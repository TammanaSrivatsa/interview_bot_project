"""
models.py — ORM models for Interview Bot.

FIX: Added dedicated HR decision columns to Result table so that
     HR decision data is no longer mixed into the resume explanation
     JSON blob. This eliminates silent data-loss bugs when multiple
     code paths write to result.explanation concurrently.
"""
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey,
    Integer, JSON, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from database import Base


class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(Integer, primary_key=True, index=True)
    candidate_uid = Column(String(32), unique=True, nullable=True, index=True)
    name = Column(String(100))
    email = Column(String(120), unique=True, index=True)
    password = Column(String(200))
    gender = Column(String(20))
    resume_path = Column(String(300))
    selected_jd_id = Column(Integer, ForeignKey("job_descriptions.id"), nullable=True, index=True)
    questions_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True, index=True)

    results = relationship("Result", back_populates="candidate")
    interviews = relationship("InterviewSession", back_populates="candidate")
    selected_jd = relationship("JobDescriptionConfig", foreign_keys=[selected_jd_id])


class HR(Base):
    __tablename__ = "hr"

    id = Column(Integer, primary_key=True, index=True)
    company_name = Column(String(150))
    email = Column(String(120), unique=True, index=True)
    password = Column(String(200))

    jobs = relationship("JobDescription", back_populates="company")


class JobDescription(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True)
    company_id = Column(Integer, ForeignKey("hr.id"))
    jd_title = Column(String(150), nullable=True)
    jd_text = Column(String)
    skill_scores = Column(JSON)
    gender_requirement = Column(String(50))
    education_requirement = Column(String(50))
    experience_requirement = Column(Integer)
    cutoff_score = Column(Float, default=65.0, nullable=False)
    question_count = Column(Integer, default=8, nullable=False)

    company = relationship("HR", back_populates="jobs")
    results = relationship("Result", back_populates="job")


class JobDescriptionConfig(Base):
    __tablename__ = "job_descriptions"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    jd_text = Column(Text, nullable=False)
    jd_dict_json = Column(JSON, nullable=True)
    weights_json = Column(JSON, nullable=True)
    qualify_score = Column(Float, default=65.0, nullable=False)
    min_academic_percent = Column(Float, default=0.0, nullable=False)
    total_questions = Column(Integer, default=8, nullable=False)
    project_question_ratio = Column(Float, default=0.8, nullable=False)
    # NOTE: Backward-safe active flag for demo readiness.
    is_active = Column(Boolean, default=True, nullable=False)
    # NEW: store education + experience requirements on the canonical config
    education_requirement = Column(String(50), nullable=True)
    experience_requirement = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class Result(Base):
    __tablename__ = "results"

    # Enforce one interview attempt per (candidate, JD) pair.
    __table_args__ = (
        UniqueConstraint("candidate_id", "job_id", name="uq_result_candidate_job"),
    )

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id"))
    job_id = Column(Integer, ForeignKey("jobs.id"))
    application_id = Column(String(64), unique=True, nullable=True, index=True)

    # Resume screening output
    score = Column(Float)
    shortlisted = Column(Boolean)
    explanation = Column(JSON)  # resume scorecard only going forward
    interview_date = Column(String, nullable=True)
    interview_link = Column(String, nullable=True)
    interview_questions = Column(JSON, nullable=True)
    interview_token = Column(String, nullable=True)
    events_json = Column(JSON, nullable=True)

    # FIX: Dedicated HR decision columns — no longer stored inside explanation JSON.
    # This prevents silent data loss when multiple code paths write to explanation.
    hr_decision = Column(String(20), nullable=True)          # 'selected' | 'rejected'
    hr_final_score = Column(Float, nullable=True)
    hr_behavioral_score = Column(Float, nullable=True)
    hr_communication_score = Column(Float, nullable=True)
    hr_notes = Column(Text, nullable=True)
    hr_red_flags = Column(Text, nullable=True)

    candidate = relationship("Candidate", back_populates="results")
    job = relationship("JobDescription", back_populates="results")
    sessions = relationship("InterviewSession", back_populates="result")


