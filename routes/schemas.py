"""Pydantic request bodies shared by API route modules."""

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


class SkillWeightsBody(BaseModel):
    skill_scores: dict[str, int]
    job_id: int | None = None


class ScheduleInterviewBody(BaseModel):
    result_id: int
    interview_date: str


class InterviewScoreBody(BaseModel):
    result_id: int
    technical_score: float = Field(..., ge=0, le=100)


class InterviewStartBody(BaseModel):
    candidate_id: int | None = None
    result_id: int | None = None
    per_question_seconds: int = Field(default=60, ge=15, le=600)
    total_time_seconds: int = Field(default=1200, ge=300, le=7200)
    max_questions: int = Field(default=8, ge=3, le=20)


class InterviewAnswerBody(BaseModel):
    session_id: int
    question_id: int
    answer_text: str = ""
    skipped: bool = False
    time_taken_sec: int = Field(default=0, ge=0, le=600)
