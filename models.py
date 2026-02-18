from sqlalchemy import Column, Integer, String, Boolean, Float, JSON, ForeignKey, Text
from sqlalchemy.orm import relationship
from database import Base


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

    interview_date = Column(String, nullable=True)
    interview_link = Column(String, nullable=True)

    # 🔥 ADD THIS
    interview_questions = Column(JSON, nullable=True)
    interview_token = Column(String, nullable=True)

    candidate = relationship("Candidate", back_populates="results")
    job = relationship("JobDescription", back_populates="results")


# --------------------------------------------------
# Interview Session Table (NEW)
# --------------------------------------------------
class InterviewSession(Base):
    __tablename__ = "interviews"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id"))
    job_id = Column(Integer, ForeignKey("jobs.id"))

    status = Column(String(50), default="not_started")
    final_score = Column(Float, nullable=True)
    overall_feedback = Column(Text, nullable=True)

    candidate = relationship("Candidate", back_populates="interviews")
    questions = relationship("InterviewQuestion", back_populates="interview")


# --------------------------------------------------
# Interview Questions Table (NEW)
# --------------------------------------------------
class InterviewQuestion(Base):
    __tablename__ = "interview_questions"

    id = Column(Integer, primary_key=True, index=True)
    interview_id = Column(Integer, ForeignKey("interviews.id"))

    question_text = Column(Text)
    answer_text = Column(Text, nullable=True)
    score = Column(Float, nullable=True)

    interview = relationship("InterviewSession", back_populates="questions")