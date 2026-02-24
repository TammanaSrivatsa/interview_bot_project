"""Resume skill matching and interview score aggregation utilities."""

from __future__ import annotations

import re
from typing import Iterable


SKILL_ALIASES: dict[str, list[str]] = {
    "python": ["python"],
    "java": ["java"],
    "c++": ["c++", "cpp"],
    "c#": ["c#", "c sharp", "dotnet", ".net"],
    "javascript": ["javascript", "js"],
    "typescript": ["typescript", "ts"],
    "react": ["react", "reactjs", "react.js"],
    "node.js": ["node", "nodejs", "node.js"],
    "fastapi": ["fastapi"],
    "django": ["django"],
    "flask": ["flask"],
    "sql": ["sql"],
    "mysql": ["mysql"],
    "postgresql": ["postgresql", "postgres", "psql"],
    "mongodb": ["mongodb", "mongo"],
    "aws": ["aws", "amazon web services"],
    "azure": ["azure", "microsoft azure"],
    "gcp": ["gcp", "google cloud"],
    "docker": ["docker"],
    "kubernetes": ["kubernetes", "k8s"],
    "git": ["git", "github", "gitlab"],
    "linux": ["linux"],
    "power bi": ["power bi", "powerbi"],
    "tableau": ["tableau"],
    "html": ["html", "html5"],
    "css": ["css", "css3"],
    "machine learning": ["machine learning", "ml"],
    "deep learning": ["deep learning"],
    "nlp": ["nlp", "natural language processing"],
}


def _normalize_skill(skill: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9+.# ]", " ", skill or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip().lower()
    return cleaned


def _contains_skill(text: str, term: str) -> bool:
    pattern = rf"(?<!\w){re.escape(term.lower())}(?!\w)"
    return re.search(pattern, text.lower()) is not None


def compute_resume_skill_match(resume_text: str, jd_skills: Iterable[str]) -> dict[str, object]:
    """Compute overlap between JD-required skills and detected resume skills."""

    normalized_required = sorted({_normalize_skill(skill) for skill in jd_skills if _normalize_skill(skill)})
    if not normalized_required:
        return {
            "matched_percentage": 0.0,
            "matched_skills": [],
            "missing_skills": [],
        }

    resume_text = resume_text or ""
    matched_skills: list[str] = []
    missing_skills: list[str] = []

    for required_skill in normalized_required:
        aliases = SKILL_ALIASES.get(required_skill, [required_skill])
        if any(_contains_skill(resume_text, alias) for alias in aliases):
            matched_skills.append(required_skill)
        else:
            missing_skills.append(required_skill)

    matched_percentage = round((len(matched_skills) / len(normalized_required)) * 100, 2)
    return {
        "matched_percentage": matched_percentage,
        "matched_skills": matched_skills,
        "missing_skills": missing_skills,
    }


def _clamp_score(score: float) -> float:
    return max(0.0, min(100.0, float(score)))


def _recommendation(final_score: float) -> str:
    if final_score >= 75:
        return "Select"
    if final_score >= 55:
        return "Borderline"
    return "Reject"


def compute_interview_scoring(technical_score: float, resume_score: float) -> dict[str, object]:
    """Aggregate technical and resume tracks into final interview outcome."""

    technical = _clamp_score(technical_score)
    resume = _clamp_score(resume_score)
    final = round((technical * 0.65) + (resume * 0.35), 2)
    return {
        "technical_score": technical,
        "resume_score": resume,
        "final_score": final,
        "recommendation": _recommendation(final),
    }
