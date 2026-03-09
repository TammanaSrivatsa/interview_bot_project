from datetime import datetime
from difflib import SequenceMatcher
import random
import re
from typing import Optional

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import JSONResponse
from openai import OpenAI
from sqlalchemy.orm import Session

from ai_engine.matching import extract_text_from_file
from ai_engine.question_generator import generate_dynamic_question, generate_llm_fallback_question
from database import SessionLocal
from models import Candidate, InterviewQuestion, InterviewSession, JobDescription, Result

router = APIRouter()
client = OpenAI()

INTERVIEW_DURATION = 20
MIN_RESUME_QUESTIONS = 2
MIN_HR_QUESTIONS = 2


def _normalize_question(text: str) -> str:
    cleaned = re.sub(r"[^a-z0-9\s]", " ", (text or "").lower())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _is_similar_question(new_q: str, previous_q: list[str], threshold: float = 0.50) -> bool:
    new_tokens = set(_normalize_question(new_q).split())
    if not new_tokens:
        return False

    for pq in previous_q:
        prev_tokens = set(_normalize_question(pq).split())
        if not prev_tokens:
            continue
        overlap = len(new_tokens & prev_tokens) / max(1, len(new_tokens | prev_tokens))
        if overlap >= threshold:
            return True
    return False


def _content_tokens(text: str) -> set[str]:
    stop = {
        "what", "why", "how", "when", "where", "which", "who", "do", "does", "did",
        "is", "are", "was", "were", "can", "could", "would", "should", "will", "you",
        "your", "the", "a", "an", "and", "or", "to", "of", "in", "for", "on", "with",
        "from", "that", "this", "it", "as", "at", "by", "about", "explain", "describe",
        "tell", "me", "through", "over", "under"
    }
    tokens = [t for t in _normalize_question(text).split() if len(t) > 2 and t not in stop]
    return set(tokens)


def _is_redundant_question(new_q: str, previous_q: list[str]) -> bool:
    new_norm = _normalize_question(new_q)
    new_content = _content_tokens(new_q)
    if not new_norm:
        return True

    for pq in previous_q:
        prev_norm = _normalize_question(pq)
        if not prev_norm:
            continue

        # Exact or near-exact wording repeat
        if new_norm == prev_norm:
            return True
        seq = SequenceMatcher(None, new_norm, prev_norm).ratio()
        if seq >= 0.86:
            return True

        # Same-meaning repeat by high content-token overlap
        prev_content = _content_tokens(pq)
        if not new_content or not prev_content:
            continue
        content_overlap = len(new_content & prev_content) / max(1, len(new_content | prev_content))
        if content_overlap >= 0.62:
            return True

    # Keep existing token-overlap guard for additional coverage
    return _is_similar_question(new_q, previous_q, threshold=0.50)


def _extract_resume_topics(resume_text: str) -> list[str]:
    text = resume_text or ""
    topics = []

    # Prefer explicit skill/technology sections without hard-coded technology vocab.
    skill_sections = re.findall(
        r"(TECHNICAL SKILLS|SKILLS|TECH STACK|TOOLS|TECHNOLOGIES)(.*?)(PROJECTS?|EXPERIENCE|EDUCATION|CERTIFICATIONS|ACHIEVEMENTS|$)",
        text,
        re.DOTALL | re.IGNORECASE,
    )
    body = skill_sections[0][1] if skill_sections else ""

    source = body if body.strip() else text
    for token in re.split(r"[\n,|/;•]+", source):
        clean = re.sub(r"\s+", " ", token).strip(" -*:\t\r")
        if len(clean) < 2 or len(clean) > 40:
            continue
        if re.search(r"\d{4}", clean):
            continue
        if clean.lower() in {"skills", "projects", "experience", "education", "certifications"}:
            continue
        topics.append(clean.lower())

    return list(dict.fromkeys(topics))[:120]


