"""
routes/hr/interview_review.py — HR dashboard APIs for interviews and proctoring.

FIXES applied:
  1. finalize_interview now writes to dedicated Result columns
     (hr_decision, hr_final_score, hr_behavioral_score, hr_communication_score,
      hr_notes, hr_red_flags) instead of merging into the explanation JSON blob.
     This eliminates silent data-loss when other code paths also write explanation.
  2. interview_detail reads HR review data from the new columns with a fallback
     to the old explanation keys for backward compatibility with existing rows.
  3. NEW endpoint: POST /hr/interviews/{id}/re-evaluate — lets HR manually
     re-trigger LLM scoring when it shows "Pending" after a Groq outage.
"""
from __future__ import annotations

import logging
from collections import defaultdict

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import case, func
from sqlalchemy.orm import Session, joinedload

from ai_engine.phase1.scoring import compute_answer_scorecard
from database import get_db
from models import (
    Candidate, InterviewAnswer, InterviewQuestion,
    InterviewSession, JobDescription, ProctorEvent, Result,
)
from routes.dependencies import require_role, SessionUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/hr", tags=["hr"])


# ── helpers ──────────────────────────────────────────────────────────────────

def _hr_review_from_result(result: Result) -> dict:
    """Read HR review data from the dedicated columns (new) or explanation JSON (legacy)."""
    expl = result.explanation or {}
    return {
        # New dedicated columns take precedence; fall back to legacy JSON keys.
        "final_score":         result.hr_final_score         if result.hr_final_score         is not None else expl.get("hr_final_score"),
        "behavioral_score":    result.hr_behavioral_score    if result.hr_behavioral_score    is not None else expl.get("hr_behavioral_score"),
        "communication_score": result.hr_communication_score if result.hr_communication_score is not None else expl.get("hr_communication_score"),
        "red_flags":           result.hr_red_flags           if result.hr_red_flags           is not None else expl.get("hr_red_flags"),
        "notes":               result.hr_notes               if result.hr_notes               is not None else expl.get("hr_final_notes"),
    }


# ── list interviews ───────────────────────────────────────────────────────────

@router.get("/interviews")
def list_interviews(
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
):
    sessions = (
        db.query(InterviewSession)
        .join(Result, InterviewSession.result_id == Result.id)
        .join(JobDescription, Result.job_id == JobDescription.id)
        .options(joinedload(InterviewSession.result), joinedload(InterviewSession.candidate))
        .filter(JobDescription.company_id == current_user.user_id)
        .all()
    )

    counts = (
        db.query(
            ProctorEvent.session_id,
            func.count(ProctorEvent.id).label("events_count"),
            func.sum(
                case(
                    (ProctorEvent.event_type.in_(("periodic", "baseline")), 0),
                    else_=1,
                )
            ).label("suspicious_count"),
        )
        .group_by(ProctorEvent.session_id)
        .all()
    )
    count_map = {
        row.session_id: {
            "events_count": int(row.events_count or 0),
            "suspicious_count": int(row.suspicious_count or 0),
        }
        for row in counts
    }

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
                "events_count": count_map.get(session.id, {}).get("events_count", 0),
                "suspicious_events_count": count_map.get(session.id, {}).get("suspicious_count", 0),
                # FIX: expose LLM eval status so the frontend can show "Pending / Scored"
                "llm_eval_status": session.llm_eval_status or "pending",
            }
        )
    return {"ok": True, "interviews": payload}


