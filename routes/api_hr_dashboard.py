"""HR dashboard APIs for interviews and proctoring review."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models import Candidate, InterviewProctorEvent, InterviewQuestion, InterviewSession, JobDescription, Result
from routes.dependencies import require_role, SessionUser

router = APIRouter(prefix="/hr", tags=["hr"])


@router.get("/interviews")
def list_interviews(current_user: SessionUser = Depends(require_role("hr")), db: Session = Depends(get_db)):
    # HR owns jobs; gather sessions via results->jobs.
    sessions = (
        db.query(InterviewSession)
        .join(Result, InterviewSession.result_id == Result.id)
        .join(JobDescription, Result.job_id == JobDescription.id)
        .options(joinedload(InterviewSession.result), joinedload(InterviewSession.candidate))
        .filter(JobDescription.company_id == current_user.user_id)
        .all()
    )

    counts = (
        db.query(InterviewProctorEvent.interview_id, func.count(InterviewProctorEvent.id))
        .group_by(InterviewProctorEvent.interview_id)
        .all()
    )
    count_map = {iid: cnt for iid, cnt in counts}

    payload = []
    for session in sessions:
        result = session.result
        candidate = session.candidate
        job = db.query(JobDescription).filter(JobDescription.id == result.job_id).first()
        payload.append(
            {
                "interview_id": session.id,
                "application_id": result.application_id,
                "candidate": {"id": candidate.id, "name": candidate.name, "email": candidate.email},
                "job": {"id": job.id if job else None, "title": job.jd_title if job else None},
                "status": session.status,
                "started_at": session.started_at,
                "ended_at": session.ended_at,
                "events_count": count_map.get(session.id, 0),
            }
        )
    return {"ok": True, "interviews": payload}


@router.get("/interviews/{interview_id}")
def interview_detail(
    interview_id: int,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
):
    session = (
        db.query(InterviewSession)
        .join(Result, InterviewSession.result_id == Result.id)
        .join(JobDescription, Result.job_id == JobDescription.id)
        .options(joinedload(InterviewSession.questions))
        .filter(InterviewSession.id == interview_id, JobDescription.company_id == current_user.user_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Interview not found")

    result = session.result
    candidate = db.query(Candidate).filter(Candidate.id == session.candidate_id).first()
    job = db.query(JobDescription).filter(JobDescription.id == result.job_id).first()
    events = (
        db.query(InterviewProctorEvent)
        .filter(InterviewProctorEvent.interview_id == session.id)
        .order_by(InterviewProctorEvent.created_at.asc())
        .all()
    )

    return {
        "ok": True,
        "interview": {
            "interview_id": session.id,
            "application_id": result.application_id,
            "candidate": {"id": candidate.id, "name": candidate.name, "email": candidate.email},
            "job": {"id": job.id if job else None, "title": job.jd_title if job else None},
            "status": session.status,
            "started_at": session.started_at,
            "ended_at": session.ended_at,
        },
        "questions": [
            {
                "id": q.id,
                "text": q.text,
                "answer_text": q.answer_text,
                "answer_summary": q.answer_summary,
                "relevance_score": q.relevance_score,
                "time_taken_seconds": q.time_taken_seconds,
                "skipped": q.skipped,
            }
            for q in session.questions
        ],
        "events": [
            {
                "id": ev.id,
                "event_type": ev.event_type,
                "confidence": ev.confidence,
                "created_at": ev.created_at,
                "question_id": ev.question_id,
                "snapshot_path": ev.snapshot_path,
            }
            for ev in events
        ],
    }


class FinalizeBody(BaseModel):
    decision: str
    notes: str | None = None
    final_score: float | None = None


@router.post("/interviews/{interview_id}/finalize")
def finalize_interview(
    interview_id: int,
    payload: FinalizeBody,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
):
    session = (
        db.query(InterviewSession)
        .join(Result, InterviewSession.result_id == Result.id)
        .join(JobDescription, Result.job_id == JobDescription.id)
        .filter(InterviewSession.id == interview_id, JobDescription.company_id == current_user.user_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Interview not found")

    session.status = payload.decision.lower()
    session.ended_at = session.ended_at or session.started_at
    result = session.result
    explanation = result.explanation or {}
    explanation["hr_final_notes"] = payload.notes
    explanation["hr_final_score"] = payload.final_score
    result.explanation = explanation
    if payload.final_score is not None:
        result.score = payload.final_score
    db.commit()
    return {"ok": True, "status": session.status}