def _choose_anchor_topic(
    phase: str,
    concepts: dict,
    current_project: Optional[str],
    project_tech_map: dict,
    topic_question_count: dict,
    answer_topics: Optional[list[str]] = None,
    recent_anchor_topics: Optional[list[str]] = None,
):
    if phase == "hr":
        return "behavioral"

    project_topics = []
    if current_project and current_project in project_tech_map:
        project_topics = project_tech_map.get(current_project, []) or []

    answer_topics = answer_topics or []
    recent_anchor_topics = [t.lower() for t in (recent_anchor_topics or [])]
    resume_topics = list((concepts or {}).keys())

    # Prioritize candidate-mentioned technologies to make the interview reactive,
    # then blend in project and broader resume technologies for coverage.
    candidate_topics = list(dict.fromkeys(answer_topics + project_topics + resume_topics))
    if not candidate_topics:
        return "system design"

    for topic in candidate_topics:
        topic_question_count.setdefault(topic, 0)

    not_recent = [t for t in candidate_topics if t.lower() not in recent_anchor_topics[-5:]]
    selection_pool = not_recent or candidate_topics

    # Strongly prefer answer-mentioned topics when available and not recently repeated.
    answer_pool = [t for t in selection_pool if t in answer_topics]
    if answer_pool:
        min_count = min(topic_question_count.get(t, 0) for t in answer_pool)
        least_asked_answer = [t for t in answer_pool if topic_question_count.get(t, 0) == min_count]
        return random.choice(least_asked_answer)

    min_count = min(topic_question_count.get(t, 0) for t in selection_pool)
    least_asked = [t for t in selection_pool if topic_question_count.get(t, 0) == min_count]
    return random.choice(least_asked)


def _select_project_topic(projects: list[str], project_question_count: dict) -> Optional[str]:
    if not projects:
        return None

    for p in projects:
        project_question_count.setdefault(p, 0)

    min_count = min(project_question_count.get(p, 0) for p in projects)
    least_asked_projects = [p for p in projects if project_question_count.get(p, 0) == min_count]
    return random.choice(least_asked_projects)


def _extract_projects_and_techs(resume_text: str, resume_topics: list[str]):
    project_tech_map = {}
    projects = []

    project_section = re.findall(
        r"(PROJECTS?|ACADEMIC PROJECTS?|PROJECT EXPERIENCE)(.*?)(CERTIFICATIONS|EXTRACURRICULAR|SKILLS|EDUCATION|ACHIEVEMENTS|$)",
        resume_text or "",
        re.DOTALL | re.IGNORECASE,
    )

    section_body = project_section[0][1] if project_section else ""
    if not section_body:
        return projects, project_tech_map

    resume_lower = (resume_text or "").lower()
    resume_techs = [tech for tech in resume_topics if re.search(r"\b" + re.escape(tech) + r"\b", resume_lower)]
    raw_lines = [ln.rstrip() for ln in section_body.split("\n") if ln.strip()]
    blocks: list[tuple[str, str]] = []
    current_title = None
    current_text: list[str] = []

    for raw in raw_lines:
        stripped = raw.strip()
        clean = re.sub(r"^\s*[-*•]+\s*", "", stripped)
        low = clean.lower()
        is_bullet = bool(re.match(r"^\s*[-*•]", raw))
        looks_like_title = (
            not is_bullet
            and 5 <= len(clean) <= 110
            and "." not in clean
            and not re.match(r"^(developed|implemented|designed|built|worked|responsible|created|used|integrated)\b", low)
        )

        if looks_like_title:
            if current_title and current_text:
                blocks.append((current_title, "\n".join(current_text)))
            current_title = re.sub(r"\s+", " ", clean).strip()
            current_text = [clean]
            continue

        if not current_title:
            current_title = re.sub(r"\s+", " ", clean).strip()[:110]
        current_text.append(clean)

    if current_title and current_text:
        blocks.append((current_title, "\n".join(current_text)))

    if not blocks:
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", section_body) if p.strip()]
        for para in paragraphs:
            lines = [ln.strip(" -*\t\r") for ln in para.split("\n") if ln.strip()]
            if not lines:
                continue
            blocks.append((re.sub(r"\s+", " ", lines[0]).strip(), para))

    for idx, (title, block_text) in enumerate(blocks):
        if len(title) > 120:
            title = title[:117].rstrip() + "..."
        if len(title) < 5:
            continue

        block_lower = block_text.lower()
        techs = [tech for tech in resume_topics if re.search(r"\b" + re.escape(tech) + r"\b", block_lower)]
        if not techs and resume_techs:
            start = (idx * 3) % len(resume_techs)
            rolled = resume_techs[start:] + resume_techs[:start]
            techs = rolled[:6]

        projects.append(title)
        project_tech_map[title] = list(dict.fromkeys(techs))[:10]

    return list(dict.fromkeys(projects)), project_tech_map


