# AI Interview Platform

An AI-driven interview platform with:
- FastAPI backend (API-only, session-based auth)
- React + Vite frontend
- Resume/JD matching
- Dynamic interview question flow
- Camera, microphone, and voice-input support for interview sessions

## Current Architecture

This project is now split into:

1. Backend (`main.py`, `routes/api_routes.py`)
- Serves JSON APIs under `/api/*`
- Handles authentication, candidate workflow, HR workflow, and interview flow
- Stores data in SQLite by default (`app.db`)

2. Frontend (`interview-frontend/`)
- React app served by Vite
- Uses Vite proxy to call backend APIs
- Includes candidate dashboard, HR dashboard, and interview page (`#/interview/:resultId?token=...`)

## Key Features

- Candidate and HR signup/login
- Candidate can:
  - Select company/JD
  - Upload resume for selected JD
  - View score and explanation
  - Schedule interview and receive interview link
- HR can:
  - Upload multiple JDs
  - Give custom JD title
  - Review and update skill weights per selected JD
  - View shortlisted candidates
- Interview flow:
  - Token-protected access
  - Session-based question progression (intro -> resume -> experience -> project -> system -> HR)
  - Voice input via browser SpeechRecognition API
  - Camera/mic preview and permissions

## Environment Variables

Create `.env` in project root:

```env
DATABASE_URL=sqlite:///./app.db
SECRET_KEY=replace_with_a_long_random_secret
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# Optional but recommended for richer question generation:
GROQ_API_KEY=

# Required for interview email sending:
EMAIL_ADDRESS=
EMAIL_PASSWORD=

# Optional frontend URL used in interview links sent by email:
FRONTEND_URL=http://localhost:5173
```

Notes:
- For Gmail, `EMAIL_PASSWORD` must be an App Password (not your normal account password).
- If `GROQ_API_KEY` is missing, interview question generation uses fallback behavior.

## Installation

### 1. Backend

```powershell
cd C:\Users\mohit\Documents\interview_bot_project
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. Frontend

```powershell
cd C:\Users\mohit\Documents\interview_bot_project\interview-frontend
npm install
```

## Run Locally

Open two terminals.

### Terminal A: Backend

```powershell
cd C:\Users\mohit\Documents\interview_bot_project
.\venv\Scripts\Activate.ps1
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Health check:

```text
http://127.0.0.1:8000/health
```

### Terminal B: Frontend

```powershell
cd C:\Users\mohit\Documents\interview_bot_project\interview-frontend
npm run dev
```

Frontend URL:

```text
http://localhost:5173
```

## API Overview

Main router: `routes/api_routes.py`

Auth:
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Candidate:
- `GET /api/candidate/dashboard`
- `POST /api/candidate/upload-resume`
- `POST /api/candidate/select-interview-date`

HR:
- `GET /api/hr/dashboard`
- `GET /api/hr/jobs`
- `POST /api/hr/upload-jd`
- `POST /api/hr/confirm-jd`
- `POST /api/hr/update-skill-weights`

Interview:
- `GET /api/interview/{result_id}?token=...`
- `POST /api/interview/next-question`

## Project Structure

```text
interview_bot_project/
├── ai_engine/
│   ├── matching.py
│   └── question_generator.py
├── routes/
│   └── api_routes.py
├── utils/
│   └── email_service.py
├── interview-frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── App.css
│   │   ├── index.css
│   │   └── services/api.js
│   └── vite.config.js
├── auth.py
├── database.py
├── main.py
├── models.py
├── requirements.txt
└── README.md
```

## Troubleshooting

1. `ECONNREFUSED 127.0.0.1:8000` in Vite logs
- Backend is not running or crashed.
- Restart backend and verify `http://127.0.0.1:8000/health`.

2. Voice input button does not work
- Use Chrome or Edge (best support for SpeechRecognition).
- Allow microphone permissions for `localhost`.
- Click `Enable Camera & Mic` before `Start Voice Input`.

3. Interview page shows request failures
- Ensure backend is running.
- Open interview link generated from candidate dashboard (valid token).

4. No interview email received
- Check `EMAIL_ADDRESS` and `EMAIL_PASSWORD` in `.env`.
- Verify Gmail App Password usage.
- Check spam/promotions folder.

## Notes

- Backend includes a lightweight schema backfill at startup for `jobs.jd_title` if missing.
- Session cookies are required for authenticated APIs.
- Uploaded files are saved under `uploads/`.
