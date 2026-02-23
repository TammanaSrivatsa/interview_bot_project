import os
from dotenv import load_dotenv
from sqlalchemy import text

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from database import engine
from models import Base
from routes.api_routes import api_router

# ---------------------------
# App Bootstrapping
# ---------------------------
load_dotenv()

app = FastAPI(docs_url=None, redoc_url=None)

# Create tables for current models (dev-friendly startup behavior).
Base.metadata.create_all(bind=engine)


def ensure_schema():
    # Lightweight migration for existing SQLite DBs.
    with engine.begin() as conn:
        try:
            rows = conn.execute(text("PRAGMA table_info(jobs)")).fetchall()
            columns = {row[1] for row in rows}
            if "jd_title" not in columns:
                conn.execute(text("ALTER TABLE jobs ADD COLUMN jd_title VARCHAR(150)"))
        except Exception:
            # Do not block app startup on non-critical schema backfill.
            pass


ensure_schema()

# ---------------------------
# Middleware + Routing
# ---------------------------
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ["SECRET_KEY"],
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.include_router(api_router)


@app.get("/health")
def health():
    return {"ok": True}