def _select_project_round_robin(projects: list[str], project_order: list[str], project_question_index: int) -> Optional[str]:
    if not projects:
        return None
    ordered = [p for p in (project_order or []) if p in projects]
    if not ordered:
        ordered = projects[:]
    return ordered[project_question_index % len(ordered)]


def _select_project_for_coverage(
    projects: list[str],
    project_order: list[str],
    project_question_count: dict,
    project_question_index: int,
) -> Optional[str]:
    if not projects:
        return None
    ordered = [p for p in (project_order or []) if p in projects] or projects[:]
    uncovered = [p for p in ordered if project_question_count.get(p, 0) == 0]
    pool = uncovered or ordered
    return pool[project_question_index % len(pool)]


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _ensure_interview_session(db: Session, result: Result) -> InterviewSession:
    session = (
        db.query(InterviewSession)
        .filter(InterviewSession.candidate_id == result.candidate_id)
        .filter(InterviewSession.job_id == result.job_id)
        .order_by(InterviewSession.id.desc())
        .first()
    )

    if not session:
        session = InterviewSession(
            candidate_id=result.candidate_id,
            job_id=result.job_id,
            status="scheduled" if result.interview_date else "not_started",
        )
        db.add(session)
        db.commit()
        db.refresh(session)

    return session


def _append_timeline(request: Request, event: str):
    timeline = request.session.get("timeline", [])
    timeline.append({"event": event, "time": datetime.now().isoformat()})
    request.session["timeline"] = timeline


@router.get("/interview/{result_id}")
def interview_page(
    result_id: int,
    request: Request,
    token: Optional[str] = None,
    db: Session = Depends(get_db),
):
    result = db.query(Result).filter(Result.id == result_id).first()
    if not result or not token or token != result.interview_token or not result.shortlisted:
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    candidate = db.query(Candidate).filter(Candidate.id == result.candidate_id).first()
    job = db.query(JobDescription).filter(JobDescription.id == result.job_id).first()
    if not candidate or not job:
        return JSONResponse(status_code=404, content={"error": "Not found"})

    interview_session = _ensure_interview_session(db, result)
    if interview_session.status == "not_started":
        interview_session.status = "scheduled"
        db.commit()

    request.session.clear()
    request.session["result_id"] = result.id
    request.session["interview_session_id"] = interview_session.id

    return JSONResponse(
        {
            "candidate_name": candidate.name,
            "interview_duration": INTERVIEW_DURATION,
            "result_id": result.id,
        }
    )


