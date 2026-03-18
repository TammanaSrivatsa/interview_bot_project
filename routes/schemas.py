"""Pydantic request bodies shared by API route modules."""

from typing import Any

from pydantic import BaseModel, EmailStr, Field


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class SignupBody(BaseModel):
    role: str = Field(..., description="candidate or hr")
    name: str = Field(..., min_length=2, max_length=150)
    email: EmailStr
    password: str = Field(..., min_length=6)
    gender: str | None = None


# NOTE: Support both the legacy backend payload shape and the current frontend
# payload shape for skill-weight updates.
# Frontend currently sends: { jd_id, weights, cutoff_score }
# Older backend code may still send: { job_id, skill_scores, cutoff_score, question_count }
class SkillWeightsBody(BaseModel):
    skill_scores: dict[str, int] | None = None
    weights: dict[str, int] | None = None
    job_id: int | None = None
    jd_id: int | None = None
    cutoff_score: float | None = Field(default=None, ge=0, le=100)
    question_count: int | None = Field(default=None, ge=3, le=20)


class ScheduleInterviewBody(BaseModel):
    result_id: int
    interview_date: str


class InterviewScoreBody(BaseModel):
    result_id: int
    technical_score: float = Field(..., ge=0, le=100)


class InterviewStartBody(BaseModel):
    candidate_id: int | None = None
    result_id: int | None = None
    consent_given: bool = False
    per_question_seconds: int = Field(default=60, ge=15, le=600)
    total_time_seconds: int = Field(default=1200, ge=300, le=7200)
    max_questions: int | None = Field(default=None, ge=3, le=20)


class InterviewAnswerBody(BaseModel):
    session_id: int
    question_id: int
    answer_text: str = ""
    skipped: bool = False
    time_taken_sec: int = Field(default=0, ge=0, le=600)


class InterviewEventBody(BaseModel):
    event_type: str = Field(..., min_length=1, max_length=80)
    detail: str | None = Field(default=None, max_length=300)
    timestamp: str | None = Field(default=None, max_length=60)
    meta: dict[str, Any] | None = None


# NOTE: These fields mirror the exact payload shape sent by
# interview-frontend/src/pages/HRJdManagementPage.jsx.
class HrJDCreateBody(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    jd_text: str = Field(..., min_length=2)
    jd_dict_json: dict[str, Any] | None = None
    weights_json: dict[str, int] = Field(default_factory=dict)
    qualify_score: float = Field(default=65.0, ge=0, le=100)
    education_requirement: str | None = Field(default=None, max_length=50)
    experience_requirement: int = Field(default=0, ge=0, le=100)
    min_academic_percent: float = Field(default=0.0, ge=0, le=100)
    total_questions: int = Field(default=8, ge=1, le=50)
    project_question_ratio: float = Field(default=0.8, ge=0.0, le=1.0)


# NOTE: Partial-update schema aligned to the existing frontend JD form.
class HrJDUpdateBody(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    jd_text: str | None = Field(default=None, min_length=10)
    jd_dict_json: dict[str, Any] | None = None
    weights_json: dict[str, int] | None = None
    qualify_score: float | None = Field(default=None, ge=0, le=100)
    education_requirement: str | None = Field(default=None, max_length=50)
    experience_requirement: int | None = Field(default=None, ge=0, le=100)
    min_academic_percent: float | None = Field(default=None, ge=0, le=100)
    total_questions: int | None = Field(default=None, ge=1, le=50)
    project_question_ratio: float | None = Field(default=None, ge=0.0, le=1.0)


class CandidateSelectJDBody(BaseModel):
    jd_id: int
