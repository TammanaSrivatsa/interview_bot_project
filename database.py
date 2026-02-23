"""Database engine and session wiring for SQLAlchemy."""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

# ---------------------------
# SQLAlchemy Base + Config
# ---------------------------
# Base class used by all ORM models in models.py
Base = declarative_base()
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

# Fallback DB for local development if env is missing.
if not DATABASE_URL:
    DATABASE_URL = "sqlite:///./app.db"

# Engine handles low-level DB connections.
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
)

# ---------------------------
# Session Dependency
# ---------------------------
# SessionLocal is injected in routes using Depends(get_db).
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
def get_db():
    """Provide one DB session per request and close safely."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
