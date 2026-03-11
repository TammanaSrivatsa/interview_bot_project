import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional
import json

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy.orm import Session

from ai_engine.matching import extract_skills_from_jd, final_score
from database import SessionLocal
from models import Candidate, HR, InterviewQuestion, InterviewSession, JobDescription, Result

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


def _display_role_name(job: JobDescription) -> str:
    return (job.role_name or "").strip() or _classify_role_from_skills(job.skill_scores)


def _derive_pipeline_status(result: Result, interview_session: Optional[InterviewSession]) -> str:
    if result.pipeline_status:
        return result.pipeline_status
    if interview_session:
        if interview_session.abandoned:
            return "abandoned"
        if interview_session.completed:
            return "completed"
        if interview_session.status == "in_progress":
            return "in_progress"
        if interview_session.scheduled_at or result.interview_date:
            return "scheduled"
    if result.shortlisted:
        return "shortlisted"
    if result.screening_completed:
        return "rejected"
    return "applied"


def _decision_label(decision: Optional[str]) -> str:
    return (decision or "pending").replace("_", " ").title()


def _score_bucket(score: Optional[float]) -> str:
    numeric = float(score or 0)
    if numeric >= 80:
        return "Strong"
    if numeric >= 65:
        return "Good"
    if numeric >= 50:
        return "Mixed"
    return "Weak"


