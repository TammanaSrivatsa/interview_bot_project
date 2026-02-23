"""JSON APIs for React frontend (auth + dashboard + workflows)."""

import os
import re
import shutil
import uuid
from pathlib import Path
from datetime import datetime

from fastapi import APIRouter, Request, HTTPException, Depends, UploadFile, File, Form
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from database import get_db
from models import Candidate, HR, JobDescription, Result
from auth import hash_password, verify_password
from ai_engine.matching import final_score, extract_skills_from_jd, extract_text_from_file
from ai_engine.question_generator import generate_dynamic_question
from utils.email_service import send_interview_email

api_router = APIRouter(prefix="/api", tags=["api"])

# Runtime constants shared across upload/interview flows.
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
INTERVIEW_DURATION = 20
INTERVIEW_SESSION_KEYS = [
    "interview_initialized",
    "interview_start",
    "asked_questions",
    "question_count",
    "projects",
    "experiences",
    "covered_projects",
    "phase",
    "followup_depth",
    "current_topic",
    "interview_result_id",
    "interview_token",
]


# Session guard for authenticated routes.
def require_session_user(request: Request):
    user_id = request.session.get("user_id")
    role = request.session.get("role")
    if not user_id or not role:
        raise HTTPException(status_code=401, detail="not logged in")
    return {"user_id": user_id, "role": role}


# Frontend base URL used when building interview links in emails.
def _frontend_base_url() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")


# Clears only interview-specific session keys (not full app session).
def clear_interview_session(request: Request):
    for key in INTERVIEW_SESSION_KEYS:
        request.session.pop(key, None)


# Validates interview token + shortlist status before exposing interview actions.
def validate_interview_access(result: Result | None, token: str | None) -> bool:
    if not result or not token:
        return False
    if not result.shortlisted:
        return False
    return token == result.interview_token


# Candidate dashboard serializer keeps API response shape consistent.
def serialize_candidate_dashboard(candidate: Candidate, latest_result: Result | None):
    return {
        "ok": True,
        "candidate": {
            "id": candidate.id,
            "name": candidate.name,
            "email": candidate.email,
            "gender": candidate.gender,
            "resume_path": candidate.resume_path,
        },
        "result": {
            "id": latest_result.id,
            "score": latest_result.score,
            "shortlisted": latest_result.shortlisted,
            "explanation": latest_result.explanation,
            "interview_date": latest_result.interview_date,
            "interview_link": latest_result.interview_link,
        } if latest_result else None,
    }


# Common DB helper used by candidate routes.
def get_candidate_or_404(db: Session, user_id: int):
    candidate = db.query(Candidate).filter(Candidate.id == user_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="candidate not found")
    return candidate


# Returns all available job cards for candidate job selection UI.
def list_available_jobs(db: Session):
    jobs = db.query(JobDescription).order_by(JobDescription.id.desc()).all()
    items = []
    for job in jobs:
        company = db.query(HR).filter(HR.id == job.company_id).first()
        items.append(
            {
                "id": job.id,
                "company_id": job.company_id,
                "company_name": company.company_name if company else "Unknown Company",
                "jd_title": job.jd_title or Path(job.jd_text).name,
                "jd_name": Path(job.jd_text).name,
                "education_requirement": job.education_requirement,
                "experience_requirement": job.experience_requirement,
                "gender_requirement": job.gender_requirement,
            }
        )
    return items


# ---------------------------
# Request Schemas
# ---------------------------
class LoginBody(BaseModel):
    email: EmailStr
    password: str


class SignupBody(BaseModel):
    role: str
    name: str
    email: EmailStr
    password: str
    gender: str | None = None


class ScheduleInterviewBody(BaseModel):
    result_id: int
    interview_date: str


class SkillsBody(BaseModel):
    skill_scores: dict[str, int]
    job_id: int | None = None


class InterviewNextQuestionBody(BaseModel):
    result_id: int
    token: str
    last_answer: str = ""


