# AI Interview Platform

**End-to-end AI-powered interview workflow with FastAPI backend, React 19 + Vite frontend, and Groq LLM integration.**

- 🔐 Session-cookie auth for candidate and HR users
- 📊 Deterministic resume scoring (v2) against HR-managed JDs with academic cutoff validation
- 💡 AI resume advice and practice-kit generation from uploaded resumes
- ⏱️ Timed interview sessions with adaptive follow-up questions
- 📹 Webcam proctoring with OpenCV frame analysis, local speech-to-text (Groq Whisper), and HR review/finalization
- 🤖 Groq LLM-powered answer scoring with local fallback rubric
- ✅ Dedicated HR decision columns (no more JSON blob conflicts)

---

## Current Architecture

### Backend

- **Entrypoint**: `main.py`
- **API Router**: `routes/api_routes.py`
- **Route Groups**:
  - `routes/auth/sessions.py` — signup, login, logout, profile updates, password changes, Groq health check
  - `routes/candidate/workflow.py` — dashboard, JD selection, resume upload, practice kit
  - `routes/hr/management.py` — JD CRUD, candidate search, skill generation, bulk scoring
  - `routes/hr/interview_review.py` — interview detail, finalization, **re-evaluation endpoint**
  - `routes/interview/runtime.py` — session start, answer submission, transcription, proctoring events
  - `routes/interview/evaluation.py` — post-interview LLM scoring with graceful Groq fallback
- **ORM + DB**: `models.py`, `database.py`
- **Default DB**: `sqlite:///./interview_bot.db`
- **File Storage**: `uploads/` (resumes, proctoring snapshots, exports)

### Frontend

- **Active App**: `interview-frontend/`
- **Stack**: React 19 + Vite
- **API Client**: Vite proxy default to `/api`
- **Main Flows**: login/signup, candidate dashboard, HR dashboard, candidate manager, interview review, pre-check, live interview

### AI / Workflow Modules

- **Phase 1** (Resume Screening):
  - `ai_engine/phase1/matching.py` — text extraction, semantic matching, skill extraction
  - `ai_engine/phase1/scoring.py` — resume scorecard v2, answer rubric scoring
  - Logic: Semantic similarity (30%), skill match (25%), experience (15%), education (10%), academic % (5%), resume quality (5%)
  
- **Phase 2** (Question Generation):
  - `ai_engine/phase2/question_builder.py` — LLM-powered question generation with deterministic fallback
  - Projects extracted from resume + weighted skill distribution
  - Ratio: 80% technical (project-based) + 20% behavioral
  
- **Phase 3** (Interview Runtime):
  - `ai_engine/phase3/question_flow.py` — adaptive question selection + dynamic time allocation
  - Stages: intro (easy), project (hard), HR (medium)

- **Services**:
  - `services/llm/client.py` — Groq LLM integration (skill extraction, answer scoring)
  - `services/practice.py` — practice kit generation
  - `services/resume_advice.py` — deterministic resume improvement suggestions
  - `services/jd_sync.py` — sync legacy jobs and JD config rows
  - `services/hr_dashboard.py` — analytics aggregation
  - `services/local_exports.py` — backup archive creation

---

## Key Features

### ✨ What's New / Recently Fixed

#### Resume Scoring (Phase 1)
- ✅ **Scorecard v2**: Stable 0-100 final score with component breakdown
- ✅ **Academic Cutoff**: Validates 10th, 12th, engineering % independently
- ✅ **Smart Education Matching**: Bachelor/Master/PhD rank-based validation
- ✅ **Weighted Skill Matching**: Skills ranked by JD importance
- ✅ Screening bands: `strong_shortlist` (≥80), `review_shortlist` (65-79), `reject` (<65)

#### Interview Workflow (Phase 3)
- ✅ **LLM Answer Scoring**: Groq-powered with local fallback (never "Pending forever")
- ✅ **llm_eval_status Tracking**: `pending` → `running` → `completed` / `failed`
- ✅ **Re-evaluation Endpoint**: HR can manually retry scoring after Groq outages
- ✅ **Graceful Transcription**: Empty transcript returned instead of HTTP 500 if Whisper unavailable
- ✅ **Atomic LLM Writes**: Both InterviewAnswer + InterviewQuestion updated in single flush

