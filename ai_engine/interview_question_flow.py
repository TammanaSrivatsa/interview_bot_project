"""Gradual interview question generation helpers."""

from __future__ import annotations

import re

STOPWORDS = {
    "about",
    "after",
    "also",
    "because",
    "could",
    "from",
    "have",
    "just",
    "like",
    "make",
    "more",
    "should",
    "that",
    "them",
    "then",
    "they",
    "this",
    "what",
    "when",
    "with",
    "your",
}

FALLBACK_STAGE_QUESTIONS = {
    "basics": (
        "Introduce your most relevant project and your personal ownership in it.",
        "Which core technologies do you use confidently in production and why?",
    ),
    "experience": (
        "Describe a production bug you solved end-to-end, including root cause and fix.",
        "Tell me about a technical trade-off where you chose speed vs quality.",
    ),
    "system": (
        "How would you design this feature to support scale and failures?",
        "What monitoring, alerts, and rollback strategy would you define here?",
    ),
    "behavioral": (
        "Describe a difficult team conflict and how you resolved it professionally.",
        "Tell me about a time you failed, what you learned, and what changed.",
    ),
}


def normalize_result_questions(payload: object) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    if isinstance(payload, list):
        candidates: list[object] = payload
    elif isinstance(payload, dict) and isinstance(payload.get("questions"), list):
        candidates = payload["questions"]
    else:
        candidates = []

    for item in candidates:
        if isinstance(item, str):
            text = item.strip()
            if text:
                normalized.append({"text": text, "difficulty": "medium", "topic": "general"})
            continue
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or item.get("question") or "").strip()
        if not text:
            continue
        normalized.append(
            {
                "text": text,
                "difficulty": str(item.get("difficulty") or "medium"),
                "topic": str(item.get("topic") or "general"),
            }
        )
    return normalized


def stage_for_question_index(index: int) -> str:
    if index < 2:
        return "basics"
    if index < 5:
        return "experience"
    if index < 7:
        return "system"
    return "behavioral"


def compute_dynamic_seconds(base_seconds: int, question_index: int, last_answer: str) -> int:
    words = len((last_answer or "").split())
    stage = stage_for_question_index(question_index)
    stage_bonus = {"basics": 0, "experience": 10, "system": 20, "behavioral": 5}.get(stage, 0)

    answer_adjust = 0
    if words < 15:
        answer_adjust = -10
    elif words > 80:
        answer_adjust = 15

    dynamic_seconds = base_seconds + stage_bonus + answer_adjust
    return max(30, min(180, int(dynamic_seconds)))


def next_question_payload(
    source_questions: list[dict[str, str]],
    asked_questions: list[str],
    question_index: int,
    last_answer: str,
    jd_title: str | None,
) -> dict[str, str]:
    asked_set = {text.strip().lower() for text in asked_questions if text.strip()}
    for item in source_questions:
        text = item["text"].strip()
        if text.lower() in asked_set:
            continue
        return {
            "text": text,
            "difficulty": item.get("difficulty", "medium"),
            "topic": item.get("topic", "general"),
        }

    stage = stage_for_question_index(question_index)
    stage_questions = FALLBACK_STAGE_QUESTIONS.get(stage, FALLBACK_STAGE_QUESTIONS["experience"])

    focus = _focus_phrase(last_answer) or (jd_title or "your recent project")
    base = stage_questions[question_index % len(stage_questions)]
    if stage in {"experience", "system"}:
        text = f"{base} Please include metrics, decisions, and trade-offs around {focus}."
    elif stage == "behavioral":
        text = f"{base} Explain your communication style while handling {focus}."
    else:
        text = f"{base} Connect it to {focus}."

    return {"text": text, "difficulty": _difficulty_for_stage(stage), "topic": stage}


def _difficulty_for_stage(stage: str) -> str:
    if stage == "basics":
        return "easy"
    if stage == "experience":
        return "medium"
    return "hard"


def _focus_phrase(last_answer: str) -> str:
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9+#.-]{2,}", (last_answer or "").lower())
    filtered = [token for token in tokens if token not in STOPWORDS]
    if not filtered:
        return ""
    return " ".join(filtered[:4])
