from database import Base
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship


# --------------------------------------------------
# Candidate Table
# --------------------------------------------------
class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100))
    email = Column(String(120), unique=True, index=True)
    password = Column(String(200))
    gender = Column(String(20))
    resume_path = Column(String(300))

    # Relationships
    results = relationship("Result", back_populates="candidate")
    interviews = relationship("InterviewSession", back_populates="candidate")


# --------------------------------------------------
# HR Table
# --------------------------------------------------
class HR(Base):
    __tablename__ = "hr"

    id = Column(Integer, primary_key=True, index=True)
    company_name = Column(String(150))
    email = Column(String(120), unique=True, index=True)
    password = Column(String(200))

    jobs = relationship("JobDescription", back_populates="company")


# --------------------------------------------------
# Job Description Table
# --------------------------------------------------
class JobDescription(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True)
    company_id = Column(Integer, ForeignKey("hr.id"))
    company_name = Column(String(200))
    role_name = Column(String(200))
    jd_text = Column(String)
    skill_scores = Column(JSON)
    gender_requirement = Column(String(50))
    education_requirement = Column(String(50))
    experience_requirement = Column(Integer)

    company = relationship("HR", back_populates="jobs")
    results = relationship("Result", back_populates="job")


# --------------------------------------------------
# Result Table (Matching Output)
# --------------------------------------------------
class Result(Base):
    __tablename__ = "results"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id"))
    job_id = Column(Integer, ForeignKey("jobs.id"))

    score = Column(Float)
    shortlisted = Column(Boolean)
    explanation = Column(JSON)

    # Existing interview tracking (DO NOT MODIFY)
    interview_date = Column(String, nullable=True)
    interview_link = Column(String, nullable=True)
    interview_start_time = Column(String, nullable=True)
    interview_end_time = Column(String, nullable=True)
    interview_abandoned = Column(Boolean, default=False)

    # Existing
    interview_questions = Column(JSON, nullable=True)
    interview_token = Column(String, nullable=True)

    # SAFE ADDITIONS (no effect on existing workflow)
    screening_completed = Column(Boolean, default=False)
    screened_at = Column(DateTime, nullable=True)
    pipeline_status = Column(String(50), nullable=True)
    hr_decision = Column(String(50), nullable=True)
    recruiter_notes = Column(Text, nullable=True)
    recruiter_feedback = Column(Text, nullable=True)
    report_generated_at = Column(DateTime, nullable=True)

    candidate = relationship("Candidate", back_populates="results")
    job = relationship("JobDescription", back_populates="results")


# --------------------------------------------------
# Interview Session Table
# --------------------------------------------------
class InterviewSession(Base):
    __tablename__ = "interviews"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id"))
    job_id = Column(Integer, ForeignKey("jobs.id"))

    status = Column(String(50), default="not_started")
    final_score = Column(Float, nullable=True)
    overall_feedback = Column(Text, nullable=True)

    # Candidate selected interview date & time
    scheduled_at = Column(DateTime, nullable=True)

    # Actual interview start time
    started_at = Column(DateTime, nullable=True)

    # Actual interview end time
    ended_at = Column(DateTime, nullable=True)

    # If candidate closed tab / logged out
    abandoned = Column(Boolean, default=False)

    # If interview completed normally
    completed = Column(Boolean, default=False)

    # Suspicious activity flag
    suspicious_activity = Column(Boolean, default=False)

    candidate = relationship("Candidate", back_populates="interviews")
    questions = relationship("InterviewQuestion", back_populates="interview")


# --------------------------------------------------
# Interview Questions Table
# --------------------------------------------------
class InterviewQuestion(Base):
    __tablename__ = "interview_questions"

    id = Column(Integer, primary_key=True, index=True)
    interview_id = Column(Integer, ForeignKey("interviews.id"))

    question_text = Column(Text)
    answer_text = Column(Text, nullable=True)
    score = Column(Float, nullable=True)
    score_reason = Column(Text, nullable=True)

    interview = relationship("InterviewSession", back_populates="questions")
