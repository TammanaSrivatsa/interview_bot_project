"""Interview + timed session + OpenCV proctoring routes."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from ai_engine.interview_question_flow import (
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
from routes.dependencies import SessionUser, require_role
from routes.schemas import InterviewAnswerBody, InterviewStartBody
from utils.proctoring_cv import analyze_frame, compare_signatures, should_store_periodic
from utils.scoring import summarize_and_score

router = APIRouter()

PROCTOR_UPLOAD_ROOT = Path("uploads") / "proctoring"
PROCTOR_UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

HIGH_MOTION_THRESHOLD = 0.20
FACE_MISMATCH_THRESHOLD = 0.78
PERIODIC_SAVE_SECONDS = 10
SUSPICIOUS_TYPES = {"no_face", "multi_face", "face_mismatch", "high_motion", "baseline_no_face", "baseline_multi_face"}


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
        result = (
            db.query(Result)
            .filter(Result.id == result_id, Result.candidate_id == candidate_id)
            .first()
        )
        if not result:
            raise HTTPException(status_code=404, detail="Interview result not found")
        return result

    result = (
        db.query(Result)
        .filter(Result.candidate_id == candidate_id, Result.shortlisted.is_(True))
        .order_by(Result.id.desc())
        .first()
    )
    if result:
        return result

    result = db.query(Result).filter(Result.candidate_id == candidate_id).order_by(Result.id.desc()).first()
    if not result:
        raise HTTPException(status_code=404, detail="No interview context found for candidate")
    return result


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
    job = db.query(JobDescription).filter(JobDescription.id == result.job_id).first()
    job_title = (job.jd_title if job else "") or "the role"
    generated = next_question_payload(
        source_questions=source_questions,
        asked_questions=asked_questions,
        question_index=len(existing),
        last_answer=last_answer,
        jd_title=job_title,
    )
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
        allotted_seconds=dynamic_seconds,
    )
    db.add(question)
    db.flush()
    return question


def _compose_start_response(
    session: InterviewSession,
    question: InterviewQuestion | None,
    answered_count: int,
) -> dict[str, object]:
    return {
        "ok": True,
        "session_id": session.id,
        "interview_completed": question is None,
        "current_question": _serialize_question(question),
        "question_number": answered_count + (1 if question else 0),
        "max_questions": int(session.max_questions or 8),
        "time_limit_seconds": int((question.allotted_seconds if question else 0) or 0),
        "remaining_total_seconds": int(session.remaining_time_seconds or session.total_time_seconds or 1200),
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
        session = InterviewSession(
            candidate_id=candidate.id,
            result_id=result.id,
            status="in_progress",
            per_question_seconds=payload.per_question_seconds,
            total_time_seconds=payload.total_time_seconds,
            remaining_time_seconds=payload.total_time_seconds,
            max_questions=payload.max_questions,
        )
        db.add(session)
        db.commit()
        db.refresh(session)

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

    now = datetime.utcnow()
    question_limit = int(question.allotted_seconds or session.per_question_seconds or 60)
    safe_time_taken = int(max(0, min(payload.time_taken_sec, question_limit)))
    started_at = now - timedelta(seconds=safe_time_taken) if safe_time_taken else now

    answer_text = (payload.answer_text or "").strip()
    if payload.skipped:
        answer_text = ""

    summary, relevance_score = summarize_and_score(question.text, answer_text)

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
    result = db.query(Result).filter(Result.id == session.result_id).first()
    if not result:
        raise HTTPException(status_code=404, detail="Interview result not found")

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
        db.commit()
        return {
            "ok": True,
            "interview_completed": True,
            "remaining_total_seconds": int(session.remaining_time_seconds or 0),
            "next_question": None,
            "question_number": answered_count,
            "max_questions": max_questions,
            "time_limit_seconds": 0,
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
    }


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

    faces_count = int(frame["faces_count"])
    motion_score = float(frame["motion_score"])
    current_signature = frame["face_signature"]
    opencv_enabled = bool(frame.get("opencv_enabled"))
    baseline_signature = None
    if session.baseline_face_signature:
        try:
            baseline_signature = [float(item) for item in json.loads(session.baseline_face_signature)]
        except Exception:
            baseline_signature = None

    face_similarity = None
    if baseline_signature and current_signature:
        face_similarity = compare_signatures(baseline_signature, current_signature)

    requested_event = (event_type or "").strip().lower()
    resolved_event_type = "periodic"
    if requested_event == "baseline":
        if not opencv_enabled:
            resolved_event_type = "baseline"
        elif faces_count == 1 and current_signature:
            session.baseline_face_signature = json.dumps(current_signature)
            session.baseline_face_captured_at = datetime.utcnow()
            resolved_event_type = "baseline"
        elif faces_count == 0:
            resolved_event_type = "baseline_no_face"
        else:
            resolved_event_type = "baseline_multi_face"
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
        elif motion_score > HIGH_MOTION_THRESHOLD:
            resolved_event_type = "high_motion"

    suspicious = resolved_event_type in SUSPICIOUS_TYPES
    should_store = suspicious or resolved_event_type.startswith("baseline")
    if resolved_event_type == "periodic":
        should_store = should_store_periodic(session.id, PERIODIC_SAVE_SECONDS)

    if not should_store:
        db.commit()
        return {
            "ok": True,
            "stored": False,
            "event_type": resolved_event_type,
            "suspicious": False,
            "motion_score": motion_score,
            "faces_count": faces_count,
        }

    session_dir = PROCTOR_UPLOAD_ROOT / str(session.id)
    session_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%S%f")
    file_path = session_dir / f"{timestamp}.jpg"
    file_path.write_bytes(raw)

    relative_path = file_path.relative_to(Path("uploads")).as_posix()
    score = motion_score
    if resolved_event_type in {"no_face", "multi_face", "face_mismatch"}:
        score += 1.0
    elif resolved_event_type == "high_motion":
        score += 0.7
    elif resolved_event_type in {"baseline", "baseline_no_face", "baseline_multi_face"}:
        score = 0.0 if resolved_event_type == "baseline" else 1.0

    event = ProctorEvent(
        session_id=session.id,
        event_type=resolved_event_type,
        score=round(float(score), 4),
        meta_json={
            "faces_count": faces_count,
            "motion_score": round(motion_score, 4),
            "face_similarity": round(face_similarity, 4) if face_similarity is not None else None,
            "baseline_ready": bool(session.baseline_face_signature),
            "suspicious": suspicious,
            "opencv_enabled": bool(frame.get("opencv_enabled")),
            "requested_event_type": requested_event or "scan",
        },
        image_path=relative_path,
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    return {
        "ok": True,
        "stored": True,
        "event_id": event.id,
        "event_type": event.event_type,
        "suspicious": suspicious,
        "image_url": f"/uploads/{relative_path}",
        "motion_score": motion_score,
        "faces_count": faces_count,
        "face_similarity": face_similarity,
    }


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
