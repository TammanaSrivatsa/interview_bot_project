"""HR dashboard aggregation helpers."""

from __future__ import annotations

from collections import Counter
from datetime import datetime

from sqlalchemy.orm import Session, joinedload

from models import JobDescription, Result

STATUS_META = {
    "applied": {"key": "applied", "label": "Applied", "tone": "secondary"},
    "shortlisted": {"key": "shortlisted", "label": "Shortlisted", "tone": "success"},
    "rejected": {"key": "rejected", "label": "Rejected", "tone": "danger"},
    "interview_scheduled": {"key": "interview_scheduled", "label": "Interview Scheduled", "tone": "primary"},
    "completed": {"key": "completed", "label": "Completed", "tone": "dark"},
}


def latest_session(result: Result | None):
    if not result or not result.sessions:
        return None
    return max(result.sessions, key=lambda item: (item.started_at or datetime.min, item.id or 0))


def status_key(result: Result | None, latest_session_row) -> str:
    if latest_session_row:
        session_status = (latest_session_row.status or "").strip().lower()
        if latest_session_row.ended_at or session_status in {"completed", "selected", "rejected"}:
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


def status_payload(result: Result | None, latest_session_row) -> dict[str, str]:
    return STATUS_META[status_key(result, latest_session_row)]


def build_hr_dashboard_analytics(
    db: Session,
    *,
    hr_id: int,
    selected_job_id: int | None = None,
) -> dict[str, object]:
    jobs = (
        db.query(JobDescription)
        .filter(JobDescription.company_id == hr_id)
        .order_by(JobDescription.id.desc())
        .all()
    )
    results = (
        db.query(Result)
        .join(JobDescription, Result.job_id == JobDescription.id)
        .options(joinedload(Result.sessions), joinedload(Result.candidate))
        .filter(JobDescription.company_id == hr_id)
        .order_by(Result.id.desc())
        .all()
    )

    selected_results = [result for result in results if not selected_job_id or result.job_id == selected_job_id]
    pipeline_counter: Counter[str] = Counter()
    missing_counter: Counter[str] = Counter()
    matched_counter: Counter[str] = Counter()
    score_values: list[float] = []
    candidate_ids: set[int] = set()
    shortlisted_count = 0

    for result in selected_results:
        latest = latest_session(result)
        pipeline_counter[status_key(result, latest)] += 1
        if result.candidate_id is not None:
            candidate_ids.add(int(result.candidate_id))
        if result.shortlisted:
            shortlisted_count += 1
        if result.score is not None:
            score_values.append(float(result.score))
        explanation = result.explanation or {}
        for skill in explanation.get("missing_skills") or []:
            key = str(skill or "").strip().lower()
            if key:
                missing_counter[key] += 1
        for skill in explanation.get("matched_skills") or []:
            key = str(skill or "").strip().lower()
            if key:
                matched_counter[key] += 1

    completed = pipeline_counter.get("completed", 0)
    scheduled = pipeline_counter.get("interview_scheduled", 0)
    total_results = len(selected_results)
    avg_score = round(sum(score_values) / len(score_values), 2) if score_values else 0.0
    shortlist_rate = round((shortlisted_count / total_results) * 100, 2) if total_results else 0.0
    completion_rate = round((completed / (completed + scheduled)) * 100, 2) if (completed + scheduled) else 0.0

    return {
        "overview": {
            "total_jobs": len(jobs),
            "total_applications": total_results,
            "active_candidates": len(candidate_ids),
            "avg_resume_score": avg_score,
            "shortlist_rate": shortlist_rate,
            "interview_completion_rate": completion_rate,
        },
        "pipeline": [
            {
                **STATUS_META[key],
                "count": pipeline_counter.get(key, 0),
            }
            for key in ("applied", "shortlisted", "interview_scheduled", "completed", "rejected")
        ],
        "top_missing_skills": [
            {"skill": skill, "count": count}
            for skill, count in missing_counter.most_common(5)
        ],
        "top_matched_skills": [
            {"skill": skill, "count": count}
            for skill, count in matched_counter.most_common(5)
        ],
    }
