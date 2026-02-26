"""Candidate-facing timed interview + proctoring APIs."""

from __future__ import annotations

import base64
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from models import Candidate, InterviewQuestion, InterviewSession, JobDescription, Result
from routes.common import validate_interview_access
from utils.scoring import summarize_and_score

router = APIRouter(prefix="/interview", tags=["interview"])

PROCTOR_DIR = Path("uploads") / "proctor"
PROCTOR_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_TIME_LIMIT = 45


class StartResponse(BaseModel):
    interview_id: int
    candidate_id: int
    job_id: int
    application_id: Optional[str]
    time_limit_seconds: int
    questions: list[dict[str, object]]


class AnswerBody(BaseModel):
    question_id: int
    answer_text: Optional[str] = ""
    skipped: bool = False
    time_taken_seconds: int = Field(default=0, ge=0, le=900)


class EventBody(BaseModel):
    event_type: str
    confidence: float = Field(ge=0.0, le=1.0)
    question_id: Optional[int] = None
    snapshot_base64: Optional[str] = None


def _get_session_by_token(db: Session, token: str) -> tuple[InterviewSession, Result, Candidate, JobDescription]:
    result = db.query(Result).filter(Result.interview_token == token).first()
    if not validate_interview_access(result, token):
        raise HTTPException(status_code=403, detail="Invalid interview token")
    if not result.application_id:
        result.application_id = f"APP-{result.job_id}-{result.candidate_id}-{uuid.uuid4().hex[:6].upper()}"
        db.commit()

    session = (
        db.query(InterviewSession)
        .filter(InterviewSession.result_id == result.id)
        .order_by(InterviewSession.id.desc())
        .first()
    )
    if not session:
        session = InterviewSession(
            candidate_id=result.candidate_id,
            result_id=result.id,
            status="in_progress",
            per_question_seconds=DEFAULT_TIME_LIMIT,
        )
        db.add(session)
        db.commit()
        db.refresh(session)

    candidate = db.query(Candidate).filter(Candidate.id == result.candidate_id).first()
    job = db.query(JobDescription).filter(JobDescription.id == result.job_id).first()
    if not candidate or not job:
        raise HTTPException(status_code=404, detail="Interview context not found")
    return session, result, candidate, job


@router.get("/{token}/start", response_model=StartResponse)
def start_interview(token: str, db: Session = Depends(get_db)):
    session, result, candidate, job = _get_session_by_token(db, token)

    if not session.questions:
        questions_source = result.interview_questions or []
        if not questions_source:
            raise HTTPException(status_code=400, detail="No questions configured for this interview")
        for q in questions_source:
            text = q["text"] if isinstance(q, dict) else str(q)
            db.add(
                InterviewQuestion(
                    session_id=session.id,
                    text=text,
                    difficulty="medium",
                    topic="general",
                )
            )
        db.commit()
        db.refresh(session)

    questions = [
        {
            "id": q.id,
            "text": q.text,
            "answer_text": q.answer_text,
            "skipped": q.skipped,
            "relevance_score": q.relevance_score,
        }
        for q in session.questions
    ]

    return StartResponse(
        interview_id=session.id,
        candidate_id=candidate.id,
        job_id=job.id,
        application_id=result.application_id,
        time_limit_seconds=session.per_question_seconds or DEFAULT_TIME_LIMIT,
        questions=questions,
    )


@router.post("/{token}/answer")
def submit_answer(token: str, payload: AnswerBody, db: Session = Depends(get_db)) -> dict[str, object]:
    session, result, _candidate, _job = _get_session_by_token(db, token)

    question = db.query(InterviewQuestion).filter(
        InterviewQuestion.id == payload.question_id,
        InterviewQuestion.session_id == session.id,
    ).first()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    answer_text = (payload.answer_text or "").strip()
    skipped = bool(payload.skipped)

    # Compute simple summary + score
    summary, score = summarize_and_score(question.text, answer_text)

    question.answer_text = answer_text if not skipped else None
    question.skipped = skipped
    question.time_taken_seconds = payload.time_taken_seconds
    question.answer_summary = summary
    question.relevance_score = score
    db.commit()

    next_question_id = None
    ordered = [q.id for q in db.query(InterviewQuestion).filter(InterviewQuestion.session_id == session.id).order_by(InterviewQuestion.id).all()]
    if question.id in ordered:
        idx = ordered.index(question.id)
        if idx + 1 < len(ordered):
            next_question_id = ordered[idx + 1]
    return {"ok": True, "next_question_id": next_question_id}


def _save_snapshot(interview_id: int, b64: str) -> str:
    try:
        raw = base64.b64decode(b64.split(",")[-1], validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid snapshot_base64")
    folder = PROCTOR_DIR / str(interview_id)
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.jpg"
    path = folder / name
    path.write_bytes(raw)
    return path.as_posix()


@router.post("/{token}/event")
def record_event(token: str, payload: EventBody, db: Session = Depends(get_db)) -> dict[str, object]:
    session, result, _candidate, _job = _get_session_by_token(db, token)

    snapshot_path = None
    if payload.snapshot_base64:
        snapshot_path = _save_snapshot(session.id, payload.snapshot_base64)

    db.execute(
        """
        INSERT INTO interview_proctor_events(interview_id, question_id, event_type, confidence, created_at, snapshot_path)
        VALUES (:interview_id, :question_id, :event_type, :confidence, :created_at, :snapshot_path)
        """,
        {
            "interview_id": session.id,
            "question_id": payload.question_id,
            "event_type": payload.event_type,
            "confidence": float(payload.confidence),
            "created_at": datetime.utcnow(),
            "snapshot_path": snapshot_path,
        },
    )
    db.commit()
    return {"ok": True, "snapshot_path": snapshot_path}
