"""FastAPI application entrypoint for Interview Bot backend."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.middleware.sessions import SessionMiddleware

from database import engine
from models import Base
from routes.api_routes import api_router

load_dotenv()

app = FastAPI(title="Interview Bot API", version="1.0.0")

# Keep startup table creation for local/dev environments.
Base.metadata.create_all(bind=engine)


def ensure_schema() -> None:
    """Backfill lightweight schema changes for existing local SQLite DBs."""

    with engine.begin() as conn:
        try:
            rows = conn.execute(text("PRAGMA table_info(jobs)")).fetchall()
            columns = {row[1] for row in rows}
            if "jd_title" not in columns:
                conn.execute(text("ALTER TABLE jobs ADD COLUMN jd_title VARCHAR(150)"))

            # application_id on results
            rows = conn.execute(text("PRAGMA table_info(results)")).fetchall()
            res_cols = {row[1] for row in rows}
            if "application_id" not in res_cols:
                conn.execute(text("ALTER TABLE results ADD COLUMN application_id VARCHAR(64)"))

            # new columns on interview_questions_v2
            rows = conn.execute(text("PRAGMA table_info(interview_questions_v2)")).fetchall()
            q_cols = {row[1] for row in rows}
            if "answer_summary" not in q_cols:
                conn.execute(text("ALTER TABLE interview_questions_v2 ADD COLUMN answer_summary TEXT"))
            if "relevance_score" not in q_cols:
                conn.execute(text("ALTER TABLE interview_questions_v2 ADD COLUMN relevance_score FLOAT"))
            if "time_taken_seconds" not in q_cols:
                conn.execute(text("ALTER TABLE interview_questions_v2 ADD COLUMN time_taken_seconds INTEGER"))
            if "skipped" not in q_cols:
                conn.execute(text("ALTER TABLE interview_questions_v2 ADD COLUMN skipped BOOLEAN DEFAULT 0 NOT NULL"))
            if "answer_text" not in q_cols:
                conn.execute(text("ALTER TABLE interview_questions_v2 ADD COLUMN answer_text TEXT"))

            # Migrate legacy token-flow proctor events into unified proctor_events.
            legacy_table = conn.execute(
                text(
                    """
                    SELECT name
                    FROM sqlite_master
                    WHERE type = 'table' AND name = 'interview_proctor_events'
                    """
                )
            ).first()
            if legacy_table:
                conn.execute(
                    text(
                        """
                        INSERT INTO proctor_events (
                            session_id,
                            created_at,
                            event_type,
                            score,
                            meta_json,
                            image_path
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
                            SELECT 1
                            FROM proctor_events current
                            WHERE current.session_id = legacy.interview_id
                                AND current.created_at = legacy.created_at
                                AND current.event_type = legacy.event_type
                                AND COALESCE(current.image_path, '') = COALESCE(
                                    CASE
                                        WHEN legacy.snapshot_path LIKE 'uploads/%'
                                            THEN substr(legacy.snapshot_path, 9)
                                        ELSE legacy.snapshot_path
                                    END,
                                    ''
                                )
                        )
                        """
                    )
                )
        except Exception:
            # Non-blocking schema migration best effort.
            pass


ensure_schema()

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
app.include_router(api_router)