class InterviewSession(Base):
    __tablename__ = "interview_sessions"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id"), nullable=False, index=True)
    result_id = Column(Integer, ForeignKey("results.id"), nullable=False, index=True)
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    ended_at = Column(DateTime, nullable=True)
    status = Column(String(50), default="in_progress", nullable=False)
    per_question_seconds = Column(Integer, default=60, nullable=False)
    total_time_seconds = Column(Integer, default=1200, nullable=False)
    remaining_time_seconds = Column(Integer, default=1200, nullable=False)
    max_questions = Column(Integer, default=8, nullable=False)
    baseline_face_signature = Column(Text, nullable=True)
    baseline_face_captured_at = Column(DateTime, nullable=True)
    consent_given = Column(Boolean, default=False, nullable=False)
    warning_count = Column(Integer, default=0, nullable=False)
    consecutive_violation_frames = Column(Integer, default=0, nullable=False)
    paused_until = Column(DateTime, nullable=True)
    # NEW: track LLM evaluation job status
    llm_eval_status = Column(String(20), default="pending", nullable=False)
    # values: pending | running | completed | failed

    candidate = relationship("Candidate", back_populates="interviews")
    result = relationship("Result", back_populates="sessions")
    questions = relationship("InterviewQuestion", back_populates="session", cascade="all, delete-orphan")
    answers = relationship("InterviewAnswer", back_populates="session", cascade="all, delete-orphan")
    proctor_events = relationship("ProctorEvent", back_populates="session", cascade="all, delete-orphan")


class InterviewQuestion(Base):
    __tablename__ = "interview_questions_v2"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("interview_sessions.id"), nullable=False, index=True)
    text = Column(Text, nullable=False)
    difficulty = Column(String(30), default="medium", nullable=False)
    topic = Column(String(80), default="general", nullable=False)
    # Final interview-question metadata used by runtime, evaluation, and HR review.
    question_type = Column(String(30), default="project", nullable=False)
    intent = Column(Text, nullable=True)
    focus_skill = Column(String(80), nullable=True)
    project_name = Column(String(160), nullable=True)
    reference_answer = Column(Text, nullable=True)
    answer_text = Column(Text, nullable=True)
    answer_summary = Column(Text, nullable=True)
    relevance_score = Column(Float, nullable=True)
    allotted_seconds = Column(Integer, default=60, nullable=False)
    time_taken_seconds = Column(Integer, nullable=True)
    skipped = Column(Boolean, default=False, nullable=False)
    llm_score = Column(Float, nullable=True)
    llm_feedback = Column(Text, nullable=True)
    evaluation_json = Column(JSON, nullable=True)

    session = relationship("InterviewSession", back_populates="questions")
    answers = relationship("InterviewAnswer", back_populates="question")


class InterviewAnswer(Base):
    __tablename__ = "interview_answers"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("interview_sessions.id"), nullable=False, index=True)
    question_id = Column(Integer, ForeignKey("interview_questions_v2.id"), nullable=False, index=True)
    answer_text = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    skipped = Column(Boolean, default=False, nullable=False)
    time_taken_sec = Column(Integer, default=0, nullable=False)
    llm_score = Column(Float, nullable=True)
    llm_feedback = Column(Text, nullable=True)

    session = relationship("InterviewSession", back_populates="answers")
    question = relationship("InterviewQuestion", back_populates="answers")


class ProctorEvent(Base):
    __tablename__ = "proctor_events"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("interview_sessions.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    event_type = Column(String(80), nullable=False)
    score = Column(Float, default=0.0, nullable=False)
    meta_json = Column(JSON, nullable=True)
    image_path = Column(String(500), nullable=True)

    session = relationship("InterviewSession", back_populates="proctor_events")