# ── interview detail ──────────────────────────────────────────────────────────

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
        .filter(
            InterviewSession.id == interview_id,
            JobDescription.company_id == current_user.user_id,
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Interview not found")

    result = session.result
    candidate = db.query(Candidate).filter(Candidate.id == session.candidate_id).first()
    job = db.query(JobDescription).filter(JobDescription.id == result.job_id).first()
    events = (
        db.query(ProctorEvent)
        .filter(ProctorEvent.session_id == session.id)
        .order_by(ProctorEvent.created_at.asc())
        .all()
    )
    latest_answers: dict[int, InterviewAnswer] = {}
    for row in (
        db.query(InterviewAnswer)
        .filter(InterviewAnswer.session_id == session.id)
        .order_by(InterviewAnswer.question_id.asc(), InterviewAnswer.id.desc())
        .all()
    ):
        latest_answers.setdefault(row.question_id, row)

    # FIX: read HR review from dedicated columns (new) with JSON fallback (legacy)
    hr_review = _hr_review_from_result(result)
    job_skills = (job.skill_scores or {}).keys() if job else ()

    questions_payload = []
    section_scores: dict[str, list[float]] = defaultdict(list)
    for q in sorted(session.questions, key=lambda item: item.id):
        answer_text = q.answer_text if q.answer_text is not None else (
            latest_answers[q.id].answer_text if q.id in latest_answers else None
        )
        time_taken_seconds = q.time_taken_seconds if q.time_taken_seconds is not None else (
            latest_answers[q.id].time_taken_sec if q.id in latest_answers else None
        )
        score_breakdown = compute_answer_scorecard(
            q.text,
            answer_text or "",
            allotted_seconds=int(q.allotted_seconds or 0),
            time_taken_seconds=int(time_taken_seconds or 0),
            jd_skills=job_skills,
        )
        ai_answer_score = float(q.relevance_score) if q.relevance_score is not None else float(score_breakdown["overall_score"])
        questions_payload.append(
            {
                "id": q.id,
                "text": q.text,
                "difficulty": q.difficulty,
                "topic": q.topic,
                "answer_text": answer_text,
                "answer_summary": q.answer_summary,
                "relevance_score": q.relevance_score,
                "ai_answer_score": ai_answer_score,
                "score_breakdown": score_breakdown,
                "allotted_seconds": q.allotted_seconds,
                "time_taken_seconds": time_taken_seconds,
                "skipped": q.skipped or (latest_answers[q.id].skipped if q.id in latest_answers else False),
                "llm_score": q.llm_score,
                "llm_feedback": q.llm_feedback,
            }
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
            "llm_eval_status": session.llm_eval_status or "pending",
        },
        "questions": questions_payload,
        "events": [
            {
                "id": ev.id,
                "event_type": ev.event_type,
                "score": float(ev.score),
                "created_at": ev.created_at,
                "meta_json": ev.meta_json or {},
                "image_url": f"/uploads/{ev.image_path}" if ev.image_path else None,
                "suspicious": ev.event_type not in {"periodic", "baseline"},
            }
            for ev in events
        ],
        "hr_review": hr_review,
        "section_summary": {key: round(sum(values) / len(values), 1) for key, values in section_scores.items() if values},
    }


# ── finalize interview ────────────────────────────────────────────────────────

