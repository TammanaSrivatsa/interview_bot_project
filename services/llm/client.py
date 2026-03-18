"""Groq-backed helpers used by JD upload and interview evaluation."""
from __future__ import annotations

import json
import logging
import os
import re

from groq import Groq

logger = logging.getLogger(__name__)
_client: Groq | None = None


def _get_client() -> Groq:
    global _client
    if _client is None:
        api_key = os.getenv("GROQ_API_KEY", "")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY is not set in .env")
        _client = Groq(api_key=api_key)
    return _client


def _llm_model() -> str:
    return os.getenv("GROQ_LLM_MODEL", "llama-3.1-8b-instant")


def _clean_json(raw: str) -> str:
    return re.sub(r"```(?:json)?", "", raw or "").strip().strip("`")


def extract_skills(jd_text: str) -> dict[str, int]:
    if not jd_text or not jd_text.strip():
        return {}
    prompt = (
        "You are a technical recruiter. Read the job description below and extract all required technical skills.\n\n"
        "Return ONLY a valid JSON object where keys are lowercase skill names and values are integer importance weights from 1 to 10.\n\n"
        f"Job Description:\n{jd_text[:4000]}"
    )
    try:
        response = _get_client().chat.completions.create(
            model=_llm_model(),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=600,
        )
        data = json.loads(_clean_json(response.choices[0].message.content or ""))
        return {str(k).strip().lower(): max(1, min(10, int(v))) for k, v in data.items() if str(k).strip()}
    except Exception as exc:
        logger.error("extract_skills failed: %s", exc)
        return {}


def evaluate_answer_detailed(*, question: str, answer: str, section: str = "project", reference_answer: str | None = None, intent: str | None = None, focus_skill: str | None = None, project_name: str | None = None) -> dict[str, object]:
    if not answer or not answer.strip():
        return {
            "question": question,
            "candidate_answer": answer,
            "generated_reference_answer": reference_answer or "A strong answer should directly answer the question with practical detail.",
            "score": 0,
            "feedback": "No answer was provided.",
            "strengths": [],
            "weaknesses": ["No answer was provided."],
            "section": section,
            "dimension_breakdown": {"relevance": 0, "correctness": 0, "completeness": 0, "clarity": 0, "confidence": 0},
        }

    prompt = f"""You are a practical interviewer evaluating a fresher/junior candidate.
Question: {question}
Candidate answer: {answer}
Section: {section}
Intent: {intent or 'Assess practical understanding and communication.'}
Focus skill: {focus_skill or 'general'}
Project name: {project_name or 'N/A'}
Reference answer guideline: {reference_answer or 'A strong answer should directly answer the question, use practical examples, and explain reasoning clearly.'}

Return ONLY valid JSON with keys:
question, candidate_answer, generated_reference_answer, score, feedback, strengths, weaknesses, section, dimension_breakdown

Rules:
- score 0-100
- do not require exact wording match
- be practical and human-like, not harsh
- strengths and weaknesses must each be arrays of short strings
- dimension_breakdown must contain integers 0-100 for relevance, correctness, completeness, clarity, confidence
"""
    response = _get_client().chat.completions.create(
        model=_llm_model(),
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=900,
    )
    raw = _clean_json(response.choices[0].message.content or "")
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        raw = match.group(0)
    data = json.loads(raw)
    dims = data.get("dimension_breakdown") or {}
    clean_dims = {k: max(0, min(100, int(dims.get(k, 0)))) for k in ["relevance", "correctness", "completeness", "clarity", "confidence"]}
    return {
        "question": question,
        "candidate_answer": answer,
        "generated_reference_answer": str(data.get("generated_reference_answer") or reference_answer or "A strong answer should directly answer the question with practical detail."),
        "score": max(0, min(100, float(data.get("score", 50)))),
        "feedback": str(data.get("feedback") or "Evaluation completed."),
        "strengths": [str(x) for x in (data.get("strengths") or [])[:3]],
        "weaknesses": [str(x) for x in (data.get("weaknesses") or [])[:3]],
        "section": str(data.get("section") or section),
        "dimension_breakdown": clean_dims,
    }


def score_answer(question: str, answer: str) -> dict[str, object]:
    detailed = evaluate_answer_detailed(question=question, answer=answer)
    return {"score": int(detailed["score"]), "feedback": str(detailed["feedback"])}
