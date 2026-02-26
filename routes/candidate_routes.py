"""Candidate-facing dashboard and resume workflows."""

import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ai_engine.interview_scoring import compute_resume_skill_match
from ai_engine.matching import extract_text_from_file
from database import get_db
from models import JobDescription, Result
from routes.common import (
    UPLOAD_DIR,
    evaluate_resume_for_job,
    frontend_base_url,
    get_candidate_or_404,
    list_available_jobs,
    serialize_result,
    upsert_result,
)
from routes.dependencies import SessionUser, require_role
from routes.schemas import ScheduleInterviewBody
from utils.email_service import send_interview_email

router = APIRouter()


@router.get("/candidate/dashboard")
def candidate_dashboard(
    job_id: int | None = None,
    current_user: SessionUser = Depends(require_role("candidate")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    candidate = get_candidate_or_404(db, current_user.user_id)
    available_jobs = list_available_jobs(db)
    selected_job_id = job_id or (available_jobs[0]["id"] if available_jobs else None)

    result = None
    if selected_job_id:
        result = (
            db.query(Result)
            .filter(Result.candidate_id == candidate.id, Result.job_id == selected_job_id)
            .order_by(Result.id.desc())
            .first()
        )

    return {
        "ok": True,
        "candidate": {
            "id": candidate.id,
            "name": candidate.name,
            "email": candidate.email,
            "gender": candidate.gender,
            "resume_path": candidate.resume_path,
        },
        "available_jobs": available_jobs,
        "selected_job_id": selected_job_id,
        "result": serialize_result(result),
    }


@router.get("/candidate/skill-match/{job_id}")
def candidate_skill_match(
    job_id: int,
    current_user: SessionUser = Depends(require_role("candidate")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    candidate = get_candidate_or_404(db, current_user.user_id)
    if not candidate.resume_path:
        raise HTTPException(status_code=400, detail="Please upload resume first")

    job = db.query(JobDescription).filter(JobDescription.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    resume_text = extract_text_from_file(candidate.resume_path)
    skill_match = compute_resume_skill_match(resume_text, (job.skill_scores or {}).keys())
    return {"ok": True, "job_id": job.id, **skill_match}


@router.post("/candidate/upload-resume")
def upload_resume(
    resume: UploadFile = File(...),
    job_id: int | None = Form(None),
    current_user: SessionUser = Depends(require_role("candidate")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    candidate = get_candidate_or_404(db, current_user.user_id)
    safe_filename = Path(resume.filename or "resume").name
    if not safe_filename:
        raise HTTPException(status_code=400, detail="Resume filename is invalid")

    resume_path = UPLOAD_DIR / f"resume_{candidate.id}_{uuid.uuid4().hex}_{safe_filename}"
    with resume_path.open("wb") as buffer:
        shutil.copyfileobj(resume.file, buffer)

    candidate.resume_path = str(resume_path)
    db.commit()

    selected_job = None
    if job_id:
        selected_job = db.query(JobDescription).filter(JobDescription.id == job_id).first()
    if not selected_job:
        selected_job = db.query(JobDescription).order_by(JobDescription.id.desc()).first()

    if not selected_job:
        return {
            "ok": True,
            "message": "Resume uploaded. No job description available yet.",
            "uploaded_resume": safe_filename,
            "result": None,
            "available_jobs": list_available_jobs(db),
            "selected_job_id": None,
        }

    score, explanation = evaluate_resume_for_job(candidate, selected_job)
    result = upsert_result(db, candidate.id, selected_job.id, score, explanation)

    return {
        "ok": True,
        "message": "Resume uploaded and scoring completed.",
        "uploaded_resume": safe_filename,
        "candidate": {
            "id": candidate.id,
            "name": candidate.name,
            "email": candidate.email,
            "gender": candidate.gender,
            "resume_path": candidate.resume_path,
        },
        "available_jobs": list_available_jobs(db),
        "selected_job_id": selected_job.id,
        "result": serialize_result(result),
    }


@router.post("/candidate/select-interview-date")
def select_interview_date(
    payload: ScheduleInterviewBody,
    current_user: SessionUser = Depends(require_role("candidate")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    result = (
        db.query(Result)
        .filter(Result.id == payload.result_id, Result.candidate_id == current_user.user_id)
        .first()
    )
    if not result:
        raise HTTPException(status_code=404, detail="Result not found")
    if not result.shortlisted:
        raise HTTPException(status_code=400, detail="Interview can be scheduled only for shortlisted result")

    result.interview_token = None
    result.interview_date = payload.interview_date
    result.interview_link = f"{frontend_base_url()}/interview/{result.id}"
    db.commit()

    candidate = get_candidate_or_404(db, current_user.user_id)
    email_sent = True
    message = "Interview link sent to your registered email."
    try:
        send_interview_email(candidate.email, candidate.name, payload.interview_date, result.interview_link)
    except Exception:
        email_sent = False
        message = "Interview scheduled, but email delivery failed."

    return {
        "ok": True,
        "email_sent": email_sent,
        "message": message,
        "result": serialize_result(result),
    }
