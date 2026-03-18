"""Post-interview answer evaluation with structured metadata."""
from __future__ import annotations

import logging
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ai_engine.phase1.scoring import compute_answer_scorecard
from database import get_db
from models import InterviewAnswer, InterviewQuestion, InterviewSession
from routes.dependencies import SessionUser, require_role
from services.llm.client import evaluate_answer_detailed

logger = logging.getLogger(__name__)
router = APIRouter(tags=["interview-evaluation"])


def _local_dimension_breakdown(question: InterviewQuestion, answer_text: str) -> dict[str, int]:
    scorecard = compute_answer_scorecard(
        question.text,
        answer_text,
        allotted_seconds=int(question.allotted_seconds or 0),
        time_taken_seconds=int(question.time_taken_seconds or 0),
        jd_skills=[question.focus_skill] if question.focus_skill else (),
    )
    overall = int(scorecard.get("overall_score", 0))
    relevance = int(scorecard.get("relevance_score", overall))
    completeness = int(scorecard.get("completeness_score", overall))
    clarity = int(scorecard.get("clarity_score", overall))
    confidence = max(35, min(100, int((clarity + completeness) / 2)))
    correctness = max(0, min(100, int((overall + relevance) / 2)))
    return {
        "relevance": relevance,
        "correctness": correctness,
        "completeness": completeness,
        "clarity": clarity,
        "confidence": confidence,
    }


def _fallback_evaluation(question: InterviewQuestion, answer_text: str) -> dict[str, object]:
    dims = _local_dimension_breakdown(question, answer_text)
    overall = round(sum(dims.values()) / len(dims), 1)
    strengths = []
    weaknesses = []
    if dims["relevance"] >= 65:
        strengths.append("The answer stayed relevant to the question.")
    else:
        weaknesses.append("The answer did not fully address the main intent of the question.")
    if dims["clarity"] >= 60:
        strengths.append("The explanation was reasonably clear and understandable.")
    else:
        weaknesses.append("The explanation could be structured more clearly.")
    if dims["completeness"] >= 65:
        strengths.append("The answer covered multiple useful points.")
    else:
        weaknesses.append("More concrete detail or examples were needed.")
    reference = question.reference_answer or "A strong answer should directly answer the question, use practical examples, and explain the reasoning behind decisions."
    return {
        "question": question.text,
        "candidate_answer": answer_text,
        "generated_reference_answer": reference,
        "score": overall,
        "feedback": "Scored using the local evaluation fallback. The answer was checked for relevance, clarity, completeness, and practical depth.",
        "strengths": strengths[:3],
        "weaknesses": weaknesses[:3],
        "section": question.question_type or "project",
        "dimension_breakdown": dims,
    }


def _upsert_llm_fields(db: Session, session_id: int, question: InterviewQuestion, evaluation: dict[str, object]) -> None:
    answer = (
        db.query(InterviewAnswer)
        .filter(InterviewAnswer.session_id == session_id, InterviewAnswer.question_id == question.id)
        .order_by(InterviewAnswer.id.desc())
        .first()
    )
    if answer:
        answer.llm_score = float(evaluation["score"])
        answer.llm_feedback = str(evaluation["feedback"])
        answer.evaluation_json = evaluation

    question.llm_score = float(evaluation["score"])
    question.llm_feedback = str(evaluation["feedback"])
    question.reference_answer = str(evaluation.get("generated_reference_answer") or question.reference_answer or "") or None
    question.evaluation_json = evaluation
    db.flush()


@router.post("/interview/{session_id}/evaluate")
def evaluate_interview(
    session_id: int,
    current_user: SessionUser = Depends(require_role("candidate")),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    session = db.query(InterviewSession).filter(InterviewSession.id == session_id, InterviewSession.candidate_id == current_user.user_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found")

    session.llm_eval_status = "running"
    db.commit()

    questions = db.query(InterviewQuestion).filter(InterviewQuestion.session_id == session_id).order_by(InterviewQuestion.id.asc()).all()
    scored = 0
    total_score = 0.0
    section_scores: dict[str, list[float]] = defaultdict(list)

    for question in questions:
        answer_text = (question.answer_text or "").strip()
        if not answer_text or question.skipped:
            evaluation = {
                "question": question.text,
                "candidate_answer": answer_text,
                "generated_reference_answer": question.reference_answer or "A strong answer should directly respond to the prompt with practical detail.",
                "score": 0,
                "feedback": "Answer was skipped or empty.",
                "strengths": [],
                "weaknesses": ["No answer was provided."],
                "section": question.question_type or "project",
                "dimension_breakdown": {"relevance": 0, "correctness": 0, "completeness": 0, "clarity": 0, "confidence": 0},
            }
            _upsert_llm_fields(db, session_id, question, evaluation)
            continue

        try:
            evaluation = evaluate_answer_detailed(
                question=question.text,
                answer=answer_text,
                section=question.question_type or "project",
                reference_answer=question.reference_answer,
                intent=question.intent,
                focus_skill=question.focus_skill,
                project_name=question.project_name,
            )
        except Exception as exc:
            logger.warning("Detailed answer evaluation failed for question %s (session %s): %s — using local fallback.", question.id, session_id, exc)
            evaluation = _fallback_evaluation(question, answer_text)

        _upsert_llm_fields(db, session_id, question, evaluation)
        total_score += float(evaluation["score"])
        scored += 1
        section_scores[str(evaluation.get("section") or "project")].append(float(evaluation["score"]))

    session.llm_eval_status = "completed"
    db.commit()

    avg_score = round(total_score / scored, 1) if scored else 0.0
    section_summary = {key: round(sum(values) / len(values), 1) for key, values in section_scores.items() if values}
    return {"ok": True, "session_id": session_id, "questions_evaluated": scored, "average_llm_score": avg_score, "section_summary": section_summary}
