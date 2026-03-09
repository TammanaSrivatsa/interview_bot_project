import os
import random
import re

from dotenv import load_dotenv
from groq import Groq

load_dotenv()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))


def _stage_focus(stage: str) -> str:
    if stage == "advanced_projects":
        return (
            "Project deep-dive only: implementation internals, architecture tradeoffs, production incidents, "
            "debugging stories, scaling and reliability design."
        )
    if stage == "deep_dive":
        return (
            "System design round: distributed systems, resilience, data consistency, latency/cost tradeoffs, "
            "capacity planning, observability and operations."
        )
    if stage == "hr":
        return (
            "Behavioral and general round: ownership, conflict resolution, learning mindset, prioritization, "
            "stakeholder management, communication clarity, ethics."
        )
    return "Technical fundamentals tied to candidate resume and JD with practical implementation depth."


def _normalize_question(text: str) -> str:
    cleaned = re.sub(r"[^a-z0-9\s]", " ", (text or "").lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def _question_similarity(a: str, b: str) -> float:
    ta = set(_normalize_question(a).split())
    tb = set(_normalize_question(b).split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / max(1, len(ta | tb))


def _clean_question(raw: str) -> str:
    question = (raw or "").strip()
    if "?" in question:
        question = question.split("?")[0].strip() + "?"
    else:
        question = question.strip() + "?"

    bad_prefixes = ["here is", "as an interviewer", "i would ask", "question:", "sure,"]
    low = question.lower()
    for bp in bad_prefixes:
        if low.startswith(bp):
            question = question[len(bp):].strip()
            if not question.endswith("?"):
                question = question + "?"
            break

    words = question.replace("?", "").split()
    if len(words) > 30:
        question = " ".join(words[:30]).strip() + "?"

    return question


def _model_candidates() -> list[str]:
    models = [
        os.getenv("GROQ_MODEL", "").strip(),
        "llama-3.3-70b-versatile",
        "qwen-2.5-72b-instruct",
        "llama-3.1-8b-instant",
    ]
    return [m for m in models if m]


def generate_dynamic_question(
    jd_text,
    resume_text,
    last_answer,
    stage,
    asked_questions,
    remaining_time_minutes,
    current_project=None,
    current_experience=None,
    question_mode="deep",
    concepts=None,
    projects=None,
    project_tech_map=None,
    anchor_topic=None,
    last_question=None,
    answer_topics=None,
):
    recent_questions = [q.strip() for q in (asked_questions or "").split("\n") if q.strip()]
    recent_questions = recent_questions[-12:]
    resume_topics = list((concepts or {}).keys())
    categories = [
        "implementation details",
        "design tradeoffs",
        "debugging and incident handling",
        "testing and validation",
        "performance and reliability",
        "security and safety",
        "scalability and maintainability",
        "why this over alternatives",
    ]

    focus = _stage_focus(stage)
    drilldown = (
        f"Drill deep into {anchor_topic} using resume-specific details."
        if anchor_topic
        else "Drill deep into any topic from resume with concrete implementation depth."
    )
    tech_list = ", ".join(resume_topics) if resume_topics else "None"
    project_list = ", ".join(projects or []) if projects else "None"
    answer_topic_text = ", ".join(answer_topics or []) if (answer_topics or []) else "None"
    recent_text = "\n".join(recent_questions) if recent_questions else "None"

    project_context = ""
    if current_project:
        techs = ", ".join((project_tech_map or {}).get(current_project, []))
        project_context = (
            f"Current project under discussion: {current_project}\n"
            f"Project technologies: {techs or 'Not explicit'}\n"
        )

    answer_followup = ""
    if (last_answer or "").strip():
        answer_followup = (
            "Follow up on the candidate's last answer with deeper implementation detail. "
            "Ask why they chose their approach and why not alternatives."
        )

    time_instruction = "Time is low; ask a concise high-signal question." if remaining_time_minutes <= 2 else "Ask a deep question requiring specific technical reasoning."
    length_instruction = "Keep it 14-24 words, max 30."

    intent_instruction = ""
    if stage == "basics":
        intent_instruction = "Test resume concepts using practical project context."
    elif stage == "advanced_projects":
        intent_instruction = "Project deep dive on implementation, tradeoffs, incidents, debugging, and improvements."
    elif stage == "hr":
        intent_instruction = "Ask one behavioral question."

    def _build_prompt(category: str) -> str:
        return f"""
You are an elite technical interviewer. Ask exactly ONE high-quality interview question.

INTERVIEW STAGE:
{stage}

STAGE FOCUS:
{focus}

INTERVIEW INTENT:
{intent_instruction}

PRIMARY TOPIC TO DRILL:
{anchor_topic or "Best-fit topic from resume/JD"}

TOPIC DRILLDOWN AREAS:
{drilldown}

QUESTION CATEGORY:
{category}

RESUME TECHNOLOGIES:
{tech_list}

PROJECTS:
{project_list}

{project_context}

LAST ANSWER:
{last_answer or "N/A"}

LAST QUESTION:
{last_question or "N/A"}

ANSWER-MENTIONED TOPICS:
{answer_topic_text}

FOLLOWUP INSTRUCTION:
{answer_followup or "Ask a fresh but still context-aware question."}

TIME INSTRUCTION:
{time_instruction}

LENGTH INSTRUCTION:
{length_instruction}

RECENT QUESTIONS TO AVOID REPEATING (do not repeat or paraphrase):
{recent_text}

JD CONTEXT:
{jd_text}

RESUME CONTEXT:
{resume_text}

STRICT OUTPUT RULES:
1. Output exactly one question only.
2. Must end with '?'.
3. Do not include preface/explanation/bullets/numbering.
4. Question must include at least one concrete technical constraint.
   Acceptable constraints include: scale, latency, cost, failure, security, tradeoff, accessibility, browser compatibility, maintainability, model quality, or data quality.
5. Make it difficult and scenario-based, not textbook.
6. Never repeat or paraphrase previous questions.
7. Keep it short and direct (max 30 words).
8. Do NOT ask math, aptitude, brain-teaser, puzzle, or LeetCode/DSA-style coding questions.
9. Prefer project-specific wording; reference current project or resume technologies in the question.
10. If LAST ANSWER is provided, generate a targeted follow-up connected to that answer when possible.
11. Prefer "why this design/technology over alternatives" style questions where applicable.
12. Use only topics and technologies present in the resume context.
13. Prefer follow-up depth from the candidate's previous answer before switching topics.
"""
    model_candidates = _model_candidates()

    best_question = None
    best_score = -1.0

    for attempt in range(6):
        category = random.choice(categories)
        prompt = _build_prompt(category)
        model = model_candidates[attempt % len(model_candidates)]
        temperature = min(1.0, 0.82 + (attempt * 0.04))
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a senior software engineering interviewer. Ask only project-based, "
                            "concept-application questions. Avoid math/aptitude/brain-teaser/DSA puzzle questions."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=temperature,
                top_p=0.95,
                max_tokens=220,
            )
        except Exception:
            continue

        question = _clean_question(response.choices[0].message.content or "")
        if len(question.strip()) < 8:
            continue

        max_sim = max((_question_similarity(question, q) for q in recent_questions), default=0.0)
        if max_sim >= 0.58:
            continue

        score = 1.0 - max_sim
        if anchor_topic and anchor_topic.lower() in question.lower():
            score += 0.15
        if (last_answer or "").strip() and any((t or "").lower() in question.lower() for t in (answer_topics or [])):
            score += 0.15
        if "why" in question.lower() and ("instead" in question.lower() or "rather" in question.lower()):
            score += 0.1

        if score > best_score:
            best_score = score
            best_question = question

    if best_question:
        return best_question

    return ""


def generate_llm_fallback_question(
    jd_text,
    resume_text,
    asked_questions,
    last_answer="",
    anchor_topic=None,
    current_project=None,
):
    prompt = f"""
You are an elite technical interviewer.
Generate exactly ONE non-repetitive technical interview question using the candidate resume context.

PRIMARY TOPIC:
{anchor_topic or "best topic from resume"}

CURRENT PROJECT:
{current_project or "N/A"}

LAST ANSWER:
{last_answer or "N/A"}

PREVIOUS QUESTIONS TO AVOID:
{asked_questions or "N/A"}

JD CONTEXT:
{jd_text}

RESUME CONTEXT:
{resume_text}

RULES:
1. Ask exactly one question, and end with '?'.
2. Do not repeat or paraphrase previous questions.
3. Keep it project/concept based and implementation-focused.
4. Prefer "why this over alternatives" framing when possible.
5. Use only technologies/topics present in the resume context.
"""

    for model in _model_candidates():
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": "Ask one high-signal technical interview question based on resume context.",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.75,
                top_p=0.95,
                max_tokens=180,
            )
            question = _clean_question(response.choices[0].message.content or "")
            return question if len(question.strip()) >= 8 else ""
        except Exception:
            continue
    return ""