class FinalizeBody(BaseModel):
    decision: str
    notes: str | None = None
    final_score: float | None = Field(default=None, ge=0, le=100)
    behavioral_score: float | None = Field(default=None, ge=0, le=100)
    communication_score: float | None = Field(default=None, ge=0, le=100)
    red_flags: str | None = None


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
        .filter(
            InterviewSession.id == interview_id,
            JobDescription.company_id == current_user.user_id,
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Interview not found")

    session.status = payload.decision.lower()
    session.ended_at = session.ended_at or session.started_at

    result = session.result

    # FIX: Write to dedicated columns — no longer merging into explanation JSON.
    result.hr_decision = payload.decision.lower()
    result.hr_final_score = payload.final_score
    result.hr_behavioral_score = payload.behavioral_score
    result.hr_communication_score = payload.communication_score
    result.hr_notes = payload.notes
    result.hr_red_flags = payload.red_flags

    if payload.final_score is not None:
        result.score = payload.final_score

    db.commit()
    return {
        "ok": True,
        "status": session.status,
        "hr_review": {
            "final_score": payload.final_score,
            "behavioral_score": payload.behavioral_score,
            "communication_score": payload.communication_score,
            "red_flags": payload.red_flags,
            "notes": payload.notes,
        },
    }


# ── re-evaluate interview answers ────────────────────────────────────────────

@router.post("/interviews/{interview_id}/re-evaluate")
def re_evaluate_interview(
    interview_id: int,
    background_tasks: BackgroundTasks,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
):
    session = (
        db.query(InterviewSession)
        .join(Result, InterviewSession.result_id == Result.id)
        .join(JobDescription, Result.job_id == JobDescription.id)
        .filter(
            InterviewSession.id == interview_id,
            JobDescription.company_id == current_user.user_id,
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Interview not found")
    if session.status == "in_progress":
        raise HTTPException(status_code=400, detail="Cannot re-evaluate an interview that is still in progress.")

    session.llm_eval_status = "running"
    db.commit()
    background_tasks.add_task(_run_llm_evaluation, interview_id)
    return {"ok": True, "message": "AI re-evaluation started. Refresh the interview detail page in ~30 seconds.", "session_id": interview_id}


# Keep the import available for background tasks.
from database import SessionLocal  # noqa: E402


def _run_llm_evaluation(session_id: int) -> None:
    from services.llm.client import evaluate_answer_detailed

    db = SessionLocal()
    try:
        session = db.query(InterviewSession).filter(InterviewSession.id == session_id).first()
        if not session:
            return

        questions = (
            db.query(InterviewQuestion)
            .filter(InterviewQuestion.session_id == session_id)
            .order_by(InterviewQuestion.id.asc())
            .all()
        )

        scored = 0
        total_score = 0.0
        for question in questions:
            answer_text = (question.answer_text or "").strip()
            if not answer_text or question.skipped:
                evaluation = {
                    "question": question.text,
                    "candidate_answer": answer_text,
                    "generated_reference_answer": question.reference_answer or "A strong answer should directly answer the question with practical detail.",
                    "score": 0,
                    "feedback": "Answer was skipped or empty.",
                    "strengths": [],
                    "weaknesses": ["No answer was provided."],
                    "section": question.question_type or "project",
                    "dimension_breakdown": {"relevance": 0, "correctness": 0, "completeness": 0, "clarity": 0, "confidence": 0},
                }
                _save_llm_fields(db, session_id, question.id, evaluation)
                continue

            try:
                evaluation = evaluate_answer_detailed(
                    question=question.text,
                    answer=answer_text,
                    section=question.question_type or "project",
                    reference_answer=question.reference_answer,
                    intent=question.intent,
                    focus_skill=question.focus_skill,
                    project_name=question.project_name,
                )
            except Exception as exc:
                logger.error("AI scoring failed for question %s: %s", question.id, exc)
                from ai_engine.phase1.scoring import compute_answer_scorecard
                local = compute_answer_scorecard(question.text, answer_text)
                overall = int(local["overall_score"])
                evaluation = {
                    "question": question.text,
                    "candidate_answer": answer_text,
                    "generated_reference_answer": question.reference_answer or "A strong answer should directly answer the question with practical detail.",
                    "score": overall,
                    "feedback": "Scored locally (AI unavailable).",
                    "strengths": ["The answer was evaluated using the local fallback scorer."],
                    "weaknesses": [],
                    "section": question.question_type or "project",
                    "dimension_breakdown": {"relevance": overall, "correctness": overall, "completeness": overall, "clarity": overall, "confidence": overall},
                }

            _save_llm_fields(db, session_id, question.id, evaluation)
            total_score += float(evaluation["score"])
            scored += 1

        session = db.query(InterviewSession).filter(InterviewSession.id == session_id).first()
        if session:
            session.llm_eval_status = "completed"
        db.commit()
        logger.info("AI re-evaluation done: session=%s scored=%s avg=%.1f", session_id, scored, total_score / scored if scored else 0)
    except Exception as exc:
        logger.error("AI re-evaluation worker failed for session %s: %s", session_id, exc)
        try:
            session = db.query(InterviewSession).filter(InterviewSession.id == session_id).first()
            if session:
                session.llm_eval_status = "failed"
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


def _save_llm_fields(db: Session, session_id: int, question_id: int, evaluation: dict[str, object]) -> None:
    answer = (
        db.query(InterviewAnswer)
        .filter(
            InterviewAnswer.session_id == session_id,
            InterviewAnswer.question_id == question_id,
        )
        .order_by(InterviewAnswer.id.desc())
        .first()
    )
    if answer:
        answer.llm_score = float(evaluation["score"])
        answer.llm_feedback = str(evaluation["feedback"])
        answer.evaluation_json = evaluation

    question = db.query(InterviewQuestion).filter(InterviewQuestion.id == question_id).first()
    if question:
        question.llm_score = float(evaluation["score"])
        question.llm_feedback = str(evaluation["feedback"])
        question.reference_answer = str(evaluation.get("generated_reference_answer") or question.reference_answer or "") or None
        question.evaluation_json = evaluation

    db.flush()
def fields(db: Session, session_id: int, question_id: int, evaluation: dict[str, object]) -> None:
    answer = (
        db.query(InterviewAnswer)
        .filter(
            InterviewAnswer.session_id == session_id,
            InterviewAnswer.question_id == question_id,
        )
        .order_by(InterviewAnswer.id.desc())
        .first()
    )
    if answer:
        answer.llm_score = float(evaluation["score"])
        answer.llm_feedback = str(evaluation["feedback"])
        answer.evaluation_json = evaluation

    question = db.query(InterviewQuestion).filter(InterviewQuestion.id == question_id).first()
    if question:
        question.llm_score = float(evaluation["score"])
        question.llm_feedback = str(evaluation["feedback"])
        question.reference_answer = str(evaluation.get("generated_reference_answer") or question.reference_answer or "") or None
        question.evaluation_json = evaluation

    db.flush()
