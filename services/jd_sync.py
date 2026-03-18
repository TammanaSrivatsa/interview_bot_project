"""Helpers for keeping legacy jobs and JD config rows aligned."""

from __future__ import annotations

from pathlib import Path
import re

from sqlalchemy.orm import Session

from models import JobDescription, JobDescriptionConfig


def normalize_skill_map(raw_map: dict[str, int] | None) -> dict[str, int]:
    normalized: dict[str, int] = {}
    for key, value in (raw_map or {}).items():
        skill = str(key or "").strip().lower()
        if not skill:
            continue
        try:
            normalized[skill] = int(value)
        except Exception:
            normalized[skill] = 0
    return normalized


def extract_min_academic_percent(value: str | float | int | None) -> float:
    if value is None:
        return 0.0

    if isinstance(value, (int, float)):
        return max(0.0, min(100.0, float(value)))

    raw = str(value).strip()
    if not raw:
        return 0.0

    match = re.search(r"(\d+(?:\.\d+)?)\s*%?", raw)
    if not match:
        return 0.0
    return max(0.0, min(100.0, float(match.group(1))))


def sync_legacy_job_from_config(
    db: Session,
    jd_config: JobDescriptionConfig,
    hr_id: int | None = None,
) -> JobDescription:
    legacy = db.query(JobDescription).filter(JobDescription.id == jd_config.id).first()
    education_requirement = f"Min Academic: {float(jd_config.min_academic_percent or 0.0):.2f}%"
    title = jd_config.title or Path(jd_config.jd_text or "").name or "Untitled JD"
    if not legacy:
        legacy = JobDescription(
            id=jd_config.id,
            company_id=hr_id,
            jd_title=title,
            jd_text=jd_config.jd_text,
            skill_scores=normalize_skill_map(jd_config.weights_json),
            gender_requirement=None,
            education_requirement=education_requirement,
            experience_requirement=0,
            cutoff_score=float(jd_config.qualify_score if jd_config.qualify_score is not None else 65.0),
            question_count=int(jd_config.total_questions if jd_config.total_questions is not None else 8),
        )
        db.add(legacy)
        db.flush()
        return legacy

    if hr_id is not None and legacy.company_id is None:
        legacy.company_id = hr_id
    legacy.jd_title = title
    legacy.jd_text = jd_config.jd_text
    legacy.skill_scores = normalize_skill_map(jd_config.weights_json)
    legacy.education_requirement = education_requirement
    legacy.cutoff_score = float(jd_config.qualify_score if jd_config.qualify_score is not None else 65.0)
    legacy.question_count = int(jd_config.total_questions if jd_config.total_questions is not None else 8)
    return legacy


def sync_config_from_legacy_job(db: Session, legacy_job: JobDescription) -> JobDescriptionConfig:
    jd_config = db.query(JobDescriptionConfig).filter(JobDescriptionConfig.id == legacy_job.id).first()
    title = legacy_job.jd_title or Path(legacy_job.jd_text or "").name or "Untitled JD"
    min_academic_percent = extract_min_academic_percent(legacy_job.education_requirement)
    if not jd_config:
        jd_config = JobDescriptionConfig(
            id=legacy_job.id,
            title=title,
            jd_text=legacy_job.jd_text or "",
            jd_dict_json={},
            weights_json=normalize_skill_map(legacy_job.skill_scores),
            qualify_score=float(legacy_job.cutoff_score if legacy_job.cutoff_score is not None else 65.0),
            min_academic_percent=min_academic_percent,
            total_questions=int(legacy_job.question_count if legacy_job.question_count is not None else 8),
            project_question_ratio=0.8,
        )
        db.add(jd_config)
        db.flush()
        return jd_config

    jd_config.title = title
    jd_config.jd_text = legacy_job.jd_text or ""
    jd_config.weights_json = normalize_skill_map(legacy_job.skill_scores)
    jd_config.qualify_score = float(legacy_job.cutoff_score if legacy_job.cutoff_score is not None else 65.0)
    jd_config.min_academic_percent = min_academic_percent
    jd_config.total_questions = int(legacy_job.question_count if legacy_job.question_count is not None else 8)
    jd_config.project_question_ratio = float(jd_config.project_question_ratio if jd_config.project_question_ratio else 0.8)
    return jd_config
