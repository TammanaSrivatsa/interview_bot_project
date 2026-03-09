import shutil
import uuid
from pathlib import Path

from ai_engine.matching import final_score
from database import SessionLocal
from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse
from models import Candidate, JobDescription, Result
from sqlalchemy.orm import Session
from utils.email_service import send_interview_email
from utils.file_reader import extract_text_from_pdf

router = APIRouter()

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

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

    interview_link = f"http://localhost:3000/interview/{result.id}?token={meeting_token}"

    result.interview_date = interview_date
    result.interview_link = interview_link

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
