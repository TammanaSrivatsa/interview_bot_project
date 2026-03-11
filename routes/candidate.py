import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from ai_engine.matching import final_score
from database import SessionLocal
from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse
from models import Candidate, InterviewSession, JobDescription, Result
from sqlalchemy.orm import Session
from utils.email_service import send_interview_email
from utils.file_reader import extract_text_from_pdf

router = APIRouter()

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")

# --------------------------------------------------
# DB Dependency
# --------------------------------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(request: Request, db: Session):
    if "user_id" not in request.session:
        return None
    user_id = request.session["user_id"]
    role = request.session.get("role")
    return {"user_id": user_id, "role": role}


def _derive_pipeline_status(result: Result | None) -> str:
    if not result:
        return "apply"
    if result.pipeline_status:
        return result.pipeline_status
    if result.interview_abandoned:
        return "abandoned"
    if result.interview_end_time:
        return "completed"
    if result.interview_start_time:
        return "in_progress"
    if result.interview_date:
        return "scheduled"
    if result.shortlisted:
        return "shortlisted"
    if result.screening_completed:
        return "rejected"
    return "applied"


# --------------------------------------------------
# Candidate Dashboard
# --------------------------------------------------
@router.get("/candidate/dashboard")
def candidate_dashboard(request: Request, db: Session = Depends(get_db)):

    user = get_current_user(request, db)

    if not user or user["role"] != "candidate":
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    candidate = db.query(Candidate).filter(
        Candidate.id == user["user_id"]
    ).first()

    result = (
        db.query(Result)
        .filter(Result.candidate_id == user["user_id"])
        .order_by(Result.id.desc())
        .first()
    )

    # Get all available JDs
    all_jds = db.query(JobDescription).order_by(JobDescription.id.desc()).all()

    jd_list = [
        {
            "id": jd.id,
            "company_name": jd.company_name,
            "created_at": str(jd.id)
        }
        for jd in all_jds
    ]

    return JSONResponse({
        "candidate": {
            "id": candidate.id,
            "name": candidate.name,
            "email": candidate.email,
            "resume_path": candidate.resume_path,
        },
        "result": {
            "id": result.id,
            "score": result.score,
            "shortlisted": result.shortlisted,
            "interview_date": str(result.interview_date) if result.interview_date else None,
            "explanation": result.explanation,
            "pipeline_status": _derive_pipeline_status(result),
            "hr_decision": result.hr_decision,
            "recruiter_notes": result.recruiter_notes,
            "recruiter_feedback": result.recruiter_feedback,
        } if result else None,
        "available_jds": jd_list,
    })


# --------------------------------------------------
# Upload Resume
# --------------------------------------------------
@router.post("/upload_resume")
def upload_resume(
    request: Request,
    resume: UploadFile = File(...),
    job_id: int = Form(...),
    db: Session = Depends(get_db),
):

    user = get_current_user(request, db)

    if not user or user["role"] != "candidate":
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    # Save Resume
    file_path = UPLOAD_DIR / f"{user['user_id']}_{resume.filename}"

    with file_path.open("wb") as buffer:
        shutil.copyfileobj(resume.file, buffer)

    candidate = db.query(Candidate).filter(
        Candidate.id == user["user_id"]
    ).first()

    candidate.resume_path = str(file_path)

    # Remove old results
    db.query(Result).filter(
        Result.candidate_id == candidate.id
    ).delete()

    db.commit()

    # Get JD
    latest_job = db.query(JobDescription).filter(
        JobDescription.id == job_id
    ).first()

    if not latest_job:
        return JSONResponse({
            "success": False,
            "message": "Job description not found",
        })

    # --------------------------------------------------
    # AI Resume Screening
    # --------------------------------------------------
    score, explanation = final_score(
        latest_job.jd_text,
        candidate.resume_path,
        latest_job.skill_scores,
        latest_job.education_requirement,
        latest_job.experience_requirement,
    )

    shortlisted = score >= 60
    pipeline_status = "shortlisted" if shortlisted else "rejected"

    questions = None

    # --------------------------------------------------
    # Generate Interview Questions (only if shortlisted)
    # --------------------------------------------------
    if shortlisted:
        try:
            resume_text = extract_text_from_pdf(candidate.resume_path)
            jd_text = extract_text_from_pdf(latest_job.jd_text)

            # Future AI question generation can go here
            questions = None

        except Exception as e:
            print("Question generation error:", e)
            questions = None

    # Save Result
    new_result = Result(
        candidate_id=candidate.id,
        job_id=latest_job.id,
        score=score,
        shortlisted=shortlisted,
        explanation=explanation,
        interview_questions=questions if shortlisted else None,
        screening_completed=True,
        screened_at=datetime.utcnow(),
        pipeline_status=pipeline_status,
    )

    db.add(new_result)
    db.commit()

    return JSONResponse({
        "success": True,
        "message": "Resume uploaded & AI analysis completed!",
        "filename": resume.filename,
    })


# --------------------------------------------------
# Select Interview Date
# --------------------------------------------------
@router.post("/select_interview_date")
def select_interview_date(
    request: Request,
    result_id: int = Form(...),
    interview_date: str = Form(...),
    db: Session = Depends(get_db),
):

    result = db.query(Result).filter(Result.id == result_id).first()

    if not result:
        return JSONResponse(status_code=404, content={"error": "Result not found"})

    meeting_token = str(uuid.uuid4())

    result.interview_token = meeting_token

    interview_link = f"{FRONTEND_URL}/interview/{result.id}?token={meeting_token}"

    result.interview_date = interview_date
    result.interview_link = interview_link
    result.pipeline_status = "scheduled"

    db.commit()

    interview_session = (
        db.query(InterviewSession)
        .filter(InterviewSession.candidate_id == result.candidate_id)
        .filter(InterviewSession.job_id == result.job_id)
        .order_by(InterviewSession.id.desc())
        .first()
    )
    if not interview_session:
        interview_session = InterviewSession(
            candidate_id=result.candidate_id,
            job_id=result.job_id,
            status="scheduled",
        )
        db.add(interview_session)

    try:
        interview_session.scheduled_at = datetime.fromisoformat(interview_date)
    except ValueError:
        interview_session.scheduled_at = None
    interview_session.status = "scheduled"
    db.commit()

    candidate = db.query(Candidate).filter(
        Candidate.id == result.candidate_id
    ).first()

    send_interview_email(
        candidate.email,
        candidate.name,
        interview_date,
        interview_link,
    )

    return JSONResponse({
        "success": True,
        "message": "Interview link has been sent to your email!",
    })
