"""Shared constants and helper functions used by route modules."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from ai_engine.interview_scoring import compute_resume_skill_match
from ai_engine.matching import extract_text_from_file, final_score
from models import Candidate, HR, JobDescription, Result

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

INTERVIEW_DURATION_MINUTES = 20
INTERVIEW_SESSION_KEYS = (
    "interview_start",
    "interview_result_id",
    "interview_token",
    "asked_questions",
    "question_count",
)
FALLBACK_QUESTIONS = (
    "Walk me through your most relevant project and your specific contribution.",
    "How would you debug a production issue that only happens intermittently?",
    "Describe one technical decision you made and the trade-offs you considered.",
)


def frontend_base_url() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")


def clear_interview_session(request: Request) -> None:
    for key in INTERVIEW_SESSION_KEYS:
        request.session.pop(key, None)


def validate_interview_access(result: Result | None, token: str | None) -> bool:
    return bool(result and token and result.shortlisted and result.interview_token == token)


def get_candidate_or_404(db: Session, candidate_id: int) -> Candidate:
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return candidate


def get_hr_or_404(db: Session, hr_id: int) -> HR:
    hr_user = db.query(HR).filter(HR.id == hr_id).first()
    if not hr_user:
        raise HTTPException(status_code=404, detail="HR user not found")
    return hr_user


def list_available_jobs(db: Session) -> list[dict[str, object]]:
    jobs = db.query(JobDescription).order_by(JobDescription.id.desc()).all()
    companies = {item.id: item.company_name for item in db.query(HR).all()}
    payload: list[dict[str, object]] = []
    for job in jobs:
        payload.append(
            {
                "id": job.id,
                "company_id": job.company_id,
                "company_name": companies.get(job.company_id, "Unknown Company"),
                "jd_title": job.jd_title or Path(job.jd_text).name,
                "jd_name": Path(job.jd_text).name,
                "gender_requirement": job.gender_requirement,
                "education_requirement": job.education_requirement,
                "experience_requirement": job.experience_requirement,
                "skill_scores": job.skill_scores or {},
            }
        )
    return payload


def serialize_result(result: Result | None) -> dict[str, object] | None:
    if not result:
        return None
    return {
        "id": result.id,
        "score": float(result.score or 0),
        "shortlisted": bool(result.shortlisted),
        "explanation": result.explanation or {},
        "interview_date": result.interview_date,
        "interview_link": result.interview_link,
    }


def evaluate_resume_for_job(candidate: Candidate, job: JobDescription) -> tuple[float, dict[str, object]]:
    resume_text = extract_text_from_file(candidate.resume_path or "")
    jd_skill_scores = job.skill_scores or {}
    skill_match = compute_resume_skill_match(resume_text, jd_skill_scores.keys())

    explanation: dict[str, object] = {
        "semantic_score": 0.0,
        "skill_score": skill_match["matched_percentage"],
        "education_reason": "Not evaluated.",
        "experience_reason": "Not evaluated.",
        "matched_skills": skill_match["matched_skills"],
        "missing_skills": skill_match["missing_skills"],
        "matched_percentage": skill_match["matched_percentage"],
    }
    ai_score = float(skill_match["matched_percentage"])

    # Keep existing semantic/education/experience scoring when available.
    try:
        model_score, model_explanation = final_score(
            job.jd_text,
            candidate.resume_path,
            jd_skill_scores,
            job.education_requirement,
            job.experience_requirement,
        )
        ai_score = float(model_score)
        if isinstance(model_explanation, dict):
            explanation.update(model_explanation)
    except Exception:
        # Fallback keeps API functional even if external model APIs fail.
        pass

    explanation["matched_percentage"] = skill_match["matched_percentage"]
    explanation["matched_skills"] = skill_match["matched_skills"]
    explanation["missing_skills"] = skill_match["missing_skills"]
    combined_score = round((ai_score * 0.7) + (float(skill_match["matched_percentage"]) * 0.3), 2)
    return combined_score, explanation


def upsert_result(
    db: Session,
    candidate_id: int,
    job_id: int,
    score: float,
    explanation: dict[str, object],
) -> Result:
    current = (
        db.query(Result)
        .filter(Result.candidate_id == candidate_id, Result.job_id == job_id)
        .order_by(Result.id.desc())
        .first()
    )
    shortlisted = score >= 60
    if current:
        current.score = score
        current.shortlisted = shortlisted
        current.explanation = explanation
        current.interview_date = None
        current.interview_link = None
        current.interview_token = None
        current.interview_questions = None
        db.commit()
        db.refresh(current)
        return current

    result = Result(
        candidate_id=candidate_id,
        job_id=job_id,
        score=score,
        shortlisted=shortlisted,
        explanation=explanation,
    )
    db.add(result)
    db.commit()
    db.refresh(result)
    return result


def stage_for_question_count(count: int) -> str:
    if count < 2:
        return "basics"
    if count < 5:
        return "experience"
    if count < 8:
        return "advanced_projects"
    if count < 10:
        return "deep_dive"
    return "hr"
