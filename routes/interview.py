from fastapi import APIRouter, Request, Depends, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from datetime import datetime
import re

from database import SessionLocal
from models import Result, JobDescription, Candidate
from ai_engine.question_generator import generate_dynamic_question
from ai_engine.matching import extract_text_from_file

router = APIRouter()
templates = Jinja2Templates(directory="templates")

# 🔥 Change interview duration here (in minutes)
INTERVIEW_DURATION = 2


# ---------------------------
# DB Dependency
# ---------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------
# Interview Page
# ---------------------------
@router.get("/interview/{result_id}", response_class=HTMLResponse)
def interview_page(result_id: int, request: Request, token: str = None, db: Session = Depends(get_db)):

    result = db.query(Result).filter(Result.id == result_id).first()
    if not result or not token or token != result.interview_token or not result.shortlisted:
        return RedirectResponse("/", status_code=303)

    candidate = db.query(Candidate).filter(Candidate.id == result.candidate_id).first()
    job = db.query(JobDescription).filter(JobDescription.id == result.job_id).first()

    if not candidate or not job:
        return RedirectResponse("/", status_code=303)

    return templates.TemplateResponse(
        "interview.html",
        {"request": request, "candidate": candidate, "result": result}
    )


# ---------------------------
# Generate Next Question
# ---------------------------
@router.post("/generate-next-question")
def generate_next_question(
    request: Request,
    result_id: int = Form(...),
    last_answer: str = Form(""),
    db: Session = Depends(get_db)
):

    result = db.query(Result).filter(Result.id == result_id).first()
    if not result:
        return {"question": "Interview session error."}

    candidate = db.query(Candidate).filter(Candidate.id == result.candidate_id).first()
    job = db.query(JobDescription).filter(JobDescription.id == result.job_id).first()

    if not candidate or not job:
        return {"question": "Interview session error."}

    # --------------------------------------------------
    # SESSION INITIALIZATION
    # --------------------------------------------------
    if "interview_start" not in request.session:
        request.session.clear()
        request.session["interview_start"] = str(datetime.now())
        request.session["asked_questions"] = ""
        request.session["question_count"] = 0
        request.session["projects"] = []
        request.session["experiences"] = []
        request.session["covered_projects"] = []
        request.session["phase"] = "intro"
        request.session["followup_depth"] = 0
        request.session["current_topic"] = None

    # --------------------------------------------------
    # TIME CONTROL
    # --------------------------------------------------
    start_time = datetime.fromisoformat(request.session["interview_start"])
    elapsed_minutes = (datetime.now() - start_time).total_seconds() / 60

    if elapsed_minutes >= INTERVIEW_DURATION:
        request.session.clear()
        return {"question": "INTERVIEW_COMPLETE"}

    remaining_minutes = INTERVIEW_DURATION - int(elapsed_minutes)

    # 🔥 Dynamic Question Mode
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

    # --------------------------------------------------
    # WEAK / SILENCE DETECTION
    # --------------------------------------------------
    weak_answer = False
    if last_answer and len(last_answer.strip()) < 15:
        weak_answer = True

    if weak_answer:
        # force phase shift
        request.session["followup_depth"] = 999

    # --------------------------------------------------
    # FIXED INTRO
    # --------------------------------------------------
    if phase == "intro":
        request.session["phase"] = "resume"
        intro = (
            "Introduce yourself. Explain your academic background, "
            "work experience, technical strengths, and key projects."
        )
        request.session["asked_questions"] = intro
        request.session["question_count"] = 1
        return {"question": intro}

    # --------------------------------------------------
    # Extract Resume & JD
    # --------------------------------------------------
    jd_text = extract_text_from_file(job.jd_text)
    resume_text = extract_text_from_file(candidate.resume_path)

    if not request.session["projects"]:
        projects = re.findall(r'(Project\s*[:\-]?\s*.*)', resume_text, re.IGNORECASE)
        request.session["projects"] = list(set(projects))

    if not request.session["experiences"]:
        exps = re.findall(r'(Experience\s*[:\-]?.*|Company\s*[:\-]?.*)', resume_text, re.IGNORECASE)
        request.session["experiences"] = list(set(exps))

    projects = request.session["projects"]
    experiences = request.session["experiences"]
    covered_projects = request.session["covered_projects"]

    stage = "basics"
    current_project = None
    current_experience = None

    # --------------------------------------------------
    # PHASE ENGINE
    # --------------------------------------------------

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
            for p in projects:
                if p not in covered_projects:
                    current_topic = p
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

            if len(covered_projects) >= len(projects):
                request.session["phase"] = "system"
            else:
                request.session["phase"] = "project"
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
            request.session.clear()
            return {"question": "Thank you for attending the interview."}

    # --------------------------------------------------
    # ANTI-REPETITION
    # --------------------------------------------------
    MAX_RETRY = 3
    question = None

    for _ in range(MAX_RETRY):
        candidate_question = generate_dynamic_question(
            jd_text,
            resume_text,
            last_answer,
            stage,
            asked_questions,
            remaining_minutes,
            current_project,
            current_experience,
            question_mode
        )

        clean = candidate_question.strip().lower()

        if clean not in asked_questions.lower():
            question = candidate_question
            break

    if not question:
        question = "Explain a complex technical challenge you solved recently."

    # --------------------------------------------------
    # UPDATE SESSION
    # --------------------------------------------------
    request.session["asked_questions"] = asked_questions + "\n" + question
    request.session["question_count"] = question_count + 1

    return {"question": question}