# ---------------------------
# Auth APIs
# ---------------------------
@api_router.post("/auth/signup")
def api_signup(payload: SignupBody, db: Session = Depends(get_db)):
    existing_candidate = db.query(Candidate).filter(Candidate.email == payload.email).first()
    existing_hr = db.query(HR).filter(HR.email == payload.email).first()
    if existing_candidate or existing_hr:
        raise HTTPException(status_code=400, detail="email already registered")

    if payload.role == "candidate":
        user = Candidate(
            name=payload.name,
            email=payload.email,
            password=hash_password(payload.password),
            gender=payload.gender,
        )
    elif payload.role == "hr":
        user = HR(
            company_name=payload.name,
            email=payload.email,
            password=hash_password(payload.password),
        )
    else:
        raise HTTPException(status_code=400, detail="invalid role")

    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="email already registered")
    return {"ok": True}


@api_router.post("/auth/login")
def api_login(payload: LoginBody, request: Request, db: Session = Depends(get_db)):
    user = db.query(Candidate).filter(Candidate.email == payload.email).first()
    role = "candidate"

    if not user:
        user = db.query(HR).filter(HR.email == payload.email).first()
        role = "hr"

    if not user or not verify_password(payload.password, user.password):
        raise HTTPException(status_code=401, detail="invalid credentials")

    request.session["user_id"] = user.id
    request.session["role"] = role
    return {"ok": True, "role": role}


@api_router.post("/auth/logout")
def api_logout(request: Request):
    request.session.clear()
    return {"ok": True}


@api_router.get("/auth/me")
def api_me(request: Request):
    user = require_session_user(request)
    return {
        "ok": True,
        "user_id": user["user_id"],
        "role": user["role"],
    }


# Backward-compatible aliases for existing clients.
@api_router.post("/login")
def api_login_legacy(payload: LoginBody, request: Request, db: Session = Depends(get_db)):
    return api_login(payload, request, db)


@api_router.post("/logout")
def api_logout_legacy(request: Request):
    return api_logout(request)


@api_router.get("/me")
def api_me_legacy(request: Request):
    return api_me(request)


# ---------------------------
# Candidate APIs
# ---------------------------
@api_router.get("/candidate/dashboard")
def candidate_dashboard_api(
    request: Request,
    job_id: int | None = None,
    db: Session = Depends(get_db),
):
    user = require_session_user(request)
    if user["role"] != "candidate":
        raise HTTPException(status_code=403, detail="candidate access required")

    candidate = get_candidate_or_404(db, user["user_id"])
    jobs = list_available_jobs(db)
    selected_job_id = job_id or (jobs[0]["id"] if jobs else None)

    result_query = db.query(Result).filter(Result.candidate_id == candidate.id)
    if selected_job_id:
        result_query = result_query.filter(Result.job_id == selected_job_id)
    latest_result = result_query.order_by(Result.id.desc()).first()

    payload = serialize_candidate_dashboard(candidate, latest_result)
    payload["available_jobs"] = jobs
    payload["selected_job_id"] = selected_job_id
    return payload