#### HR Decision Management
- ✅ **Dedicated Columns**: `hr_decision`, `hr_final_score`, `hr_behavioral_score`, `hr_communication_score`, `hr_notes`, `hr_red_flags`
- ✅ **No JSON Conflicts**: Prevents silent data loss from concurrent explanation edits
- ✅ **Backward Compatible**: Falls back to old JSON keys for existing rows

#### Authentication
- ✅ **New Endpoints**:
  - `PUT /api/auth/profile` — update display name
  - `POST /api/auth/change-password` — change password with verification
  - `GET /api/health/groq` — Groq API status (shows if LLM/Whisper available)

#### Proctoring
- ✅ **OpenCV Frame Analysis**: Face detection, motion tracking, shoulder visibility
- ✅ **Baseline Capture**: Prevents re-capture on reconnect
- ✅ **Pause on Warnings**: Optional enforcement (PROCTOR_PAUSE_ENABLED env var)
- ✅ **Periodic Snapshots**: Configurable interval for suspicious events only

---

## Feature Overview

### Candidate Flow

1. **Sign up** → log in → persist session via cookies
2. **View active JDs** → select target JD
3. **Upload resume** → get:
   - Explainable resume score (v2) with reasoning
   - Matched & missing skills
   - Resume rewrite guidance
4. **Schedule interview** after shortlist → receive emailed interview link
5. **Practice mode** → timed interview with generated questions
6. **Live interview** with:
   - Candidate authentication
   - Per-question time limits
   - Local Groq Whisper transcription
   - Webcam baseline capture + proctoring events
7. **Submit** → answers auto-scored by LLM (with local fallback)

### HR Flow

1. **Create company account** → manage JD inventory
2. **Upload JD file** → confirm skill weights & tune:
   - Qualify score cutoff
   - Min academic percentage
   - Question count & ratio
3. **View HR dashboard**:
   - Shortlist pipeline (applied → shortlisted → scheduled → completed)
   - Analytics (avg score, shortlist rate, completion rate, top skills)
   - Skill gaps & matched/missing breakdown
4. **Candidate manager**:
   - Search by UID, name, email, status
   - View skill-gap details
   - Download local backup archive
   - Delete candidates (soft delete + resume cleanup)
5. **Interview review**:
   - View session timeline + proctoring events
   - Score breakdown per answer (relevance, completeness, clarity, time fit)
   - Enter HR final decision + behavioral & communication scores
   - **Re-trigger LLM scoring** if Groq was down (new endpoint)
6. **Export** → zip archive with DB snapshot + uploads

---

## Requirements

- Python 3.10+
- Node.js LTS
- npm
- **Groq API Key** (for LLM + Whisper; optional but recommended)

---

## Environment Variables

Create a `.env` file in project root (optional; sensible defaults provided):

```env
# Database
DATABASE_URL=sqlite:///./interview_bot.db

# Authentication
SECRET_KEY=replace_with_a_long_random_secret_key

# Groq API (required for LLM features)
GROQ_API_KEY=your_groq_api_key_here
GROQ_LLM_MODEL=llama-3.1-8b-instant
GROQ_WHISPER_MODEL=whisper-large-v3-turbo

# Speech-to-Text (optional overrides for local Whisper)
WHISPER_MODEL_SIZE=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_BEAM_SIZE=1
WHISPER_VAD_FILTER=true

# Email (required for interview scheduling emails)
EMAIL_ADDRESS=your_email@gmail.com
EMAIL_PASSWORD=your_app_password

# Frontend
FRONTEND_URL=http://localhost:5173

# Proctoring (optional)
PROCTOR_PAUSE_ENABLED=false  # Set true to enforce pause on repeated violations
```

