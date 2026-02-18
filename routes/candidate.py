from fastapi import APIRouter, Request, Depends, Form, UploadFile, File
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from pathlib import Path
import shutil
import uuid

from utils.file_reader import extract_text_from_pdf
from utils.email_service import send_interview_email
from database import SessionLocal
from models import Candidate, Result, JobDescription
from ai_engine.matching import final_score

router = APIRouter()
templates = Jinja2Templates(directory="templates")

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

def get_current_user(request: Request):
    if "user_id" not in request.session:
        return None
    return request.session

# --------------------------------------------------
# Candidate Dashboard
# --------------------------------------------------
@router.get("/candidate/dashboard", response_class=HTMLResponse)
def candidate_dashboard(request: Request, db: Session = Depends(get_db)):

    user = get_current_user(request)

    if not user or user["role"] != "candidate":
        return RedirectResponse("/", status_code=303)

    candidate = db.query(Candidate).filter(
        Candidate.id == user["user_id"]
    ).first()

    uploaded_resume = request.session.pop("uploaded_resume", None)
    show_result = request.session.pop("show_result", False)
    success_message = request.session.pop("success_message", None)

    result = None
    if show_result:
        result = db.query(Result)\
            .filter(Result.candidate_id == user["user_id"])\
            .order_by(Result.id.desc())\
            .first()

    return templates.TemplateResponse(
        "dashboard_candidate.html",
        {
            "request": request,
            "candidate": candidate,
            "result": result,
            "uploaded_resume": uploaded_resume,
            "success_message": success_message
        }
    )

# --------------------------------------------------
# Upload Resume
# --------------------------------------------------
@router.post("/upload_resume")
def upload_resume(
    request: Request,
    resume: UploadFile = File(...),
    db: Session = Depends(get_db)
):

    user = get_current_user(request)

    if not user or user["role"] != "candidate":
        return RedirectResponse("/", status_code=303)

    # Save Resume File
    file_path = UPLOAD_DIR / f"{user['user_id']}_{resume.filename}"

    with file_path.open("wb") as buffer:
        shutil.copyfileobj(resume.file, buffer)

    candidate = db.query(Candidate).filter(
        Candidate.id == user["user_id"]
    ).first()

    candidate.resume_path = str(file_path)

    # Clean old results
    db.query(Result).filter(
        Result.candidate_id == candidate.id
    ).delete()

    db.commit()

    # Get latest JD
    latest_job = db.query(JobDescription)\
        .order_by(JobDescription.id.desc())\
        .first()

    if not latest_job:
        request.session["success_message"] = \
            "⚠ No Job Description available yet."
        request.session["uploaded_resume"] = resume.filename
        return RedirectResponse("/candidate/dashboard", status_code=303)

    # Run AI matching
    score, explanation = final_score(
        latest_job.jd_text,
        candidate.resume_path,
        latest_job.skill_scores,
        latest_job.education_requirement,
        latest_job.experience_requirement
    )

    shortlisted = score >= 60
    questions = None

    # Generate interview questions ONLY if shortlisted
    if shortlisted:
        try:
            resume_text = extract_text_from_pdf(candidate.resume_path)
            jd_text = extract_text_from_pdf(latest_job.jd_text)

        except Exception as e:
            print("Question generation error:", e)
            questions = None

    # Save result (ALWAYS save result now)
    new_result = Result(
        candidate_id=candidate.id,
        job_id=latest_job.id,
        score=score,
        shortlisted=shortlisted,
        explanation=explanation,
        interview_questions=questions if shortlisted else None
    )

    db.add(new_result)
    db.commit()

    request.session["success_message"] = \
        "✅ Resume uploaded & AI analysis completed!"
    request.session["uploaded_resume"] = resume.filename
    request.session["show_result"] = True

    return RedirectResponse("/candidate/dashboard", status_code=303)

# --------------------------------------------------
# Select Interview Date
# --------------------------------------------------
@router.post("/select_interview_date")
def select_interview_date(
    request: Request,
    result_id: int = Form(...),
    interview_date: str = Form(...),
    db: Session = Depends(get_db)
):

    result = db.query(Result).filter(Result.id == result_id).first()

    if not result:
        return RedirectResponse("/candidate/dashboard", status_code=303)

    meeting_token = str(uuid.uuid4())

    result.interview_token = meeting_token

    interview_link = f"http://127.0.0.1:8000/interview/{result.id}?token={meeting_token}"

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
        interview_link
    )

    request.session["success_message"] = \
        "🎯 Interview link has been shared to your mail!"
    request.session["show_result"] = True

    return RedirectResponse("/candidate/dashboard", status_code=303)