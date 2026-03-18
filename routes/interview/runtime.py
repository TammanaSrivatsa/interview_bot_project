"""
routes/interview/runtime.py — Interview + timed session + OpenCV proctoring.

FIXES in this file:
  I3: interview_transcribe now returns graceful empty response instead of HTTP 500
      when Groq STT is unavailable. Candidate sees a soft warning and can type answer.

Original fixes also present:
  1. PAUSE_ON_WARNINGS_ENABLED reads from env var PROCTOR_PAUSE_ENABLED
  2. Baseline re-capture prevented on reconnect
  3. llm_eval_status set to "pending" when session completes
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from ai_engine.phase1.matching import extract_text_from_file
from fastapi.responses import RedirectResponse
from services.question_generation import build_question_bundle
from sqlalchemy.orm import Session
from ai_engine.phase3.question_flow import (
    compute_dynamic_seconds,
    next_question_payload,
    normalize_result_questions,
)
from database import get_db
from models import (
    Candidate,
    InterviewAnswer,
    InterviewQuestion,
    InterviewSession,
    JobDescription,
    ProctorEvent,
    Result,
)
from routes.common import interview_access_state, interview_entry_url
from routes.dependencies import SessionUser, require_role
from routes.schemas import InterviewAnswerBody, InterviewEventBody, InterviewStartBody
from utils.proctoring_cv import analyze_frame, compare_signatures, should_store_periodic
from utils.scoring import summarize_and_score
from utils.stt_whisper import transcribe_audio_bytes

router = APIRouter()
logger = logging.getLogger(__name__)

PROCTOR_UPLOAD_ROOT = Path("uploads") / "proctoring"
PROCTOR_UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

HIGH_MOTION_THRESHOLD = 0.20
FACE_MISMATCH_THRESHOLD = 0.78
SHOULDER_MIN_THRESHOLD = 0.55
PERIODIC_SAVE_SECONDS = 10
VIOLATION_FRAMES_PER_WARNING = 3
PAUSE_SECONDS_ON_THIRD_WARNING = 60
MAX_WARNINGS_BEFORE_PAUSE = 3

PAUSE_ON_WARNINGS_ENABLED: bool = os.getenv("PROCTOR_PAUSE_ENABLED", "false").lower() == "true"

SUSPICIOUS_TYPES = {
    "no_face",
    "multi_face",
    "face_mismatch",
    "high_motion",
    "shoulder_missing",
    "baseline_no_face",
    "baseline_multi_face",
    "baseline_no_shoulder",
    "warning_issued",
    "pause_enforced",
}


@router.get("/interview/{result_id}")
def legacy_interview_entry(result_id: int, token: str | None = None) -> RedirectResponse:
    """Redirect legacy backend interview URLs to the SPA pre-check route."""
    target = interview_entry_url(result_id) or "/"
    if token:
        target = f"{target}?token={token}"
    return RedirectResponse(url=target, status_code=307)


def _ordered_questions(db: Session, session_id: int) -> list[InterviewQuestion]:
    return (
        db.query(InterviewQuestion)
        .filter(InterviewQuestion.session_id == session_id)
        .order_by(InterviewQuestion.id.asc())
        .all()
    )


def _serialize_question(question: InterviewQuestion | None) -> dict[str, object] | None:
    if not question:
        return None
    return {
        "id": question.id,
        "text": question.text,
        "difficulty": question.difficulty,
        "topic": question.topic,
        "allotted_seconds": int(question.allotted_seconds or 0),
    }


def _pause_seconds_left(session: InterviewSession, now: datetime | None = None) -> int:
    if not PAUSE_ON_WARNINGS_ENABLED:
        return 0
    if not session.paused_until:
        return 0
    ref = now or datetime.utcnow()
    return max(0, int((session.paused_until - ref).total_seconds()))


def _clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return float(max(minimum, min(maximum, value)))


def _float_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _compute_face_score(
    faces_count: int,
    face_similarity: float | None,
    baseline_ready: bool,
) -> float:
    if faces_count != 1:
        return 0.0
    if not baseline_ready:
        return 1.0
    if face_similarity is None:
        return 0.7
    normalized = (face_similarity - FACE_MISMATCH_THRESHOLD) / (1.0 - FACE_MISMATCH_THRESHOLD)
    return _clamp(normalized)


def _frame_reasons(
    *,
    faces_count: int,
    baseline_ready: bool,
    face_similarity: float | None,
    shoulder_model_enabled: bool,
    shoulder_score: float | None,
) -> list[str]:
    reasons: list[str] = []
    if faces_count == 0:
        reasons.append("No face detected. Please face the camera.")
    elif faces_count > 1:
        reasons.append("Only one person should be visible in the frame.")
    if baseline_ready and face_similarity is not None and face_similarity < FACE_MISMATCH_THRESHOLD:
        reasons.append("Face mismatch detected. Ensure only the candidate is in front of the camera.")
    if shoulder_model_enabled and (shoulder_score is None or shoulder_score < SHOULDER_MIN_THRESHOLD):
        reasons.append("Both shoulders must be visible in frame.")
    return reasons


def _frame_status_from_reasons(reasons: list[str], faces_count: int) -> str:
    if not reasons:
        return "green"
    if faces_count == 1:
        return "amber"
    return "red"


def _get_candidate_session_or_403(
    db: Session,
    session_id: int,
    current_user: SessionUser,
) -> InterviewSession:
    session = db.query(InterviewSession).filter(InterviewSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found")
    if session.candidate_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="You can access only your own interview session")
    return session


def _resolve_candidate_result(db: Session, candidate_id: int, result_id: int | None) -> Result:
    if result_id is not None:
        result = db.query(Result).filter(
            Result.id == result_id,
            Result.candidate_id == candidate_id,
        ).first()
        if result:
            return result
        logger.warning(
            "Requested interview result not found for candidate_id=%s result_id=%s; falling back to latest available result",
            candidate_id,
            result_id,
        )

    result = (
        db.query(Result)
        .filter(
            Result.candidate_id == candidate_id,
            Result.shortlisted.is_(True),
            Result.interview_date.is_not(None),
        )
        .order_by(Result.id.desc())
        .first()
    )
    if result:
        return result

    result = (
        db.query(Result)
        .filter(Result.candidate_id == candidate_id, Result.shortlisted.is_(True))
        .order_by(Result.id.desc())
        .first()
    )
    if result:
        return result

    result = (
        db.query(Result)
        .filter(Result.candidate_id == candidate_id)
        .order_by(Result.id.desc())
        .first()
    )
    if not result:
        raise HTTPException(status_code=404, detail="No interview context found for candidate")
    return result


def _ensure_interview_ready(result: Result) -> None:
    access = interview_access_state(result)
    if access["interview_ready"]:
        return
    if access["interview_locked_reason"] == "shortlist_required":
        raise HTTPException(status_code=403, detail="Only shortlisted candidates can start interviews")
    if access["interview_locked_reason"] == "already_started":
        raise HTTPException(status_code=409, detail="Interview session is already in progress")
    if access["interview_locked_reason"] == "already_completed":
        raise HTTPException(status_code=400, detail="Interview session has already been submitted")
    raise HTTPException(status_code=400, detail="Schedule your interview before starting")


def _resolve_result_by_token(db: Session, candidate_id: int, token: str) -> Result:
    token_value = (token or "").strip()
    if not token_value:
        raise HTTPException(status_code=404, detail="Interview token is missing")
    query = db.query(Result).filter(Result.candidate_id == candidate_id)
    by_token = query.filter(Result.interview_token == token_value).order_by(Result.id.desc()).first()
    if by_token:
        return by_token
    if token_value.isdigit():
        by_id = query.filter(Result.id == int(token_value)).first()
        if by_id:
            return by_id
    raise HTTPException(status_code=404, detail="Interview token is invalid")


def _latest_interview_session(db: Session, result: Result) -> InterviewSession | None:
    return (
        db.query(InterviewSession)
        .filter(InterviewSession.result_id == result.id)
        .order_by(InterviewSession.id.desc())
        .first()
    )


def _job_title_for_result(db: Session, result: Result) -> str:
    job = db.query(JobDescription).filter(JobDescription.id == result.job_id).first()
    return str(getattr(job, "title", None) or getattr(job, "job_title", None) or "Interview")


def _create_next_question(
    db: Session,
    session: InterviewSession,
    result: Result,
    last_answer: str,
) -> InterviewQuestion | None:
    existing = _ordered_questions(db, session.id)
    max_questions = int(session.max_questions or 8)
    if len(existing) >= max_questions:
        return None

    remaining_total = int(session.remaining_time_seconds or session.total_time_seconds or 1200)
    if remaining_total <= 0:
        return None

    asked_questions = [item.text for item in existing]
    source_questions = normalize_result_questions(result.interview_questions)
    if not source_questions:
        raise HTTPException(
            status_code=400,
            detail="Interview questions are not available for this session yet. Please reopen the interview from pre-check.",
        )

    job_title = _job_title_for_result(db, result)

    try:
        generated = next_question_payload(
            source_questions=source_questions,
            asked_questions=asked_questions,
            question_index=len(existing),
            last_answer=last_answer,
            jd_title=job_title,
        )
    except RuntimeError as exc:
        logger.warning(
            "Interview question bank exhausted for session_id=%s result_id=%s existing=%s source=%s: %s",
            session.id,
            result.id,
            len(existing),
            len(source_questions),
            exc,
        )
        return None
    dynamic_seconds = compute_dynamic_seconds(
        base_seconds=int(session.per_question_seconds or 60),
        question_index=len(existing),
        last_answer=last_answer,
    )
    question = InterviewQuestion(
        session_id=session.id,
        text=generated["text"],
        difficulty=generated["difficulty"],
        topic=generated["topic"],
        question_type=str(generated.get("type") or "project"),
        intent=generated.get("intent"),
        focus_skill=generated.get("focus_skill"),
        project_name=generated.get("project_name"),
        reference_answer=generated.get("reference_answer"),
        allotted_seconds=dynamic_seconds,
    )
    db.add(question)
    db.flush()
    return question


def _needs_question_bank_refresh(
    questions: list[dict[str, object]],
    required_count: int,
) -> bool:
    return len(questions) < max(1, int(required_count or 0))


def _ensure_question_bank(
    db: Session,
    *,
    result: Result,
    candidate: Candidate,
    job: JobDescription | None,
    question_count: int,
) -> list[dict[str, object]]:
    questions = normalize_result_questions(result.interview_questions)
    if questions and not _needs_question_bank_refresh(questions, question_count):
        return questions
    if not candidate.resume_path:
        raise HTTPException(status_code=400, detail="Resume is required before interview questions can be prepared.")

    resume_text = extract_text_from_file(candidate.resume_path or "")
    if not resume_text.strip():
        raise HTTPException(status_code=400, detail="Candidate resume text could not be extracted for interview question generation.")

    logger.info("interview_question_bank_generate_start result_id=%s candidate_id=%s", result.id, candidate.id)
    bundle = build_question_bundle(
        resume_text=resume_text,
        jd_title=(job.jd_title if job else None),
        jd_skill_scores=(job.skill_scores if job else {}) or {},
        question_count=int(question_count or 8),
    )
    questions = normalize_result_questions(bundle.get("questions") or [])
    if not questions:
        raise HTTPException(status_code=400, detail="Interview questions could not be generated for this result yet.")
    if _needs_question_bank_refresh(questions, question_count):
        raise HTTPException(
            status_code=400,
            detail=f"Interview question generation produced only {len(questions)} question(s); expected at least {int(question_count or 0)}.",
        )

    result.interview_questions = questions
    db.add(result)
    db.commit()
    db.refresh(result)
    logger.info("interview_question_bank_generate_success result_id=%s questions=%s", result.id, len(questions))
    return questions


def _compose_start_response(
    session: InterviewSession,
    question: InterviewQuestion | None,
    answered_count: int,
) -> dict[str, object]:
    pause_seconds_left = _pause_seconds_left(session)
    return {
        "ok": True,
        "session_id": session.id,
        "interview_completed": question is None,
        "current_question": _serialize_question(question),
        "question_number": answered_count + (1 if question else 0),
        "max_questions": int(session.max_questions or 8),
        "time_limit_seconds": int((question.allotted_seconds if question else 0) or 0),
        "remaining_total_seconds": int(session.remaining_time_seconds or session.total_time_seconds or 1200),
        "consent_given": bool(session.consent_given),
        "warning_count": int(session.warning_count or 0),
        "paused": pause_seconds_left > 0,
        "pause_seconds_left": pause_seconds_left,
    }


@router.get("/interview/{result_id}/access")
def interview_access(
    result_id: int,
    current_user: SessionUser = Depends(require_role("candidate")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    candidate = db.query(Candidate).filter(Candidate.id == current_user.user_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    result = _resolve_candidate_result(db, candidate.id, result_id)
    access = interview_access_state(result)
    latest_session = _latest_interview_session(db, result)
    job = db.query(JobDescription).filter(JobDescription.id == result.job_id).first()
    question_count = int(job.question_count if job and job.question_count is not None else 8)
    questions = _ensure_question_bank(
        db,
        result=result,
        candidate=candidate,
        job=job,
        question_count=question_count,
    )

    return {
        "ok": True,
        "result_id": result.id,
        "shortlisted": bool(result.shortlisted),
        "interview_date": result.interview_date,
        "interview_ready": bool(access["interview_ready"]),
        "interview_locked_reason": access["interview_locked_reason"],
        "latest_session_status": str(getattr(latest_session, "status", "") or "").strip().lower() or None,
        "question_count": len(questions),
    }


@router.post("/interview/start")
def interview_start(
    payload: InterviewStartBody,
    current_user: SessionUser = Depends(require_role("candidate")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    if payload.candidate_id is not None and payload.candidate_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="candidate_id does not match logged-in user")

    candidate = db.query(Candidate).filter(Candidate.id == current_user.user_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    result = _resolve_candidate_result(db, candidate.id, payload.result_id)
    _ensure_interview_ready(result)

    job = db.query(JobDescription).filter(JobDescription.id == result.job_id).first()
    configured_max_questions = (
        int(payload.max_questions)
        if payload.max_questions is not None
        else int(job.question_count if job and job.question_count is not None else 8)
    )
    configured_max_questions = max(3, min(20, configured_max_questions))

    _ensure_question_bank(
        db,
        result=result,
        candidate=candidate,
        job=job,
        question_count=configured_max_questions,
    )
    question_bank = normalize_result_questions(result.interview_questions)
    effective_max_questions = max(1, min(configured_max_questions, len(question_bank)))

    session = (
        db.query(InterviewSession)
        .filter(
            InterviewSession.candidate_id == candidate.id,
            InterviewSession.result_id == result.id,
            InterviewSession.status == "in_progress",
        )
        .order_by(InterviewSession.id.desc())
        .first()
    )

    if not session:
        if not payload.consent_given:
            raise HTTPException(
                status_code=400,
                detail="Consent to webcam proctoring is required before starting.",
            )
        session = InterviewSession(
            candidate_id=candidate.id,
            result_id=result.id,
            status="in_progress",
            per_question_seconds=payload.per_question_seconds,
            total_time_seconds=payload.total_time_seconds,
            remaining_time_seconds=payload.total_time_seconds,
            max_questions=effective_max_questions,
            consent_given=True,
            warning_count=0,
            consecutive_violation_frames=0,
            paused_until=None,
            llm_eval_status="pending",
        )
        db.add(session)
        db.commit()
        db.refresh(session)
    elif payload.consent_given and not session.consent_given:
        session.consent_given = True
        db.commit()
        db.refresh(session)

    desired_max_questions = max(1, min(effective_max_questions, len(question_bank)))
    if int(session.max_questions or 0) != desired_max_questions:
        session.max_questions = desired_max_questions
        db.commit()
        db.refresh(session)

    if not session.consent_given:
        raise HTTPException(
            status_code=400,
            detail="Please complete consent in pre-check before starting interview.",
        )

    ordered = _ordered_questions(db, session.id)
    answered_count = sum(1 for item in ordered if item.time_taken_seconds is not None)
    current_question = next((item for item in ordered if item.time_taken_seconds is None), None)

    if not current_question:
        current_question = _create_next_question(db, session, result, last_answer="")
        if current_question:
            db.commit()
            db.refresh(current_question)

    if not current_question:
        session.status = "completed"
        session.ended_at = session.ended_at or datetime.utcnow()
        db.commit()

    return _compose_start_response(session, current_question, answered_count)


@router.post("/interview/answer")
def interview_answer(
    payload: InterviewAnswerBody,
    current_user: SessionUser = Depends(require_role("candidate")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    session = _get_candidate_session_or_403(db, payload.session_id, current_user)
    if session.status == "completed":
        raise HTTPException(status_code=400, detail="Interview session already completed")
    if not session.consent_given:
        raise HTTPException(status_code=400, detail="Consent is required before answering interview questions.")

    now = datetime.utcnow()
    pause_seconds_left = _pause_seconds_left(session, now)
    if pause_seconds_left > 0:
        raise HTTPException(
            status_code=429,
            detail=f"Interview is paused for {pause_seconds_left}s due to repeated framing violations.",
        )
    if session.paused_until and (pause_seconds_left <= 0 or not PAUSE_ON_WARNINGS_ENABLED):
        session.paused_until = None

    question = (
        db.query(InterviewQuestion)
        .filter(
            InterviewQuestion.id == payload.question_id,
            InterviewQuestion.session_id == session.id,
        )
        .first()
    )
    if not question:
        raise HTTPException(status_code=404, detail="Question not found in session")
    if question.time_taken_seconds is not None:
        raise HTTPException(status_code=400, detail="Question already answered")

    question_limit = int(question.allotted_seconds or session.per_question_seconds or 60)
    safe_time_taken = int(max(0, min(payload.time_taken_sec, question_limit)))
    started_at = now - timedelta(seconds=safe_time_taken) if safe_time_taken else now

    answer_text = (payload.answer_text or "").strip()
    if payload.skipped:
        answer_text = ""

    result = db.query(Result).filter(Result.id == session.result_id).first()
    if not result:
        raise HTTPException(status_code=404, detail="Interview result not found")

    job = db.query(JobDescription).filter(JobDescription.id == result.job_id).first()
    summary, relevance_score, score_breakdown = summarize_and_score(
        question.text,
        answer_text,
        allotted_seconds=question_limit,
        time_taken_seconds=safe_time_taken,
        jd_skills=(job.skill_scores or {}).keys() if job else (),
    )

    answer = (
        db.query(InterviewAnswer)
        .filter(
            InterviewAnswer.session_id == session.id,
            InterviewAnswer.question_id == question.id,
        )
        .order_by(InterviewAnswer.id.desc())
        .first()
    )
    if answer:
        answer.answer_text = answer_text if not payload.skipped else None
        answer.skipped = payload.skipped
        answer.time_taken_sec = safe_time_taken
        answer.started_at = started_at
        answer.ended_at = now
    else:
        answer = InterviewAnswer(
            session_id=session.id,
            question_id=question.id,
            answer_text=answer_text if not payload.skipped else None,
            skipped=payload.skipped,
            time_taken_sec=safe_time_taken,
            started_at=started_at,
            ended_at=now,
        )
        db.add(answer)

    question.answer_text = answer_text if not payload.skipped else None
    question.answer_summary = summary
    question.relevance_score = relevance_score
    question.skipped = payload.skipped
    question.time_taken_seconds = safe_time_taken

    current_remaining = int(session.remaining_time_seconds or session.total_time_seconds or 1200)
    session.remaining_time_seconds = max(0, current_remaining - safe_time_taken)

    ordered = _ordered_questions(db, session.id)
    answered_count = sum(1 for item in ordered if item.time_taken_seconds is not None)

    interview_completed = False
    next_question = None
    max_questions = int(session.max_questions or 8)
    if (session.remaining_time_seconds or 0) <= 0 or answered_count >= max_questions:
        interview_completed = True
    else:
        next_question = _create_next_question(db, session, result, answer_text)
        interview_completed = next_question is None

    if interview_completed:
        session.status = "completed"
        session.ended_at = now
        session.llm_eval_status = "pending"
        db.commit()
        return {
            "ok": True,
            "interview_completed": True,
            "remaining_total_seconds": int(session.remaining_time_seconds or 0),
            "next_question": None,
            "question_number": answered_count,
            "max_questions": max_questions,
            "time_limit_seconds": 0,
            "feedback": None,
        }

    db.commit()
    db.refresh(next_question)
    return {
        "ok": True,
        "interview_completed": False,
        "remaining_total_seconds": int(session.remaining_time_seconds or 0),
        "next_question": _serialize_question(next_question),
        "question_number": answered_count + 1,
        "max_questions": max_questions,
        "time_limit_seconds": int(next_question.allotted_seconds or session.per_question_seconds or 60),
        "feedback": {
            "overall_score": score_breakdown["overall_score"],
            "relevance": score_breakdown["relevance"],
            "completeness": score_breakdown["completeness"],
            "clarity": score_breakdown["clarity"],
            "time_fit": score_breakdown["time_fit"],
            "word_count": score_breakdown["word_count"],
        } if (not payload.skipped and answer_text) else None,
    }


@router.post("/interview/transcribe")
def interview_transcribe(
    audio: UploadFile = File(...),
    language: str = Form("en"),
    context_hint: str = Form(""),
    current_user: SessionUser = Depends(require_role("candidate")),
) -> dict[str, object]:
    _ = current_user
    raw = audio.file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Audio payload is empty")

    try:
        transcript = transcribe_audio_bytes(
            raw,
            language=language,
            filename=audio.filename,
            context_hint=context_hint,
        )
    except Exception as exc:
        logger.warning(
            "STT transcription unavailable (Groq error) — returning empty transcript. Error: %s",
            exc,
        )
        return {
            "ok": True,
            "text": "",
            "confidence": 0.0,
            "low_confidence": True,
            "language": language,
            "degraded": True,
        }

    return {"ok": True, **transcript}


@router.post("/interview/{token}/event")
def interview_event(
    token: str,
    payload: InterviewEventBody,
    current_user: SessionUser = Depends(require_role("candidate")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    result = _resolve_result_by_token(db, current_user.user_id, token)
    latest_session = (
        db.query(InterviewSession)
        .filter(
            InterviewSession.candidate_id == current_user.user_id,
            InterviewSession.result_id == result.id,
        )
        .order_by(InterviewSession.id.desc())
        .first()
    )

    normalized_event_type = (payload.event_type or "").strip().lower()
    if not normalized_event_type:
        raise HTTPException(status_code=400, detail="event_type is required")

    event_payload: dict[str, object] = {
        "event_type": normalized_event_type,
        "detail": (payload.detail or "").strip() or None,
        "timestamp": (payload.timestamp or "").strip() or datetime.utcnow().isoformat(),
        "meta": payload.meta if isinstance(payload.meta, dict) else {},
        "session_id": latest_session.id if latest_session else None,
    }

    existing_events: list[dict[str, object]]
    if isinstance(result.events_json, list):
        existing_events = [item for item in result.events_json if isinstance(item, dict)]
    elif isinstance(result.events_json, dict):
        existing_events = [result.events_json]
    else:
        existing_events = []

    existing_events.append(event_payload)
    if len(existing_events) > 500:
        existing_events = existing_events[-500:]

    result.events_json = existing_events
    db.commit()
    return {"ok": True, "event_count": len(existing_events), "event": event_payload}


@router.post("/proctor/frame")
def upload_proctor_frame(
    file: UploadFile = File(...),
    session_id: int = Form(...),
    event_type: str = Form("scan"),
    current_user: SessionUser = Depends(require_role("candidate")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    session = _get_candidate_session_or_403(db, session_id, current_user)

    raw = file.file.read()
    frame = analyze_frame(session.id, raw)
    if not frame["ok"]:
        raise HTTPException(status_code=400, detail=str(frame["error"]))

    now = datetime.utcnow()
    if session.paused_until and (session.paused_until <= now or not PAUSE_ON_WARNINGS_ENABLED):
        session.paused_until = None

    faces_count = int(frame["faces_count"])
    motion_score = float(frame["motion_score"])
    current_signature = frame["face_signature"]
    opencv_enabled = bool(frame.get("opencv_enabled"))
    shoulder_model_enabled = bool(frame.get("shoulder_model_enabled"))
    left_shoulder_visibility = _float_or_none(frame.get("left_shoulder_visibility"))
    right_shoulder_visibility = _float_or_none(frame.get("right_shoulder_visibility"))
    shoulder_score_raw = _float_or_none(frame.get("shoulder_score"))
    upper_bodies_count = int(frame.get("upper_bodies_count") or 0)

    baseline_signature = None
    if session.baseline_face_signature:
        try:
            baseline_signature = [float(item) for item in json.loads(session.baseline_face_signature)]
        except Exception:
            baseline_signature = None

    face_similarity = None
    if baseline_signature and current_signature:
        face_similarity = compare_signatures(baseline_signature, current_signature)

    baseline_ready = bool(session.baseline_face_signature)
    shoulder_score = shoulder_score_raw if shoulder_score_raw is not None else (1.0 if not shoulder_model_enabled else 0.0)
    face_score = _compute_face_score(faces_count, face_similarity, baseline_ready=baseline_ready)
    compliance_score = _clamp((0.6 * face_score) + (0.4 * shoulder_score))
    frame_reasons = _frame_reasons(
        faces_count=faces_count,
        baseline_ready=baseline_ready,
        face_similarity=face_similarity,
        shoulder_model_enabled=shoulder_model_enabled,
        shoulder_score=shoulder_score_raw,
    )
    frame_ready = len(frame_reasons) == 0
    frame_status = _frame_status_from_reasons(frame_reasons, faces_count)

    requested_event = (event_type or "").strip().lower()
    if requested_event not in {"scan", "baseline", "frame_check"}:
        requested_event = "scan"

    resolved_event_type = "periodic"
    action = "ok"
    warning_triggered = False
    pause_enforced = False
    suspicious = False
    pause_seconds_left = _pause_seconds_left(session, now)
    violation_for_warning = False

    if requested_event == "baseline":
        if not opencv_enabled:
            resolved_event_type = "baseline"
        elif faces_count == 0:
            resolved_event_type = "baseline_no_face"
        elif faces_count > 1:
            resolved_event_type = "baseline_multi_face"
        elif shoulder_model_enabled and shoulder_score < SHOULDER_MIN_THRESHOLD:
            resolved_event_type = "baseline_no_shoulder"
        elif current_signature:
            if not session.baseline_face_signature:
                session.baseline_face_signature = json.dumps(current_signature)
                session.baseline_face_captured_at = now
                baseline_ready = True
            resolved_event_type = "baseline"
        else:
            resolved_event_type = "baseline_no_face"
    elif requested_event == "frame_check":
        resolved_event_type = "frame_check_ok" if frame_ready else "frame_check_adjust"
        action = "adjust" if not frame_ready else "ok"
    else:
        if pause_seconds_left > 0:
            resolved_event_type = "pause_active"
            action = "paused"
        else:
            if faces_count == 0:
                resolved_event_type = "no_face"
            elif faces_count > 1:
                resolved_event_type = "multi_face"
            elif (
                baseline_signature
                and current_signature
                and face_similarity is not None
                and face_similarity < FACE_MISMATCH_THRESHOLD
            ):
                resolved_event_type = "face_mismatch"
            elif shoulder_model_enabled and shoulder_score < SHOULDER_MIN_THRESHOLD:
                resolved_event_type = "shoulder_missing"
            elif motion_score > HIGH_MOTION_THRESHOLD:
                resolved_event_type = "high_motion"
            else:
                resolved_event_type = "periodic"

            violation_for_warning = resolved_event_type in {
                "no_face",
                "multi_face",
                "face_mismatch",
                "shoulder_missing",
            }
            if violation_for_warning:
                session.consecutive_violation_frames = int(session.consecutive_violation_frames or 0) + 1
                if session.consecutive_violation_frames >= VIOLATION_FRAMES_PER_WARNING:
                    session.warning_count = int(session.warning_count or 0) + 1
                    session.consecutive_violation_frames = 0
                    warning_triggered = True
                    resolved_event_type = "warning_issued"
                    action = "warning"
                    if PAUSE_ON_WARNINGS_ENABLED and int(session.warning_count or 0) >= MAX_WARNINGS_BEFORE_PAUSE:
                        session.paused_until = now + timedelta(seconds=PAUSE_SECONDS_ON_THIRD_WARNING)
                        pause_seconds_left = PAUSE_SECONDS_ON_THIRD_WARNING
                        pause_enforced = True
                        resolved_event_type = "pause_enforced"
                        action = "paused"
            else:
                session.consecutive_violation_frames = 0
                if resolved_event_type == "high_motion":
                    action = "observe"

    pause_seconds_left = _pause_seconds_left(session, now)
    paused = pause_seconds_left > 0
    suspicious = resolved_event_type in SUSPICIOUS_TYPES

    should_store = False
    if requested_event == "baseline":
        should_store = True
    elif requested_event == "scan":
        should_store = suspicious or warning_triggered or pause_enforced
        if resolved_event_type in {"periodic", "pause_active"}:
            should_store = should_store_periodic(session.id, PERIODIC_SAVE_SECONDS)

    payload_out = {
        "ok": True,
        "stored": False,
        "event_type": resolved_event_type,
        "requested_event_type": requested_event,
        "suspicious": suspicious,
        "action": action,
        "motion_score": motion_score,
        "faces_count": faces_count,
        "face_similarity": face_similarity,
        "face_score": round(face_score, 4),
        "left_shoulder_visibility": left_shoulder_visibility,
        "right_shoulder_visibility": right_shoulder_visibility,
        "shoulder_score": round(shoulder_score, 4),
        "shoulder_model_enabled": shoulder_model_enabled,
        "upper_bodies_count": upper_bodies_count,
        "compliance_score": round(compliance_score, 4),
        "frame_ready": frame_ready,
        "frame_status": frame_status,
        "frame_reasons": frame_reasons,
        "warning_count": int(session.warning_count or 0),
        "consecutive_violation_frames": int(session.consecutive_violation_frames or 0),
        "warning_triggered": warning_triggered,
        "paused": paused,
        "pause_seconds_left": pause_seconds_left,
        "baseline_ready": baseline_ready,
        "opencv_enabled": bool(frame.get("opencv_enabled")),
    }

    if not should_store:
        db.commit()
        return payload_out

    session_dir = PROCTOR_UPLOAD_ROOT / str(session.id)
    session_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%S%f")
    file_path = session_dir / f"{timestamp}.jpg"
    file_path.write_bytes(raw)

    relative_path = file_path.relative_to(Path("uploads")).as_posix()
    score = float(motion_score)
    if resolved_event_type in {"no_face", "multi_face", "face_mismatch", "shoulder_missing"}:
        score += 1.0
    elif resolved_event_type == "high_motion":
        score += 0.7
    elif resolved_event_type in {"warning_issued", "pause_enforced"}:
        score += 1.2
    elif resolved_event_type in {"baseline", "baseline_no_face", "baseline_multi_face", "baseline_no_shoulder"}:
        score = 0.0 if resolved_event_type == "baseline" else 1.0
    if not frame_ready:
        score += 0.25

    event = ProctorEvent(
        session_id=session.id,
        event_type=resolved_event_type,
        score=round(float(score), 4),
        meta_json={
            "faces_count": faces_count,
            "motion_score": round(motion_score, 4),
            "face_similarity": round(face_similarity, 4) if face_similarity is not None else None,
            "face_score": round(face_score, 4),
            "left_shoulder_visibility": left_shoulder_visibility,
            "right_shoulder_visibility": right_shoulder_visibility,
            "shoulder_score": round(shoulder_score, 4),
            "shoulder_model_enabled": shoulder_model_enabled,
            "compliance_score": round(compliance_score, 4),
            "frame_ready": frame_ready,
            "frame_status": frame_status,
            "frame_reasons": frame_reasons,
            "baseline_ready": bool(session.baseline_face_signature),
            "suspicious": suspicious,
            "warning_count": int(session.warning_count or 0),
            "warning_triggered": warning_triggered,
            "paused": paused,
            "pause_seconds_left": pause_seconds_left,
            "opencv_enabled": bool(frame.get("opencv_enabled")),
            "requested_event_type": requested_event,
            "upper_bodies_count": upper_bodies_count,
        },
        image_path=relative_path,
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    payload_out["stored"] = True
    payload_out["event_id"] = event.id
    payload_out["image_url"] = f"/uploads/{relative_path}"
    return payload_out


@router.get("/hr/proctoring/{session_id}")
def hr_proctoring_timeline(
    session_id: int,
    request: Request,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    session = (
        db.query(InterviewSession)
        .join(Result, InterviewSession.result_id == Result.id)
        .join(JobDescription, Result.job_id == JobDescription.id)
        .filter(
            InterviewSession.id == session_id,
            JobDescription.company_id == current_user.user_id,
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found for this HR account")

    candidate = db.query(Candidate).filter(Candidate.id == session.candidate_id).first()
    events = (
        db.query(ProctorEvent)
        .filter(ProctorEvent.session_id == session.id)
        .order_by(ProctorEvent.created_at.asc())
        .all()
    )
    base_url = str(request.base_url).rstrip("/")

    return {
        "ok": True,
        "session": {
            "id": session.id,
            "candidate_id": session.candidate_id,
            "candidate_name": candidate.name if candidate else None,
            "status": session.status,
            "started_at": session.started_at,
            "ended_at": session.ended_at,
            "per_question_seconds": session.per_question_seconds,
            "remaining_time_seconds": session.remaining_time_seconds,
            "max_questions": session.max_questions,
            "baseline_captured": bool(session.baseline_face_signature),
            "consent_given": bool(session.consent_given),
            "warning_count": int(session.warning_count or 0),
            "paused": _pause_seconds_left(session) > 0,
            "pause_seconds_left": _pause_seconds_left(session),
            "llm_eval_status": session.llm_eval_status or "pending",
        },
        "timeline": [
            {
                "id": event.id,
                "created_at": event.created_at,
                "event_type": event.event_type,
                "score": float(event.score),
                "meta_json": event.meta_json or {},
                "suspicious": event.event_type in SUSPICIOUS_TYPES,
                "image_url": f"{base_url}/uploads/{event.image_path}" if event.image_path else None,
            }
            for event in events
        ],
    }
