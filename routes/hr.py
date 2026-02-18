from fastapi import APIRouter, Request, Depends, Form, UploadFile, File
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from pathlib import Path
import shutil
from typing import Optional

from database import SessionLocal
from models import Candidate, JobDescription, Result
from ai_engine.matching import final_score, extract_skills_from_jd

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


# --------------------------------------------------
# Session Helper
# --------------------------------------------------
def get_current_user(request: Request):
    if "user_id" not in request.session:
        return None
    return request.session


# --------------------------------------------------
# HR Dashboard
# --------------------------------------------------
@router.get("/hr/dashboard", response_class=HTMLResponse)
def hr_dashboard(request: Request, db: Session = Depends(get_db)):

    user = get_current_user(request)

    if not user or user["role"] != "hr":
        return RedirectResponse("/", status_code=303)

    # 🔥 Always load latest JD from DB
    latest_jd = db.query(JobDescription)\
        .filter(JobDescription.company_id == user["user_id"])\
        .order_by(JobDescription.id.desc())\
        .first()

    shortlisted_candidates = []

    if latest_jd:
        results = db.query(Result)\
            .filter(Result.job_id == latest_jd.id)\
            .filter(Result.shortlisted == True)\
            .all()

        for result in results:
            candidate = db.query(Candidate)\
                .filter(Candidate.id == result.candidate_id)\
                .first()

            shortlisted_candidates.append({
                "candidate": candidate,
                "result": result
            })

    success_message = request.session.pop("success_message", None)

    return templates.TemplateResponse(
        "dashboard_hr.html",
        {
            "request": request,
            "latest_jd": latest_jd,
            "shortlisted_candidates": shortlisted_candidates,
            "success_message": success_message
        }
    )


# --------------------------------------------------
# STEP 1 — Upload JD & Extract Skills (Preview Only)
# --------------------------------------------------
@router.post("/upload_jd")
def upload_jd(
    request: Request,
    jd_file: UploadFile = File(...),
    gender_requirement: Optional[str] = Form(None),
    education_requirement: Optional[str] = Form(None),
    experience_requirement: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):

    user = get_current_user(request)

    if not user or user["role"] != "hr":
        return RedirectResponse("/", status_code=303)

    if experience_requirement and experience_requirement.strip():
        experience_requirement = int(experience_requirement)
    else:
        experience_requirement = 0

    jd_path = UPLOAD_DIR / f"jd_{user['user_id']}_{jd_file.filename}"

    with jd_path.open("wb") as buffer:
        shutil.copyfileobj(jd_file.file, buffer)

    # 🔥 Extract skills from NEW JD
    ai_skills = extract_skills_from_jd(str(jd_path))
    ai_skill_dict = {skill: 5 for skill in ai_skills}

    # Temporarily store in session
    request.session["temp_jd"] = {
        "jd_path": str(jd_path),
        "gender_requirement": gender_requirement,
        "education_requirement": education_requirement,
        "experience_requirement": experience_requirement
    }

    return templates.TemplateResponse(
        "dashboard_hr.html",
        {
            "request": request,
            "ai_skills": ai_skill_dict,
            "uploaded_jd": jd_file.filename
        }
    )


# --------------------------------------------------
# STEP 2 — Confirm JD & Run Matching
# --------------------------------------------------
@router.post("/confirm_jd")
def confirm_jd(
    request: Request,
    skill_names: list[str] = Form(...),
    skill_scores: list[str] = Form(...),
    db: Session = Depends(get_db)
):

    user = get_current_user(request)

    if not user or user["role"] != "hr":
        return RedirectResponse("/", status_code=303)

    temp_jd = request.session.get("temp_jd")

    if not temp_jd:
        return RedirectResponse("/hr/dashboard", status_code=303)

    # Build skill dictionary
    skill_score_dict = {}

    for skill, score in zip(skill_names, skill_scores):
        if skill and score:
            skill_score_dict[skill.lower()] = int(score)

    # 🔥 Create NEW JD record (old remains in history)
    new_job = JobDescription(
        company_id=user["user_id"],
        jd_text=temp_jd["jd_path"],
        skill_scores=skill_score_dict,
        gender_requirement=temp_jd["gender_requirement"],
        education_requirement=temp_jd["education_requirement"],
        experience_requirement=temp_jd["experience_requirement"]
    )

    db.add(new_job)
    db.commit()

    # 🔥 Run AI Matching
    candidates = db.query(Candidate).all()

    for candidate in candidates:

        if not candidate.resume_path:
            continue

        explanation = {}
        score = 0
        shortlisted = False

        if new_job.gender_requirement and candidate.gender != new_job.gender_requirement:
            explanation["gender_reason"] = "Gender requirement not satisfied."
        else:
            score, explanation = final_score(
                new_job.jd_text,
                candidate.resume_path,
                skill_score_dict,
                new_job.education_requirement,
                new_job.experience_requirement
            )
            shortlisted = score >= 60

        result = Result(
            candidate_id=candidate.id,
            job_id=new_job.id,
            score=score,
            shortlisted=shortlisted,
            explanation=explanation
        )

        db.add(result)

    db.commit()

    request.session.pop("temp_jd", None)

    request.session["success_message"] = \
        "🎯 JD confirmed & AI matching completed successfully!"

    return RedirectResponse("/hr/dashboard", status_code=303)


# --------------------------------------------------
# Update Skill Weights (Without New JD)
# --------------------------------------------------
@router.post("/update_skill_weights")
def update_skill_weights(
    request: Request,
    skill_names: list[str] = Form(...),
    skill_scores: list[str] = Form(...),
    db: Session = Depends(get_db)
):

    user = get_current_user(request)

    if not user or user["role"] != "hr":
        return RedirectResponse("/", status_code=303)

    latest_jd = db.query(JobDescription)\
        .filter(JobDescription.company_id == user["user_id"])\
        .order_by(JobDescription.id.desc())\
        .first()

    if not latest_jd:
        return RedirectResponse("/hr/dashboard", status_code=303)

    updated_skills = {}

    for skill, score in zip(skill_names, skill_scores):
        updated_skills[skill] = int(score)

    latest_jd.skill_scores = updated_skills
    db.commit()

    request.session["success_message"] = \
        "✅ Skill weights updated successfully!"

    return RedirectResponse("/hr/dashboard", status_code=303)