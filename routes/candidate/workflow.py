"""Candidate-facing dashboard and resume workflows."""

import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ai_engine.phase1.scoring import compute_resume_skill_match
from ai_engine.phase1.matching import extract_text_from_file
from ai_engine.phase2.question_builder import build_question_bundle
from database import get_db
from models import JobDescription, JobDescriptionConfig, Result
from routes.common import (
    UPLOAD_DIR,
    ensure_candidate_profile,
    evaluate_resume_for_job,
    get_candidate_or_404,
    interview_entry_url,
    list_active_jds,
    list_available_jobs,
    serialize_result,
    upsert_result,
)
from routes.dependencies import SessionUser, require_role
from routes.schemas import CandidateSelectJDBody, ScheduleInterviewBody
from services.jd_sync import sync_config_from_legacy_job, sync_legacy_job_from_config
from services.practice import build_practice_kit
from services.resume_advice import build_resume_advice
from utils.email_service import send_interview_email

router = APIRouter()


# NOTE: Keep Result.interview_questions as the active source of truth for the
# interview question bank. Generate it immediately after resume-vs-JD screening.
def _persist_result_question_bank(
    *,
    result: Result,
    resume_text: str,
    job: JobDescription,
) -> list[dict[str, object]]:
    bundle = build_question_bundle(
        resume_text=resume_text,
        jd_title=job.jd_title,
        jd_skill_scores=(job.skill_scores or {}),
        question_count=int(job.question_count if job.question_count is not None else 8),
    )
    questions = bundle.get("questions") or []
    result.interview_questions = questions
    return questions


def _generate_result_question_bank(
    *,
    result: Result,
    resume_text: str,
    job: JobDescription,
) -> list[dict[str, object]]:
    bundle = build_question_bundle(
        resume_text=resume_text,
        jd_title=job.jd_title,
        jd_skill_scores=(job.skill_scores or {}),
        question_count=int(job.question_count if job.question_count is not None else 8),
    )
    questions = bundle.get("questions") or []
    result.interview_questions = questions
    return questions


def _selected_jd_or_404(db: Session, jd_id: int) -> JobDescriptionConfig:
    selected_jd = db.query(JobDescriptionConfig).filter(JobDescriptionConfig.id == jd_id).first()
    if selected_jd:
        return selected_jd

    legacy = db.query(JobDescription).filter(JobDescription.id == jd_id).first()
    if not legacy:
        raise HTTPException(status_code=404, detail="JD not found")
    return sync_config_from_legacy_job(db, legacy)


def _resume_advice_payload(
    *,
    candidate,
    selected_jd: JobDescriptionConfig | None,
    explanation: dict[str, object] | None,
) -> dict[str, object] | None:
    if not candidate.resume_path or not selected_jd:
        return None
    resume_text = extract_text_from_file(candidate.resume_path)
    if not resume_text.strip():
        return None
    return build_resume_advice(
        resume_text=resume_text,
        jd_skill_scores=selected_jd.weights_json or {},
        explanation=explanation or {},
    )


@router.get("/candidate/dashboard")
def candidate_dashboard(
    job_id: int | None = None,
    current_user: SessionUser = Depends(require_role("candidate")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    candidate = get_candidate_or_404(db, current_user.user_id)
    if ensure_candidate_profile(candidate, db):
        db.commit()
        db.refresh(candidate)
    if job_id is not None and job_id > 0 and candidate.selected_jd_id != job_id:
        candidate.selected_jd_id = job_id
        db.commit()
        db.refresh(candidate)

    available_jobs = list_available_jobs(db)
    available_jds = list_active_jds(db)
    selected_job_id = candidate.selected_jd_id or (available_jds[0]["id"] if available_jds else None)

    result = None
    selected_jd = None
    if selected_job_id:
        try:
            selected_jd = _selected_jd_or_404(db, selected_job_id)
        except HTTPException:
            selected_jd = None
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
            "candidate_uid": candidate.candidate_uid,
            "name": candidate.name,
            "email": candidate.email,
            "gender": candidate.gender,
            "resume_path": candidate.resume_path,
            "created_at": candidate.created_at,
        },
        "available_jobs": available_jobs,
        "available_jds": available_jds,
        "selected_job_id": selected_job_id,
        "selected_jd_id": selected_job_id,
        "result": serialize_result(result),
        "resume_advice": _resume_advice_payload(
            candidate=candidate,
            selected_jd=selected_jd,
            explanation=(result.explanation if result else None),
        ),
    }


