import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ai_engine.matching import extract_skills_from_jd, final_score
from database import SessionLocal
from models import Candidate, InterviewQuestion, InterviewSession, JobDescription, Result

router = APIRouter()

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)


def _safe_percent(value):
    if value is None:
        return "N/A"
    try:
        return f"{float(value):.2f}%"
    except (TypeError, ValueError):
        return "N/A"


def _classify_role_from_skills(skill_scores: dict) -> str:
    skills = {str(k).lower() for k in (skill_scores or {}).keys()}
    if not skills:
        return "General Role"

    if "python" in skills and "java" not in skills:
        return "Python Developer"
    if "java" in skills and "python" not in skills:
        return "Java Developer"
    if "python" in skills and "java" in skills:
        return "Backend Developer"
    if {"react", "javascript", "typescript"} & skills:
        return "Frontend Developer"
    if {"django", "flask", "fastapi", "spring", "node", "node.js"} & skills:
        return "Backend Developer"
    if {"aws", "azure", "gcp", "docker", "kubernetes", "devops"} & skills:
        return "DevOps Engineer"
    if {"sql", "mysql", "postgresql", "postgres", "mongodb"} & skills:
        return "Data/Backend Role"

    return "General Role"


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


@router.get("/hr/dashboard")
def hr_dashboard(
    request: Request,
    job_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    user = get_current_user(request, db)
    if not user or user["role"] != "hr":
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    all_jds = (
        db.query(JobDescription)
        .filter(JobDescription.company_id == user["user_id"])
        .order_by(JobDescription.id.desc())
        .all()
    )

    latest_jd = all_jds[0] if all_jds else None
    selected_jd = latest_jd
    if job_id and all_jds:
        selected_jd = next((j for j in all_jds if j.id == job_id), latest_jd)

    shortlisted_candidates = []

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

            interview_session = (
                db.query(InterviewSession)
                .filter(InterviewSession.candidate_id == candidate.id)
                .filter(InterviewSession.job_id == selected_jd.id)
                .order_by(InterviewSession.id.desc())
                .first()
            )

            explanation = result.explanation if isinstance(result.explanation, dict) else {}
            matched_skills = explanation.get("matched_skills", [])
            jd_skills = list((selected_jd.skill_scores or {}).keys())
            missing_skills = [skill for skill in jd_skills if skill not in matched_skills]
            academic = explanation.get("academic_percentages", {}) or {}

            qa_transcript = []
            duration_seconds = 0
            timeline = []
            violations = []
            behavior_summary = {}

            if interview_session:
                questions = (
                    db.query(InterviewQuestion)
                    .filter(InterviewQuestion.interview_id == interview_session.id)
                    .order_by(InterviewQuestion.id.asc())
                    .all()
                )
                qa_transcript = [
                    {
                        "id": q.id,
                        "question": q.question_text,
                        "answer": q.answer_text,
                        "score": q.score,
                    }
                    for q in questions
                ]

                if interview_session.started_at and interview_session.ended_at:
                    duration_seconds = int(
                        (interview_session.ended_at - interview_session.started_at).total_seconds()
                    )

            report = explanation.get("interview_report", {})
            timeline = report.get("timeline", [])
            violations = report.get("violations", [])
            behavior_summary = explanation.get("video_analysis", {})

            answered_count = sum(1 for qa in qa_transcript if (qa.get("answer") or "").strip())
            unanswered_count = len(qa_transcript) - answered_count
            avg_answer_words = 0
            if answered_count > 0:
                total_words = sum(
                    len((qa.get("answer") or "").strip().split())
                    for qa in qa_transcript
                    if (qa.get("answer") or "").strip()
                )
                avg_answer_words = round(total_words / answered_count, 2)

            shortlisted_candidates.append(
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
                        "interview_date": str(result.interview_date) if result.interview_date else None,
                        "interview_start_time": result.interview_start_time,
                        "interview_end_time": result.interview_end_time,
                        "interview_abandoned": result.interview_abandoned,
                        "hr_decision": explanation.get("hr_decision"),
                        "hr_decision_at": explanation.get("hr_decision_at"),
                        "explanation": explanation,
                        "matched_skills": matched_skills,
                        "missing_skills": missing_skills,
                    },
                    "interview_details": {
                        "scheduled_at": str(interview_session.scheduled_at)
                        if interview_session and interview_session.scheduled_at
                        else None,
                        "started_at": str(interview_session.started_at)
                        if interview_session and interview_session.started_at
                        else None,
                        "ended_at": str(interview_session.ended_at)
                        if interview_session and interview_session.ended_at
                        else None,
                        "duration_seconds": duration_seconds,
                        "abandoned": interview_session.abandoned if interview_session else False,
                        "completed": interview_session.completed if interview_session else False,
                        "suspicious_activity": interview_session.suspicious_activity if interview_session else False,
                        "status": interview_session.status if interview_session else "not_started",
                        "timeline": timeline,
                        "violations": violations,
                        "behavior_summary": behavior_summary,
                        "qa_transcript": qa_transcript,
                    },
                    "candidate_report": {
                        "candidate_skills": matched_skills,
                        "missing_required_skills": missing_skills,
                        "academic_percentages": {
                            "tenth": _safe_percent(academic.get("10th")),
                            "intermediate": _safe_percent(academic.get("intermediate")),
                            "engineering": _safe_percent(academic.get("engineering")),
                        },
                        "screening_analysis": {
                            "overall_score": result.score,
                            "semantic_score": explanation.get("semantic_score", 0),
                            "skill_score": explanation.get("skill_score", 0),
                            "education_check": explanation.get("education_reason", "Not available"),
                            "experience_check": explanation.get("experience_reason", "Not available"),
                            "academic_check": explanation.get("percentage_reason", "Not available"),
                            "experience_detected_years": explanation.get("total_experience_detected", 0),
                        },
                        "interview_analysis": {
                            "status": interview_session.status if interview_session else "not_started",
                            "started_at": str(interview_session.started_at)
                            if interview_session and interview_session.started_at
                            else None,
                            "ended_at": str(interview_session.ended_at)
                            if interview_session and interview_session.ended_at
                            else None,
                            "duration_seconds": duration_seconds,
                            "questions_asked": len(qa_transcript),
                            "questions_answered": answered_count,
                            "questions_unanswered": unanswered_count,
                            "avg_answer_words": avg_answer_words,
                            "suspicious_activity": interview_session.suspicious_activity if interview_session else False,
                            "violation_count": len(violations),
                            "timeline_count": len(timeline),
                        },
                    },
                }
            )

    summary = {
        "total_selected": len(shortlisted_candidates),
        "cleared_interview": 0,
        "in_progress": 0,
        "saved_candidates": 0,
    }
    for entry in shortlisted_candidates:
        details = entry.get("interview_details", {})
        result_data = entry.get("result", {})
        status = (details.get("status") or "").lower()
        completed = bool(details.get("completed"))
        abandoned = bool(details.get("abandoned"))
        hr_decision = (result_data.get("hr_decision") or "").lower()

        if completed and not abandoned:
            summary["cleared_interview"] += 1
        if status == "in_progress":
            summary["in_progress"] += 1
        if hr_decision == "saved":
            summary["saved_candidates"] += 1

    return JSONResponse(
        {
            "latest_jd": {
                "id": selected_jd.id,
                "company_name": selected_jd.company_name,
                "jd_text": selected_jd.jd_text.split("\\")[-1] if selected_jd else None,
                "skill_scores": selected_jd.skill_scores,
                "role_classification": _classify_role_from_skills(selected_jd.skill_scores),
            }
            if selected_jd
            else None,
            "available_jds": [
                {
                    "id": jd.id,
                    "company_name": jd.company_name,
                    "jd_text": jd.jd_text.split("\\")[-1] if jd.jd_text else None,
                    "skill_scores": jd.skill_scores or {},
                    "role_classification": _classify_role_from_skills(jd.skill_scores),
                }
                for jd in all_jds
            ],
            "shortlisted_candidates": shortlisted_candidates,
            "summary": summary,
        }
    )


