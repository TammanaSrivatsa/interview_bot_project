"""HR-facing JD management, candidate management, and interview scoring routes."""

from __future__ import annotations

import shutil
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload

from ai_engine.phase2.question_builder import build_question_bundle
from ai_engine.phase1.scoring import compute_interview_scoring, compute_resume_skill_match
from ai_engine.phase1.matching import extract_skills_from_jd, extract_text_from_file
from database import get_db
from services.llm.client import extract_skills as llm_extract_skills
from models import Candidate, InterviewSession, JobDescription, JobDescriptionConfig, Result
from routes.common import (
    UPLOAD_DIR,
    ensure_candidate_profile,
    evaluate_resume_for_job,
    safe_delete_upload,
    serialize_result,
    upsert_result,
)
from routes.dependencies import SessionUser, require_role
from routes.schemas import HrJDCreateBody, HrJDUpdateBody, InterviewScoreBody, SkillWeightsBody
from services.hr_dashboard import build_hr_dashboard_analytics
from services.jd_sync import normalize_skill_map, sync_config_from_legacy_job, sync_legacy_job_from_config
from services.local_exports import create_local_backup_archive
from services.resume_advice import build_resume_advice

router = APIRouter()
jd_router = APIRouter(prefix="/hr/jds", tags=["hr-jds"])
# Keep FastAPI path params in plain `{jd_id}` form here. Using Starlette-style
# converter syntax (`{jd_id:int}`) can produce route resolution mismatches across
# versions and was breaking the frontend's /api/hr/jds/:id and toggle-active calls.

PAGE_SIZE = 10
STATUS_META = {
    "applied": {"key": "applied", "label": "Applied", "tone": "secondary"},
    "shortlisted": {"key": "shortlisted", "label": "Shortlisted", "tone": "success"},
    "rejected": {"key": "rejected", "label": "Rejected", "tone": "danger"},
    "interview_scheduled": {"key": "interview_scheduled", "label": "Interview Scheduled", "tone": "primary"},
    "completed": {"key": "completed", "label": "Completed", "tone": "dark"},
}


# 1) What this does: finds the most recent interview session for a result.
# 2) Why needed: HR status and detail pages should use the latest interview state.
# 3) How it works: picks the session with the newest timestamp and highest id fallback.
def _latest_session(result: Result | None) -> InterviewSession | None:
    if not result or not result.sessions:
        return None
    return max(
        result.sessions,
        key=lambda item: (item.started_at or datetime.min, item.id or 0),
    )


# 1) What this does: converts result/session data into a stable status key.
# 2) Why needed: the UI needs a single normalized status value for labels and filtering.
# 3) How it works: checks interview state first, then scheduled/shortlisted/rejected fallbacks.
def _status_key(result: Result | None, latest_session: InterviewSession | None) -> str:
    if latest_session:
        session_status = (latest_session.status or "").strip().lower()
        if latest_session.ended_at or session_status in {"completed", "selected", "rejected"}:
            return "completed"
        return "interview_scheduled"

    if result and result.interview_date:
        return "interview_scheduled"
    if result and result.shortlisted:
        return "shortlisted"
    if result and (result.score is None or not result.explanation):
        return "applied"
    if result:
        return "rejected"
    return "applied"


# 1) What this does: maps the status key to the UI-ready label and badge tone.
# 2) Why needed: keeps status presentation consistent across pages.
# 3) How it works: reuses the shared STATUS_META map.
def _status_payload(result: Result | None, latest_session: InterviewSession | None) -> dict[str, str]:
    return STATUS_META[_status_key(result, latest_session)]


# 1) What this does: builds the candidate summary payload used by the HR list page.
# 2) Why needed: keeps row shaping in one place.
# 3) How it works: combines candidate identity, current result data, and derived status.
def _serialize_candidate_summary(candidate: Candidate, result: Result | None) -> dict[str, object]:
    latest_session = _latest_session(result)
    status = _status_payload(result, latest_session)
    return {
        "id": candidate.id,
        "candidate_uid": candidate.candidate_uid,
        "name": candidate.name,
        "email": candidate.email,
        "resume_path": candidate.resume_path,
        "created_at": candidate.created_at,
        "status": status,
        "score": float(result.score) if result and result.score is not None else None,
        "result_id": result.id if result else None,
        "application_id": result.application_id if result else None,
        "job": {
            "id": result.job.id if result and result.job else None,
            "title": (result.job.jd_title or Path(result.job.jd_text).name) if result and result.job else None,
        },
        "interview_date": result.interview_date if result else None,
    }


# 1) What this does: scopes candidate results to the current HR's jobs.
# 2) Why needed: prevents cross-company access and keeps downstream queries consistent.
# 3) How it works: joins results to jobs and preloads related data once.
def _candidate_result_scope(db: Session, hr_id: int):
    return (
        db.query(Result)
        .join(JobDescription, Result.job_id == JobDescription.id)
        .options(joinedload(Result.candidate), joinedload(Result.job), joinedload(Result.sessions))
        .filter(JobDescription.company_id == hr_id)
    )