@router.get("/candidate/jds")
def candidate_jds(
    current_user: SessionUser = Depends(require_role("candidate")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    candidate = get_candidate_or_404(db, current_user.user_id)
    if ensure_candidate_profile(candidate, db):
        db.commit()
        db.refresh(candidate)
    return {
        "ok": True,
        "selected_jd_id": candidate.selected_jd_id,
        "jds": list_active_jds(db),
    }


@router.post("/candidate/select-jd")
def candidate_select_jd(
    payload: CandidateSelectJDBody,
    current_user: SessionUser = Depends(require_role("candidate")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    candidate = get_candidate_or_404(db, current_user.user_id)
    selected_jd = _selected_jd_or_404(db, payload.jd_id)

    candidate.selected_jd_id = selected_jd.id
    db.commit()
    db.refresh(candidate)
    return {
        "ok": True,
        "selected_jd_id": candidate.selected_jd_id,
        "jd": {
            "id": selected_jd.id,
            "title": selected_jd.title,
            "qualify_score": float(selected_jd.qualify_score if selected_jd.qualify_score is not None else 65.0),
            "total_questions": int(selected_jd.total_questions if selected_jd.total_questions is not None else 8),
        },
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
    profile_changed = ensure_candidate_profile(candidate, db)
    safe_filename = Path(resume.filename or "resume").name
    if not safe_filename:
        raise HTTPException(status_code=400, detail="Resume filename is invalid")

    resume_path = UPLOAD_DIR / f"resume_{candidate.id}_{uuid.uuid4().hex}_{safe_filename}"
    with resume_path.open("wb") as buffer:
        shutil.copyfileobj(resume.file, buffer)

    candidate.resume_path = str(resume_path)
    if profile_changed:
        db.add(candidate)
    db.commit()
    db.refresh(candidate)

    selected_jd_id = job_id or candidate.selected_jd_id
    if not selected_jd_id:
        raise HTTPException(status_code=400, detail="Select a JD before uploading resume")

    selected_jd = _selected_jd_or_404(db, selected_jd_id)

    selected_job = sync_legacy_job_from_config(db, selected_jd)
    candidate.selected_jd_id = selected_jd.id
    db.commit()
    db.refresh(candidate)

    if not selected_job:
        return {
            "ok": True,
            "message": "Resume uploaded. No job description available yet.",
            "uploaded_resume": safe_filename,
            "result": None,
            "available_jobs": list_available_jobs(db),
            "available_jds": list_active_jds(db),
            "selected_job_id": None,
            "selected_jd_id": None,
        }

    score, explanation, _ = evaluate_resume_for_job(candidate, selected_job)
    result = upsert_result(
        db,
        candidate.id,
        selected_job.id,
        score,
        explanation,
        cutoff_score=float(selected_job.cutoff_score if selected_job.cutoff_score is not None else 65.0),
    )

    # Main restored flow: generate and persist interview questions immediately
    # after resume-vs-JD screening. Result.interview_questions is the source of truth.
    resume_text = extract_text_from_file(candidate.resume_path)
    questions = _generate_result_question_bank(result=result, resume_text=resume_text, job=selected_job)
    db.commit()
    db.refresh(result)

    return {
        "ok": True,
        "message": "Resume uploaded and scoring completed.",
        "uploaded_resume": safe_filename,
        "candidate": {
            "id": candidate.id,
            "candidate_uid": candidate.candidate_uid,
            "name": candidate.name,
            "email": candidate.email,
            "gender": candidate.gender,
            "resume_path": candidate.resume_path,
            "created_at": candidate.created_at,
        },
        "available_jobs": list_available_jobs(db),
        "available_jds": list_active_jds(db),
        "selected_job_id": selected_job.id,
        "selected_jd_id": selected_job.id,
        "result": serialize_result(result),
        "question_count": len(questions or []),
        "question_generation_ready": bool(result.interview_questions),
        "diagnostic_first_question": (questions[0].get("text") if questions else None),
        "resume_advice": _resume_advice_payload(
            candidate=candidate,
            selected_jd=selected_jd,
            explanation=result.explanation if result else None,
        ),
    }


@router.post("/candidate/select-interview-date")
def select_interview_date(
    payload: ScheduleInterviewBody,
    current_user: SessionUser = Depends(require_role("candidate")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    if not (payload.interview_date or "").strip():
        raise HTTPException(status_code=400, detail="Interview date is required")

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
    result.interview_date = payload.interview_date.strip()
    result.interview_link = interview_entry_url(result.id)
    db.commit()

    candidate = get_candidate_or_404(db, current_user.user_id)
    email_sent = True
    message = "Interview link sent to your registered email."
    try:
        send_interview_email(candidate.email, candidate.name, result.interview_date, result.interview_link)
    except Exception:
        email_sent = False
        message = "Interview scheduled, but email delivery failed."

    return {
        "ok": True,
        "email_sent": email_sent,
        "message": message,
        "result": serialize_result(result),
    }


@router.get("/candidate/practice-kit")
def candidate_practice_kit(
    job_id: int | None = None,
    current_user: SessionUser = Depends(require_role("candidate")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    candidate = get_candidate_or_404(db, current_user.user_id)
    if not candidate.resume_path:
        raise HTTPException(status_code=400, detail="Upload your resume before starting practice mode")

    selected_jd_id = job_id or candidate.selected_jd_id
    if not selected_jd_id:
        raise HTTPException(status_code=400, detail="Select a JD before starting practice mode")

    selected_jd = _selected_jd_or_404(db, selected_jd_id)
    resume_text = extract_text_from_file(candidate.resume_path)
    if not resume_text.strip():
        raise HTTPException(status_code=400, detail="Resume text could not be extracted")

    practice = build_practice_kit(
        resume_text=resume_text,
        jd_title=selected_jd.title,
        jd_skill_scores=selected_jd.weights_json or {},
        question_count=int(selected_jd.total_questions if selected_jd.total_questions is not None else 6),
    )
    score, explanation, _ = evaluate_resume_for_job(candidate, selected_jd)
    advice = build_resume_advice(
        resume_text=resume_text,
        jd_skill_scores=selected_jd.weights_json or {},
        explanation=explanation,
    )

    return {
        "ok": True,
        "jd": {
            "id": selected_jd.id,
            "title": selected_jd.title,
            "qualify_score": float(selected_jd.qualify_score if selected_jd.qualify_score is not None else 65.0),
            "total_questions": int(selected_jd.total_questions if selected_jd.total_questions is not None else 8),
        },
        "practice": practice,
        "resume_advice": advice,
        "score_preview": score,
    }
