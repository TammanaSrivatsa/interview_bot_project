"""Shared constants and helper functions used by route modules."""
from __future__ import annotations

from datetime import datetime
import os
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ai_engine.phase1.scoring import compute_resume_scorecard
from ai_engine.phase1.matching import extract_text_from_file
from models import Candidate, HR, JobDescription, JobDescriptionConfig, Result
from services.jd_sync import extract_min_academic_percent

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)


def frontend_base_url() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")


def interview_entry_url(result_id: int | None) -> str | None:
    if not result_id:
        return None
    return f"{frontend_base_url()}/interview/{int(result_id)}"


def _latest_interview_session(result: Result | None):
    sessions = getattr(result, "sessions", None) or []
    if not sessions:
        return None
    return max(
        sessions,
        key=lambda item: (item.started_at or datetime.min, item.id or 0),
    )


def _application_stage(result: Result | None, latest_session) -> str | None:
    if not result:
        return None

    session_status = str(getattr(latest_session, "status", "") or "").strip().lower()
    if session_status in {"selected", "rejected"}:
        return "final_reviewed"
    if latest_session and (latest_session.ended_at or session_status == "completed"):
        return "interview_submitted"
    if session_status == "in_progress":
        return "interview_in_progress"
    if result.shortlisted and (result.interview_date or "").strip():
        return "interview_ready"
    if result.shortlisted:
        return "screening_shortlisted"
    return "screening_rejected"


def interview_access_state(result: Result | None) -> dict[str, object]:
    if not result:
        return {
            "interview_scheduled": False,
            "interview_ready": False,
            "interview_locked_reason": None,
        }

    if not result.shortlisted:
        return {
            "interview_scheduled": False,
            "interview_ready": False,
            "interview_locked_reason": "shortlist_required",
        }

    if not (result.interview_date or "").strip():
        return {
            "interview_scheduled": False,
            "interview_ready": False,
            "interview_locked_reason": "schedule_required",
        }

    latest_session = _latest_interview_session(result)
    latest_status = str(getattr(latest_session, "status", "") or "").strip().lower()
    if latest_status == "in_progress":
        return {
            "interview_scheduled": True,
            "interview_ready": True,
            "interview_locked_reason": None,
        }

    if latest_session and (latest_session.ended_at or latest_status in {"completed", "selected", "rejected"}):
        return {
            "interview_scheduled": True,
            "interview_ready": False,
            "interview_locked_reason": "already_completed",
        }

    return {
        "interview_scheduled": True,
        "interview_ready": True,
        "interview_locked_reason": None,
    }


def generate_candidate_uid() -> str:
    stamp = datetime.utcnow().strftime("%Y%m%d")
    return f"CAND-{stamp}-{uuid4().hex[:6].upper()}"


def ensure_candidate_profile(candidate: Candidate, db: Session) -> bool:
    changed = False

    if not candidate.created_at:
        candidate.created_at = datetime.utcnow()
        changed = True

    if candidate.candidate_uid:
        return changed

    for _ in range(10):
        candidate_uid = generate_candidate_uid()
        query = db.query(Candidate).filter(Candidate.candidate_uid == candidate_uid)
        if candidate.id is not None:
            query = query.filter(Candidate.id != candidate.id)
        exists = query.first()
        if exists:
            continue
        candidate.candidate_uid = candidate_uid
        changed = True
        return changed

    raise RuntimeError("Unable to allocate a unique candidate ID after multiple attempts.")


def get_candidate_or_404(db: Session, candidate_id: int) -> Candidate:
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return candidate


def get_hr_or_404(db: Session, hr_id: int) -> HR:
    hr_user = db.query(HR).filter(HR.id == hr_id).first()
    if not hr_user:
        raise HTTPException(status_code=404, detail="HR user not found")
    return hr_user


def list_available_jobs(db: Session) -> list[dict[str, object]]:
    jobs = db.query(JobDescription).order_by(JobDescription.id.desc()).all()
    companies = {item.id: item.company_name for item in db.query(HR).all()}
    payload: list[dict[str, object]] = []
    for job in jobs:
        payload.append(
            {
                "id": job.id,
                "company_id": job.company_id,
                "company_name": companies.get(job.company_id, "Unknown Company"),
                "jd_title": job.jd_title or Path(job.jd_text).name,
                "jd_name": Path(job.jd_text).name,
                "gender_requirement": None,
                "education_requirement": job.education_requirement,
                "experience_requirement": job.experience_requirement,
                "skill_scores": job.skill_scores or {},
                "cutoff_score": float(job.cutoff_score if job.cutoff_score is not None else 65.0),
                "min_academic_percent": extract_min_academic_percent(job.education_requirement),
                "question_count": int(job.question_count if job.question_count is not None else 8),
            }
        )
    return payload