# 1) What this does: returns de-duplicated candidate summaries for one HR.
# 2) Why needed: the candidate manager should show one row per candidate, not one row per application.
# 3) How it works: walks latest results first and keeps the first summary for each candidate.
def _candidate_summaries(db: Session, hr_id: int) -> list[dict[str, object]]:
    scoped_results = _candidate_result_scope(db, hr_id).order_by(Result.id.desc()).all()
    summaries_by_candidate: dict[int, dict[str, object]] = {}
    changed = False

    for result in scoped_results:
        candidate = result.candidate
        if not candidate:
            continue
        changed = ensure_candidate_profile(candidate, db) or changed
        if candidate.id in summaries_by_candidate:
            continue
        summaries_by_candidate[candidate.id] = _serialize_candidate_summary(candidate, result)

    if changed:
        db.commit()
        for summary in summaries_by_candidate.values():
            candidate = db.query(Candidate).filter(Candidate.id == summary["id"]).first()
            if candidate:
                summary["candidate_uid"] = candidate.candidate_uid
                summary["created_at"] = candidate.created_at

    return list(summaries_by_candidate.values())


# 1) What this does: checks whether one candidate summary matches the search text.
# 2) Why needed: powers HR search without changing existing data models.
# 3) How it works: compares the lowered search text with candidate id, name, email, and status text.
def _matches_query(candidate_summary: dict[str, object], search_text: str) -> bool:
    if not search_text:
        return True

    status = candidate_summary.get("status") or {}
    haystacks = [
        str(candidate_summary.get("candidate_uid") or "").lower(),
        str(candidate_summary.get("name") or "").lower(),
        str(candidate_summary.get("email") or "").lower(),
        str(status.get("label") or "").lower(),
        str(status.get("key") or "").lower(),
    ]
    return any(search_text in value for value in haystacks)


# 1) What this does: sorts the candidate list using the selected mode.
# 2) Why needed: the HR list supports newest-first and score-desc ordering.
# 3) How it works: sorts in place using a stable tuple key.
def _sort_candidate_summaries(candidates: list[dict[str, object]], sort: str) -> list[dict[str, object]]:
    if sort == "score_desc":
        candidates.sort(
            key=lambda item: (
                float(item["score"]) if item.get("score") is not None else -1.0,
                item.get("created_at") or datetime.min,
            ),
            reverse=True,
        )
        return candidates

    candidates.sort(
        key=lambda item: (
            item.get("created_at") or datetime.min,
            int(item.get("id") or 0),
        ),
        reverse=True,
    )
    return candidates


def _normalize_weight_map(raw_map: dict[str, int] | None) -> dict[str, int]:
    return normalize_skill_map(raw_map)


# NOTE: Keep this serializer aligned with the exact field names expected by
# interview-frontend/src/pages/HRJdManagementPage.jsx and related HR views.
def _serialize_jd_config(jd: JobDescriptionConfig) -> dict[str, object]:
    return {
        "id": jd.id,
        "title": jd.title,
        "jd_text": jd.jd_text,
        "jd_dict_json": jd.jd_dict_json or {},
        "weights_json": jd.weights_json or {},
        "qualify_score": float(jd.qualify_score if jd.qualify_score is not None else 65.0),
        "education_requirement": jd.education_requirement,
        "experience_requirement": int(jd.experience_requirement if jd.experience_requirement is not None else 0),
        "min_academic_percent": float(jd.min_academic_percent if jd.min_academic_percent is not None else 0.0),
        "total_questions": int(jd.total_questions if jd.total_questions is not None else 8),
        "project_question_ratio": float(jd.project_question_ratio if jd.project_question_ratio is not None else 0.8),
        "is_active": bool(jd.is_active if jd.is_active is not None else True),
        "created_at": jd.created_at,
    }


def _sync_legacy_job_from_config(
    db: Session,
    jd_config: JobDescriptionConfig,
    hr_id: int,
) -> JobDescription:
    return sync_legacy_job_from_config(db, jd_config, hr_id)


def _get_hr_owned_jd_or_404(db: Session, jd_id: int, hr_id: int) -> JobDescriptionConfig:
    legacy = (
        db.query(JobDescription)
        .filter(JobDescription.id == jd_id, JobDescription.company_id == hr_id)
        .first()
    )
    if not legacy:
        raise HTTPException(status_code=404, detail="JD not found")
    jd = db.query(JobDescriptionConfig).filter(JobDescriptionConfig.id == jd_id).first()
    if not jd:
        jd = sync_config_from_legacy_job(db, legacy)
    return jd


def _generated_questions_payload(candidate: Candidate) -> tuple[list[dict[str, object]], dict[str, object]]:
    stored = candidate.questions_json
    if isinstance(stored, dict):
        questions = stored.get("questions")
        meta = stored.get("meta") if isinstance(stored.get("meta"), dict) else {}
    elif isinstance(stored, list):
        questions = stored
        meta = {}
    else:
        questions = []
        meta = {}

    normalized: list[dict[str, object]] = []
    if isinstance(questions, list):
        for idx, item in enumerate(questions, start=1):
            if not isinstance(item, dict):
                continue
            text = str(item.get("text") or "").strip()
            if not text:
                continue
            normalized.append(
                {
                    "index": idx,
                    "text": text,
                    "type": str(item.get("type") or "unknown"),
                    "topic": str(item.get("topic") or "general"),
                    "difficulty": str(item.get("difficulty") or "medium"),
                }
            )
    return normalized, meta