@api_router.post("/candidate/upload-resume")
def candidate_upload_resume_api(
    request: Request,
    resume: UploadFile = File(...),
    job_id: int | None = Form(None),
    db: Session = Depends(get_db),
):
    user = require_session_user(request)
    if user["role"] != "candidate":
        raise HTTPException(status_code=403, detail="candidate access required")

    candidate = get_candidate_or_404(db, user["user_id"])

    safe_filename = Path(resume.filename or "resume").name
    file_path = UPLOAD_DIR / f"{candidate.id}_{uuid.uuid4().hex}_{safe_filename}"
    with file_path.open("wb") as buffer:
        shutil.copyfileobj(resume.file, buffer)

    candidate.resume_path = str(file_path)
    db.commit()

    selected_job = None
    if job_id:
        selected_job = db.query(JobDescription).filter(JobDescription.id == job_id).first()
    if not selected_job:
        selected_job = db.query(JobDescription).order_by(JobDescription.id.desc()).first()
    if not selected_job:
        jobs = list_available_jobs(db)
        return {
            "ok": True,
            "message": "Resume uploaded. No job description available yet.",
            "uploaded_resume": safe_filename,
            "available_jobs": jobs,
            "selected_job_id": jobs[0]["id"] if jobs else None,
            "result": None,
        }

    db.query(Result).filter(
        Result.candidate_id == candidate.id,
        Result.job_id == selected_job.id,
    ).delete()
    db.commit()

    score, explanation = final_score(
        selected_job.jd_text,
        candidate.resume_path,
        selected_job.skill_scores,
        selected_job.education_requirement,
        selected_job.experience_requirement,
    )

    shortlisted = score >= 60
    questions = None
    if shortlisted:
        try:
            extract_text_from_file(candidate.resume_path)
            extract_text_from_file(selected_job.jd_text)
            questions = []
        except Exception:
            questions = None

    new_result = Result(
        candidate_id=candidate.id,
        job_id=selected_job.id,
        score=score,
        shortlisted=shortlisted,
        explanation=explanation,
        interview_questions=questions if shortlisted else None,
    )
    db.add(new_result)
    db.commit()
    db.refresh(new_result)

    latest_result = (
        db.query(Result)
        .filter(
            Result.candidate_id == candidate.id,
            Result.job_id == selected_job.id,
        )
        .order_by(Result.id.desc())
        .first()
    )
    payload = serialize_candidate_dashboard(candidate, latest_result)
    payload["available_jobs"] = list_available_jobs(db)
    payload["selected_job_id"] = selected_job.id
    payload["message"] = "Resume uploaded and AI analysis completed."
    payload["uploaded_resume"] = safe_filename
    return payload


@api_router.post("/candidate/select-interview-date")
def candidate_select_interview_date_api(
    payload: ScheduleInterviewBody,
    request: Request,
    db: Session = Depends(get_db),
):
    user = require_session_user(request)
    if user["role"] != "candidate":
        raise HTTPException(status_code=403, detail="candidate access required")

    result = db.query(Result).filter(Result.id == payload.result_id).first()
    if not result or result.candidate_id != user["user_id"]:
        raise HTTPException(status_code=404, detail="result not found")

    meeting_token = str(uuid.uuid4())
    result.interview_token = meeting_token
    result.interview_date = payload.interview_date
    result.interview_link = (
        f"{_frontend_base_url()}/#/interview/{result.id}?token={meeting_token}"
    )
    db.commit()

    candidate = get_candidate_or_404(db, user["user_id"])
    email_sent = True
    message = "Interview link has been shared to your email."
    try:
        send_interview_email(
            candidate.email,
            candidate.name,
            payload.interview_date,
            result.interview_link,
        )
    except Exception:
        email_sent = False
        message = "Interview scheduled, but email could not be sent."

    return {
        "ok": True,
        "email_sent": email_sent,
        "message": message,
        "result": {
            "id": result.id,
            "interview_date": result.interview_date,
            "interview_link": result.interview_link,
            "interview_token": result.interview_token,
        },
    }


# ---------------------------
# HR APIs
# ---------------------------
@api_router.get("/hr/dashboard")
def hr_dashboard_api(
    request: Request,
    job_id: int | None = None,
    db: Session = Depends(get_db),
):
    user = require_session_user(request)
    if user["role"] != "hr":
        raise HTTPException(status_code=403, detail="hr access required")

    jobs = (
        db.query(JobDescription)
        .filter(JobDescription.company_id == user["user_id"])
        .order_by(JobDescription.id.desc())
        .all()
    )
    selected_jd = None
    if job_id:
        selected_jd = next((job for job in jobs if job.id == job_id), None)
    if not selected_jd and jobs:
        selected_jd = jobs[0]

    shortlisted = []
    if selected_jd:
        results = (
            db.query(Result)
            .filter(Result.job_id == selected_jd.id)
            .filter(Result.shortlisted.is_(True))
            .all()
        )
        for result in results:
            candidate = db.query(Candidate).filter(Candidate.id == result.candidate_id).first()
            if not candidate:
                continue
            shortlisted.append(
                {
                    "candidate": {
                        "id": candidate.id,
                        "name": candidate.name,
                        "email": candidate.email,
                        "resume_path": candidate.resume_path,
                    },
                    "result": {
                        "id": result.id,
                        "score": result.score,
                        "explanation": result.explanation,
                        "interview_date": result.interview_date,
                        "interview_link": result.interview_link,
                    },
                }
            )

    jd_list = []
    for job in jobs:
        jd_list.append(
            {
                "id": job.id,
                "jd_title": job.jd_title or Path(job.jd_text).name,
                "jd_name": Path(job.jd_text).name,
                "jd_text": job.jd_text,
                "skill_scores": job.skill_scores,
                "gender_requirement": job.gender_requirement,
                "education_requirement": job.education_requirement,
                "experience_requirement": job.experience_requirement,
            }
        )

    return {
        "ok": True,
        "selected_job_id": selected_jd.id if selected_jd else None,
        "jobs": jd_list,
        "latest_jd": {
            "id": selected_jd.id,
            "jd_title": selected_jd.jd_title or Path(selected_jd.jd_text).name,
            "jd_text": selected_jd.jd_text,
            "skill_scores": selected_jd.skill_scores,
            "gender_requirement": selected_jd.gender_requirement,
            "education_requirement": selected_jd.education_requirement,
            "experience_requirement": selected_jd.experience_requirement,
        } if selected_jd else None,
        "shortlisted_candidates": shortlisted,
    }