@router.post("/upload_jd")
def upload_jd(
    request: Request,
    jd_file: UploadFile = File(...),
    company_name: str = Form(...),
    gender_requirement: Optional[str] = Form(None),
    education_requirement: Optional[str] = Form(None),
    experience_requirement: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    user = get_current_user(request, db)
    if not user or user["role"] != "hr":
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    if experience_requirement and experience_requirement.strip():
        experience_requirement = int(experience_requirement)
    else:
        experience_requirement = 0

    jd_path = UPLOAD_DIR / f"jd_{user['user_id']}_{jd_file.filename}"
    with jd_path.open("wb") as buffer:
        shutil.copyfileobj(jd_file.file, buffer)

    ai_skills = extract_skills_from_jd(str(jd_path))
    ai_skill_dict = {skill: 10 for skill in ai_skills}

    request.session["temp_jd"] = {
        "jd_path": str(jd_path),
        "company_name": company_name,
        "gender_requirement": gender_requirement,
        "education_requirement": education_requirement,
        "experience_requirement": experience_requirement,
    }

    return JSONResponse({"success": True, "ai_skills": ai_skill_dict, "uploaded_jd": jd_file.filename})


@router.post("/confirm_jd")
def confirm_jd(
    request: Request,
    skill_names_bracket: Optional[list[str]] = Form(None, alias="skill_names[]"),
    skill_scores_bracket: Optional[list[str]] = Form(None, alias="skill_scores[]"),
    skill_names_plain: Optional[list[str]] = Form(None, alias="skill_names"),
    skill_scores_plain: Optional[list[str]] = Form(None, alias="skill_scores"),
    db: Session = Depends(get_db),
):
    user = get_current_user(request, db)
    if not user or user["role"] != "hr":
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    temp_jd = request.session.get("temp_jd")
    if not temp_jd:
        return JSONResponse(status_code=400, content={"error": "No JD data found"})

    skill_names = skill_names_bracket or skill_names_plain or []
    skill_scores = skill_scores_bracket or skill_scores_plain or []
    if not skill_names or not skill_scores:
        return JSONResponse(status_code=400, content={"error": "No skill data received from form"})

    skill_score_dict = {}
    try:
        for skill, score in zip(skill_names, skill_scores):
            if skill is not None and score is not None and str(skill).strip() != "":
                skill_score_dict[skill.lower()] = int(str(score).strip())
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "Invalid skill score value provided"})

    if not skill_score_dict:
        return JSONResponse(status_code=400, content={"error": "Skill list is empty after validation"})

    new_job = JobDescription(
        company_id=user["user_id"],
        company_name=temp_jd["company_name"],
        jd_text=temp_jd["jd_path"],
        skill_scores=skill_score_dict,
        gender_requirement=temp_jd["gender_requirement"],
        education_requirement=temp_jd["education_requirement"],
        experience_requirement=temp_jd["experience_requirement"],
    )
    db.add(new_job)
    db.commit()

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
    return JSONResponse({"success": True, "message": "JD confirmed & AI matching completed"})