def _resolve_candidate_jd_for_generation(
    db: Session,
    candidate: Candidate,
    hr_id: int,
) -> JobDescriptionConfig:
    if candidate.selected_jd_id:
        selected = db.query(JobDescriptionConfig).filter(JobDescriptionConfig.id == candidate.selected_jd_id).first()
        if selected:
            return selected

    latest_result = (
        _candidate_result_scope(db, hr_id)
        .filter(Result.candidate_id == candidate.id)
        .order_by(Result.id.desc())
        .first()
    )
    if not latest_result:
        raise HTTPException(status_code=404, detail="No JD context found for candidate")

    selected = db.query(JobDescriptionConfig).filter(JobDescriptionConfig.id == latest_result.job_id).first()
    if selected:
        return selected

    legacy_job = latest_result.job
    if not legacy_job:
        raise HTTPException(status_code=404, detail="Candidate JD not found")
    return sync_config_from_legacy_job(db, legacy_job)


# 1) What this does: creates one JD config row for HR and syncs scoring table.
# 2) Why needed: supports N number of JDs with per-JD scoring config.
# 3) How it works: stores canonical config in job_descriptions and mirrors to legacy jobs by same id.
@jd_router.post("")
def hr_create_jd(
    payload: HrJDCreateBody,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    # NOTE: Persist the full JD management payload used by the current frontend,
    # including education_requirement and experience_requirement.
    jd_config = JobDescriptionConfig(
        title=payload.title.strip(),
        jd_text=payload.jd_text.strip(),
        jd_dict_json=payload.jd_dict_json or {},
        weights_json=_normalize_weight_map(payload.weights_json),
        qualify_score=float(payload.qualify_score),
        education_requirement=(payload.education_requirement.strip() if payload.education_requirement else None),
        experience_requirement=int(payload.experience_requirement if payload.experience_requirement is not None else 0),
        min_academic_percent=float(payload.min_academic_percent),
        total_questions=int(payload.total_questions),
        project_question_ratio=float(payload.project_question_ratio),
    )
    db.add(jd_config)
    db.flush()
    _sync_legacy_job_from_config(db, jd_config, current_user.user_id)
    db.commit()
    db.refresh(jd_config)
    return {"ok": True, "jd": _serialize_jd_config(jd_config)}


# 1) What this does: lists all HR-owned JD configs.
# 2) Why needed: UI dropdowns and HR config page need JD inventory.
# 3) How it works: resolves owned legacy ids and fetches matching config rows.
@jd_router.get("")
def hr_list_jds(
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    owned_ids = [
        row.id
        for row in db.query(JobDescription.id)
        .filter(JobDescription.company_id == current_user.user_id)
        .order_by(JobDescription.id.desc())
        .all()
    ]
    if not owned_ids:
        return {"ok": True, "jds": []}

    jd_rows = (
        db.query(JobDescriptionConfig)
        .filter(JobDescriptionConfig.id.in_(owned_ids))
        .order_by(JobDescriptionConfig.id.desc())
        .all()
    )
    return {"ok": True, "jds": [_serialize_jd_config(row) for row in jd_rows]}


# 1) What this does: fetches details for one HR-owned JD config.
# 2) Why needed: allows per-JD view/edit flows.
# 3) How it works: verifies HR ownership via legacy jobs table.
@jd_router.get("/{jd_id}")
def hr_get_jd(
    jd_id: int,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    jd = _get_hr_owned_jd_or_404(db, jd_id, current_user.user_id)
    return {"ok": True, "jd": _serialize_jd_config(jd)}


# 1) What this does: updates one HR-owned JD config and syncs scoring table.
# 2) Why needed: HR can tune qualify score, weights, and question count without re-uploading.
# 3) How it works: applies partial fields to job_descriptions and mirrors into jobs.
@jd_router.put("/{jd_id}")
def hr_update_jd(
    jd_id: int,
    payload: HrJDUpdateBody,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    jd = _get_hr_owned_jd_or_404(db, jd_id, current_user.user_id)

    if payload.title is not None:
        jd.title = payload.title.strip()
    if payload.jd_text is not None:
        jd.jd_text = payload.jd_text.strip()
    if payload.jd_dict_json is not None:
        jd.jd_dict_json = payload.jd_dict_json
    if payload.weights_json is not None:
        jd.weights_json = _normalize_weight_map(payload.weights_json)
    if payload.qualify_score is not None:
        jd.qualify_score = float(payload.qualify_score)
    # NOTE: These fields are sent by the current HR JD management form and
    # must be persisted on partial update as-is.
    if payload.education_requirement is not None:
        jd.education_requirement = payload.education_requirement.strip() or None
    if payload.experience_requirement is not None:
        jd.experience_requirement = int(payload.experience_requirement)
    if payload.min_academic_percent is not None:
        jd.min_academic_percent = float(payload.min_academic_percent)
    if payload.total_questions is not None:
        jd.total_questions = int(payload.total_questions)
    if payload.project_question_ratio is not None:
        jd.project_question_ratio = float(payload.project_question_ratio)

    _sync_legacy_job_from_config(db, jd, current_user.user_id)
    db.commit()
    db.refresh(jd)
    return {"ok": True, "jd": _serialize_jd_config(jd)}


# NOTE: Backward-safe minimal toggle for demo readiness.
# HR keeps seeing all JDs, while candidate-facing lists only show active ones.
@jd_router.post("/{jd_id}/toggle-active")
def hr_toggle_jd_active(
    jd_id: int,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    jd = _get_hr_owned_jd_or_404(db, jd_id, current_user.user_id)
    legacy_job = (
        db.query(JobDescription)
        .filter(JobDescription.id == jd_id, JobDescription.company_id == current_user.user_id)
        .first()
    )

    next_active = not bool(jd.is_active if jd.is_active is not None else True)
    jd.is_active = next_active
    if legacy_job:
        legacy_job.is_active = next_active

    db.commit()
    db.refresh(jd)
    return {"ok": True, "jd": _serialize_jd_config(jd)}


@jd_router.delete("/{jd_id}")
def hr_delete_jd(
    jd_id: int,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    jd = _get_hr_owned_jd_or_404(db, jd_id, current_user.user_id)
    legacy_job = (
        db.query(JobDescription)
        .filter(JobDescription.id == jd_id, JobDescription.company_id == current_user.user_id)
        .first()
    )

    applications_count = db.query(Result).filter(Result.job_id == jd_id).count()
    if applications_count:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete a JD that already has candidate applications",
        )

    selected_candidates_count = db.query(Candidate).filter(Candidate.selected_jd_id == jd_id).count()
    if selected_candidates_count:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete a JD that is currently selected by candidates",
        )

    deleted_upload = False
    if legacy_job and legacy_job.jd_text:
        deleted_upload = safe_delete_upload(legacy_job.jd_text)
    elif jd.jd_text:
        deleted_upload = safe_delete_upload(jd.jd_text)

    if legacy_job:
        db.delete(legacy_job)
    db.delete(jd)
    db.commit()
    return {"ok": True, "jd_id": jd_id, "deleted_upload": deleted_upload}

# Register the JD subrouter after all JD handlers are defined.
router.include_router(jd_router)


# 1) What this does: returns the HR dashboard payload with jobs and shortlisted candidates.
# 2) Why needed: drives the main HR home page without extra round-trips.
# 3) How it works: loads jobs, picks the selected one, and returns derived summaries.
@router.get("/hr/dashboard")
def hr_dashboard(
    job_id: int | None = None,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    jobs = (
        db.query(JobDescription)
        .filter(JobDescription.company_id == current_user.user_id)
        .order_by(JobDescription.id.desc())
        .all()
    )
    selected_job = None
    if job_id:
        selected_job = next((job for job in jobs if job.id == job_id), None)
    if not selected_job and jobs:
        selected_job = jobs[0]

    shortlisted_candidates: list[dict[str, object]] = []
    changed = False
    if selected_job:
        results = (
            db.query(Result)
            .options(joinedload(Result.candidate), joinedload(Result.job), joinedload(Result.sessions))
            .filter(Result.job_id == selected_job.id, Result.shortlisted.is_(True))
            .order_by(Result.id.desc())
            .all()
        )
        for result in results:
            candidate = result.candidate
            if not candidate:
                continue
            changed = ensure_candidate_profile(candidate, db) or changed
            shortlisted_candidates.append(
                {
                    "candidate": {
                        "id": candidate.id,
                        "candidate_uid": candidate.candidate_uid,
                        "name": candidate.name,
                        "email": candidate.email,
                        "resume_path": candidate.resume_path,
                        "created_at": candidate.created_at,
                    },
                    "status": _status_payload(result, _latest_session(result)),
                    "result": serialize_result(result),
                }
            )
    if changed:
        db.commit()

    analytics = build_hr_dashboard_analytics(
        db,
        hr_id=current_user.user_id,
        selected_job_id=selected_job.id if selected_job else None,
    )
    jobs_payload = [
        {
            "id": job.id,
            "jd_title": job.jd_title or Path(job.jd_text).name,
            "jd_name": Path(job.jd_text).name,
            "jd_text": job.jd_text,
            "skill_scores": job.skill_scores or {},
            "gender_requirement": None,
            "education_requirement": job.education_requirement,
            "experience_requirement": job.experience_requirement,
            "cutoff_score": float(job.cutoff_score if job.cutoff_score is not None else 65.0),
            "question_count": int(job.question_count if job.question_count is not None else 8),
        }
        for job in jobs
    ]

    return {
        "ok": True,
        "selected_job_id": selected_job.id if selected_job else None,
        "jobs": jobs_payload,
        "latest_jd": (
            {
                "id": selected_job.id,
                "jd_title": selected_job.jd_title or Path(selected_job.jd_text).name,
                "jd_text": selected_job.jd_text,
                "skill_scores": selected_job.skill_scores or {},
                "gender_requirement": None,
                "education_requirement": selected_job.education_requirement,
                "experience_requirement": selected_job.experience_requirement,
                "cutoff_score": float(selected_job.cutoff_score if selected_job.cutoff_score is not None else 65.0),
                "question_count": int(selected_job.question_count if selected_job.question_count is not None else 8),
            }
            if selected_job
            else None
        ),
        "shortlisted_candidates": shortlisted_candidates,
        "analytics": analytics,
    }


# 1) What this does: returns the paginated HR candidate manager list.
# 2) Why needed: supports search, filter, sorting, and paging in one API.
# 3) How it works: builds summaries, filters them in memory, then slices the requested page.
@router.get("/hr/candidates")
def hr_candidates(
    q: str = "",
    status: str = "all",
    sort: str = "newest",
    page: int = 1,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    search_text = (q or "").strip().lower()
    status_key = (status or "all").strip().lower()
    sort_key = (sort or "newest").strip().lower()
    if status_key not in {"all", *STATUS_META.keys()}:
        status_key = "all"
    if sort_key not in {"newest", "score_desc"}:
        sort_key = "newest"
    page_number = max(1, int(page or 1))

    candidates = _candidate_summaries(db, current_user.user_id)
    filtered = [
        item
        for item in candidates
        if (status_key in {"", "all"} or item["status"]["key"] == status_key) and _matches_query(item, search_text)
    ]
    _sort_candidate_summaries(filtered, sort_key)

    total_results = len(filtered)
    total_pages = max(1, (total_results + PAGE_SIZE - 1) // PAGE_SIZE) if total_results else 1
    if page_number > total_pages:
        page_number = total_pages
    start = (page_number - 1) * PAGE_SIZE
    end = start + PAGE_SIZE
    paged_candidates = filtered[start:end]

    return {
        "ok": True,
        "q": q,
        "status": status_key,
        "sort": sort_key,
        "page": page_number,
        "page_size": PAGE_SIZE,
        "total_pages": total_pages,
        "total_results": total_results,
        "results_found": len(paged_candidates),
        "has_prev": page_number > 1,
        "has_next": page_number < total_pages,
        "candidates": paged_candidates,
    }


# 1) What this does: returns the full HR candidate detail payload.
# 2) Why needed: powers the detail page for one candidate and their applications.
# 3) How it works: loads the candidate, verifies HR ownership via scoped results, and returns application history.
@router.get("/hr/candidates/{candidate_uid}")
def hr_candidate_detail(
    candidate_uid: str,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    candidate = db.query(Candidate).filter(Candidate.candidate_uid == candidate_uid).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    if ensure_candidate_profile(candidate, db):
        db.commit()
        db.refresh(candidate)

    results = (
        _candidate_result_scope(db, current_user.user_id)
        .filter(Result.candidate_id == candidate.id)
        .order_by(Result.id.desc())
        .all()
    )
    if not results:
        raise HTTPException(status_code=404, detail="Candidate not found for this HR")

    applications: list[dict[str, object]] = []
    for result in results:
        latest_session = _latest_session(result)
        applications.append(
            {
                "result_id": result.id,
                "application_id": result.application_id,
                "job": {
                    "id": result.job.id if result.job else None,
                    "title": (result.job.jd_title or Path(result.job.jd_text).name) if result.job else None,
                },
                "score": float(result.score) if result.score is not None else None,
                "shortlisted": bool(result.shortlisted),
                "status": _status_payload(result, latest_session),
                "interview_date": result.interview_date,
                "interview_link": result.interview_link,
                "explanation": result.explanation or {},
                "latest_session": {
                    "id": latest_session.id,
                    "status": latest_session.status,
                    "started_at": latest_session.started_at,
                    "ended_at": latest_session.ended_at,
                }
                if latest_session
                else None,
            }
        )

    latest_application = applications[0]
    generated_questions, generated_questions_meta = _generated_questions_payload(candidate)
    latest_result = results[0]
    latest_job = latest_result.job
    resume_text = extract_text_from_file(candidate.resume_path or "")
    skill_gap = None
    resume_advice = None
    if latest_job and resume_text.strip():
        skill_gap = compute_resume_skill_match(resume_text, (latest_job.skill_scores or {}).keys())
        resume_advice = build_resume_advice(
            resume_text=resume_text,
            jd_skill_scores=latest_job.skill_scores or {},
            explanation=latest_result.explanation or {},
        )
    return {
        "ok": True,
        "candidate": {
            "id": candidate.id,
            "candidate_uid": candidate.candidate_uid,
            "name": candidate.name,
            "email": candidate.email,
            "resume_path": candidate.resume_path,
            "created_at": candidate.created_at,
            "current_status": latest_application["status"],
            "current_score": latest_application["score"],
        },
        "applications": applications,
        "generated_questions": generated_questions,
        "generated_questions_meta": generated_questions_meta,
        "skill_gap": (
            {
                "ok": True,
                "candidate_uid": candidate.candidate_uid,
                "job_id": latest_job.id,
                "job_title": latest_job.jd_title or Path(latest_job.jd_text).name,
                "matched_skills": list(skill_gap["matched_skills"]),
                "missing_skills": list(skill_gap["missing_skills"]),
                "match_percentage": float(skill_gap["matched_percentage"]),
                "matched_percentage": float(skill_gap["matched_percentage"]),
            }
            if latest_job and skill_gap
            else None
        ),
        "resume_advice": resume_advice,
    }


# 1) What this does: generates interview questions from selected JD + resume and stores on candidate row.
# 2) Why needed: HR triggers controlled question generation; candidate UI should not access this.
# 3) How it works: enforces HR ownership, builds weighted 80/20 questions, stores in candidates.questions_json.
@router.post("/hr/candidate/{candidate_id}/generate-questions")
def hr_generate_candidate_questions(
    candidate_id: int,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if not candidate.resume_path:
        raise HTTPException(status_code=400, detail="Candidate has no resume to generate questions from")

    owns_candidate = (
        _candidate_result_scope(db, current_user.user_id)
        .filter(Result.candidate_id == candidate.id)
        .first()
    )
    if not owns_candidate:
        raise HTTPException(status_code=403, detail="Not allowed to generate questions for this candidate")

    jd_config = _resolve_candidate_jd_for_generation(db, candidate, current_user.user_id)
    resume_text = extract_text_from_file(candidate.resume_path or "")
    if not resume_text.strip():
        raise HTTPException(status_code=400, detail="Resume text could not be extracted")

    bundle = build_question_bundle(
        resume_text=resume_text,
        jd_title=jd_config.title,
        jd_skill_scores=jd_config.weights_json or {},
        question_count=int(jd_config.total_questions if jd_config.total_questions is not None else 8),
        project_ratio=float(jd_config.project_question_ratio if jd_config.project_question_ratio is not None else 0.8),
    )
    candidate.questions_json = {
        "questions": bundle["questions"],
        "meta": {
            "candidate_id": candidate.id,
            "jd_id": jd_config.id,
            "jd_title": jd_config.title,
            "total_questions": int(bundle["total_questions"]),
            "project_questions_count": int(bundle["project_questions_count"]),
            "theory_questions_count": int(bundle["theory_questions_count"]),
            "generated_at": datetime.utcnow().isoformat(),
        },
    }
    db.commit()

    return {
        "candidate_id": candidate.id,
        "total_questions": int(bundle["total_questions"]),
        "project_questions_count": int(bundle["project_questions_count"]),
        "theory_questions_count": int(bundle["theory_questions_count"]),
    }


# 1) What this does: returns skill-gap details for a candidate against one JD.
# 2) Why needed: the HR candidate detail page needs matched and missing skills for quick review.
# 3) How it works: finds the candidate, resolves the requested or latest HR-owned job, extracts resume text, and reuses existing skill-match logic.
@router.get("/hr/candidates/{candidate_uid}/skill-gap")
def hr_candidate_skill_gap(
    candidate_uid: str,
    job_id: int | None = None,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    # 1) What this does: loads the target candidate row.
    # 2) Why needed: skill-gap analysis starts from the stored resume.
    # 3) How it works: looks up by the human-friendly candidate UID.
    candidate = db.query(Candidate).filter(Candidate.candidate_uid == candidate_uid).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    # 1) What this does: keeps legacy candidate records hydrated with modern metadata.
    # 2) Why needed: older rows may still be missing generated profile fields.
    # 3) How it works: updates candidate metadata only when needed.
    if ensure_candidate_profile(candidate, db):
        db.commit()
        db.refresh(candidate)

    # 1) What this does: resolves the target job for the skill-gap analysis.
    # 2) Why needed: the UI can pass a job id, but should also work with the latest application.
    # 3) How it works: uses the requested HR-owned job when present, otherwise falls back to the latest HR-owned application.
    target_job: JobDescription | None = None
    if job_id is not None:
        target_job = (
            db.query(JobDescription)
            .filter(JobDescription.id == job_id, JobDescription.company_id == current_user.user_id)
            .first()
        )
    else:
        latest_result = (
            _candidate_result_scope(db, current_user.user_id)
            .filter(Result.candidate_id == candidate.id)
            .order_by(Result.id.desc())
            .first()
        )
        if latest_result:
            target_job = latest_result.job

    if not target_job:
        raise HTTPException(status_code=404, detail="No matching job found for this candidate")

    # 1) What this does: reads the stored resume text.
    # 2) Why needed: the skill matcher works on plain text.
    # 3) How it works: uses the existing file extractor and stays null-safe for missing files.
    resume_text = extract_text_from_file(candidate.resume_path or "")

    # 1) What this does: calculates matched and missing skills.
    # 2) Why needed: this is the same local-only logic already used elsewhere in the app.
    # 3) How it works: reuses the existing compute_resume_skill_match helper with the JD skill keys.
    skill_gap = compute_resume_skill_match(resume_text, (target_job.skill_scores or {}).keys())

    return {
        "ok": True,
        "candidate_uid": candidate.candidate_uid,
        "job_id": target_job.id,
        "job_title": target_job.jd_title or Path(target_job.jd_text).name,
        "matched_skills": list(skill_gap["matched_skills"]),
        "missing_skills": list(skill_gap["missing_skills"]),
        "match_percentage": float(skill_gap["matched_percentage"]),
        "matched_percentage": float(skill_gap["matched_percentage"]),
    }


# 1) What this does: deletes a candidate and related local data.
# 2) Why needed: HR needs a safe cleanup action from the candidate manager.
# 3) How it works: verifies ownership, deletes uploads, sessions, results, then the candidate row.
@router.post("/hr/candidates/{candidate_uid}/delete")
def hr_delete_candidate(
    candidate_uid: str,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    candidate = db.query(Candidate).filter(Candidate.candidate_uid == candidate_uid).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    owned_results = (
        db.query(Result)
        .join(JobDescription, Result.job_id == JobDescription.id)
        .filter(Result.candidate_id == candidate.id, JobDescription.company_id == current_user.user_id)
        .count()
    )
    if not owned_results:
        raise HTTPException(status_code=404, detail="Candidate not found for this HR")

    foreign_results = (
        db.query(Result)
        .join(JobDescription, Result.job_id == JobDescription.id)
        .filter(Result.candidate_id == candidate.id, JobDescription.company_id != current_user.user_id)
        .count()
    )
    if foreign_results:
        raise HTTPException(
            status_code=400,
            detail="Candidate has applications with another company and cannot be deleted from this HR panel.",
        )

    safe_delete_upload(candidate.resume_path)

    sessions = db.query(InterviewSession).filter(InterviewSession.candidate_id == candidate.id).all()
    for session in sessions:
        db.delete(session)

    results = db.query(Result).filter(Result.candidate_id == candidate.id).all()
    for result in results:
        db.delete(result)

    db.delete(candidate)
    db.commit()
    return {"ok": True, "message": "Candidate deleted", "candidate_uid": candidate_uid}


# 1) What this does: uploads a JD file and extracts its initial skill list.
# 2) Why needed: HR can review skills before saving the JD permanently.
# 3) How it works: stores the upload locally and keeps a temporary session payload until confirmation.
@router.post("/hr/upload-jd")
def upload_jd(
    request: Request,
    jd_file: UploadFile = File(...),
    jd_title: str = Form(""),
    gender_requirement: str = Form(""),
    education_requirement: str = Form(""),
    experience_requirement: str = Form(""),
    cutoff_score: str = Form("65"),
    question_count: str = Form("8"),
    project_question_ratio: str = Form("0.8"),
    current_user: SessionUser = Depends(require_role("hr")),
) -> dict[str, object]:
    _ = gender_requirement
    try:
        years = int(experience_requirement) if experience_requirement else 0
    except ValueError:
        years = 0
    try:
        cutoff = float(cutoff_score) if cutoff_score else 65.0
    except ValueError:
        cutoff = 65.0
    cutoff = max(0.0, min(100.0, cutoff))
    try:
        questions = int(question_count) if question_count else 8
    except ValueError:
        questions = 8
    questions = max(3, min(20, questions))
    try:
        ratio = float(project_question_ratio) if project_question_ratio else 0.8
    except ValueError:
        ratio = 0.8
    ratio = max(0.0, min(1.0, ratio))

    safe_filename = Path(jd_file.filename or "job_description").name
    jd_path = UPLOAD_DIR / f"jd_{current_user.user_id}_{uuid.uuid4().hex}_{safe_filename}"

    # Write file first, fully closed before reading
    with jd_path.open("wb") as buffer:
        shutil.copyfileobj(jd_file.file, buffer)

    # Extract text and skills after file is closed
    jd_raw_text = extract_text_from_file(str(jd_path))
    ai_skills = llm_extract_skills(jd_raw_text)
    if not ai_skills:
        extracted_skills = extract_skills_from_jd(str(jd_path))
        ai_skills = {skill: 5 for skill in extracted_skills}

    request.session["temp_jd"] = {
        "jd_title": jd_title.strip() if jd_title else None,
        "jd_path": str(jd_path),
        "jd_raw_text": jd_raw_text[:8000],
        "gender_requirement": None,
        "education_requirement": education_requirement or None,
        "experience_requirement": years,
        "cutoff_score": cutoff,
        "question_count": questions,
        "project_question_ratio": ratio,
    }

    return {
        "ok": True,
        "jd_title": request.session["temp_jd"]["jd_title"],
        "jd_text": jd_raw_text[:500],
        "uploaded_jd": safe_filename,
        "ai_skills": ai_skills,
        "cutoff_score": cutoff,
        "question_count": questions,
        "project_question_ratio": ratio,
    }


# 1) What this does: saves the uploaded JD and backfills scoring for current candidates.
# 2) Why needed: a confirmed JD becomes available for screening and interview setup.
# 3) How it works: persists the job, then recomputes resume scoring for candidates with resumes.
@router.post("/hr/confirm-jd")
def confirm_jd(
    payload: SkillWeightsBody,
    request: Request,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    temp_jd = request.session.get("temp_jd")
    if not temp_jd:
        raise HTTPException(status_code=400, detail="Please upload JD first")
    if not payload.skill_scores:
        raise HTTPException(status_code=400, detail="skill_scores cannot be empty")

    normalized_scores: dict[str, int] = {}
    for skill, weight in payload.skill_scores.items():
        key = (skill or "").strip().lower()
        if not key:
            continue
        normalized_scores[key] = int(weight)

    job = JobDescription(
        company_id=current_user.user_id,
        jd_title=temp_jd.get("jd_title"),
        jd_text=temp_jd["jd_path"],
        skill_scores=normalized_scores,
        gender_requirement=None,
        education_requirement=temp_jd.get("education_requirement"),
        experience_requirement=temp_jd.get("experience_requirement", 0),
        cutoff_score=float(temp_jd.get("cutoff_score", 65.0)),
        question_count=int(temp_jd.get("question_count", 8)),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    synced_config = sync_config_from_legacy_job(db, job)
    synced_config.project_question_ratio = float(temp_jd.get("project_question_ratio", 0.8))
    db.commit()

    candidates = db.query(Candidate).all()
    for candidate in candidates:
        if ensure_candidate_profile(candidate, db):
            db.commit()
            db.refresh(candidate)
        if not candidate.resume_path:
            continue
        score, explanation, _ = evaluate_resume_for_job(candidate, job)
        upsert_result(
            db,
            candidate.id,
            job.id,
            score,
            explanation,
            cutoff_score=float(job.cutoff_score if job.cutoff_score is not None else 65.0),
        )

    request.session.pop("temp_jd", None)
    return {"ok": True, "message": "JD confirmed and candidate scoring completed.", "job_id": job.id}


# 1) What this does: updates the selected job's skill weights.
# 2) Why needed: HR can tune screening criteria without re-uploading the JD.
# 3) How it works: saves normalized weights and recalculates candidate results for that job.
@router.post("/hr/update-skill-weights")
def update_skill_weights(
    payload: SkillWeightsBody,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    # NOTE: Accept both payload shapes here.
    # Frontend currently sends: { jd_id, weights, cutoff_score }
    # Older code may still send: { job_id, skill_scores, cutoff_score, question_count }
    requested_job_id = payload.job_id or payload.jd_id
    incoming_skill_scores = payload.skill_scores if payload.skill_scores is not None else payload.weights

    target_job = None
    if requested_job_id:
        target_job = (
            db.query(JobDescription)
            .filter(JobDescription.company_id == current_user.user_id, JobDescription.id == requested_job_id)
            .first()
        )
    if not target_job:
        target_job = (
            db.query(JobDescription)
            .filter(JobDescription.company_id == current_user.user_id)
            .order_by(JobDescription.id.desc())
            .first()
        )
    if not target_job:
        raise HTTPException(status_code=404, detail="No JD found")
    if not incoming_skill_scores:
        raise HTTPException(status_code=400, detail="weights cannot be empty")

    # NOTE: Normalize whichever field name the caller used so the current
    # frontend HRSkillWeightsPage.jsx works without renaming its payload.
    target_job.skill_scores = {
        str(key).strip().lower(): int(value)
        for key, value in incoming_skill_scores.items()
        if str(key).strip()
    }
    if payload.cutoff_score is not None:
        target_job.cutoff_score = float(payload.cutoff_score)
    if payload.question_count is not None:
        target_job.question_count = int(payload.question_count)
    db.commit()

    sync_config_from_legacy_job(db, target_job)
    db.commit()

    candidates = db.query(Candidate).filter(Candidate.resume_path.isnot(None)).all()
    for candidate in candidates:
        if ensure_candidate_profile(candidate, db):
            db.commit()
            db.refresh(candidate)
        score, explanation, _ = evaluate_resume_for_job(candidate, target_job)
        upsert_result(
            db,
            candidate.id,
            target_job.id,
            score,
            explanation,
            cutoff_score=float(target_job.cutoff_score if target_job.cutoff_score is not None else 65.0),
        )

    return {"ok": True, "message": "Skill weights updated and scores recalculated."}


@router.get("/hr/local-backup")
def hr_local_backup(
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
):
    _ = current_user
    archive_path = create_local_backup_archive(db)
    return FileResponse(
        path=archive_path,
        media_type="application/zip",
        filename=archive_path.name,
    )


# 1) What this does: stores HR-entered interview scoring for a candidate result.
# 2) Why needed: combines the resume and technical scores into one final interview outcome.
# 3) How it works: validates job ownership, computes the scorecard, and stores it in explanation JSON.
@router.post("/hr/interview-score")
def hr_interview_score(
    payload: InterviewScoreBody,
    current_user: SessionUser = Depends(require_role("hr")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    result = db.query(Result).filter(Result.id == payload.result_id).first()
    if not result:
        raise HTTPException(status_code=404, detail="Result not found")

    job = db.query(JobDescription).filter(JobDescription.id == result.job_id).first()
    if not job or job.company_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not allowed to score this result")

    explanation = result.explanation or {}
    resume_score = explanation.get("final_resume_score", result.score or 0)
    scorecard = compute_interview_scoring(payload.technical_score, float(resume_score))

    explanation["interview_scoring"] = scorecard
    result.explanation = explanation
    db.commit()
    db.refresh(result)

    return {"ok": True, "result_id": result.id, **scorecard}