@router.post("/generate-next-question")
def generate_next_question(
    request: Request,
    result_id: int = Form(...),
    last_answer: str = Form(""),
    db: Session = Depends(get_db),
):
    result = db.query(Result).filter(Result.id == result_id).first()
    if not result:
        return {"question": "Interview session error."}

    candidate = db.query(Candidate).filter(Candidate.id == result.candidate_id).first()
    job = db.query(JobDescription).filter(JobDescription.id == result.job_id).first()
    if not candidate or not job:
        return {"question": "Interview session error."}

    interview_session = _ensure_interview_session(db, result)

    if request.session.get("interview_initialized") is None:
        request.session["interview_initialized"] = True
        request.session["interview_start"] = datetime.now().isoformat()
        request.session["result_id"] = result_id
        request.session["interview_session_id"] = interview_session.id

        request.session["asked_questions"] = ""
        request.session["projects"] = []
        request.session["project_order"] = []
        request.session["covered_projects"] = []
        request.session["project_question_count"] = {}
        request.session["phase"] = "intro"
        request.session["followup_depth"] = 0
        request.session["current_topic"] = None
        request.session["question_count"] = 0
        request.session["topic_question_count"] = {}
        request.session["project_question_index"] = 0
        request.session["resume_question_count"] = 0
        request.session["hr_question_count"] = 0
        request.session["project_total_question_count"] = 0

        request.session["timeline"] = []
        request.session["violations"] = []
        request.session["last_question_id"] = None
        request.session["last_question_text"] = None
        request.session["last_answer_topics"] = []
        request.session["recent_anchor_topics"] = []
        request.session["clarify_count"] = 0

        # A new run for the same candidate/job should replace old transcript data.
        db.query(InterviewQuestion).filter(
            InterviewQuestion.interview_id == interview_session.id
        ).delete(synchronize_session=False)

        interview_session.status = "in_progress"
        interview_session.started_at = datetime.now()
        interview_session.ended_at = None
        interview_session.completed = False
        interview_session.abandoned = False
        interview_session.suspicious_activity = False

        result.interview_start_time = interview_session.started_at.isoformat()
        result.interview_end_time = None
        result.interview_abandoned = False
        db.commit()

        _append_timeline(request, "Interview started")

    # Persist answer for previous question, if available
    last_question_id = request.session.get("last_question_id")
    if last_question_id and last_answer.strip():
        prev_q = db.query(InterviewQuestion).filter(InterviewQuestion.id == last_question_id).first()
        if prev_q:
            prev_q.answer_text = last_answer.strip()
            db.commit()
            _append_timeline(request, "Candidate answered a question")

    interview_start = request.session.get("interview_start")
    if not interview_start:
        return {"question": "INTERVIEW_COMPLETE"}

    elapsed_minutes = (datetime.now() - datetime.fromisoformat(interview_start)).total_seconds() / 60
    if elapsed_minutes >= INTERVIEW_DURATION:
        return {"question": "INTERVIEW_COMPLETE"}

    remaining_minutes = INTERVIEW_DURATION - elapsed_minutes
    max_depth = 2 if remaining_minutes > 5 else (1 if remaining_minutes > 2 else 0)

    asked_questions = request.session.get("asked_questions", "")
    question_count = request.session.get("question_count", 0)
    phase = request.session.get("phase")
    followup_depth = request.session.get("followup_depth", 0)
    current_topic = request.session.get("current_topic")
    last_question_text = request.session.get("last_question_text") or "your previous answer"

    # Real-interviewer behavior: ask for elaboration if response is too short/unclear.
    answer_tokens = [w for w in re.findall(r"[a-zA-Z0-9+#./-]+", (last_answer or "").strip()) if w]
    if answer_tokens:
        clarify_count = request.session.get("clarify_count", 0)
        if len(answer_tokens) < 8 and clarify_count < 1:
            clarification = (
                "Could you elaborate on that with a concrete example from one project, "
                "including your role, technical decisions, and final outcome?"
            )
            request.session["clarify_count"] = clarify_count + 1

            existing = request.session.get("asked_questions", "")
            request.session["asked_questions"] = f"{existing}\n{clarification}".strip() if existing else clarification
            request.session["question_count"] = question_count + 1

            q = InterviewQuestion(interview_id=interview_session.id, question_text=clarification)
            db.add(q)
            db.commit()
            db.refresh(q)

            request.session["last_question_id"] = q.id
            request.session["last_question_text"] = clarification
            _append_timeline(request, "Clarification question asked")
            return {"question": clarification}
        elif len(answer_tokens) >= 8:
            request.session["clarify_count"] = 0

    if phase == "intro":
        request.session["phase"] = "resume"
        intro = (
            "Introduce yourself. Explain your academic background, "
            "work experience, technical strengths, and key projects."
        )
        request.session["asked_questions"] = intro

        q = InterviewQuestion(interview_id=interview_session.id, question_text=intro)
        db.add(q)
        db.commit()
        db.refresh(q)
        request.session["last_question_id"] = q.id
        request.session["last_question_text"] = intro
        _append_timeline(request, "Question asked")
        return {"question": intro}

    jd_text = extract_text_from_file(job.jd_text)
    resume_text = extract_text_from_file(candidate.resume_path or "")
    resume_lower = resume_text.lower()
    resume_topics = _extract_resume_topics(resume_text)

    if not request.session["projects"]:
        extracted_projects, extracted_project_tech_map = _extract_projects_and_techs(resume_text, resume_topics)
        request.session["projects"] = extracted_projects
        request.session["project_tech_map"] = extracted_project_tech_map
        if extracted_projects:
            shuffled = extracted_projects[:]
            random.shuffle(shuffled)
            request.session["project_order"] = shuffled

    projects = request.session.get("projects", [])
    project_order = request.session.get("project_order", [])
    project_question_count = request.session.get("project_question_count", {})
    topic_question_count = request.session.get("topic_question_count", {})
    project_question_index = request.session.get("project_question_index", 0)
    resume_question_count = request.session.get("resume_question_count", 0)
    hr_question_count = request.session.get("hr_question_count", 0)

    concepts = {}
    for tech in resume_topics:
        if re.search(r"\b" + re.escape(tech) + r"\b", resume_lower):
            concepts[tech] = True

    if not request.session.get("project_tech_map"):
        extracted_projects, extracted_project_tech_map = _extract_projects_and_techs(resume_text, resume_topics)
        if extracted_projects and not projects:
            projects = extracted_projects
            request.session["projects"] = projects
        project_tech_map = extracted_project_tech_map
    else:
        project_tech_map = request.session.get("project_tech_map", {})

    # Backfill per-project technologies when parsing produced sparse stacks.
    resume_techs = [tech for tech in resume_topics if re.search(r"\b" + re.escape(tech) + r"\b", resume_lower)]
    for idx, project in enumerate(projects):
        existing = project_tech_map.get(project, [])
        if not existing:
            if resume_techs:
                start = (idx * 3) % len(resume_techs)
                rolled = resume_techs[start:] + resume_techs[:start]
                project_tech_map[project] = rolled[:6]
            else:
                project_tech_map[project] = []
    request.session["project_tech_map"] = project_tech_map

    if projects and not project_order:
        shuffled = projects[:]
        random.shuffle(shuffled)
        project_order = shuffled
        request.session["project_order"] = project_order

    last_answer_topics = []
    last_answer_lower = (last_answer or "").lower()
    for tech in resume_topics:
        if re.search(r"\b" + re.escape(tech) + r"\b", last_answer_lower):
            last_answer_topics.append(tech)
    request.session["last_answer_topics"] = list(dict.fromkeys(last_answer_topics))

    # Time-first scheduling with minimum quotas:
    # 1) Start with 2 resume-tech basics
    # 2) Use remaining middle time mostly for project questions
    # 3) Reserve final time window for 2 HR/general questions
    if resume_question_count < MIN_RESUME_QUESTIONS:
        request.session["phase"] = "resume"
    else:
        remaining_hr_needed = max(0, MIN_HR_QUESTIONS - hr_question_count)
        if remaining_hr_needed > 0:
            # Estimate average minutes per asked question and reserve time for pending HR questions.
            avg_minutes_per_question = (
                elapsed_minutes / max(1, question_count) if question_count > 0 else 2.0
            )
            # Keep a practical reserve so HR questions can happen at the end even with variable pace.
            hr_time_reserve = max(2.0, remaining_hr_needed * avg_minutes_per_question)
            if remaining_minutes <= hr_time_reserve:
                request.session["phase"] = "hr"
            else:
                request.session["phase"] = "project" if projects else "resume"
        else:
            request.session["phase"] = "project" if projects else "resume"

    phase = request.session["phase"]
    stage = "basics"
    current_project = None

    if phase == "resume":
        stage = "basics"
    elif phase == "project":
        stage = "advanced_projects"
    elif phase == "hr":
        stage = "hr"

    if phase == "project":
        current_project = _select_project_for_coverage(
            projects=projects,
            project_order=project_order,
            project_question_count=project_question_count,
            project_question_index=project_question_index,
        )
        request.session["current_topic"] = current_project

    question = None
    if phase == "project" and projects and len(projects) > 1 and (project_question_index % 5 == 4):
        # Periodic cross-project dynamic question
        p1 = _select_project_for_coverage(
            projects=projects,
            project_order=project_order,
            project_question_count=project_question_count,
            project_question_index=project_question_index,
        )
        p2_candidates = [p for p in projects if p != p1]
        p2 = random.choice(p2_candidates) if p2_candidates else p1
        anchor_topic = f"cross-project: {p1} + {p2}"
    else:
        anchor_topic = _choose_anchor_topic(
            phase=phase,
            concepts=concepts,
            current_project=current_project,
            project_tech_map=request.session.get("project_tech_map", {}),
            topic_question_count=topic_question_count,
            answer_topics=request.session.get("last_answer_topics", []),
            recent_anchor_topics=request.session.get("recent_anchor_topics", []),
        )
    previous_questions = [q.strip() for q in asked_questions.split("\n") if q.strip()]

    for _ in range(8):
        try:
            question = generate_dynamic_question(
                jd_text=jd_text,
                resume_text=resume_text,
                last_answer=last_answer,
                stage=stage,
                asked_questions=asked_questions,
                remaining_time_minutes=remaining_minutes,
                current_project=current_project,
                concepts=concepts,
                projects=projects,
                project_tech_map=request.session.get("project_tech_map", {}),
                anchor_topic=anchor_topic,
                last_question=request.session.get("last_question_text"),
                answer_topics=request.session.get("last_answer_topics", []),
            )
        except Exception:
            question = None

        if question:
            if _is_redundant_question(question, previous_questions):
                question = None
                # Shift anchor when duplicate meaning is detected to force topic movement.
                anchor_topic = _choose_anchor_topic(
                    phase=phase,
                    concepts=concepts,
                    current_project=current_project,
                    project_tech_map=request.session.get("project_tech_map", {}),
                    topic_question_count=topic_question_count,
                    answer_topics=request.session.get("last_answer_topics", []),
                    recent_anchor_topics=(request.session.get("recent_anchor_topics", []) + [anchor_topic]),
                )
                continue
            break

    if not question or len(question.strip()) < 5:
        question = generate_llm_fallback_question(
            jd_text=jd_text,
            resume_text=resume_text,
            asked_questions=asked_questions,
            last_answer=last_answer,
            anchor_topic=anchor_topic,
            current_project=current_project,
        )

    if question and _is_redundant_question(question, previous_questions):
        question = None

    if not question or len(question.strip()) < 5:
        project_hint = current_project or "your project"
        topic_hint = anchor_topic or (resume_topics[0] if resume_topics else "the technology you used")
        question = (
            f"In {project_hint}, why did you choose {topic_hint} over alternatives, "
            "and what tradeoff did that decision create?"
        )

    existing = request.session.get("asked_questions", "")
    request.session["asked_questions"] = f"{existing}\n{question}".strip() if existing else question

    if current_project:
        project_question_count[current_project] = project_question_count.get(current_project, 0) + 1
        request.session["project_question_count"] = project_question_count
    if phase == "project":
        request.session["project_question_index"] = project_question_index + 1
        request.session["project_total_question_count"] = request.session.get("project_total_question_count", 0) + 1
    elif phase == "resume":
        request.session["resume_question_count"] = resume_question_count + 1
    elif phase == "hr":
        request.session["hr_question_count"] = hr_question_count + 1

    request.session["question_count"] = question_count + 1
    topic_question_count[anchor_topic] = topic_question_count.get(anchor_topic, 0) + 1
    request.session["topic_question_count"] = topic_question_count
    recent_anchor_topics = request.session.get("recent_anchor_topics", [])
    recent_anchor_topics.append(anchor_topic)
    request.session["recent_anchor_topics"] = recent_anchor_topics[-8:]

    q = InterviewQuestion(interview_id=interview_session.id, question_text=question)
    db.add(q)
    db.commit()
    db.refresh(q)

    request.session["last_question_id"] = q.id
    request.session["last_question_text"] = question
    _append_timeline(request, "Question asked")

    return {"question": question}


