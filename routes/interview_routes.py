"""Interview + timed session + proctoring routes."""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

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

router = APIRouter()

PROCTOR_UPLOAD_ROOT = Path("uploads") / "proctoring"
PROCTOR_UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

FALLBACK_SESSION_QUESTIONS = (
    "Introduce yourself and summarize your recent technical work.",
    "Describe a production issue you debugged and how you resolved it.",
    "How would you design a scalable API endpoint with pagination and caching?",
    "Tell me about a trade-off you made between delivery speed and code quality.",
    "What areas do you want to improve in over the next 6 months?",
)


def _extract_questions_from_result(result: Result | None) -> list[dict[str, str]]:
    payload = result.interview_questions if result else None
    normalized: list[dict[str, str]] = []

    candidates: list[object] = []
    if isinstance(payload, list):
        candidates = payload
    elif isinstance(payload, dict):
        questions = payload.get("questions")
        if isinstance(questions, list):
            candidates = questions

    for item in candidates:
        if isinstance(item, str):
            text = item.strip()
            if text:
                normalized.append({"text": text, "difficulty": "medium", "topic": "general"})
            continue
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or item.get("question") or "").strip()
        if not text:
            continue
        normalized.append(
            {
                "text": text,
                "difficulty": str(item.get("difficulty") or "medium"),
                "topic": str(item.get("topic") or "general"),
            }
        )

    if normalized:
        return normalized
    return [{"text": text, "difficulty": "medium", "topic": "general"} for text in FALLBACK_SESSION_QUESTIONS]


def _serialize_session_questions(session: InterviewSession) -> list[dict[str, object]]:
    questions = sorted(session.questions, key=lambda q: q.id)
    return [{"id": question.id, "text": question.text} for question in questions]


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

    existing_session = (
        db.query(InterviewSession)
        .filter(
            InterviewSession.candidate_id == candidate.id,
            InterviewSession.result_id == result.id,
            InterviewSession.status == "in_progress",
        )
        .order_by(InterviewSession.id.desc())
        .first()
    )
    if existing_session and existing_session.questions:
        return {
            "ok": True,
            "session_id": existing_session.id,
            "questions": _serialize_session_questions(existing_session),
            "per_question_seconds": existing_session.per_question_seconds,
        }

    session = InterviewSession(
        candidate_id=candidate.id,
        result_id=result.id,
        status="in_progress",
        per_question_seconds=payload.per_question_seconds,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    for item in _extract_questions_from_result(result):
        db.add(
            InterviewQuestion(
                session_id=session.id,
                text=item["text"],
                difficulty=item["difficulty"],
                topic=item["topic"],
            )
        )
    db.commit()
    db.refresh(session)

    return {
        "ok": True,
        "session_id": session.id,
        "questions": _serialize_session_questions(session),
        "per_question_seconds": session.per_question_seconds,
    }


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

    now = datetime.utcnow()
    safe_time_taken = int(max(0, payload.time_taken_sec))
    started_at = now - timedelta(seconds=safe_time_taken) if safe_time_taken else now

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
        answer.answer_text = payload.answer_text
        answer.skipped = payload.skipped
        answer.time_taken_sec = safe_time_taken
        answer.started_at = started_at
        answer.ended_at = now
    else:
        answer = InterviewAnswer(
            session_id=session.id,
            question_id=question.id,
            answer_text=payload.answer_text,
            skipped=payload.skipped,
            time_taken_sec=safe_time_taken,
            started_at=started_at,
            ended_at=now,
        )
        db.add(answer)

    question.answer_text = payload.answer_text if not payload.skipped else None
    question.skipped = payload.skipped
    question.time_taken_seconds = safe_time_taken
    db.commit()

    question_ids = [
        row[0]
        for row in db.query(InterviewQuestion.id)
        .filter(InterviewQuestion.session_id == session.id)
        .order_by(InterviewQuestion.id.asc())
        .all()
    ]
    current_index = question_ids.index(question.id)
    next_index = current_index + 1
    interview_completed = next_index >= len(question_ids)
    if interview_completed:
        session.status = "completed"
        session.ended_at = now
        db.commit()

    return {
        "ok": True,
        "next_question_index": None if interview_completed else next_index,
        "interview_completed": interview_completed,
    }


@router.post("/proctor/frame")
def upload_proctor_frame(
    file: UploadFile = File(...),
    session_id: int = Form(...),
    event_flags: str = Form("{}"),
    motion_score: float = Form(0.0),
    faces_count: int = Form(0),
    event_type: str = Form(""),
    current_user: SessionUser = Depends(require_role("candidate")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    session = _get_candidate_session_or_403(db, session_id, current_user)

    try:
        flags_payload = json.loads(event_flags) if event_flags else {}
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="event_flags must be valid JSON") from exc

    if not isinstance(flags_payload, dict):
        flags_payload = {}
    normalized_flags = {str(key): bool(value) for key, value in flags_payload.items()}

    resolved_event_type = (event_type or "").strip()
    if not resolved_event_type:
        if normalized_flags.get("no_face"):
            resolved_event_type = "no_face"
        elif normalized_flags.get("multi_face"):
            resolved_event_type = "multi_face"
        elif normalized_flags.get("high_motion"):
            resolved_event_type = "high_motion"
        else:
            resolved_event_type = "periodic"

    session_dir = PROCTOR_UPLOAD_ROOT / str(session.id)
    session_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%S%f")
    file_path = session_dir / f"{timestamp}.jpg"
    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    relative_path = file_path.relative_to(Path("uploads")).as_posix()
    flag_score = sum(1.0 for value in normalized_flags.values() if value)
    score = round(float(max(motion_score, 0.0)) + flag_score, 4)
    if resolved_event_type == "baseline":
        score = 0.0

    event = ProctorEvent(
        session_id=session.id,
        event_type=resolved_event_type,
        score=score,
        meta_json={
            "event_flags": normalized_flags,
            "motion_score": float(motion_score),
            "faces_count": int(faces_count),
        },
        image_path=relative_path,
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    return {
        "ok": True,
        "event_id": event.id,
        "event_type": event.event_type,
        "image_url": f"/uploads/{relative_path}",
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
        },
        "timeline": [
            {
                "id": event.id,
                "created_at": event.created_at,
                "event_type": event.event_type,
                "score": float(event.score),
                "meta_json": event.meta_json or {},
                "image_url": f"{base_url}/uploads/{event.image_path}" if event.image_path else None,
            }
            for event in events
        ],
    }
