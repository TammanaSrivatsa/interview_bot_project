# Phase-Wise Code Map

Use this map to explain the project quickly in demos/interviews.

## Folder View (backend)

```
ai_engine/
  phase1/
    matching.py
    scoring.py
  phase2/
    question_builder.py
  phase3/
    question_flow.py

routes/
  auth/sessions.py
  candidate/workflow.py
  hr/management.py
  hr/interview_review.py
  interview/runtime.py
```

## Phase 1: Resume Screening + JD Selection

- APIs:
  - `routes/candidate/workflow.py`
  - `routes/hr/management.py`
- Logic:
  - `ai_engine/phase1/matching.py`
  - `ai_engine/phase1/scoring.py`
- Data models:
  - `models.py` (`JobDescription`, `JobDescriptionConfig`, `Result`, `Candidate`)

## Phase 2: Dynamic Question Generation

- API trigger:
  - `POST /api/hr/candidate/{candidate_id}/generate-questions`
  - file: `routes/hr/management.py`
- Logic:
  - `ai_engine/phase2/question_builder.py`

## Phase 3: Interview Runtime + Proctoring

- APIs:
  - `routes/interview/runtime.py`
  - `routes/hr/interview_review.py`
- Adaptive question flow:
  - `ai_engine/phase3/question_flow.py`
- Frontend:
  - `interview-frontend/src/pages/PreCheck.jsx`
  - `interview-frontend/src/pages/Interview.jsx`
- Proctoring helpers:
  - `utils/proctoring_cv.py`

## Shared Infrastructure

- Entrypoint: `main.py`
- Router aggregator: `routes/api_routes.py`
- DB/session wiring: `database.py`
- ORM models: `models.py`
- Auth helpers: `auth.py`