**Notes**:
- For Gmail: Use [App Password](https://support.google.com/accounts/answer/185833), not your main password
- Groq key: Get from [console.groq.com](https://console.groq.com)
- First transcription request may download Whisper model (~3GB)
- If model download blocked, set `WHISPER_MODEL_PATH` to local Faster Whisper dir

---

## Quick Start

### 1. Backend Setup

```bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. Frontend Setup

```bash
cd interview-frontend
npm install
cd ..
```

### 3. Run Backend

```bash
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Health check: `http://127.0.0.1:8000/health`

### 4. Run Frontend

```bash
cd interview-frontend
npm run dev
```

Frontend URL: `http://localhost:5173`

---

## API Surface

**Main router**: `routes/api_routes.py`

### Health & System

- `GET /health` — basic health check
- `GET /api/health/groq` — Groq API status (tells if LLM/Whisper available)

### Authentication

- `POST /api/auth/signup` — register candidate or HR
- `POST /api/auth/login` — session-based login
- `POST /api/auth/logout` — clear session
- `GET /api/auth/me` — current user profile
- `PUT /api/auth/profile` — **NEW** update display name
- `POST /api/auth/change-password` — **NEW** change password

### Candidate Endpoints

- `GET /api/candidate/dashboard` — candidate overview with current result
- `GET /api/candidate/jds` — list active JDs
- `POST /api/candidate/select-jd` — select target JD
- `GET /api/candidate/skill-match/{job_id}` — matched vs missing skills
- `POST /api/candidate/upload-resume` — upload + auto-score
- `POST /api/candidate/select-interview-date` — schedule interview
- `GET /api/candidate/practice-kit` — timed practice questions

### HR Endpoints

#### JD Management
- `POST /api/hr/jds` — create new JD config
- `GET /api/hr/jds` — list owned JDs
- `GET /api/hr/jds/{jd_id}` — fetch one JD
- `PUT /api/hr/jds/{jd_id}` — update JD (weights, qualify score, etc.)
- `DELETE /api/hr/jds/{jd_id}` — delete JD (if no applications)

#### Candidate Management
- `GET /api/hr/dashboard` — shortlist pipeline + analytics
- `GET /api/hr/candidates` — paginated search with filters
- `GET /api/hr/candidates/{candidate_uid}` — full candidate detail + skill gap
- `GET /api/hr/candidates/{candidate_uid}/skill-gap` — matched vs missing for JD
- `POST /api/hr/candidates/{candidate_uid}/delete` — delete candidate + cleanup
- `POST /api/hr/candidate/{candidate_id}/generate-questions` — generate interview questions

#### JD Upload Flow
- `POST /api/hr/upload-jd` — upload JD file → extract skills
- `POST /api/hr/confirm-jd` — confirm weights → create JD + score candidates
- `POST /api/hr/update-skill-weights` — adjust weights → recalculate scores

#### Interview Review
- `GET /api/hr/interviews` — list all completed sessions with LLM status
- `GET /api/hr/interviews/{interview_id}` — session detail + answer scores + proctoring timeline
- `POST /api/hr/interviews/{interview_id}/finalize` — enter HR decision (selected/rejected) + scores
- `POST /api/hr/interviews/{interview_id}/re-evaluate` — **NEW** retry LLM scoring
- `GET /api/hr/proctoring/{session_id}` — proctoring event timeline + snapshots

#### Analytics & Export
- `POST /api/hr/interview-score` — compute final score (resume + technical)
- `GET /api/hr/local-backup` — download zip archive (DB + uploads)

### Interview Runtime

- `GET /api/interview/{result_id}` — legacy redirect to SPA
- `POST /api/interview/start` — start new session + first question
- `POST /api/interview/answer` — submit answer → next question
- `POST /api/interview/transcribe` — send audio → get transcript
- `POST /api/interview/{token}/event` — log custom events
- `POST /api/interview/{session_id}/evaluate` — score all answers (called after interview ends)
- `POST /proctor/frame` — upload webcam frame → proctoring analysis

---

## Project Structure

```
.
├── ai_engine/
│   ├── phase1/
│   │   ├── matching.py      (text extraction, semantic score, skill match)
│   │   └── scoring.py        (resume scorecard v2, answer rubric)
│   ├── phase2/
│   │   └── question_builder.py (LLM question generation + fallback)
│   └── phase3/
│       └── question_flow.py   (adaptive question selection)
├── docs/
│   └── PHASE_MAP.md
├── interview-frontend/       (React 19 + Vite — THE active frontend)
│   ├── src/
│   └── vite.config.js
├── routes/
│   ├── auth/
│   │   └── sessions.py       (signup, login, profile, password, Groq health)
│   ├── candidate/
│   │   └── workflow.py       (dashboard, JD selection, resume, practice, schedule)
│   ├── hr/
│   │   ├── management.py     (JD CRUD, candidate search, question generation)
│   │   └── interview_review.py (interview detail, finalization, **re-evaluation**)
│   ├── interview/
│   │   ├── runtime.py        (session start, answer submit, transcription, proctoring)
│   │   └── evaluation.py     (post-interview LLM scoring with fallback)
│   ├── api_routes.py         (router aggregator)
│   ├── common.py             (shared helpers)
│   ├── dependencies.py       (auth middleware)
│   └── schemas.py            (request bodies)
├── services/
│   ├── llm/
│   │   └── client.py         (Groq LLM skill extraction + answer scoring)
│   ├── practice.py
│   ├── resume_advice.py
│   ├── jd_sync.py
│   ├── hr_dashboard.py
│   └── local_exports.py
├── utils/
│   ├── email_service.py      (SMTP interview emails)
│   ├── proctoring_cv.py      (OpenCV frame analysis)
│   ├── scoring.py            (answer summarization)
│   └── stt_whisper.py        (Groq Whisper transcription)
├── tests/
│   ├── test_phase1_api.py    (end-to-end resume + interview flow)
│   └── test_phase1_scoring.py (scorecard + answer rubric)
├── auth.py                   (password hashing, JWT tokens)
├── database.py               (SQLAlchemy engine + session)
├── models.py                 (ORM: Candidate, HR, Result, InterviewSession, etc.)
├── main.py                   (FastAPI entrypoint + startup hooks)
└── requirements.txt
```

---

## Workflow Summary

### Phase 1: Resume Screening

1. HR uploads JD → AI extracts skills + weights
2. Candidate uploads resume → AI scores resume (v2):
   - Semantic similarity to JD (30%)
   - Skill match against weights (25%)
   - Experience check (15%)
   - Education rank check (10%)
   - Academic % validation (5%)
   - Resume quality (5%)
3. **Result**: Screening band (strong/review/reject) + explanations
4. If shortlisted → eligible for interview

### Phase 2: Question Generation

1. HR triggers question generation for candidate
2. AI extracts projects from resume + selects top 3
3. Generates 80/20 split: **80% project-based** (weighted by JD skills), **20% behavioral** (HR questions)
4. LLM-powered with deterministic fallback (no Groq = still works)
5. Questions stored in `candidates.questions_json`

### Phase 3: Interview Runtime

1. **Pre-Check**: Consent → baseline webcam capture → frame quality check
2. **Interview Start**: Session created, first question fetched
3. **Per Question**:
   - Answer submitted (text or transcribed audio)
   - Local rubric score computed immediately (relevance, completeness, clarity, time fit)
   - Time-based scoring adjustment
4. **Session End**: All answers marked for LLM evaluation
5. **LLM Scoring** (async or on-demand):
   - Groq scores each answer (question relevance + depth)
   - If Groq unavailable → local rubric score used (no "Pending" stuck state)
   - Scores stored in both InterviewAnswer + InterviewQuestion (atomic flush)
6. **HR Review**:
   - View all answers + scores + proctoring timeline
   - Enter HR decision (selected/rejected) + behavioral/communication scores
   - **Can re-trigger LLM scoring** if needed

### Proctoring Events

- **Baseline**: Face capture at start (no re-capture on reconnect)
- **Periodic**: Save snapshots every 10s if frame is clean
- **Violations**: No face, multi-face, face mismatch, shoulder missing, high motion → warning
- **Pause**: After 3 warnings, session paused for 60s (if PROCTOR_PAUSE_ENABLED)
- **HR Timeline**: View all events + snapshots + violation counts

---

## Tests

Backend tests live in `tests/` using `unittest`.

```bash
python -m unittest discover -s tests -p "test_*.py"
```

**Coverage**:
- Phase 1: resume scoring, skill matching, academic cutoff
- Phase 2: question generation (LLM + fallback)
- Phase 3: interview start, answer submission, session completion
- HR workflows: candidate search, skill-gap, interview review, candidate deletion
- Resume upload → interview → HR finalization end-to-end flow

---

## Operational Notes

### Startup
- `main.py` runs `ensure_schema()` to backfill columns on existing SQLite DBs (non-breaking)
- SentenceTransformer model preloaded at startup (avoids 10s cold start on first resume)
- Groq API key checked at startup → warning logged if missing
- All routes require session cookie set by `/api/auth/login`

### CORS
- Configured for `http://localhost:5173` and `http://127.0.0.1:5173`
- Change in `main.py` for production

### Uploads
- Backend serves `/uploads/*` for resumes + proctoring snapshots
- Files stored with candidate ID + UUID for uniqueness
- Safe cleanup on candidate delete

### Database
- Supports SQLite (default) and PostgreSQL (via DATABASE_URL)
- Schema auto-migrates on startup
- Unique constraint: one interview attempt per (candidate, JD) pair

---

## Troubleshooting

### `ECONNREFUSED 127.0.0.1:8000` from Vite

**Solution**: Backend not running or failed startup
- Check `http://127.0.0.1:8000/health` returns `{"ok": true}`
- Review terminal for startup errors (missing env vars, schema errors)
- Restart backend: `python -m uvicorn main:app --reload`

### Interview page cannot start

**Causes**:
- Candidate not logged in → check session cookie
- Result doesn't exist → verify resume was uploaded & shortlisted
- Backend unreachable → check `http://127.0.0.1:8000/health`

**If email link used**: Verify `FRONTEND_URL` env var matches current frontend host

### No interview email received

**Checklist**:
- `EMAIL_ADDRESS` and `EMAIL_PASSWORD` set in `.env`
- Using Gmail? → Use [App Password](https://support.google.com/accounts/answer/185833), not main password
- Check spam/promotions folder
- Review backend logs for SMTP errors

### Transcription returns empty transcript

**Cause**: Groq Whisper unavailable or audio quality too poor

**Solution**: Candidate can type answer instead (graceful fallback)
- Check Groq API status: `GET /api/health/groq`
- If degraded: verify `GROQ_API_KEY` is valid

### Answer scores show "Pending"

**Cause**: LLM evaluation job failed or timed out

**Solution (NEW)**: HR can manually re-trigger scoring
- Go to interview detail page
- Click **"Re-evaluate"** button
- Groq will re-score all answers in background
- Refresh page after ~30s to see scores

**If still pending**: 
- Check Groq API: `GET /api/health/groq`
- Local rubric fallback was used instead (scores will eventually populate)

### Resume re-upload wipes interview schedule

**Status**: ✅ FIXED (no longer happens)
- Interview date, link, token now preserved on resume re-upload
- Only cleared on first upload (when no schedule exists yet)

---

## Deployment Notes

### Pre-Production Checklist

- [ ] `SECRET_KEY` set to strong random value
- [ ] `GROQ_API_KEY` configured
- [ ] `EMAIL_ADDRESS` and `EMAIL_PASSWORD` set (Gmail App Password)
- [ ] `DATABASE_URL` points to production DB (PostgreSQL recommended)
- [ ] `FRONTEND_URL` set to production frontend domain
- [ ] CORS origins updated in `main.py`
- [ ] Run migrations: `python -m unittest discover -s tests -p "test_*.py"` (ensure schema)
- [ ] Test email delivery with a test interview schedule
- [ ] Test Groq API with `GET /api/health/groq`

### Production Database

- SQLite is development-only
- Use PostgreSQL for production:
  ```env
  DATABASE_URL=postgresql://user:password@host:5432/interview_bot
  ```

---

## About

**Interview Bot v2.0** — AI-powered recruitment platform with deterministic scoring, Groq LLM integration, and end-to-end interview workflows.

**Key Improvements in This Version**:
- Resume scorecard v2 (stable 0-100 with breakdowns)
- LLM answer scoring with local fallback (no stuck "Pending")
- Dedicated HR decision columns (no JSON conflicts)
- Re-evaluation endpoint for recovery after outages
- Graceful Groq error handling (transcription, LLM scoring)
- Atomic database writes (no partial updates)
- Profile & password management endpoints
- Enhanced proctoring (baseline, pause enforcement, periodic snapshots)