def list_active_jds(db: Session) -> list[dict[str, object]]:
    jds = db.query(JobDescriptionConfig).order_by(JobDescriptionConfig.id.desc()).all()
    if not jds:
        legacy_jobs = db.query(JobDescription).order_by(JobDescription.id.desc()).all()
        return [
            {
                "id": job.id,
                "title": (job.jd_title or Path(job.jd_text or "").name or "Untitled JD"),
                "jd_text": job.jd_text or "",
                "jd_dict_json": {},
                "weights_json": job.skill_scores or {},
                "qualify_score": float(job.cutoff_score if job.cutoff_score is not None else 65.0),
                "min_academic_percent": extract_min_academic_percent(job.education_requirement),
                "total_questions": int(job.question_count if job.question_count is not None else 8),
                "project_question_ratio": 0.8,
                "created_at": None,
            }
            for job in legacy_jobs
        ]
    payload: list[dict[str, object]] = []
    for jd in jds:
        payload.append(
            {
                "id": jd.id,
                "title": jd.title,
                "jd_text": jd.jd_text,
                "jd_dict_json": jd.jd_dict_json or {},
                "weights_json": jd.weights_json or {},
                "qualify_score": float(jd.qualify_score if jd.qualify_score is not None else 65.0),
                "education_requirement": jd.education_requirement,
                "experience_requirement": int(jd.experience_requirement if jd.experience_requirement is not None else 0),
                "min_academic_percent": float(
                    jd.min_academic_percent if jd.min_academic_percent is not None else 0.0
                ),
                "total_questions": int(jd.total_questions if jd.total_questions is not None else 8),
                "project_question_ratio": float(
                    jd.project_question_ratio if jd.project_question_ratio is not None else 0.8
                ),
                "is_active": bool(jd.is_active if jd.is_active is not None else True),
                "created_at": jd.created_at,
            }
        )
    # NOTE: Candidate-facing list should only expose active JDs.
    return [item for item in payload if item["is_active"]]


def serialize_result(result: Result | None) -> dict[str, object] | None:
    if not result:
        return None
    access = interview_access_state(result)
    latest_session = _latest_interview_session(result)
    latest_session_status = str(getattr(latest_session, "status", "") or "").strip().lower() or None
    interview_completed = bool(
        latest_session and (latest_session.ended_at or latest_session_status in {"completed", "selected", "rejected"})
    )
    final_decision = (
        (str(result.hr_decision or "").strip().lower() if str(result.hr_decision or "").strip().lower() in {"selected", "rejected"} else None)
        or (latest_session_status if latest_session_status in {"selected", "rejected"} else None)
    )
    explanation = result.explanation or {}
    # NOTE: Dedicated HR review columns are now the source of truth.
    # Fall back to the legacy explanation JSON only when the new columns are empty.
    final_review = {
        "final_score": result.hr_final_score if result.hr_final_score is not None else explanation.get("hr_final_score"),
        "behavioral_score": result.hr_behavioral_score if result.hr_behavioral_score is not None else explanation.get("hr_behavioral_score"),
        "communication_score": result.hr_communication_score if result.hr_communication_score is not None else explanation.get("hr_communication_score"),
        "red_flags": result.hr_red_flags if result.hr_red_flags is not None else explanation.get("hr_red_flags"),
        "notes": result.hr_notes if result.hr_notes is not None else explanation.get("hr_final_notes"),
    }
    final_review_available = final_decision is not None or any(
        value is not None and value != "" for value in final_review.values()
    )
    return {
        "id": result.id,
        "score": float(result.score or 0),
        "shortlisted": bool(result.shortlisted),
        "explanation": explanation,
        "interview_date": result.interview_date,
        "interview_scheduled": bool(access["interview_scheduled"]),
        "interview_ready": bool(access["interview_ready"]),
        "interview_locked_reason": access["interview_locked_reason"],
        "interview_link": interview_entry_url(result.id) if access["interview_ready"] else None,
        "interview_session_status": latest_session_status,
        "interview_completed": interview_completed,
        "final_decision": final_decision,
        "final_review": final_review if final_review_available else None,
        "application_stage": _application_stage(result, latest_session),
    }


