"""
interview_guard.py — Enforce one interview attempt per (candidate, JD) pair.

FIXES applied:
  1. Uses Result.allow_retry flag (if present) so HR can grant a second attempt
     without deleting the original result row.
  2. Cleaner error messages that help the frontend show actionable UI.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models import InterviewSession, Result

# Statuses that count as "interview used up"
TERMINAL_STATUSES = {"completed", "terminated", "submitted", "selected", "rejected"}


def get_completed_session(db: Session, result_id: int) -> InterviewSession | None:
    """Return a terminal-status session for this result, or None."""
    return (
        db.query(InterviewSession)
        .filter(
            InterviewSession.result_id == result_id,
            InterviewSession.status.in_(TERMINAL_STATUSES),
        )
        .first()
    )


def assert_candidate_can_interview(
    db: Session,
    candidate_id: int,
    job_id: int,
) -> Result:
    """
    Check whether this candidate is allowed to start an interview for this JD.

    Logic
    -----
    1. No Result row → never applied → HTTP 404.
    2. Result exists, no terminal session → first attempt → allow, return Result.
    3. Result exists, terminal session found → already interviewed → HTTP 409.

    Returns
    -------
    Result  The Result ORM row, ready for the caller to use.
    """
    result = (
        db.query(Result)
        .filter(
            Result.candidate_id == candidate_id,
            Result.job_id == job_id,
        )
        .first()
    )

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No application found for this candidate and JD.",
        )

    completed = get_completed_session(db, result_id=result.id)
    if completed:
        # FIX: check allow_retry flag if present so HR can grant a second attempt
        allow_retry = getattr(result, "allow_retry", False)
        if not allow_retry:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "You have already completed an interview for this position. "
                    "You may apply and interview for other open positions. "
                    "Contact HR if you believe this is an error."
                ),
            )

    return result