@router.post("/log-violation")
async def log_violation(request: Request):
    data = await request.json()
    reason = (data or {}).get("reason", "Unspecified violation")
    violations = request.session.get("violations", [])
    violations.append({"reason": reason, "time": datetime.now().isoformat()})
    request.session["violations"] = violations
    _append_timeline(request, f"Violation: {reason}")
    return {"status": "logged"}


@router.post("/complete-interview")
async def complete_interview(request: Request, db: Session = Depends(get_db)):
    data = await request.json()
    result_id = data.get("result_id")
    if not result_id:
        return JSONResponse(status_code=400, content={"error": "Missing result_id"})

    result = db.query(Result).filter(Result.id == result_id).first()
    if not result:
        return JSONResponse(status_code=404, content={"error": "Result not found"})

    interview_session = _ensure_interview_session(db, result)
    now = datetime.now()
    if not interview_session.started_at:
        interview_session.started_at = now
    interview_session.ended_at = now

    status = data.get("status", "completed")
    interview_session.status = status
    interview_session.completed = status == "completed"
    interview_session.abandoned = status != "completed"

    # Persist pending answer if interview ends before next question fetch.
    pending_answer = (data.get("last_answer") or "").strip()
    last_question_id = request.session.get("last_question_id")
    if last_question_id and pending_answer:
        prev_q = db.query(InterviewQuestion).filter(InterviewQuestion.id == last_question_id).first()
        if prev_q and (not (prev_q.answer_text or "").strip()):
            prev_q.answer_text = pending_answer
            _append_timeline(request, "Candidate answered final question")

    incoming_violations = data.get("violations", []) or []
    session_violations = request.session.get("violations", []) or []
    all_violations = session_violations + incoming_violations
    interview_session.suspicious_activity = len(all_violations) > 0

    if interview_session.started_at and interview_session.ended_at:
        duration_sec = int((interview_session.ended_at - interview_session.started_at).total_seconds())
    else:
        duration_sec = 0

    result.interview_start_time = interview_session.started_at.isoformat() if interview_session.started_at else None
    result.interview_end_time = interview_session.ended_at.isoformat() if interview_session.ended_at else None
    result.interview_abandoned = interview_session.abandoned

    existing_explanation = result.explanation if isinstance(result.explanation, dict) else {}
    if not existing_explanation:
        existing_explanation = {}

    report_timeline = request.session.get("timeline", []) or data.get("timeline", []) or []

    existing_explanation["interview_report"] = {
        "timeline": report_timeline,
        "violations": all_violations,
        "duration_seconds": duration_sec,
        "status": interview_session.status,
    }
    result.explanation = existing_explanation

    db.commit()
    request.session.clear()

    return JSONResponse({"success": True})