@router.post("/update_skill_weights")
def update_skill_weights(
    request: Request,
    skill_names_bracket: Optional[list[str]] = Form(None, alias="skill_names[]"),
    skill_scores_bracket: Optional[list[str]] = Form(None, alias="skill_scores[]"),
    skill_names_plain: Optional[list[str]] = Form(None, alias="skill_names"),
    skill_scores_plain: Optional[list[str]] = Form(None, alias="skill_scores"),
    db: Session = Depends(get_db),
):
    user = get_current_user(request, db)
    if not user or user["role"] != "hr":
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    latest_jd = (
        db.query(JobDescription)
        .filter(JobDescription.company_id == user["user_id"])
        .order_by(JobDescription.id.desc())
        .first()
    )
    if not latest_jd:
        return JSONResponse(status_code=404, content={"error": "No JD found"})

    skill_names = skill_names_bracket or skill_names_plain or []
    skill_scores = skill_scores_bracket or skill_scores_plain or []
    if not skill_names or not skill_scores:
        return JSONResponse(status_code=400, content={"error": "No skill data received from form"})

    try:
        updated_skills = {
            skill: int(str(score).strip())
            for skill, score in zip(skill_names, skill_scores)
            if skill is not None and str(skill).strip() != ""
        }
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "Invalid skill score value provided"})

    latest_jd.skill_scores = updated_skills
    db.commit()
    return JSONResponse({"success": True, "message": "Skill weights updated"})


@router.post("/hr/candidate/save")
def save_candidate(
    request: Request,
    result_id: int = Form(...),
    db: Session = Depends(get_db),
):
    user = get_current_user(request, db)
    if not user or user["role"] != "hr":
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    result = db.query(Result).filter(Result.id == result_id).first()
    if not result:
        return JSONResponse(status_code=404, content={"error": "Result not found"})

    job = (
        db.query(JobDescription)
        .filter(JobDescription.id == result.job_id)
        .filter(JobDescription.company_id == user["user_id"])
        .first()
    )
    if not job:
        return JSONResponse(status_code=403, content={"error": "Forbidden"})

    explanation = result.explanation if isinstance(result.explanation, dict) else {}
    explanation["hr_decision"] = "saved"
    explanation["hr_decision_at"] = datetime.now().isoformat()
    result.explanation = explanation

    db.commit()
    return JSONResponse({"success": True, "message": "Candidate saved successfully"})


@router.post("/hr/candidate/delete")
def delete_candidate_from_shortlist(
    request: Request,
    result_id: int = Form(...),
    db: Session = Depends(get_db),
):
    user = get_current_user(request, db)
    if not user or user["role"] != "hr":
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    result = db.query(Result).filter(Result.id == result_id).first()
    if not result:
        return JSONResponse(status_code=404, content={"error": "Result not found"})

    job = (
        db.query(JobDescription)
        .filter(JobDescription.id == result.job_id)
        .filter(JobDescription.company_id == user["user_id"])
        .first()
    )
    if not job:
        return JSONResponse(status_code=403, content={"error": "Forbidden"})

    explanation = result.explanation if isinstance(result.explanation, dict) else {}
    explanation["hr_decision"] = "deleted"
    explanation["hr_decision_at"] = datetime.now().isoformat()
    result.explanation = explanation
    result.shortlisted = False

    db.commit()
    return JSONResponse({"success": True, "message": "Candidate deleted from shortlist"})
