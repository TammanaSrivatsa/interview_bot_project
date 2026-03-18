"""Runtime helpers for consuming a pre-generated interview question bank."""

from __future__ import annotations


def normalize_result_questions(payload: object) -> list[dict[str, object]]:
    normalized: list[dict[str, object]] = []
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
                normalized.append({
                    "text": text,
                    "difficulty": "medium",
                    "topic": "general",
                    "type": "project",
                    "intent": "Assess candidate understanding and communication.",
                    "focus_skill": None,
                    "project_name": None,
                    "reference_answer": None,
                })
            continue
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or item.get("question") or "").strip()
        if not text:
            continue
        normalized.append({
            "text": text,
            "difficulty": str(item.get("difficulty") or "medium"),
            "topic": str(item.get("topic") or "general"),
            "type": str(item.get("type") or "project"),
            "intent": str(item.get("intent") or "Assess candidate understanding and communication."),
            "focus_skill": item.get("focus_skill"),
            "project_name": item.get("project_name"),
            "reference_answer": item.get("reference_answer"),
        })
    return normalized


def compute_dynamic_seconds(base_seconds: int, question_index: int, last_answer: str, max_questions: int = 8) -> int:
    stage = "intro" if question_index == 0 else ("hr" if question_index >= max(2, max_questions - max(1, round(max_questions * 0.20))) else "project")
    stage_bonus = {"intro": -10, "project": 10, "hr": 5}.get(stage, 0)
    words = len((last_answer or "").split())
    answer_adjust = -10 if words < 15 else (15 if words > 80 else 0)
    return max(30, min(180, int(base_seconds) + stage_bonus + answer_adjust))


def next_question_payload(source_questions: list[dict[str, object]], asked_questions: list[str], question_index: int, last_answer: str, jd_title: str | None, max_questions: int = 8) -> dict[str, object]:
    asked_set = {t.strip().lower() for t in asked_questions if t.strip()}
    for item in source_questions:
        text = str(item.get("text") or "").strip()
        if text and text.lower() not in asked_set:
            return item
    raise RuntimeError("Question bank is empty or exhausted. Generate interview questions before starting the session.")
