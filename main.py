"""
main.py — FastAPI application entrypoint for Interview Bot backend.

FIXES applied:
  1. ensure_schema() migrates all new columns added to models.py
     (hr_decision, hr_final_score, hr_behavioral_score, hr_communication_score,
      hr_notes, hr_red_flags on results; llm_eval_status on interview_sessions;
      education_requirement + experience_requirement on job_descriptions)
  2. @app.on_event("startup") pre-loads the SentenceTransformer model so the
     first resume upload does not have a 10-second cold-start delay.
  3. GROQ_API_KEY is checked at startup — a clear warning is printed if it is
     missing so engineers catch it immediately instead of seeing 500 errors
     during interviews.
"""
from __future__ import annotations

import logging
import os
import threading
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.middleware.sessions import SessionMiddleware

from database import SessionLocal, engine
from models import Base, Candidate
from routes.api_routes import api_router
from routes.common import ensure_candidate_profile

load_dotenv()

logger = logging.getLogger(__name__)

app = FastAPI(title="Interview Bot API", version="1.0.0")

# Keep startup table creation for local/dev environments.
Base.metadata.create_all(bind=engine)


def ensure_schema() -> None:
    """Backfill lightweight schema changes for existing local SQLite DBs."""
    try:
        with engine.begin() as conn:
            # ── job_descriptions (canonical config table) ─────────────────
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS job_descriptions (
                        id INTEGER PRIMARY KEY,
                        title VARCHAR(200) NOT NULL,
                        jd_text TEXT NOT NULL,
                        jd_dict_json JSON,
                        weights_json JSON,
                        qualify_score FLOAT NOT NULL DEFAULT 65,
                        min_academic_percent FLOAT NOT NULL DEFAULT 0,
                        total_questions INTEGER NOT NULL DEFAULT 8,
                        project_question_ratio FLOAT NOT NULL DEFAULT 0.8,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
            )

            # Add NEW columns to job_descriptions if they don't exist
            jd_cols = {r[1] for r in conn.execute(text("PRAGMA table_info(job_descriptions)")).fetchall()}
            if "education_requirement" not in jd_cols:
                conn.execute(text("ALTER TABLE job_descriptions ADD COLUMN education_requirement VARCHAR(50)"))
            if "experience_requirement" not in jd_cols:
                conn.execute(text("ALTER TABLE job_descriptions ADD COLUMN experience_requirement INTEGER DEFAULT 0 NOT NULL"))
            # NOTE: Backward-safe demo toggle support for JD visibility.
            if "is_active" not in jd_cols:
                conn.execute(text("ALTER TABLE job_descriptions ADD COLUMN is_active BOOLEAN DEFAULT 1 NOT NULL"))

            # ── jobs (legacy table) ───────────────────────────────────────
            rows = conn.execute(text("PRAGMA table_info(jobs)")).fetchall()
            columns = {row[1] for row in rows}
            if "jd_title" not in columns:
                conn.execute(text("ALTER TABLE jobs ADD COLUMN jd_title VARCHAR(150)"))
            if "cutoff_score" not in columns:
                conn.execute(text("ALTER TABLE jobs ADD COLUMN cutoff_score FLOAT DEFAULT 65 NOT NULL"))
            if "question_count" not in columns:
                conn.execute(text("ALTER TABLE jobs ADD COLUMN question_count INTEGER DEFAULT 8 NOT NULL"))
            if "education_requirement" not in columns:
                conn.execute(text("ALTER TABLE jobs ADD COLUMN education_requirement VARCHAR(50)"))
            if "experience_requirement" not in columns:
                conn.execute(text("ALTER TABLE jobs ADD COLUMN experience_requirement INTEGER DEFAULT 0"))

            # ── candidates ────────────────────────────────────────────────
            rows = conn.execute(text("PRAGMA table_info(candidates)")).fetchall()
            candidate_cols = {row[1] for row in rows}
            if "candidate_uid" not in candidate_cols:
                conn.execute(text("ALTER TABLE candidates ADD COLUMN candidate_uid VARCHAR(32)"))
            if "created_at" not in candidate_cols:
                conn.execute(text("ALTER TABLE candidates ADD COLUMN created_at DATETIME"))
            if "selected_jd_id" not in candidate_cols:
                conn.execute(text("ALTER TABLE candidates ADD COLUMN selected_jd_id INTEGER"))
            if "questions_json" not in candidate_cols:
                conn.execute(text("ALTER TABLE candidates ADD COLUMN questions_json TEXT"))

            # ── results ───────────────────────────────────────────────────
            # One interview attempt per (candidate, JD)
            conn.execute(
                text(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_result_candidate_job
                    ON results(candidate_id, job_id)
                    WHERE candidate_id IS NOT NULL AND job_id IS NOT NULL
                    """
                )
            )
            rows = conn.execute(text("PRAGMA table_info(results)")).fetchall()
            res_cols = {row[1] for row in rows}
            if "application_id" not in res_cols:
                conn.execute(text("ALTER TABLE results ADD COLUMN application_id VARCHAR(64)"))
            if "events_json" not in res_cols:
                conn.execute(text("ALTER TABLE results ADD COLUMN events_json TEXT"))
            # FIX: new dedicated HR decision columns
            if "hr_decision" not in res_cols:
                conn.execute(text("ALTER TABLE results ADD COLUMN hr_decision VARCHAR(20)"))
            if "hr_final_score" not in res_cols:
                conn.execute(text("ALTER TABLE results ADD COLUMN hr_final_score FLOAT"))
            if "hr_behavioral_score" not in res_cols:
                conn.execute(text("ALTER TABLE results ADD COLUMN hr_behavioral_score FLOAT"))
            if "hr_communication_score" not in res_cols:
                conn.execute(text("ALTER TABLE results ADD COLUMN hr_communication_score FLOAT"))
            if "hr_notes" not in res_cols:
                conn.execute(text("ALTER TABLE results ADD COLUMN hr_notes TEXT"))
            if "hr_red_flags" not in res_cols:
                conn.execute(text("ALTER TABLE results ADD COLUMN hr_red_flags TEXT"))

            # ── interview_answers ─────────────────────────────────────────
            rows = conn.execute(text("PRAGMA table_info(interview_answers)")).fetchall()
            ans_cols = {row[1] for row in rows}
            if "llm_score" not in ans_cols:
                conn.execute(text("ALTER TABLE interview_answers ADD COLUMN llm_score FLOAT"))
            if "llm_feedback" not in ans_cols:
                conn.execute(text("ALTER TABLE interview_answers ADD COLUMN llm_feedback TEXT"))

            # ── interview_questions_v2 ────────────────────────────────────
            rows = conn.execute(text("PRAGMA table_info(interview_questions_v2)")).fetchall()
            q_cols = {row[1] for row in rows}
            for col, defn in [
                ("question_type",     "VARCHAR(30) DEFAULT 'project' NOT NULL"),
                ("intent",            "TEXT"),
                ("focus_skill",       "VARCHAR(80)"),
                ("project_name",      "VARCHAR(160)"),
                ("reference_answer",  "TEXT"),
                ("answer_summary",    "TEXT"),
                ("relevance_score",   "FLOAT"),
                ("time_taken_seconds","INTEGER"),
                ("skipped",           "BOOLEAN DEFAULT 0 NOT NULL"),
                ("answer_text",       "TEXT"),
                ("llm_score",         "FLOAT"),
                ("llm_feedback",      "TEXT"),
                ("evaluation_json",   "JSON"),
                ("allotted_seconds",  "INTEGER DEFAULT 60 NOT NULL"),
            ]:
                if col not in q_cols:
                    conn.execute(text(f"ALTER TABLE interview_questions_v2 ADD COLUMN {col} {defn}"))

            # ── interview_sessions ────────────────────────────────────────
            rows = conn.execute(text("PRAGMA table_info(interview_sessions)")).fetchall()
            session_cols = {row[1] for row in rows}
            for col, defn in [
                ("per_question_seconds",           "INTEGER DEFAULT 60 NOT NULL"),
                ("total_time_seconds",             "INTEGER DEFAULT 1200 NOT NULL"),
                ("remaining_time_seconds",         "INTEGER DEFAULT 1200 NOT NULL"),
                ("max_questions",                  "INTEGER DEFAULT 8 NOT NULL"),
                ("baseline_face_signature",        "TEXT"),
                ("baseline_face_captured_at",      "DATETIME"),
                ("consent_given",                  "BOOLEAN DEFAULT 0 NOT NULL"),
                ("warning_count",                  "INTEGER DEFAULT 0 NOT NULL"),
                ("consecutive_violation_frames",   "INTEGER DEFAULT 0 NOT NULL"),
                ("paused_until",                   "DATETIME"),
                # FIX: LLM evaluation job status
                ("llm_eval_status",                "VARCHAR(20) DEFAULT 'pending' NOT NULL"),
            ]:
                if col not in session_cols:
                    conn.execute(text(f"ALTER TABLE interview_sessions ADD COLUMN {col} {defn}"))

            # ── legacy proctor event migration ────────────────────────────
            legacy_table = conn.execute(
                text(
                    "SELECT name FROM sqlite_master "
                    "WHERE type='table' AND name='interview_proctor_events'"
                )
            ).first()
            if legacy_table:
                conn.execute(
                    text(
                        """
                        INSERT INTO proctor_events (
                            session_id, created_at, event_type, score, meta_json, image_path
                        )
                        SELECT
                            legacy.interview_id,
                            legacy.created_at,
                            legacy.event_type,
                            legacy.confidence,
                            '{"migrated_from":"interview_proctor_events"}',
                            CASE
                                WHEN legacy.snapshot_path LIKE 'uploads/%'
                                    THEN substr(legacy.snapshot_path, 9)
                                ELSE legacy.snapshot_path
                            END
                        FROM interview_proctor_events legacy
                        WHERE NOT EXISTS (
                            SELECT 1 FROM proctor_events curr
                            WHERE curr.session_id = legacy.interview_id
                              AND curr.created_at  = legacy.created_at
                              AND curr.event_type  = legacy.event_type
                        )
                        """
                    )
                )

            conn.execute(
                text("UPDATE candidates SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL")
            )

    except Exception as exc:
        # Schema migration is best-effort — log but don't crash startup.
        logger.warning("ensure_schema warning (non-fatal): %s", exc)
        return

    try:
        db = SessionLocal()
        try:
            candidates = (
                db.query(Candidate)
                .filter(
                    (Candidate.candidate_uid.is_(None))
                    | (Candidate.candidate_uid == "")
                    | (Candidate.created_at.is_(None))
                )
                .all()
            )
            changed = False
            for candidate in candidates:
                changed = ensure_candidate_profile(candidate, db) or changed
            if changed:
                db.commit()
        finally:
            db.close()

        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ux_candidates_candidate_uid "
                    "ON candidates(candidate_uid)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_candidates_created_at "
                    "ON candidates(created_at)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_candidates_selected_jd_id "
                    "ON candidates(selected_jd_id)"
                )
            )
    except Exception as exc:
        logger.warning("ensure_schema index step warning (non-fatal): %s", exc)


ensure_schema()


# ── FIX: Check GROQ_API_KEY at startup so engineers know immediately ────────
_groq_key = os.getenv("GROQ_API_KEY", "")
if not _groq_key:
    logger.warning(
        "⚠️  GROQ_API_KEY is not set. "
        "Voice transcription and LLM answer scoring will be unavailable. "
        "The system will run in text-only / local-scoring mode. "
        "Set GROQ_API_KEY in your .env file to enable full AI features."
    )


# ── FIX: Pre-load SentenceTransformer on startup ────────────────────────────
# Without this the first resume upload triggers a ~10s model load during the
# request, causing a timeout-like experience for the candidate.
@app.on_event("startup")
async def _preload_ml_model() -> None:
    """Warm up the SentenceTransformer model without blocking backend startup."""
    def _load_model() -> None:
        try:
            from ai_engine.phase1.matching import _get_model
            _get_model()
            logger.info("✅  SentenceTransformer model loaded and ready.")
        except Exception as exc:
            logger.warning("SentenceTransformer preload failed (non-fatal): %s", exc)

    threading.Thread(target=_load_model, name="st-model-preload", daemon=True).start()


app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SECRET_KEY", "dev-session-secret-change-me"),
    same_site="lax",
    https_only=False,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

uploads_dir = Path("uploads")
uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")
# NOTE: Mount the aggregate API router exactly once. Double-registration creates
# duplicate/conflicting route entries and can surface as incorrect 404/405 behavior.
app.include_router(api_router)


# NOTE: Lightweight health endpoints for local startup verification.
@app.get("/")
def root() -> dict[str, str]:
    return {"ok": "true", "service": "interview-bot-api"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