@api_router.get("/hr/jobs")
def hr_jobs_api(request: Request, db: Session = Depends(get_db)):
    user = require_session_user(request)
    if user["role"] != "hr":
        raise HTTPException(status_code=403, detail="hr access required")
    jobs = (
        db.query(JobDescription)
        .filter(JobDescription.company_id == user["user_id"])
        .order_by(JobDescription.id.desc())
        .all()
    )
    return {
        "ok": True,
        "jobs": [
            {
                "id": job.id,
                "jd_title": job.jd_title or Path(job.jd_text).name,
                "jd_name": Path(job.jd_text).name,
            }
            for job in jobs
        ],
    }


@api_router.post("/hr/upload-jd")
def hr_upload_jd_api(
    request: Request,
    jd_file: UploadFile = File(...),
    jd_title: str = Form(""),
    gender_requirement: str = Form(""),
    education_requirement: str = Form(""),
    experience_requirement: str = Form(""),
    db: Session = Depends(get_db),
):
    user = require_session_user(request)
    if user["role"] != "hr":
        raise HTTPException(status_code=403, detail="hr access required")

    years = 0
    if experience_requirement and experience_requirement.strip():
        try:
            years = int(experience_requirement)
        except ValueError:
            years = 0

    safe_filename = Path(jd_file.filename or "job_description").name
    jd_path = UPLOAD_DIR / f"jd_{user['user_id']}_{uuid.uuid4().hex}_{safe_filename}"
    with jd_path.open("wb") as buffer:
        shutil.copyfileobj(jd_file.file, buffer)

    ai_skills = extract_skills_from_jd(str(jd_path))
    ai_skill_dict = {skill: 5 for skill in ai_skills}

    request.session["temp_jd"] = {
        "jd_title": jd_title.strip() if jd_title else None,
        "jd_path": str(jd_path),
        "gender_requirement": gender_requirement or None,
        "education_requirement": education_requirement or None,
        "experience_requirement": years,
    }

    return {
        "ok": True,
        "jd_title": jd_title.strip() if jd_title else None,
        "uploaded_jd": safe_filename,
        "ai_skills": ai_skill_dict,
    }


