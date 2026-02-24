"""HR-facing JD management and interview scoring routes."""

import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from ai_engine.interview_scoring import compute_interview_scoring
from ai_engine.matching import extract_skills_from_jd
from database import get_db
from models import Candidate, JobDescription, Result
from routes.common import evaluate_resume_for_job, serialize_result, upsert_result, UPLOAD_DIR
from routes.dependencies import SessionUser, require_role
from routes.schemas import InterviewScoreBody, SkillWeightsBody

router = APIRouter()


@router.get("/hr/dashboard")
def hr_dashboard(
    job_id: int | None = None,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    jobs = (
        db.query(JobDescription)
        .filter(JobDescription.company_id == current_user.user_id)
        .order_by(JobDescription.id.desc())
        .all()
    )
    selected_job = None
    if job_id:
        selected_job = next((job for job in jobs if job.id == job_id), None)
    if not selected_job and jobs:
        selected_job = jobs[0]

    shortlisted_candidates: list[dict[str, object]] = []
    if selected_job:
        results = (
            db.query(Result)
            .filter(Result.job_id == selected_job.id, Result.shortlisted.is_(True))
            .order_by(Result.id.desc())
            .all()
        )
        for result in results:
            candidate = db.query(Candidate).filter(Candidate.id == result.candidate_id).first()
            if not candidate:
                continue
            shortlisted_candidates.append(
                {
                    "candidate": {
                        "id": candidate.id,
                        "name": candidate.name,
                        "email": candidate.email,
                        "resume_path": candidate.resume_path,
                    },
                    "result": serialize_result(result),
                }
            )

    jobs_payload = [
        {
            "id": job.id,
            "jd_title": job.jd_title or Path(job.jd_text).name,
            "jd_name": Path(job.jd_text).name,
            "jd_text": job.jd_text,
            "skill_scores": job.skill_scores or {},
            "gender_requirement": job.gender_requirement,
            "education_requirement": job.education_requirement,
            "experience_requirement": job.experience_requirement,
        }
        for job in jobs
    ]

    return {
        "ok": True,
        "selected_job_id": selected_job.id if selected_job else None,
        "jobs": jobs_payload,
        "latest_jd": (
            {
                "id": selected_job.id,
                "jd_title": selected_job.jd_title or Path(selected_job.jd_text).name,
                "jd_text": selected_job.jd_text,
                "skill_scores": selected_job.skill_scores or {},
                "gender_requirement": selected_job.gender_requirement,
                "education_requirement": selected_job.education_requirement,
                "experience_requirement": selected_job.experience_requirement,
            }
            if selected_job
            else None
        ),
        "shortlisted_candidates": shortlisted_candidates,
    }


@router.post("/hr/upload-jd")
def upload_jd(
    request: Request,
    jd_file: UploadFile = File(...),
    jd_title: str = Form(""),
    gender_requirement: str = Form(""),
    education_requirement: str = Form(""),
    experience_requirement: str = Form(""),
    current_user: SessionUser = Depends(require_role("hr")),
) -> dict[str, object]:
    try:
        years = int(experience_requirement) if experience_requirement else 0
    except ValueError:
        years = 0

    safe_filename = Path(jd_file.filename or "job_description").name
    jd_path = UPLOAD_DIR / f"jd_{current_user.user_id}_{uuid.uuid4().hex}_{safe_filename}"
    with jd_path.open("wb") as buffer:
        shutil.copyfileobj(jd_file.file, buffer)

    extracted_skills = extract_skills_from_jd(str(jd_path))
    ai_skills = {skill: 5 for skill in extracted_skills}

    request.session["temp_jd"] = {
        "jd_title": jd_title.strip() if jd_title else None,
        "jd_path": str(jd_path),
        "gender_requirement": gender_requirement or None,
        "education_requirement": education_requirement or None,
        "experience_requirement": years,
    }

    return {
        "ok": True,
        "jd_title": request.session["temp_jd"]["jd_title"],
        "uploaded_jd": safe_filename,
        "ai_skills": ai_skills,
    }


@router.post("/hr/confirm-jd")
def confirm_jd(
    payload: SkillWeightsBody,
    request: Request,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    temp_jd = request.session.get("temp_jd")
    if not temp_jd:
        raise HTTPException(status_code=400, detail="Please upload JD first")
    if not payload.skill_scores:
        raise HTTPException(status_code=400, detail="skill_scores cannot be empty")

    normalized_scores: dict[str, int] = {}
    for skill, weight in payload.skill_scores.items():
        key = (skill or "").strip().lower()
        if not key:
            continue
        normalized_scores[key] = int(weight)

    job = JobDescription(
        company_id=current_user.user_id,
        jd_title=temp_jd.get("jd_title"),
        jd_text=temp_jd["jd_path"],
        skill_scores=normalized_scores,
        gender_requirement=temp_jd.get("gender_requirement"),
        education_requirement=temp_jd.get("education_requirement"),
        experience_requirement=temp_jd.get("experience_requirement", 0),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    candidates = db.query(Candidate).all()
    for candidate in candidates:
        if not candidate.resume_path:
            continue
        score, explanation = evaluate_resume_for_job(candidate, job)
        upsert_result(db, candidate.id, job.id, score, explanation)

    request.session.pop("temp_jd", None)
    return {"ok": True, "message": "JD confirmed and candidate scoring completed.", "job_id": job.id}


@router.post("/hr/update-skill-weights")
def update_skill_weights(
    payload: SkillWeightsBody,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    target_job = None
    if payload.job_id:
        target_job = (
            db.query(JobDescription)
            .filter(JobDescription.company_id == current_user.user_id, JobDescription.id == payload.job_id)
            .first()
        )
    if not target_job:
        target_job = (
            db.query(JobDescription)
            .filter(JobDescription.company_id == current_user.user_id)
            .order_by(JobDescription.id.desc())
            .first()
        )
    if not target_job:
        raise HTTPException(status_code=404, detail="No JD found")

    target_job.skill_scores = {str(k).strip().lower(): int(v) for k, v in payload.skill_scores.items() if str(k).strip()}
    db.commit()

    candidates = db.query(Candidate).filter(Candidate.resume_path.isnot(None)).all()
    for candidate in candidates:
        score, explanation = evaluate_resume_for_job(candidate, target_job)
        upsert_result(db, candidate.id, target_job.id, score, explanation)

    return {"ok": True, "message": "Skill weights updated and scores recalculated."}


@router.post("/hr/interview-score")
def hr_interview_score(
    payload: InterviewScoreBody,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    result = db.query(Result).filter(Result.id == payload.result_id).first()
    if not result:
        raise HTTPException(status_code=404, detail="Result not found")

    job = db.query(JobDescription).filter(JobDescription.id == result.job_id).first()
    if not job or job.company_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not allowed to score this result")

    explanation = result.explanation or {}
    resume_score = explanation.get("matched_percentage", result.score or 0)
    scorecard = compute_interview_scoring(payload.technical_score, float(resume_score))

    explanation["interview_scoring"] = scorecard
    result.explanation = explanation
    db.commit()
    db.refresh(result)

    return {"ok": True, "result_id": result.id, **scorecard}