def _build_candidate_report_payload(
    result: Result,
    candidate: Candidate,
    job: JobDescription,
    interview_session: Optional[InterviewSession],
    questions: list[InterviewQuestion],
) -> dict:
    explanation = result.explanation if isinstance(result.explanation, dict) else {}
    matched_skills = explanation.get("matched_skills", [])
    jd_skills = list((job.skill_scores or {}).keys())
    missing_skills = [skill for skill in jd_skills if skill not in matched_skills]
    academic = explanation.get("academic_percentages", {}) or {}
    interview_report = explanation.get("interview_report", {}) or {}
    timeline = interview_report.get("timeline", [])
    violations = interview_report.get("violations", [])
    behavior_summary = explanation.get("video_analysis", {}) or {}

    duration_seconds = 0
    if interview_session and interview_session.started_at and interview_session.ended_at:
        duration_seconds = int((interview_session.ended_at - interview_session.started_at).total_seconds())

    qa_transcript = []
    total_question_score = 0.0
    scored_questions = 0
    for question in questions:
        score = float(question.score or 0)
        if question.score is not None:
            total_question_score += score
            scored_questions += 1
        qa_transcript.append(
            {
                "id": question.id,
                "question": question.question_text,
                "answer": question.answer_text,
                "score": question.score,
                "score_reason": question.score_reason,
            }
        )

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

    final_score = interview_session.final_score if interview_session and interview_session.final_score is not None else None
    report_summary = {
        "screening_score": result.score,
        "interview_score": final_score,
        "overall_recommendation": _score_bucket(final_score if final_score is not None else result.score),
        "pipeline_status": _derive_pipeline_status(result, interview_session),
        "hr_decision": result.hr_decision or "pending",
    }

    return {
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
            "pipeline_status": _derive_pipeline_status(result, interview_session),
            "hr_decision": result.hr_decision,
            "hr_decision_at": explanation.get("hr_decision_at"),
            "recruiter_notes": result.recruiter_notes,
            "recruiter_feedback": result.recruiter_feedback,
            "explanation": explanation,
            "matched_skills": matched_skills,
            "missing_skills": missing_skills,
            "report_generated_at": str(result.report_generated_at) if result.report_generated_at else None,
        },
        "interview_details": {
            "scheduled_at": str(interview_session.scheduled_at) if interview_session and interview_session.scheduled_at else None,
            "started_at": str(interview_session.started_at) if interview_session and interview_session.started_at else None,
            "ended_at": str(interview_session.ended_at) if interview_session and interview_session.ended_at else None,
            "duration_seconds": duration_seconds,
            "abandoned": interview_session.abandoned if interview_session else False,
            "completed": interview_session.completed if interview_session else False,
            "suspicious_activity": interview_session.suspicious_activity if interview_session else False,
            "status": interview_session.status if interview_session else "not_started",
            "timeline": timeline,
            "violations": violations,
            "behavior_summary": behavior_summary,
            "qa_transcript": qa_transcript,
            "final_score": final_score,
            "overall_feedback": interview_session.overall_feedback if interview_session else None,
        },
        "candidate_report": {
            "summary": report_summary,
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
                "started_at": str(interview_session.started_at) if interview_session and interview_session.started_at else None,
                "ended_at": str(interview_session.ended_at) if interview_session and interview_session.ended_at else None,
                "duration_seconds": duration_seconds,
                "questions_asked": len(qa_transcript),
                "questions_answered": answered_count,
                "questions_unanswered": unanswered_count,
                "avg_answer_words": avg_answer_words,
                "suspicious_activity": interview_session.suspicious_activity if interview_session else False,
                "violation_count": len(violations),
                "timeline_count": len(timeline),
                "interview_score": final_score,
                "average_question_score": round(total_question_score / scored_questions, 2) if scored_questions else None,
            },
            "recruiter_review": {
                "decision": result.hr_decision or "pending",
                "decision_label": _decision_label(result.hr_decision),
                "notes": result.recruiter_notes,
                "feedback": result.recruiter_feedback,
            },
            "qa_breakdown": qa_transcript,
        },
    }


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
            .order_by(Result.id.desc())
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

            questions = []
            if interview_session:
                questions = (
                    db.query(InterviewQuestion)
                    .filter(InterviewQuestion.interview_id == interview_session.id)
                    .order_by(InterviewQuestion.id.asc())
                    .all()
                )

            shortlisted_candidates.append(
                _build_candidate_report_payload(
                    result=result,
                    candidate=candidate,
                    job=selected_jd,
                    interview_session=interview_session,
                    questions=questions,
                )
            )

    summary = {
        "total_selected": len(shortlisted_candidates),
        "cleared_interview": 0,
        "in_progress": 0,
        "saved_candidates": 0,
        "rejected_candidates": 0,
        "on_hold_candidates": 0,
        "completed_reports": 0,
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
        if hr_decision == "rejected":
            summary["rejected_candidates"] += 1
        if hr_decision == "on_hold":
            summary["on_hold_candidates"] += 1
        if details.get("final_score") is not None:
            summary["completed_reports"] += 1

    return JSONResponse(
        {
            "latest_jd": {
                "id": selected_jd.id,
                "company_name": selected_jd.company_name,
                "role_name": selected_jd.role_name,
                "jd_text": selected_jd.jd_text.split("\\")[-1] if selected_jd else None,
                "skill_scores": selected_jd.skill_scores,
                "gender_requirement": selected_jd.gender_requirement,
                "education_requirement": selected_jd.education_requirement,
                "experience_requirement": selected_jd.experience_requirement,
                "role_classification": _display_role_name(selected_jd),
            }
            if selected_jd
            else None,
            "available_jds": [
                {
                    "id": jd.id,
                    "company_name": jd.company_name,
                    "role_name": jd.role_name,
                    "jd_text": jd.jd_text.split("\\")[-1] if jd.jd_text else None,
                    "skill_scores": jd.skill_scores or {},
                    "gender_requirement": jd.gender_requirement,
                    "education_requirement": jd.education_requirement,
                    "experience_requirement": jd.experience_requirement,
                    "role_classification": _display_role_name(jd),
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
    company_name: Optional[str] = Form(None),
    role_name: Optional[str] = Form(None),
    gender_requirement: Optional[str] = Form(None),
    education_requirement: Optional[str] = Form(None),
    experience_requirement: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    user = get_current_user(request, db)
    if not user or user["role"] != "hr":
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    hr_user = db.query(HR).filter(HR.id == user["user_id"]).first()
    resolved_company_name = (company_name or "").strip() or (hr_user.company_name if hr_user else "")
    if not resolved_company_name:
        return JSONResponse(status_code=400, content={"error": "Company name not found for this HR account"})

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
        "company_name": resolved_company_name,
        "role_name": (role_name or "").strip(),
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
        role_name=temp_jd.get("role_name") or None,
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
                screening_completed=True,
                screened_at=datetime.utcnow(),
                pipeline_status="shortlisted" if shortlisted else "rejected",
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


@router.post("/hr/jd/update")
def update_job_description(
    request: Request,
    job_id: int = Form(...),
    role_name: str = Form(...),
    education_requirement: str = Form(""),
    experience_requirement: str = Form("0"),
    gender_requirement: str = Form(""),
    skill_names_bracket: Optional[list[str]] = Form(None, alias="skill_names[]"),
    skill_scores_bracket: Optional[list[str]] = Form(None, alias="skill_scores[]"),
    skill_names_plain: Optional[list[str]] = Form(None, alias="skill_names"),
    skill_scores_plain: Optional[list[str]] = Form(None, alias="skill_scores"),
    db: Session = Depends(get_db),
):
    user = get_current_user(request, db)
    if not user or user["role"] != "hr":
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    job = (
        db.query(JobDescription)
        .filter(JobDescription.id == job_id)
        .filter(JobDescription.company_id == user["user_id"])
        .first()
    )
    if not job:
        return JSONResponse(status_code=404, content={"error": "Job description not found"})

    skill_names = skill_names_bracket or skill_names_plain or []
    skill_scores = skill_scores_bracket or skill_scores_plain or []
    updated_skills: dict[str, int] = {}
    try:
        for skill, score in zip(skill_names, skill_scores):
            cleaned_skill = (skill or "").strip().lower()
            if cleaned_skill:
                updated_skills[cleaned_skill] = int(str(score).strip())
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "Invalid skill score value provided"})

    try:
        parsed_experience = int((experience_requirement or "0").strip() or "0")
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "Invalid experience requirement"})

    job.role_name = role_name.strip() or None
    job.education_requirement = education_requirement.strip() or None
    job.experience_requirement = parsed_experience
    job.gender_requirement = gender_requirement.strip() or None
    if updated_skills:
      job.skill_scores = updated_skills

    db.commit()
    return JSONResponse({"success": True, "message": "JD details updated"})


@router.post("/hr/jd/rematch")
def rematch_job_description(
    request: Request,
    job_id: int = Form(...),
    db: Session = Depends(get_db),
):
    user = get_current_user(request, db)
    if not user or user["role"] != "hr":
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    job = (
        db.query(JobDescription)
        .filter(JobDescription.id == job_id)
        .filter(JobDescription.company_id == user["user_id"])
        .first()
    )
    if not job:
        return JSONResponse(status_code=404, content={"error": "Job description not found"})

    candidates = db.query(Candidate).all()
    processed = 0
    for candidate in candidates:
        if not candidate.resume_path:
            continue

        explanation = {}
        score = 0
        shortlisted = False

        if job.gender_requirement and candidate.gender != job.gender_requirement:
            explanation["gender_reason"] = "Gender requirement not satisfied."
        else:
            score, explanation = final_score(
                job.jd_text,
                candidate.resume_path,
                job.skill_scores or {},
                job.education_requirement,
                job.experience_requirement,
            )
            shortlisted = score >= 60

        existing_result = (
            db.query(Result)
            .filter(Result.job_id == job.id)
            .filter(Result.candidate_id == candidate.id)
            .first()
        )

        if existing_result:
            existing_result.score = score
            existing_result.shortlisted = shortlisted
            existing_result.explanation = explanation
            existing_result.screening_completed = True
            existing_result.screened_at = datetime.utcnow()
            existing_result.pipeline_status = "shortlisted" if shortlisted else "rejected"
        else:
            db.add(
                Result(
                    candidate_id=candidate.id,
                    job_id=job.id,
                    score=score,
                    shortlisted=shortlisted,
                    explanation=explanation,
                    screening_completed=True,
                    screened_at=datetime.utcnow(),
                    pipeline_status="shortlisted" if shortlisted else "rejected",
                )
            )
        processed += 1

    db.commit()
    return JSONResponse({"success": True, "message": f"Re-ran matching for {processed} candidates"})


@router.get("/hr/report-summary")
def hr_report_summary(
    request: Request,
    job_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    user = get_current_user(request, db)
    if not user or user["role"] != "hr":
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    jobs_query = db.query(JobDescription).filter(JobDescription.company_id == user["user_id"]).order_by(JobDescription.id.desc())
    all_jobs = jobs_query.all()
    selected_job = all_jobs[0] if all_jobs else None
    if job_id:
      selected_job = next((job for job in all_jobs if job.id == job_id), selected_job)

    shortlisted_candidates = []
    if selected_job:
        results = (
            db.query(Result)
            .filter(Result.job_id == selected_job.id)
            .order_by(Result.id.desc())
            .all()
        )
        for result in results:
            candidate = db.query(Candidate).filter(Candidate.id == result.candidate_id).first()
            if not candidate:
                continue
            shortlisted_candidates.append(
                {
                    "candidate_name": candidate.name,
                    "email": candidate.email,
                    "screening_score": result.score,
                    "pipeline_status": result.pipeline_status,
                    "hr_decision": result.hr_decision,
                    "interview_date": result.interview_date,
                }
            )

    return JSONResponse(
        {
            "generated_at": datetime.utcnow().isoformat(),
            "job": {
                "id": selected_job.id,
                "role_name": selected_job.role_name,
                "company_name": selected_job.company_name,
                "jd_file": selected_job.jd_text.split("\\")[-1] if selected_job else None,
            }
            if selected_job
            else None,
            "summary": {
                "jobs_count": len(all_jobs),
                "candidate_count": len(shortlisted_candidates),
            },
            "candidates": shortlisted_candidates,
        }
    )


@router.post("/hr/candidate/review")
def review_candidate(
    request: Request,
    result_id: int = Form(...),
    hr_decision: str = Form(...),
    recruiter_notes: str = Form(""),
    recruiter_feedback: str = Form(""),
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

    decision = (hr_decision or "").strip().lower()
    if decision not in {"selected", "rejected", "on_hold", "saved", "pending"}:
        return JSONResponse(status_code=400, content={"error": "Invalid recruiter decision"})

    explanation = result.explanation if isinstance(result.explanation, dict) else {}
    explanation["hr_decision"] = decision
    explanation["hr_decision_at"] = datetime.now().isoformat()
    result.explanation = explanation
    result.hr_decision = None if decision == "pending" else decision
    result.recruiter_notes = recruiter_notes.strip() or None
    result.recruiter_feedback = recruiter_feedback.strip() or None

    db.commit()
    return JSONResponse({"success": True, "message": "Recruiter review updated"})


@router.post("/hr/candidate/save")
def save_candidate(
    request: Request,
    result_id: int = Form(...),
    db: Session = Depends(get_db),
):
    return review_candidate(
        request=request,
        result_id=result_id,
        hr_decision="saved",
        recruiter_notes="",
        recruiter_feedback="",
        db=db,
    )


@router.post("/hr/candidate/delete")
def delete_candidate_from_shortlist(
    request: Request,
    result_id: int = Form(...),
    db: Session = Depends(get_db),
):
    response = review_candidate(
        request=request,
        result_id=result_id,
        hr_decision="rejected",
        recruiter_notes="Removed from shortlist",
        recruiter_feedback="",
        db=db,
    )
    result = db.query(Result).filter(Result.id == result_id).first()
    if result:
        result.shortlisted = False
        result.pipeline_status = "rejected"
        db.commit()
    return response


@router.get("/hr/report/{result_id}")
def hr_candidate_report(
    result_id: int,
    request: Request,
    format: str = "json",
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

    candidate = db.query(Candidate).filter(Candidate.id == result.candidate_id).first()
    if not candidate:
        return JSONResponse(status_code=404, content={"error": "Candidate not found"})

    interview_session = (
        db.query(InterviewSession)
        .filter(InterviewSession.candidate_id == candidate.id)
        .filter(InterviewSession.job_id == job.id)
        .order_by(InterviewSession.id.desc())
        .first()
    )
    questions = []
    if interview_session:
        questions = (
            db.query(InterviewQuestion)
            .filter(InterviewQuestion.interview_id == interview_session.id)
            .order_by(InterviewQuestion.id.asc())
            .all()
        )

    payload = _build_candidate_report_payload(result, candidate, job, interview_session, questions)
    result.report_generated_at = datetime.utcnow()
    db.commit()

    if format == "html":
        summary = payload["candidate_report"]["summary"]
        questions_markup = "".join(
            f"<li><strong>Q:</strong> {qa['question']}<br/><strong>A:</strong> {qa['answer'] or 'No answer'}"
            f"<br/><strong>Score:</strong> {qa['score'] if qa['score'] is not None else 'N/A'}/100"
            f"<br/><strong>Why:</strong> {qa['score_reason'] or 'No evaluator note'}</li>"
            for qa in payload["candidate_report"]["qa_breakdown"]
        )
        html = f"""
        <html>
          <head>
            <title>Interview Report</title>
            <style>
              body {{ font-family: Arial, sans-serif; margin: 32px; color: #0f172a; }}
              h1, h2 {{ margin-bottom: 8px; }}
              .meta {{ margin-bottom: 20px; }}
              .card {{ border: 1px solid #cbd5e1; border-radius: 12px; padding: 16px; margin-bottom: 16px; }}
              ul {{ padding-left: 20px; }}
            </style>
          </head>
          <body>
            <h1>{candidate.name} - Interview Report</h1>
            <div class="meta">Pipeline: {summary['pipeline_status']} | HR Decision: {summary['hr_decision']} | Screening Score: {summary['screening_score']} | Interview Score: {summary['interview_score'] or 'N/A'}</div>
            <div class="card"><h2>Recruiter Notes</h2><p>{result.recruiter_notes or 'No notes added.'}</p><p>{result.recruiter_feedback or 'No final feedback added.'}</p></div>
            <div class="card"><h2>Questions and Answers</h2><ul>{questions_markup or '<li>No Q/A captured.</li>'}</ul></div>
            <div class="card"><h2>Timeline</h2><pre>{json.dumps(payload['interview_details']['timeline'], indent=2)}</pre></div>
            <div class="card"><h2>Violations</h2><pre>{json.dumps(payload['interview_details']['violations'], indent=2)}</pre></div>
          </body>
        </html>
        """
        return HTMLResponse(html)

    return JSONResponse(payload)