@api_router.post("/hr/confirm-jd")
def hr_confirm_jd_api(
    payload: SkillsBody,
    request: Request,
    db: Session = Depends(get_db),
):
    user = require_session_user(request)
    if user["role"] != "hr":
        raise HTTPException(status_code=403, detail="hr access required")

    temp_jd = request.session.get("temp_jd")
    if not temp_jd:
        raise HTTPException(status_code=400, detail="please upload JD first")

    if not payload.skill_scores:
        raise HTTPException(status_code=400, detail="skill_scores cannot be empty")

    skill_score_dict = {}
    for skill, score in payload.skill_scores.items():
        if not skill:
            continue
        skill_score_dict[skill.lower()] = int(score)

    new_job = JobDescription(
        company_id=user["user_id"],
        jd_title=temp_jd.get("jd_title"),
        jd_text=temp_jd["jd_path"],
        skill_scores=skill_score_dict,
        gender_requirement=temp_jd["gender_requirement"],
        education_requirement=temp_jd["education_requirement"],
        experience_requirement=temp_jd["experience_requirement"],
    )
    db.add(new_job)
    db.commit()
    db.refresh(new_job)

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
                new_job.experience_requirement,
            )
            shortlisted = score >= 60

        db.add(
            Result(
                candidate_id=candidate.id,
                job_id=new_job.id,
                score=score,
                shortlisted=shortlisted,
                explanation=explanation,
            )
        )

    db.commit()
    request.session.pop("temp_jd", None)
    return {"ok": True, "message": "JD confirmed and AI matching completed successfully."}


@api_router.post("/hr/update-skill-weights")
def hr_update_skill_weights_api(
    payload: SkillsBody,
    request: Request,
    db: Session = Depends(get_db),
):
    user = require_session_user(request)
    if user["role"] != "hr":
        raise HTTPException(status_code=403, detail="hr access required")

    target_job = None
    if payload.job_id:
        target_job = (
            db.query(JobDescription)
            .filter(JobDescription.company_id == user["user_id"], JobDescription.id == payload.job_id)
            .first()
        )
    if not target_job:
        target_job = (
            db.query(JobDescription)
            .filter(JobDescription.company_id == user["user_id"])
            .order_by(JobDescription.id.desc())
            .first()
        )
    if not target_job:
        raise HTTPException(status_code=404, detail="no JD found")

    target_job.skill_scores = {k: int(v) for k, v in payload.skill_scores.items()}
    db.commit()
    return {"ok": True, "message": "Skill weights updated successfully."}


# ---------------------------
# Interview APIs
# ---------------------------
@api_router.get("/interview/{result_id}")
def interview_session_api(
    result_id: int,
    token: str,
    request: Request,
    db: Session = Depends(get_db),
):
    result = db.query(Result).filter(Result.id == result_id).first()
    if not validate_interview_access(result, token):
        raise HTTPException(status_code=403, detail="invalid interview access")

    candidate = db.query(Candidate).filter(Candidate.id == result.candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="candidate not found")

    clear_interview_session(request)
    request.session["interview_result_id"] = result_id
    request.session["interview_token"] = token

    return {
        "ok": True,
        "candidate_name": candidate.name,
        "result_id": result.id,
        "interview_duration": INTERVIEW_DURATION,
    }