def safe_delete_upload(stored_path: str | None) -> bool:
    if not stored_path:
        return False

    try:
        candidate_path = Path(stored_path)
        if not candidate_path.is_absolute():
            candidate_path = Path.cwd() / candidate_path
        resolved_path = candidate_path.resolve()
        upload_root = (Path.cwd() / UPLOAD_DIR).resolve()
        if upload_root != resolved_path and upload_root not in resolved_path.parents:
            return False
        if not resolved_path.is_file():
            return False
        resolved_path.unlink(missing_ok=True)
        return True
    except Exception:
        return False


def _load_jd_text(jd_text_value: str) -> str:
    raw = (jd_text_value or "").strip()
    if not raw:
        return ""
    possible_path = Path(raw)
    if possible_path.is_file():
        return extract_text_from_file(raw)
    return raw


def evaluate_resume_for_job(
    candidate: Candidate,
    job: JobDescription | JobDescriptionConfig,
) -> tuple[float, dict[str, object], list[dict[str, str]]]:
    resume_text = extract_text_from_file(candidate.resume_path or "")
    jd_text = _load_jd_text(getattr(job, "jd_text", "") or "")
    jd_skill_scores = (
        getattr(job, "skill_scores", None)
        or getattr(job, "weights_json", None)
        or {}
    )
    education_requirement = getattr(job, "education_requirement", None)
    experience_requirement = int(getattr(job, "experience_requirement", 0) or 0)
    min_academic_percent = float(
        getattr(job, "min_academic_percent", None)
        if getattr(job, "min_academic_percent", None) is not None
        else extract_min_academic_percent(education_requirement)
    )
    cutoff_score = float(
        getattr(job, "cutoff_score", None)
        if getattr(job, "cutoff_score", None) is not None
        else getattr(job, "qualify_score", 65.0)
    )
    question_count = int(
        getattr(job, "question_count", None)
        if getattr(job, "question_count", None) is not None
        else getattr(job, "total_questions", 8)
    )
    jd_title = getattr(job, "jd_title", None) or getattr(job, "title", None)
    project_ratio = float(getattr(job, "project_question_ratio", 0.80) or 0.80)
    project_ratio = max(0.0, min(1.0, project_ratio))
    explanation = compute_resume_scorecard(
        resume_text=resume_text,
        jd_text=jd_text,
        jd_skill_scores=jd_skill_scores,
        education_requirement=education_requirement,
        experience_requirement=experience_requirement,
        min_academic_percent=min_academic_percent,
    )
    explanation["cutoff_score_used"] = cutoff_score
    explanation["score_cutoff_met"] = float(explanation["final_resume_score"]) >= cutoff_score
    explanation["shortlist_eligible"] = bool(explanation["score_cutoff_met"]) and bool(
        explanation.get("academic_cutoff_met", True)
    )
    explanation["question_count_used"] = question_count
    explanation["project_ratio_used"] = project_ratio
    return float(explanation["final_resume_score"]), explanation, []


def upsert_result(
    db: Session,
    candidate_id: int,
    job_id: int,
    score: float,
    explanation: dict[str, object],
    interview_questions: list[dict[str, str]] | None = None,
    cutoff_score: float = 65.0,
) -> Result:
    score_cutoff_met = score >= float(cutoff_score)
    academic_cutoff_met = bool(explanation.get("academic_cutoff_met", True))
    shortlisted = bool(explanation.get("shortlist_eligible", score_cutoff_met and academic_cutoff_met))

    explanation["score_cutoff_met"] = score_cutoff_met
    explanation["shortlist_eligible"] = shortlisted
    current = (
        db.query(Result)
        .filter(Result.candidate_id == candidate_id, Result.job_id == job_id)
        .order_by(Result.id.desc())
        .first()
    )
    if current:
        current.score = score
        current.shortlisted = shortlisted
        current.explanation = explanation
        current.interview_questions = None
        if not current.application_id:
            current.application_id = f"APP-{job_id}-{candidate_id}-{uuid4().hex[:6].upper()}"
        # FIX C4: Do NOT clear interview_date / interview_link / interview_token on re-score.
        # Previously these were always set to None on every resume re-upload, which wiped a
        # candidate's scheduled interview if they re-uploaded their resume to improve their score.
        # Now we only clear them if no schedule exists yet (first upload).
        if not current.interview_date:
            current.interview_date = None
            current.interview_link = None
            current.interview_token = None
        db.commit()
        db.refresh(current)
        return current

    result = Result(
        candidate_id=candidate_id,
        job_id=job_id,
        score=score,
        shortlisted=shortlisted,
        explanation=explanation,
        application_id=f"APP-{job_id}-{candidate_id}-{uuid4().hex[:6].upper()}",
        interview_questions=None,
    )
    db.add(result)
    db.commit()
    db.refresh(result)
    return result
