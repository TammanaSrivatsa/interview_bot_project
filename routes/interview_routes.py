"""Token-based interview session routes."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ai_engine.matching import extract_text_from_file
from ai_engine.question_generator import generate_dynamic_question
from database import get_db
from models import Candidate, JobDescription, Result
from routes.common import (
    FALLBACK_QUESTIONS,
    INTERVIEW_DURATION_MINUTES,
    clear_interview_session,
    stage_for_question_count,
    validate_interview_access,
)
from routes.schemas import InterviewNextQuestionBody

router = APIRouter()


@router.get("/interview/{result_id}")
def interview_info(
    result_id: int,
    token: str,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    result = db.query(Result).filter(Result.id == result_id).first()
    if not validate_interview_access(result, token):
        raise HTTPException(status_code=403, detail="Invalid interview access")

    candidate = db.query(Candidate).filter(Candidate.id == result.candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    clear_interview_session(request)
    request.session["interview_start"] = datetime.utcnow().isoformat()
    request.session["interview_result_id"] = result_id
    request.session["interview_token"] = token
    request.session["asked_questions"] = ""
    request.session["question_count"] = 0

    return {
        "ok": True,
        "candidate_name": candidate.name,
        "result_id": result.id,
        "interview_duration": INTERVIEW_DURATION_MINUTES,
    }


@router.post("/interview/next-question")
def interview_next_question(
    payload: InterviewNextQuestionBody,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    result = db.query(Result).filter(Result.id == payload.result_id).first()
    if not validate_interview_access(result, payload.token):
        raise HTTPException(status_code=403, detail="Invalid interview access")

    if request.session.get("interview_result_id") != payload.result_id:
        request.session["interview_result_id"] = payload.result_id
    if request.session.get("interview_token") != payload.token:
        request.session["interview_token"] = payload.token
    if "interview_start" not in request.session:
        request.session["interview_start"] = datetime.utcnow().isoformat()
    if "asked_questions" not in request.session:
        request.session["asked_questions"] = ""
    if "question_count" not in request.session:
        request.session["question_count"] = 0

    started = datetime.fromisoformat(request.session["interview_start"])
    elapsed_minutes = (datetime.utcnow() - started).total_seconds() / 60
    if elapsed_minutes >= INTERVIEW_DURATION_MINUTES:
        clear_interview_session(request)
        return {"question": "INTERVIEW_COMPLETE"}

    candidate = db.query(Candidate).filter(Candidate.id == result.candidate_id).first()
    job = db.query(JobDescription).filter(JobDescription.id == result.job_id).first()
    if not candidate or not job:
        raise HTTPException(status_code=404, detail="Interview context not found")

    question_count = int(request.session.get("question_count", 0))
    asked_questions = request.session.get("asked_questions", "")

    if question_count == 0:
        question = (
            "Introduce yourself and summarize your background, technical strengths, "
            "and most relevant project."
        )
    else:
        stage = stage_for_question_count(question_count)
        remaining = max(1, INTERVIEW_DURATION_MINUTES - int(elapsed_minutes))
        question_mode = "lightning" if remaining <= 2 else "rapid" if remaining <= 5 else "deep"
        try:
            question = generate_dynamic_question(
                extract_text_from_file(job.jd_text),
                extract_text_from_file(candidate.resume_path or ""),
                payload.last_answer,
                stage,
                asked_questions,
                remaining,
                None,
                None,
                question_mode,
            ).strip()
        except Exception:
            question = FALLBACK_QUESTIONS[question_count % len(FALLBACK_QUESTIONS)]

    request.session["asked_questions"] = f"{asked_questions}\n{question}".strip()
    request.session["question_count"] = question_count + 1
    return {"question": question}
