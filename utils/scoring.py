"""Lightweight answer summarization and rubric-based relevance scoring."""

from __future__ import annotations

from typing import Iterable

from ai_engine.phase1.scoring import compute_answer_scorecard


def summarize_and_score(
    question: str,
    answer: str,
    *,
    allotted_seconds: int = 0,
    time_taken_seconds: int = 0,
    jd_skills: Iterable[str] | None = None,
) -> tuple[str, float, dict[str, float | int]]:
    """Return (summary, overall_score, component_breakdown)."""

    normalized_answer = (answer or "").strip()
    if not normalized_answer:
        empty_scorecard = compute_answer_scorecard(
            question,
            normalized_answer,
            allotted_seconds=allotted_seconds,
            time_taken_seconds=time_taken_seconds,
            jd_skills=jd_skills,
        )
        return ("", 0.0, empty_scorecard)

    summary = normalized_answer[:220]
    scorecard = compute_answer_scorecard(
        question,
        normalized_answer,
        allotted_seconds=allotted_seconds,
        time_taken_seconds=time_taken_seconds,
        jd_skills=jd_skills,
    )
    return summary, float(scorecard["overall_score"]), scorecard
