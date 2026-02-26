from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import relationship

from database import Base


class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100))
    email = Column(String(120), unique=True, index=True)
    password = Column(String(200))
    gender = Column(String(20))
    resume_path = Column(String(300))

    results = relationship("Result", back_populates="candidate")
    interviews = relationship("InterviewSession", back_populates="candidate")


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

    company = relationship("HR", back_populates="jobs")
    results = relationship("Result", back_populates="job")


class Result(Base):
    __tablename__ = "results"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id"))
    job_id = Column(Integer, ForeignKey("jobs.id"))
    application_id = Column(String(64), unique=True, nullable=True, index=True)

    score = Column(Float)
    shortlisted = Column(Boolean)
    explanation = Column(JSON)
    interview_date = Column(String, nullable=True)
    interview_link = Column(String, nullable=True)
    interview_questions = Column(JSON, nullable=True)
    interview_token = Column(String, nullable=True)

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
    answer_text = Column(Text, nullable=True)
    answer_summary = Column(Text, nullable=True)
    relevance_score = Column(Float, nullable=True)
    time_taken_seconds = Column(Integer, nullable=True)
    skipped = Column(Boolean, default=False, nullable=False)

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
