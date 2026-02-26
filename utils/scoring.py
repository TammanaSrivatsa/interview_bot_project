"""Lightweight answer summarization and relevance scoring."""

from __future__ import annotations

import os
import re
from typing import Tuple


def _tokenize(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-zA-Z0-9]+", text.lower()) if t}


def summarize_and_score(question: str, answer: str) -> Tuple[str, float]:
    """Return (summary, relevance_score[0-100])."""
    question_tokens = _tokenize(question)
    answer_tokens = _tokenize(answer)
    if not answer_tokens:
        return ("", 0.0)

    overlap = question_tokens & answer_tokens
    score = 0.0
    if question_tokens:
        score = min(100.0, round(len(overlap) / max(1, len(question_tokens)) * 100, 2))

    # Simple summary: first ~200 chars
    summary = answer.strip()[:200]
    return summary, score