@api_router.post("/interview/next-question")
def interview_next_question_api(
    payload: InterviewNextQuestionBody,
    request: Request,
    db: Session = Depends(get_db),
):
    result = db.query(Result).filter(Result.id == payload.result_id).first()
    if not validate_interview_access(result, payload.token):
        return {"question": "Interview session error."}

    # Session can be lost between requests (browser privacy/cookie resets).
    # Rehydrate interview context from token-validated request instead of failing hard.
    if request.session.get("interview_result_id") != payload.result_id:
        request.session["interview_result_id"] = payload.result_id
    if request.session.get("interview_token") != payload.token:
        request.session["interview_token"] = payload.token

    candidate = db.query(Candidate).filter(Candidate.id == result.candidate_id).first()
    job = db.query(JobDescription).filter(JobDescription.id == result.job_id).first()
    if not candidate or not job:
        return {"question": "Interview session error."}

    if request.session.get("interview_initialized") is None:
        request.session["interview_initialized"] = True
        request.session["interview_start"] = str(datetime.now())
        request.session["asked_questions"] = ""
        request.session["question_count"] = 0
        request.session["projects"] = []
        request.session["experiences"] = []
        request.session["covered_projects"] = []
        request.session["phase"] = "intro"
        request.session["followup_depth"] = 0
        request.session["current_topic"] = None

    start_time = datetime.fromisoformat(request.session["interview_start"])
    elapsed_minutes = (datetime.now() - start_time).total_seconds() / 60
    if elapsed_minutes >= INTERVIEW_DURATION:
        clear_interview_session(request)
        return {"question": "INTERVIEW_COMPLETE"}

    remaining_minutes = INTERVIEW_DURATION - int(elapsed_minutes)
    if remaining_minutes <= 1:
        question_mode = "lightning"
    elif remaining_minutes <= 3:
        question_mode = "rapid"
    else:
        question_mode = "deep"

    asked_questions = request.session.get("asked_questions", "")
    question_count = request.session.get("question_count", 0)
    phase = request.session.get("phase")
    followup_depth = request.session.get("followup_depth", 0)
    current_topic = request.session.get("current_topic")

    weak_answer = bool(payload.last_answer and len(payload.last_answer.strip()) < 15)
    if weak_answer:
        request.session["followup_depth"] = 999

    if phase == "intro":
        request.session["phase"] = "resume"
        intro = (
            "Introduce yourself. Explain your academic background, "
            "work experience, technical strengths, and key projects."
        )
        request.session["asked_questions"] = intro
        request.session["question_count"] = 1
        return {"question": intro}

    jd_text = extract_text_from_file(job.jd_text)
    resume_text = extract_text_from_file(candidate.resume_path)

    if not request.session["projects"]:
        projects = re.findall(r"(Project\s*[:\-]?\s*.*)", resume_text, re.IGNORECASE)
        request.session["projects"] = list(set(projects))

    if not request.session["experiences"]:
        exps = re.findall(
            r"(Experience\s*[:\-]?.*|Company\s*[:\-]?.*)",
            resume_text,
            re.IGNORECASE,
        )
        request.session["experiences"] = list(set(exps))

    projects = request.session["projects"]
    experiences = request.session["experiences"]
    covered_projects = request.session["covered_projects"]

    stage = "basics"
    current_project = None
    current_experience = None

    if phase == "resume":
        stage = "basics"
        if followup_depth >= 2:
            request.session["phase"] = "experience"
            request.session["followup_depth"] = 0
        else:
            request.session["followup_depth"] += 1
    elif phase == "experience" and experiences:
        if not current_topic:
            current_topic = experiences[0]
            request.session["current_topic"] = current_topic
        stage = "experience"
        current_experience = current_topic
        if followup_depth >= 2 or question_mode != "deep":
            request.session["phase"] = "project"
            request.session["current_topic"] = None
            request.session["followup_depth"] = 0
        else:
            request.session["followup_depth"] += 1
    elif phase == "project" and projects:
        if not current_topic:
            for project in projects:
                if project not in covered_projects:
                    current_topic = project
                    request.session["current_topic"] = current_topic
                    break
        stage = "advanced_projects"
        current_project = current_topic
        if followup_depth >= 2 or question_mode != "deep":
            if current_project and current_project not in covered_projects:
                covered_projects.append(current_project)
                request.session["covered_projects"] = covered_projects
            request.session["current_topic"] = None
            request.session["followup_depth"] = 0
            request.session["phase"] = "system" if len(covered_projects) >= len(projects) else "project"
        else:
            request.session["followup_depth"] += 1
    elif phase == "system":
        stage = "deep_dive"
        if followup_depth >= 1 or question_mode != "deep":
            request.session["phase"] = "hr"
            request.session["followup_depth"] = 0
        else:
            request.session["followup_depth"] += 1
    elif phase == "hr":
        stage = "hr"
        if remaining_minutes <= 0:
            clear_interview_session(request)
            return {"question": "Thank you for attending the interview."}

    max_retry = 3
    question = None
    for _ in range(max_retry):
        try:
            candidate_question = generate_dynamic_question(
                jd_text,
                resume_text,
                payload.last_answer,
                stage,
                asked_questions,
                remaining_minutes,
                current_project,
                current_experience,
                question_mode,
            )
        except Exception:
            candidate_question = "Walk me through your most relevant project and your specific contribution."
        clean = candidate_question.strip().lower()
        if clean not in asked_questions.lower():
            question = candidate_question
            break

    if not question:
        question = "Explain a complex technical challenge you solved recently."

    request.session["asked_questions"] = asked_questions + "\n" + question
    request.session["question_count"] = question_count + 1
    return {"question": question}
