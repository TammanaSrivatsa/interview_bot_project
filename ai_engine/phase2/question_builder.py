"""Single final interview-question generation flow for demo and future tuning."""

from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import Mapping, Sequence

logger = logging.getLogger(__name__)

# Final single config source for interview generation.
INTERVIEW_CONFIG: dict[str, object] = {
    "total_questions": 8,
    "intro_question_count": 1,
    "project_question_ratio": 0.80,
    "hr_question_ratio": 0.20,
    "tone": "natural_interviewer",
    "audience": "fresher_junior",
    "difficulty": "medium",
}


def _llm_question_mode() -> str:
    raw = str(os.getenv("INTERVIEW_QUESTION_MODE", "preferred") or "preferred").strip().lower()
    return raw if raw in {"preferred", "required"} else "preferred"

INTRO_QUESTION = {
    "text": "Please start with a brief introduction about yourself and the project you are most proud of.",
    "type": "intro",
    "topic": "intro:self_introduction",
    "intent": "Understand the candidate's background, strongest project context, and communication style.",
    "focus_skill": None,
    "project_name": None,
    "reference_answer": "A strong answer briefly covers education/background, current interests, one meaningful project, the candidate's exact contribution, and what they learned from it.",
    "difficulty": "easy",
}

HR_QUESTION_PATTERNS = [
    {
        "text": "Tell me about a time you had to learn something quickly to finish a task or project.",
        "intent": "Assess learning agility and self-driven problem solving.",
        "reference_answer": "A strong answer explains the situation, what had to be learned, how it was learned quickly, and the final result.",
    },
    {
        "text": "How do you handle deadlines or pressure when multiple things are pending?",
        "intent": "Assess prioritization and work habits under pressure.",
        "reference_answer": "A strong answer explains prioritization, breaking work into steps, communication, and staying calm under deadlines.",
    },
    {
        "text": "Tell me about a time you received feedback on your work. What did you change after that?",
        "intent": "Assess coachability and reflection.",
        "reference_answer": "A strong answer shows openness to feedback, a specific change made, and what was learned from it.",
    },
    {
        "text": "How do you work with teammates when opinions differ on how to solve a problem?",
        "intent": "Assess teamwork and conflict handling.",
        "reference_answer": "A strong answer focuses on listening, comparing options, discussing trade-offs respectfully, and reaching a practical solution.",
    },
]

_SECTION_WORDS = {
    "experience", "education", "skills", "summary", "certifications", "achievements", "references", "objective",
    "profile", "projects", "project", "workshops", "personal", "technical", "professional", "career", "academic",
    "internship", "internships", "training", "languages", "hobbies", "strengths", "declaration",
}
_ACTION_VERBS = {
    "developed", "built", "implemented", "created", "designed", "worked", "led", "managed", "optimized",
    "tested", "debugged", "deployed", "used", "integrated", "configured", "engineered", "delivered",
}
_CONTRIBUTION_VERBS = {
    "developed", "implemented", "designed", "integrated", "built", "created", "optimized", "debugged", "tested",
}
_PROJECT_SECTION_HINTS = {
    "projects", "project", "academic projects", "personal projects", "major projects", "relevant projects",
    "academic project", "personal project", "project experience",
}
_TECH_KEYWORDS = {
    "python", "java", "javascript", "typescript", "c", "c++", "c#", "sql", "mysql", "postgresql", "mongodb",
    "h2", "sqlite", "oracle", "redis", "html", "css", "react", "angular", "angularjs", "vue", "node", "node.js",
    "express", "spring", "spring boot", "django", "flask", "fastapi", "hibernate", "jpa", "bootstrap", "tailwind",
    "docker", "kubernetes", "aws", "azure", "gcp", "git", "github", "rest", "rest api", "microservices", "jwt",
    "linux", "pandas", "numpy", "scikit-learn", "tensorflow", "pytorch", "opencv", "firebase", "supabase",
}
_TECH_CATEGORY_KEYWORDS = {
    "cloud": {"aws", "azure", "gcp", "docker", "kubernetes", "terraform", "ec2", "s3", "lambda", "iam", "cloudwatch", "eks"},
    "ai_ml": {"ai", "ml", "machine learning", "deep learning", "tensorflow", "pytorch", "scikit-learn", "opencv", "nlp", "llm", "rag", "cnn", "rnn"},
    "backend": {"java", "python", "spring", "spring boot", "django", "flask", "fastapi", "node", "node.js", "express", "microservices", "rest", "rest api", "jwt"},
    "frontend": {"react", "angular", "angularjs", "vue", "html", "css", "javascript", "typescript", "tailwind", "bootstrap"},
    "database": {"sql", "mysql", "postgresql", "mongodb", "sqlite", "oracle", "redis", "jpa", "hibernate"},
}
_FRONTEND_CONCEPT_PROMPTS = {
    "html": [
        ("semantic structure", "how semantic tags improve accessibility, maintainability, and SEO"),
        ("forms and validation", "how native form behavior, browser validation, and accessibility interact"),
        ("DOM structure", "how document structure affects rendering, accessibility trees, and maintainability"),
    ],
    "css": [
        ("layout strategy", "how you reasoned about flexbox, grid, responsiveness, and maintainability"),
        ("specificity and styling architecture", "how you prevented styling conflicts and kept the UI maintainable"),
        ("responsive behavior", "how the design adapted across screen sizes without breaking usability"),
    ],
    "javascript": [
        ("state and event flow", "how data flow, events, and browser behavior affected correctness"),
        ("async behavior", "how you handled asynchronous work, timing issues, and UI consistency"),
        ("DOM interaction", "how you balanced interactivity, maintainability, and performance"),
    ],
    "typescript": [
        ("type design", "how the type system helped prevent bugs and shape the architecture"),
        ("API contracts", "how types improved correctness across component or service boundaries"),
        ("state modeling", "how you used types to represent valid and invalid UI states"),
    ],
}
_TECH_CONCEPT_PROMPTS = {
    "java": [
        ("object design and abstraction", "how the class design, responsibilities, and extensibility were chosen"),
        ("concurrency and execution behavior", "how threading, shared state, or request handling affected correctness"),
        ("exception and resource management", "how failure handling and resource lifecycles were controlled"),
    ],
    "python": [
        ("code structure and readability", "how the implementation stayed maintainable as the logic grew"),
        ("runtime behavior and correctness", "how data handling, mutability, or control flow affected bugs"),
        ("library and workflow design", "how modules, scripts, or services were organized for reliability"),
    ],
    "spring": [
        ("dependency boundaries", "how components were structured and wired cleanly"),
        ("request lifecycle and service design", "how controller, service, and persistence responsibilities were separated"),
        ("configuration and extensibility", "how framework features were used without overcoupling the design"),
    ],
    "spring boot": [
        ("application structure", "how the bootstrapped app stayed modular and maintainable"),
        ("request-to-database flow", "how responsibilities were split across layers"),
        ("configuration and operational behavior", "how profiles, properties, or startup conventions affected design"),
    ],
    "fastapi": [
        ("API contract design", "how request validation, response shape, and service boundaries were handled"),
        ("async and I O behavior", "how concurrency and latency were managed in the API flow"),
        ("validation and error handling", "how incorrect input and service failures were surfaced cleanly"),
    ],
    "django": [
        ("framework boundaries", "how models, views, and business logic were separated"),
        ("ORM and request flow", "how the app balanced speed, correctness, and maintainability"),
        ("admin and convention use", "how framework conventions helped or constrained the implementation"),
    ],
    "flask": [
        ("application structure", "how a lightweight framework was kept organized as features grew"),
        ("extension and service boundaries", "how dependencies and app wiring were managed"),
        ("request handling and maintainability", "how routing, validation, and business logic stayed clean"),
    ],
    "node": [
        ("event loop and concurrency", "how asynchronous execution influenced system behavior"),
        ("service composition", "how routes, middleware, and business logic were separated"),
        ("runtime trade offs", "how performance and simplicity were balanced in the backend"),
    ],
    "node.js": [
        ("event loop and concurrency", "how asynchronous execution influenced system behavior"),
        ("service composition", "how routes, middleware, and business logic were separated"),
        ("runtime trade offs", "how performance and simplicity were balanced in the backend"),
    ],
    "express": [
        ("middleware design", "how request processing and cross cutting concerns were composed"),
        ("route and service boundaries", "how the API stayed maintainable as endpoints increased"),
        ("error flow", "how failures propagated through the application and were controlled"),
    ],
    "sql": [
        ("data modeling", "how entities, relationships, and constraints were designed"),
        ("query behavior", "how correctness and performance were balanced"),
        ("transaction safety", "how invalid states and concurrent updates were prevented"),
    ],
    "mysql": [
        ("schema and indexing decisions", "how the relational model supported the workload"),
        ("query and performance tuning", "how the design avoided expensive or fragile queries"),
        ("consistency handling", "how updates stayed correct under real usage"),
    ],
    "postgresql": [
        ("schema and relational design", "how the model supported correctness and future change"),
        ("query planning and performance", "how heavier reads or joins were handled"),
        ("transaction and data integrity", "how invalid states or partial updates were prevented"),
    ],
    "mongodb": [
        ("document modeling", "how embedding versus referencing decisions were made"),
        ("query flexibility and trade offs", "how the schema matched the access patterns"),
        ("consistency and update behavior", "how document writes stayed correct and maintainable"),
    ],
    "redis": [
        ("caching strategy", "how cached data, freshness, and invalidation were handled"),
        ("latency and consistency trade offs", "how speed improvements were balanced with correctness"),
        ("key design", "how data access patterns shaped the cache structure"),
    ],
    "docker": [
        ("container boundaries", "how services, dependencies, and environments were isolated"),
        ("image and runtime design", "how build size, reproducibility, and debugging were balanced"),
        ("deployment workflow", "how containers improved or complicated delivery and operations"),
    ],
    "kubernetes": [
        ("orchestration design", "how scaling, availability, and service coordination were handled"),
        ("deployment and resilience", "how pods, services, and rollout behavior affected reliability"),
        ("operational complexity", "how the platform trade off was justified against simpler deployment options"),
    ],
    "aws": [
        ("service composition", "how services were combined into a reliable architecture"),
        ("security and permission boundaries", "how identities, access, and data flow were controlled"),
        ("scalability and cost trade offs", "how the cloud design balanced growth and operational simplicity"),
    ],
    "react": [
        ("component design", "how UI structure, state ownership, and maintainability were handled"),
        ("rendering and state flow", "how updates, derived state, and UI consistency were managed"),
        ("interaction architecture", "how component boundaries affected usability and complexity"),
    ],
    "angular": [
        ("component and module boundaries", "how the frontend stayed scalable and organized"),
        ("template and state flow", "how data binding and behavior stayed predictable"),
        ("framework structure", "how Angular conventions shaped the implementation"),
    ],
    "angularjs": [
        ("scope and binding behavior", "how data flow and UI updates were controlled"),
        ("controller and structure design", "how complexity was managed in the application"),
        ("framework trade offs", "how maintainability and behavior were handled in the chosen architecture"),
    ],
    "tensorflow": [
        ("modeling decisions", "how architecture, features, and data flow influenced model quality"),
        ("training behavior", "how overfitting, underfitting, and evaluation were handled"),
        ("inference design", "how model output quality and production behavior were validated"),
    ],
    "pytorch": [
        ("modeling and experimentation", "how the model design evolved with evidence"),
        ("training and debugging", "how gradients, data, and failure cases were reasoned about"),
        ("deployment implications", "how the research workflow translated into a usable system"),
    ],
    "scikit-learn": [
        ("feature and model choice", "how the right algorithm and features were selected"),
        ("evaluation strategy", "how quality was measured beyond simple accuracy"),
        ("generalization behavior", "how overfitting and real-world reliability were reasoned about"),
    ],
}
_SKILL_QUESTION_BLUEPRINTS = [
    {
        "intent": "Assess whether the candidate can connect a claimed skill to concrete implementation decisions.",
        "reference_answer": "A strong answer ties the skill to an actual feature, explains how it was used in the project, and discusses one practical trade-off or lesson.",
    },
    {
        "intent": "Assess practical debugging and problem-solving with a skill the candidate has actually used.",
        "reference_answer": "A strong answer describes a real issue, how the candidate diagnosed it, the fix applied, and how they verified the outcome.",
    },
    {
        "intent": "Assess depth beyond definitions by asking how a skill shaped architecture, performance, or maintainability.",
        "reference_answer": "A strong answer explains the role of the skill in the system design and gives a practical rationale for the chosen approach.",
    },
]
_FINGERPRINT_STOPWORDS = {
    "a", "an", "and", "the", "of", "to", "for", "in", "on", "with", "about", "your", "you", "how", "did",
    "what", "when", "where", "why", "is", "was", "were", "into", "from", "that", "this", "it", "me",
}


def _normalize(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9+.# ]", " ", value or "")
    return re.sub(r"\s+", " ", cleaned).strip().lower()


def _clean_line(value: str) -> str:
    line = re.sub(r"^[\-\*\u2022\d\.\)\(]+\s*", "", (value or "").strip())
    return re.sub(r"\s+", " ", line).strip()


def _is_section_heading(line: str) -> bool:
    value = (line or "").strip()
    lowered = value.lower()
    return bool(value and len(value) <= 60 and (lowered in _SECTION_WORDS or lowered in _PROJECT_SECTION_HINTS or re.fullmatch(r"[A-Z][A-Z\s/&\-]+", value)))


def _starts_with_action_verb(line: str) -> bool:
    first_word = (line or "").strip().split()[0].lower().rstrip(".,;") if line.strip() else ""
    return first_word in _ACTION_VERBS


def _looks_like_project_title(line: str) -> bool:
    if not line:
        return False
    lowered = line.lower().strip(" :-")
    if lowered in _PROJECT_SECTION_HINTS or _is_section_heading(line):
        return False
    if ":" in line and re.match(r"^(features?|modules?|functionalities|including|my role|role|responsible for|contribution)\s*:", lowered, re.IGNORECASE):
        return False
    if len(line) > 110:
        return False
    if _starts_with_action_verb(line):
        return False
    if re.match(r"^(features?|modules?|functionalities|including|my role|role|responsible for|contribution)\b", lowered):
        return False
    if re.search(r"\b(project|system|portal|application|app|website|dashboard|platform|management|booking|tracker|prediction|analysis)\b", lowered):
        return True
    return len(line.split()) <= 12 and bool(re.search(r"[A-Za-z]", line))


def _split_items(text: str) -> list[str]:
    return [item.strip() for item in re.split(r"[,/|;]", text or "") if item.strip()]


def _clean_sentence(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip(" .;:-")
    text = re.sub(r"^(my role|role|responsible for|contribution)\s*[:\-]\s*", "", text, flags=re.IGNORECASE)
    return text.strip()


def _trim_project_phrase(value: str) -> str:
    text = _clean_sentence(value)
    text = re.sub(r"^(implemented|developed|built|designed|integrated|using)\s+", "", text, flags=re.IGNORECASE)
    text = re.split(r"\b(?:to track|to manage|for users to|that allows|which allows)\b", text, maxsplit=1, flags=re.IGNORECASE)[0].strip(" ,.") or text
    return text


def _dedupe_keep_order(values: Sequence[str], *, limit: int | None = None) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        item = re.sub(r"\s+", " ", str(value or "")).strip()
        key = _normalize(item)
        if not item or not key or key in seen:
            continue
        seen.add(key)
        result.append(item)
        if limit and len(result) >= limit:
            break
    return result


def _extract_tech_from_text(text: str, known_skills: Mapping[str, int] | None = None) -> list[str]:
    found: list[str] = []
    normalized_text = f" {_normalize(text)} "
    for skill in (known_skills or {}).keys():
        skill_key = _normalize(skill)
        if skill_key and f" {skill_key} " in normalized_text:
            found.append(str(skill))
    for keyword in sorted(_TECH_KEYWORDS, key=len, reverse=True):
        keyword_key = _normalize(keyword)
        if keyword_key and f" {keyword_key} " in normalized_text:
            found.append(keyword)
    using_match = re.search(r"(?:using|built with|tech(?:nologies)?|stack|tools)\s*[:\-]?\s*(.+)", text, re.IGNORECASE)
    if using_match:
        raw_items = _split_items(using_match.group(1))
        clean_items = []
        for item in raw_items:
            cleaned = re.split(r"\b(?:to|for|with|where|that|which)\b", item, maxsplit=1, flags=re.IGNORECASE)[0].strip(" .")
            cleaned = re.sub(r"^(and|with)\s+", "", cleaned, flags=re.IGNORECASE)
            if 1 <= len(cleaned.split()) <= 4 and cleaned.lower() not in {"and", "with"}:
                clean_items.append(cleaned)
        found.extend(clean_items)
    return _dedupe_keep_order(found, limit=8)


def _extract_resume_skills(resume_text: str, known_skills: Mapping[str, int] | None = None) -> list[str]:
    skills = _extract_tech_from_text(resume_text, known_skills)
    lines = [_clean_line(ln) for ln in (resume_text or "").splitlines() if _clean_line(ln)]
    for line in lines:
        lowered = line.lower()
        if lowered in {"skills", "technical skills", "core skills", "technologies"}:
            continue
        if any(token in lowered for token in ("skills", "technologies", "stack", "tools")) or len(line.split(",")) >= 3:
            skills.extend(_extract_tech_from_text(line, known_skills))
    return _dedupe_keep_order(skills, limit=16)


def _skill_category(skill: str | None) -> str | None:
    key = _normalize(skill or "")
    if not key:
        return None
    for category, keywords in _TECH_CATEGORY_KEYWORDS.items():
        if key in {_normalize(item) for item in keywords}:
            return category
    return None


def _question_fingerprint(text: str) -> str:
    parts = [
        token for token in _normalize(text).split()
        if token and token not in _FINGERPRINT_STOPWORDS
    ]
    return " ".join(parts[:18])


def _frontend_concept_seed(skill: str | None, angle_index: int) -> tuple[str, str]:
    key = _normalize(skill or "")
    prompts = _FRONTEND_CONCEPT_PROMPTS.get(key)
    if prompts:
        return prompts[angle_index % len(prompts)]
    generic = [
        ("rendering behavior", "how browser rendering, state updates, and structure affected correctness"),
        ("accessibility and semantics", "how users, assistive technologies, and maintainability influenced implementation"),
        ("component or page structure", "how you kept the frontend predictable, scalable, and easy to debug"),
    ]
    return generic[angle_index % len(generic)]


def _technology_concept_seed(skill: str | None, category: str | None, angle_index: int) -> tuple[str, str]:
    key = _normalize(skill or "")
    prompts = _TECH_CONCEPT_PROMPTS.get(key)
    if prompts:
        return prompts[angle_index % len(prompts)]
    if category == "frontend":
        return _frontend_concept_seed(skill, angle_index)
    category_generic = {
        "backend": [
            ("service boundaries", "how responsibilities were split across layers, modules, or services"),
            ("runtime behavior", "how requests, data flow, and failure handling affected correctness"),
            ("maintainability trade offs", "how design choices balanced speed of development with long-term clarity"),
        ],
        "database": [
            ("data model design", "how relationships, constraints, and access patterns shaped the schema"),
            ("query behavior", "how correctness and performance were balanced under realistic usage"),
            ("consistency guarantees", "how invalid states, duplicates, or partial updates were prevented"),
        ],
        "cloud": [
            ("architecture composition", "how services were selected and coordinated"),
            ("operational trade offs", "how cost, scaling, and simplicity were balanced"),
            ("security boundaries", "how permissions, network flow, and failure behavior were controlled"),
        ],
        "ai_ml": [
            ("model quality", "how data, evaluation, and failure cases shaped confidence in the system"),
            ("design decisions", "how the candidate chose features, models, or pipelines"),
            ("real world behavior", "how the model was validated under edge cases and imperfect data"),
        ],
        "frontend": [
            ("rendering behavior", "how browser rendering, state updates, and structure affected correctness"),
            ("accessibility and semantics", "how users, assistive technologies, and maintainability influenced implementation"),
            ("component or page structure", "how the frontend stayed predictable, scalable, and easy to debug"),
        ],
    }
    generic = category_generic.get(category, [
        ("design decisions", "how the technology influenced architecture and implementation choices"),
        ("trade offs", "how the chosen approach balanced correctness, complexity, and maintainability"),
        ("real system behavior", "how the technology affected reliability, debugging, or evolution of the system"),
    ])
    return generic[angle_index % len(generic)]


def _build_related_topic_clusters(
    *,
    resume_skills: Sequence[str],
    jd_skill_scores: Mapping[str, int],
    projects: Sequence[Mapping[str, object]],
) -> list[dict[str, object]]:
    jd_ordered = _sorted_jd_skills(jd_skill_scores)
    resume_ordered = _dedupe_keep_order(list(resume_skills), limit=20)
    project_skill_map = {
        str(project.get("title") or "").strip(): _dedupe_keep_order(list(project.get("tech_stack", []) or []), limit=10)
        for project in projects
        if str(project.get("title") or "").strip()
    }

    category_groups: dict[str, list[str]] = {}
    for skill in _dedupe_keep_order(jd_ordered + resume_ordered, limit=24):
        category = _skill_category(skill) or "general"
        category_groups.setdefault(category, []).append(skill)

    clusters: list[dict[str, object]] = []
    for category, skills in category_groups.items():
        if not skills:
            continue
        clusters.append({
            "category": category,
            "skills": _dedupe_keep_order(skills, limit=6),
            "project_examples": [
                {
                    "project_name": project_name,
                    "skills": [skill for skill in project_skills if any(_normalize(skill) == _normalize(target) for target in skills)],
                }
                for project_name, project_skills in project_skill_map.items()
                if any(any(_normalize(skill) == _normalize(target) for target in skills) for skill in project_skills)
            ][:4],
        })
    return clusters[:8]


def _extract_named_segment(pattern: str, text: str) -> str | None:
    match = re.search(pattern, text, re.IGNORECASE)
    if not match:
        return None
    value = re.sub(r"\s+", " ", match.group(1)).strip(" .:-")
    return value or None


def _project_score(project: Mapping[str, object], jd_skill_scores: Mapping[str, int]) -> int:
    tech = {_normalize(value) for value in project.get("tech_stack", []) if value}
    jd_score = sum(int(weight) for skill, weight in (jd_skill_scores or {}).items() if _normalize(skill) in tech)
    details_score = len(project.get("implementation_details", []) or []) * 2
    feature_score = len(project.get("notable_features", []) or [])
    contribution_score = 2 if project.get("candidate_contribution") else 0
    summary_score = 1 if project.get("summary") else 0
    return jd_score + details_score + feature_score + contribution_score + summary_score


def extract_projects_from_resume(resume_text: str, *, known_skills: Mapping[str, int] | None = None, max_projects: int = 5) -> list[dict[str, object]]:
    lines = [_clean_line(ln) for ln in (resume_text or "").splitlines() if _clean_line(ln)]
    projects: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    in_projects = False

    def flush_current() -> None:
        nonlocal current
        if not current:
            return
        title = str(current.get("title") or "").strip()
        if not title:
            current = None
            return
        current["tech_stack"] = _dedupe_keep_order([_clean_sentence(v) for v in current.get("tech_stack", [])], limit=8)
        current["notable_features"] = _dedupe_keep_order([_clean_sentence(v) for v in current.get("notable_features", [])], limit=5)
        current["implementation_details"] = _dedupe_keep_order([_clean_sentence(v) for v in current.get("implementation_details", [])], limit=5)
        contributions = _dedupe_keep_order([_clean_sentence(v) for v in current.get("candidate_contribution", [])], limit=3)
        current["candidate_contribution"] = contributions[0] if contributions else None
        summary = _clean_sentence(str(current.get("summary") or ""))
        if not summary:
            detail_parts = list(current.get("implementation_details", [])) or list(current.get("notable_features", []))
            summary = detail_parts[0] if detail_parts else title
        current["summary"] = summary
        current["score"] = _project_score(current, known_skills or {})
        projects.append(current)
        current = None

    for line in lines:
        lowered = line.lower().strip()
        if lowered in _PROJECT_SECTION_HINTS:
            flush_current()
            in_projects = True
            continue
        if in_projects and _is_section_heading(line) and lowered not in _PROJECT_SECTION_HINTS:
            flush_current()
            in_projects = False
            continue
        if not in_projects:
            continue
        if _looks_like_project_title(line):
            flush_current()
            title_text = re.split(r"\s*[|:\-]\s*", line, maxsplit=1)[0].strip()
            current = {
                "title": title_text,
                "summary": None,
                "tech_stack": _extract_tech_from_text(line, known_skills),
                "notable_features": [],
                "implementation_details": [],
                "candidate_contribution": [],
            }
            remainder = line[len(title_text):].strip(" :-|")
            if remainder:
                current["summary"] = remainder
                current["implementation_details"].append(remainder)
            continue
        if not current:
            continue

        line_tech = _extract_tech_from_text(line, known_skills)
        if line_tech:
            current.setdefault("tech_stack", []).extend(line_tech)

        contribution = _extract_named_segment(r"(?:my role|role|responsible for|contribution)\s*[:\-]?\s*(.+)", line)
        if not contribution and current.get("candidate_contribution"):
            lower_line = line.lower()
            if any(lower_line.startswith(f"{verb} ") for verb in _CONTRIBUTION_VERBS):
                contribution = line
        if contribution and len(contribution.split()) >= 3:
            current.setdefault("candidate_contribution", []).append(contribution)

        feature = _extract_named_segment(r"(?:features?|modules?|functionalities|including)\s*[:\-]?\s*(.+)", line)
        if feature:
            current.setdefault("notable_features", []).extend(_split_items(feature) or [feature])
        elif re.search(r"\b(implemented|developed|built|designed|integrated)\b", line, re.IGNORECASE):
            current.setdefault("notable_features", []).append(_trim_project_phrase(line))

        if not current.get("summary") and len(line.split()) >= 5:
            current["summary"] = _clean_sentence(line)

        if len(line.split()) >= 4:
            current.setdefault("implementation_details", []).append(_clean_sentence(line))

    flush_current()

    if not projects:
        return []

    ranked = sorted(projects, key=lambda item: int(item.get("score") or 0), reverse=True)
    return ranked[:max_projects]


def _section_counts(total_questions: int, project_ratio: float | None = None) -> dict[str, int]:
    total = max(4, int(total_questions or INTERVIEW_CONFIG["total_questions"]))
    intro_count = int(INTERVIEW_CONFIG["intro_question_count"])
    remaining = max(1, total - intro_count)
    p_ratio = float(project_ratio if project_ratio is not None else INTERVIEW_CONFIG["project_question_ratio"])
    p_ratio = max(0.0, min(1.0, p_ratio))
    project_count = max(1, int(round(remaining * p_ratio)))
    hr_count = max(1, remaining - project_count)
    while intro_count + project_count + hr_count > total:
        if project_count > hr_count and project_count > 1:
            project_count -= 1
        elif hr_count > 1:
            hr_count -= 1
        else:
            break
    while intro_count + project_count + hr_count < total:
        if project_count <= hr_count:
            project_count += 1
        else:
            hr_count += 1
    return {"intro": intro_count, "project": project_count, "hr": hr_count}


def _sorted_jd_skills(jd_skill_scores: Mapping[str, int]) -> list[str]:
    return [skill for skill, _ in sorted((jd_skill_scores or {}).items(), key=lambda item: (-int(item[1]), item[0])) if str(skill).strip()]


def _project_to_structured_context(project: Mapping[str, object]) -> dict[str, object]:
    return {
        "project_name": str(project.get("title") or "").strip(),
        "what_it_does": str(project.get("summary") or "").strip(),
        "tech_stack": list(project.get("tech_stack", []) or []),
        "notable_features": list(project.get("notable_features", []) or []),
        "implementation_details": list(project.get("implementation_details", []) or []),
        "candidate_contribution": project.get("candidate_contribution"),
    }


def _structured_projects_payload(projects: list[dict[str, object]]) -> list[dict[str, object]]:
    return [_project_to_structured_context(project) for project in projects]


def _build_project_question_from_context(project: Mapping[str, object], focus_skill: str | None, angle_index: int) -> tuple[str, str, str]:
    context = _project_to_structured_context(project)
    project_name = str(context["project_name"] or "this project")
    summary = str(context["what_it_does"] or "").strip()
    tech_stack = list(context["tech_stack"] or [])
    features = list(context["notable_features"] or [])
    details = list(context["implementation_details"] or [])
    contribution = str(context.get("candidate_contribution") or "").strip()
    stack_phrase = ", ".join(tech_stack[:3]) if tech_stack else None
    detail = details[0] if details else summary
    feature = features[0] if features else None
    focus_area = _trim_project_phrase(feature or detail or 'the core workflow') or 'the core workflow'

    question_templates = [
        (
            f"In {project_name}, how did you design and implement {focus_area}, and what trade-offs did you make along the way?",
            "Assess architecture and implementation depth using the candidate's real project context.",
            "A strong answer explains the end-to-end implementation, why specific components or flows were chosen, and the trade-offs involved.",
        ),
        (
            f"You mentioned {project_name}" + (f" using {stack_phrase}" if stack_phrase else "") + f" — how did you split responsibilities across the system and make sure {focus_area} worked reliably?",
            "Assess understanding of component boundaries, system responsibilities, and reliability decisions.",
            "A strong answer breaks down the frontend/backend or module responsibilities and explains how the core feature was validated or stabilized.",
        ),
        (
            f"What was the trickiest technical decision in {project_name}, especially around {focus_skill or feature or 'the main implementation'}, and how did you resolve it?",
            "Assess decision-making, technical judgment, and practical problem solving in a real project.",
            "A strong answer identifies a genuine decision point, compares options, and explains why the chosen solution fit the project best.",
        ),
        (
            f"If you had to extend {project_name} further, what would you improve first in the current design or implementation, and why?",
            "Assess whether the candidate can reason about bottlenecks, maintainability, and next-step improvements.",
            "A strong answer identifies a concrete limitation and proposes a realistic improvement grounded in the actual project design.",
        ),
        (
            f"While building {project_name}, what debugging or edge-case issue came up around {focus_area if focus_area else (focus_skill or 'the core flow')}, and how did you verify the fix?",
            "Assess debugging process, edge-case handling, and quality mindset.",
            "A strong answer describes a real issue, the diagnosis process, the fix, and how the outcome was verified.",
        ),
    ]

    if contribution:
        question_templates.insert(
            1,
            (
                f"In {project_name}, your contribution included {contribution}. How did that piece fit into the overall system, and what implementation choices mattered most?",
                "Assess ownership and implementation depth based on the candidate's stated contribution.",
                "A strong answer clearly explains the candidate's exact ownership, the surrounding system context, and the important engineering choices.",
            ),
        )

    return question_templates[angle_index % len(question_templates)]


def _build_deep_skill_project_question(project: Mapping[str, object], focus_skill: str | None, angle_index: int) -> tuple[str, str, str]:
    project_name = str(project.get("title") or "this project").strip()
    skill = str(focus_skill or "").strip()
    summary = str(project.get("summary") or "").strip()
    detail = next(iter(project.get("implementation_details", []) or []), summary or "the main workflow")
    detail = _trim_project_phrase(detail) or "the main workflow"
    category = _skill_category(skill)

    if category == "cloud":
        templates = [
            (
                f"In {project_name}, how did you design the AWS or cloud workflow around {detail}, including service selection, security boundaries, and failure handling?",
                "Assess cloud architecture depth, reliability thinking, and service-level design decisions.",
                "A strong answer explains why specific cloud services were chosen, how permissions and data flow were controlled, and how failures or scaling concerns were handled.",
            ),
            (
                f"In {project_name}, where did {skill} create the biggest architectural trade-off, and how did you balance cost, scalability, and operational simplicity?",
                "Assess practical cloud trade-off analysis beyond simply naming services used.",
                "A strong answer connects the cloud choice to workload characteristics, operational constraints, and trade-offs such as cost, latency, scaling, or maintainability.",
            ),
        ]
        return templates[angle_index % len(templates)]

    if category == "ai_ml":
        templates = [
            (
                f"In {project_name}, how did you validate that the {skill} pipeline around {detail} was actually learning the right thing and not just producing good-looking outputs?",
                "Assess conceptual ML depth around data quality, evaluation, and model validity.",
                "A strong answer explains data preparation, evaluation criteria, error analysis, and how the candidate checked whether the model generalized beyond a few examples.",
            ),
            (
                f"In {project_name}, what were the hardest conceptual decisions when using {skill} for {detail}, especially around data quality, feature choice, overfitting, or model behavior in edge cases?",
                "Assess deep machine-learning reasoning grounded in project implementation choices.",
                "A strong answer discusses concrete modeling decisions, the risks involved, and how the candidate reasoned about model quality, limitations, and edge cases.",
            ),
        ]
        return templates[angle_index % len(templates)]

    if category == "database":
        templates = [
            (
                f"In {project_name}, how did {skill} influence your data model and query design for {detail}, and what did you do to keep correctness and performance under control?",
                "Assess data modeling depth, query reasoning, and performance awareness.",
                "A strong answer explains schema or document design, key queries, consistency concerns, and the trade-offs between simplicity, correctness, and speed.",
            ),
            (
                f"In {project_name}, what data consistency or concurrency issue could appear around {detail}, and how would your {skill} design prevent invalid states?",
                "Assess deeper understanding of transactional thinking, constraints, and correctness.",
                "A strong answer identifies a realistic failure mode, then explains how the database design, validation, or transaction strategy prevents or mitigates it.",
            ),
        ]
        return templates[angle_index % len(templates)]

    if category == "frontend":
        concept_label, concept_detail = _technology_concept_seed(skill, category, angle_index)
        templates = [
            (
                f"In {project_name}, how did {skill or 'the frontend stack'} affect your decisions around {concept_label}, and what trade-offs did you make in the final implementation?",
                "Assess deeper frontend reasoning around semantics, rendering, accessibility, or maintainability using real project context.",
                "A strong answer explains concrete frontend decisions, ties them to browser or user behavior, and discusses the trade-offs made in the implementation.",
            ),
            (
                f"In {project_name}, explain the hardest conceptual issue around {skill or 'the frontend'} for {detail}. I want the reasoning behind the implementation, not just the final code.",
                "Assess whether the candidate understands frontend behavior conceptually rather than only at the syntax level.",
                "A strong answer explains the underlying browser, accessibility, rendering, or interaction concepts and shows how those concepts shaped the implementation.",
            ),
            (
                f"While building {project_name}, where did {skill or 'the frontend layer'} create the biggest challenge in {concept_detail}, and how did you resolve it without hurting usability or maintainability?",
                "Assess practical frontend depth where user experience, maintainability, and browser behavior intersect.",
                "A strong answer identifies a real frontend challenge, explains the reasoning process, and shows how the final solution balanced user experience with engineering constraints.",
            ),
        ]
        return templates[angle_index % len(templates)]

    templates = [
        (
            f"In {project_name}, how did {skill or 'the main technology'} shape your implementation of {detail}, and what trade-offs did that create in the system design?",
            "Assess conceptual depth on how a real technology influenced architecture and implementation.",
            "A strong answer ties the technology to a concrete subsystem, explains why it fit, and discusses the trade-offs that came with using it.",
        ),
        (
            f"In {project_name}, what is the deepest design decision you made around {skill or detail}, and how would you defend that choice against a reasonable alternative?",
            "Assess ability to reason deeply about implementation alternatives in a real project.",
            "A strong answer compares viable options, explains the chosen design, and shows clear reasoning based on the actual project context.",
        ),
    ]
    return templates[angle_index % len(templates)]


def _build_cross_project_question(primary: Mapping[str, object], secondary: Mapping[str, object], index: int) -> tuple[str, str, str]:
    primary_name = str(primary.get("title") or "the first project").strip()
    secondary_name = str(secondary.get("title") or "the second project").strip()
    primary_skills = list(primary.get("tech_stack", []) or [])
    secondary_skills = list(secondary.get("tech_stack", []) or [])
    shared = next(
        (
            skill for skill in primary_skills
            if any(_normalize(skill) == _normalize(other) for other in secondary_skills)
        ),
        None,
    )
    comparison_anchor = shared or primary_skills[0] if primary_skills else secondary_skills[0] if secondary_skills else "system design"

    templates = [
        (
            f"You have worked on both {primary_name} and {secondary_name}. If you compare them through {comparison_anchor}, what design principle stayed the same and what had to change because the problem was different?",
            "Assess whether the candidate can interlink projects and reason across contexts instead of describing each one in isolation.",
            "A strong answer compares both projects concretely, identifies a common engineering principle, and explains how context changed the implementation decisions.",
        ),
        (
            f"If you had to combine lessons from {primary_name} and {secondary_name} into one stronger system, what architecture or implementation decision would you carry over from one project to the other, and why?",
            "Assess transfer learning across projects and deeper engineering judgment.",
            "A strong answer reasons across both projects, identifies a reusable idea, and explains why it would improve the other system in a practical way.",
        ),
    ]
    return templates[index % len(templates)]


def _select_relevant_projects(projects: list[dict[str, object]], jd_skill_scores: Mapping[str, int], count: int) -> list[dict[str, object]]:
    ranked = sorted(projects, key=lambda item: _project_score(item, jd_skill_scores or {}), reverse=True)
    return ranked[: max(1, min(len(ranked), count))]


def _build_skill_question(skill: str, project: Mapping[str, object] | None, variant_index: int) -> tuple[str, str, str]:
    blueprint = _SKILL_QUESTION_BLUEPRINTS[variant_index % len(_SKILL_QUESTION_BLUEPRINTS)]
    project_name = str((project or {}).get("title") or "").strip()
    details = list((project or {}).get("implementation_details", []) or [])
    features = list((project or {}).get("notable_features", []) or [])
    detail = _trim_project_phrase(details[0] if details else (features[0] if features else None)) if (details or features) else None
    category = _skill_category(skill)

    if category == "frontend":
        concept_label, concept_detail = _technology_concept_seed(skill, category, variant_index)
        if project_name:
            prompts = [
                f"In {project_name}, how did {skill} influence your decisions around {concept_label}, especially for {detail or 'the main user flow'}?",
                f"Think about {project_name}: what conceptual frontend issue did you face with {skill} around {concept_detail}, and how did you reason through it?",
                f"In {project_name}, if you changed the way {skill} was used for {detail or 'the UI flow'}, what user-facing or browser-level behavior would break first, and why?",
            ]
        else:
            prompts = [
                f"You listed {skill} in your resume. Explain a real implementation where your understanding of {concept_label} mattered more than just knowing the syntax.",
                f"Tell me about a frontend problem where {skill} forced you to think carefully about {concept_detail}. What made it conceptually hard?",
                f"Where have you used {skill} in a way that required understanding browser behavior, user interaction, or accessibility rather than only writing markup or code?",
            ]
        return prompts[variant_index % len(prompts)], (
            "Assess conceptual frontend depth around browser behavior, accessibility, rendering, or maintainability."
        ), (
            "A strong answer explains the underlying frontend concept, connects it to a real implementation, and shows why the final approach worked in practice."
        )

    if category in {"backend", "database", "cloud", "ai_ml"}:
        concept_label, concept_detail = _technology_concept_seed(skill, category, variant_index)
        if project_name:
            prompts = [
                f"In {project_name}, how did {skill} affect your decisions around {concept_label}, especially for {detail or 'the main implementation'}?",
                f"Think about your work on {project_name}: what conceptual issue around {skill} and {concept_detail} was hardest to reason through?",
                f"In {project_name}, if you changed the way {skill} was used in {detail or 'that system flow'}, what trade-off or failure mode would change first, and why?",
            ]
        else:
            prompts = [
                f"You listed {skill} in your resume. Explain a real implementation where your understanding of {concept_label} mattered more than just knowing the syntax or API calls.",
                f"Tell me about a system where {skill} forced you to think carefully about {concept_detail}. What made it conceptually difficult?",
                f"Where have you used {skill} in a way that required deeper reasoning about architecture, correctness, or behavior instead of only implementation steps?",
            ]
        return prompts[variant_index % len(prompts)], (
            "Assess conceptual depth for a resume skill by focusing on architecture, correctness, trade-offs, and system behavior."
        ), (
            "A strong answer explains the underlying concept, connects it to a real implementation, and shows how the candidate reasoned through trade-offs or failure modes."
        )

    if project_name:
        prompts = [
            f"In {project_name}, where did {skill} matter most in the implementation, and what did it help you solve in practice?",
            f"Think about your work on {project_name}: what problem did you hit while using {skill}, and how did you debug or improve that part of the system?",
            f"In {project_name}, how did {skill} influence your design choices" + (f" around {detail}" if detail else "") + "?",
        ]
    else:
        prompts = [
            f"You have {skill} in your resume — can you describe a real feature or implementation where you used it and what design decision depended on it?",
            f"Tell me about a practical issue you handled using {skill}. What was happening, and how did you solve it?",
            f"Where have you applied {skill} in a real build, and how did it affect the performance, maintainability, or correctness of the solution?",
        ]

    return prompts[variant_index % len(prompts)], blueprint["intent"], blueprint["reference_answer"]


def _append_unique_question(
    questions: list[dict[str, object]],
    used_fingerprints: set[str],
    payload: Mapping[str, object],
) -> bool:
    text = str(payload.get("text") or "").strip()
    if not text:
        return False
    fingerprint = _question_fingerprint(text)
    if not fingerprint or fingerprint in used_fingerprints:
        return False
    used_fingerprints.add(fingerprint)
    questions.append(dict(payload))
    return True


def _sanitize_question_order(questions: Sequence[Mapping[str, object]]) -> list[dict[str, object]]:
    intro = [dict(item) for item in questions if str(item.get("type") or "") == "intro"]
    project = [dict(item) for item in questions if str(item.get("type") or "") == "project"]
    hr = [dict(item) for item in questions if str(item.get("type") or "") == "hr"]
    other = [dict(item) for item in questions if str(item.get("type") or "") not in {"intro", "project", "hr"}]
    return intro + project + hr + other


def _build_practical_questions(projects: list[dict[str, object]], jd_skill_scores: Mapping[str, int], count: int, resume_skills: Sequence[str] | None = None) -> list[dict[str, object]]:
    if count <= 0:
        return []

    selected_projects = _select_relevant_projects(projects, jd_skill_scores, count)
    if not selected_projects:
        return []

    jd_skills = _sorted_jd_skills(jd_skill_scores)
    project_skills = _dedupe_keep_order(
        [skill for project in selected_projects for skill in project.get("tech_stack", [])],
        limit=12,
    )
    resume_skill_list = _dedupe_keep_order(list(resume_skills or []) + project_skills, limit=16)

    matched_skills: list[str] = []
    for skill in jd_skills:
        skill_key = _normalize(skill)
        if any(skill_key == _normalize(resume_skill) for resume_skill in resume_skill_list):
            matched_skills.append(skill)

    questions: list[dict[str, object]] = []
    used_fingerprints: set[str] = set()
    practical_skill_targets = matched_skills or [skill for skill in resume_skill_list if skill][: max(1, min(8, len(resume_skill_list)))]

    for index, project in enumerate(selected_projects):
        project_skill_list = list(project.get("tech_stack", []) or [])
        focus_skill = next((skill for skill in jd_skills if any(_normalize(skill) == _normalize(project_skill) for project_skill in project_skill_list)), None)
        if not focus_skill and project_skill_list:
            focus_skill = project_skill_list[0]
        if focus_skill and _skill_category(focus_skill) in {"cloud", "ai_ml", "database"}:
            text, intent, reference_answer = _build_deep_skill_project_question(project, focus_skill, index)
            topic = f"skill:{_normalize(focus_skill)}"
        else:
            text, intent, reference_answer = _build_project_question_from_context(project, focus_skill, index)
            topic = f"project:{_normalize(focus_skill or project.get('title') or 'implementation')}"
        _append_unique_question(questions, used_fingerprints, {
            "text": text if text.endswith("?") else f"{text}?",
            "type": "project",
            "topic": topic,
            "intent": intent,
            "focus_skill": focus_skill,
            "project_name": project.get("title"),
            "reference_answer": reference_answer,
            "difficulty": "hard" if focus_skill else str(INTERVIEW_CONFIG["difficulty"]),
        })

    if len(selected_projects) > 1 and len(questions) < count:
        for index in range(len(selected_projects) - 1):
            primary = selected_projects[index]
            secondary = selected_projects[(index + 1) % len(selected_projects)]
            text, intent, reference_answer = _build_cross_project_question(primary, secondary, index)
            if _append_unique_question(questions, used_fingerprints, {
                "text": text if text.endswith("?") else f"{text}?",
                "type": "project",
                "topic": f"cross_project:{_normalize(primary.get('title') or 'project')}:{_normalize(secondary.get('title') or 'project')}",
                "intent": intent,
                "focus_skill": None,
                "project_name": f"{primary.get('title')} | {secondary.get('title')}",
                "reference_answer": reference_answer,
                "difficulty": "hard",
            }) and len(questions) >= count:
                break

    for index, skill in enumerate(practical_skill_targets):
        if len(questions) >= count:
            break
        attached_project = next(
            (project for project in selected_projects if any(_normalize(skill) == _normalize(project_skill) for project_skill in project.get("tech_stack", []))),
            selected_projects[index % len(selected_projects)],
        )
        if _skill_category(skill) in {"cloud", "ai_ml", "database"}:
            text, intent, reference_answer = _build_deep_skill_project_question(attached_project, skill, index)
        else:
            text, intent, reference_answer = _build_skill_question(skill, attached_project, index)
        _append_unique_question(questions, used_fingerprints, {
            "text": text if text.endswith("?") else f"{text}?",
            "type": "project",
            "topic": f"skill:{_normalize(skill)}",
            "intent": intent,
            "focus_skill": skill,
            "project_name": attached_project.get("title") if attached_project else None,
            "reference_answer": reference_answer,
            "difficulty": "hard" if _skill_category(skill) in {"cloud", "ai_ml", "database"} else str(INTERVIEW_CONFIG["difficulty"]),
        })

    fill_index = 0
    while len(questions) < count and selected_projects:
        project = selected_projects[fill_index % len(selected_projects)]
        fallback_skill = (project.get("tech_stack") or [None])[0]
        text, intent, reference_answer = _build_project_question_from_context(project, fallback_skill, fill_index + len(questions))
        _append_unique_question(questions, used_fingerprints, {
            "text": text if text.endswith("?") else f"{text}?",
            "type": "project",
            "topic": f"project:{_normalize(fallback_skill or project.get('title') or 'implementation')}",
            "intent": intent,
            "focus_skill": fallback_skill,
            "project_name": project.get("title"),
            "reference_answer": reference_answer,
            "difficulty": str(INTERVIEW_CONFIG["difficulty"]),
        })
        fill_index += 1

    return questions[:count]


def _build_hr_questions(count: int) -> list[dict[str, object]]:
    questions: list[dict[str, object]] = []
    for index in range(count):
        pattern = HR_QUESTION_PATTERNS[index % len(HR_QUESTION_PATTERNS)]
        questions.append({
            "text": pattern["text"],
            "type": "hr",
            "topic": "hr:behavioral",
            "intent": pattern["intent"],
            "focus_skill": None,
            "project_name": None,
            "reference_answer": pattern["reference_answer"],
            "difficulty": str(INTERVIEW_CONFIG["difficulty"]),
        })
    return questions


def _build_resume_skill_fallback_questions(
    *,
    resume_skills: Sequence[str],
    jd_skills: Sequence[str],
    count: int,
) -> list[dict[str, object]]:
    if count <= 0:
        return []

    targets = _dedupe_keep_order(list(jd_skills) + list(resume_skills), limit=max(count * 2, 8))
    if not targets:
        targets = ["problem solving", "system design", "debugging", "testing"]

    questions: list[dict[str, object]] = []
    used_fingerprints: set[str] = set()

    for index in range(count * 3):
        skill = targets[index % len(targets)]
        category = _skill_category(skill)
        if category == "cloud":
            variants = [
                (
                    f"You mentioned {skill} in your resume. Walk me through a real implementation where you used it, including architecture, security boundaries, and failure handling decisions.",
                    "Assess conceptual and practical cloud depth even when project parsing is incomplete.",
                    "A strong answer ties the technology to a real implementation, explains the design, and covers reliability, permissions, and trade-offs.",
                ),
                (
                    f"Think of a system where you used {skill}. What was the most important deployment or infrastructure decision, and what problem was that decision solving?",
                    "Assess whether the candidate can explain cloud design decisions through a concrete system problem.",
                    "A strong answer identifies a real deployment problem, explains the chosen cloud design, and connects it to reliability, scalability, or operational simplicity.",
                ),
                (
                    f"In one real project, where did {skill} introduce the biggest trade-off between simplicity, cost, and scalability, and how did you decide what mattered most?",
                    "Assess cloud trade-off reasoning rather than generic service naming.",
                    "A strong answer explains the workload context, compares realistic trade-offs, and justifies the chosen approach.",
                ),
            ]
            text, intent, reference_answer = variants[index % len(variants)]
        elif category == "ai_ml":
            variants = [
                (
                    f"You mentioned {skill} in your resume. Describe a real use case where you applied it, and explain how you validated model quality, handled data issues, and reasoned about failure cases.",
                    "Assess deeper machine-learning understanding grounded in real usage rather than textbook definitions.",
                    "A strong answer covers data preparation, modeling choices, evaluation, error analysis, and realistic limitations.",
                ),
                (
                    f"Tell me about a real ML implementation where {skill} mattered. How did you know the model was actually solving the right problem and not just fitting a few examples?",
                    "Assess conceptual model-evaluation depth from actual experience.",
                    "A strong answer explains evaluation strategy, error patterns, and how the candidate checked whether the system generalized meaningfully.",
                ),
                (
                    f"When you used {skill} in practice, what was the hardest judgment call around data quality, features, or edge cases, and how did that affect the final behavior of the system?",
                    "Assess practical ML judgment and reasoning under imperfect data conditions.",
                    "A strong answer discusses a real modeling judgment, the risks involved, and the impact on system quality or reliability.",
                ),
            ]
            text, intent, reference_answer = variants[index % len(variants)]
        elif category == "database":
            variants = [
                (
                    f"You listed {skill} in your resume. In a real build, how did it shape your data model, query design, and correctness or performance trade-offs?",
                    "Assess data modeling and correctness depth from claimed resume skills.",
                    "A strong answer explains schema or data design, important queries, constraints, and the trade-offs made for correctness and performance.",
                ),
                (
                    f"Describe one real feature where {skill} mattered at the data layer. What data structure or query choice was most important, and why?",
                    "Assess whether the candidate can explain a database-backed feature through concrete design choices.",
                    "A strong answer identifies a real feature, explains the important schema or query decision, and ties it to correctness or performance.",
                ),
                (
                    f"Think about a production-like issue involving {skill}. What kind of invalid state, duplicate update, or slow query could happen, and how did your design prevent it?",
                    "Assess correctness, consistency, and performance reasoning in data-heavy systems.",
                    "A strong answer identifies a realistic failure mode and explains the technical mechanism used to prevent or reduce it.",
                ),
            ]
            text, intent, reference_answer = variants[index % len(variants)]
        elif category == "frontend":
            concept_label, concept_detail = _technology_concept_seed(skill, category, index)
            variants = [
                (
                    f"You mentioned {skill} in your resume. In one real frontend implementation, how did your understanding of {concept_label} change the final design or code structure?",
                    "Assess deeper frontend understanding from claimed resume skills rather than shallow syntax recall.",
                    "A strong answer connects frontend concepts such as semantics, rendering, forms, accessibility, or browser behavior to a real implementation decision.",
                ),
                (
                    f"Tell me about a UI or page where {skill} mattered. What was the hardest conceptual issue around {concept_detail}, and how did you reason through it?",
                    "Assess conceptual frontend reasoning around user interaction, accessibility, and browser behavior.",
                    "A strong answer explains the conceptual challenge, the implementation reasoning, and the final trade-offs in the UI or page design.",
                ),
                (
                    f"If I look at a real feature you built with {skill}, what part would reveal whether you truly understood browser behavior, semantics, or accessibility, and why?",
                    "Assess whether the candidate can connect frontend quality to deeper concepts instead of only implementation mechanics.",
                    "A strong answer identifies a concrete feature area and explains how deeper frontend understanding affects usability, correctness, and maintainability.",
                ),
            ]
            text, intent, reference_answer = variants[index % len(variants)]
        elif category in {"backend", "database", "cloud", "ai_ml"}:
            concept_label, concept_detail = _technology_concept_seed(skill, category, index)
            variants = [
                (
                    f"You mentioned {skill} in your resume. In one real implementation, how did your understanding of {concept_label} shape the final design?",
                    "Assess conceptual depth from resume skills by forcing the candidate to explain design reasoning instead of definitions.",
                    "A strong answer connects the technology to a real implementation and explains how deeper conceptual understanding influenced the design or architecture.",
                ),
                (
                    f"Tell me about a system where {skill} mattered. What was the hardest conceptual issue around {concept_detail}, and how did you reason through it?",
                    "Assess real-world technical judgment around architecture, correctness, or operational behavior.",
                    "A strong answer identifies a real conceptual challenge, explains the reasoning process, and ties the solution back to practical system behavior.",
                ),
                (
                    f"If I examine a real feature you built with {skill}, which part would best reveal whether you truly understood its deeper behavior and trade-offs, and why?",
                    "Assess whether the candidate can identify where real understanding shows up in an implemented system.",
                    "A strong answer points to a concrete feature or subsystem and explains what deeper understanding of the technology changed in the implementation.",
                ),
            ]
            text, intent, reference_answer = variants[index % len(variants)]
        else:
            variants = [
                (
                    f"You have worked with {skill} according to your resume. Explain one real implementation where it mattered, what design decision depended on it, and what trade-off you had to make.",
                    "Assess whether claimed skills can be defended through real implementation experience.",
                    "A strong answer connects the skill to a concrete implementation, explains a real design decision, and discusses a meaningful trade-off.",
                ),
                (
                    f"Tell me about a feature where {skill} was central to the implementation. Why was it the right fit there, and what limitation did you have to accept because of that choice?",
                    "Assess whether the candidate can tie a claimed skill to a concrete feature and justify its use.",
                    "A strong answer anchors the skill to a real feature, explains why it fit, and discusses a meaningful limitation or trade-off.",
                ),
                (
                    f"Think of one project where {skill} influenced the architecture or implementation style. What would have changed if you had used a different technology instead?",
                    "Assess comparison thinking and depth of implementation understanding for claimed resume skills.",
                    "A strong answer compares realistic alternatives and explains what the chosen technology enabled or constrained in the actual build.",
                ),
            ]
            text, intent, reference_answer = variants[index % len(variants)]

        if _append_unique_question(questions, used_fingerprints, {
            "text": text if text.endswith("?") else f"{text}?",
            "type": "project",
            "topic": f"skill:{_normalize(skill)}",
            "intent": intent,
            "focus_skill": skill,
            "project_name": None,
            "reference_answer": reference_answer,
            "difficulty": "hard" if category in {"cloud", "ai_ml", "database"} else str(INTERVIEW_CONFIG["difficulty"]),
        }) and len(questions) >= count:
            break

    return questions[:count]


def _adjust_counts_for_projects(
    base_counts: Mapping[str, int],
    projects: Sequence[Mapping[str, object]],
) -> dict[str, int]:
    counts = {
        "intro": int(base_counts.get("intro") or 0),
        "project": int(base_counts.get("project") or 0),
        "hr": int(base_counts.get("hr") or 0),
    }
    project_count = len(projects)
    if project_count <= 0:
        return counts
    minimum_project_questions = project_count
    if project_count > 1:
        minimum_project_questions += 1
    if counts["project"] >= minimum_project_questions:
        return counts
    counts["project"] = minimum_project_questions
    return counts


def _build_llm_prompt(
    *,
    resume_text: str,
    jd_title: str | None,
    jd_skill_scores: Mapping[str, int],
    projects: list[dict[str, object]],
    counts: Mapping[str, int],
    resume_skills: Sequence[str],
) -> str:
    jd_skills = [
        {"skill": str(skill), "weight": int(weight)}
        for skill, weight in sorted((jd_skill_scores or {}).items(), key=lambda x: -x[1])[:12]
        if str(skill).strip()
    ]
    structured_projects = _structured_projects_payload(projects[:4])
    extracted_resume_skills = _dedupe_keep_order(list(resume_skills), limit=20)
    related_topic_clusters = _build_related_topic_clusters(
        resume_skills=resume_skills,
        jd_skill_scores=jd_skill_scores,
        projects=projects,
    )
    resume_snippet = re.sub(r"\s+", " ", (resume_text or "").strip())[:2200]
    response_schema = [
        {
            "text": "string",
            "type": "intro|project|hr",
            "topic": "string",
            "intent": "string",
            "focus_skill": "string|null",
            "project_name": "string|null",
            "reference_answer": "string",
            "difficulty": "easy|medium|hard",
        }
    ]
    return f"""You are an expert technical interviewer.
Generate deeply specific interview questions for the role: {jd_title or 'Software Developer'}.
Return ONLY a valid JSON array of exactly {sum(counts.values())} objects.

Question distribution:
- {counts['intro']} self-introduction / warm-up question
- {counts['project']} deep technical questions based on the candidate's ACTUAL projects and matched JD skills
- {counts['hr']} HR / behavioral questions

Candidate resume snippet:
{resume_snippet}

Resume technologies and topics detected:
{json.dumps(extracted_resume_skills, ensure_ascii=False, indent=2)}

JD skills (weighted):
{json.dumps(jd_skills, ensure_ascii=False, indent=2)}

Structured extracted projects:
{json.dumps(structured_projects, ensure_ascii=False, indent=2)}

Related technology/topic clusters:
{json.dumps(related_topic_clusters, ensure_ascii=False, indent=2)}

Hard requirements:
- The first question must be the introduction question.
- The last {counts['hr']} question(s) must be HR / behavioral questions.
- Keep self-intro and HR questions natural; do not rewrite them into robotic wording.
- Every project question must mention the exact extracted project_name.
- Never use placeholder phrases like 'main project', 'one of your projects', 'your project', or 'tell me about your main project'.
- Skill questions must be practical and tied to actual project usage, implementation decisions, debugging, architecture, database design, backend logic, validations, performance, concurrency, edge cases, integrations, or deployment choices.
- Use the technologies and topics explicitly present in the resume. Do not fall back to generic textbook questions.
- For each important technology mentioned in the resume or JD, prefer concept-heavy questions about behavior, design trade-offs, failure cases, architecture, performance, data flow, accessibility, security, or correctness.
- For technical questions, prefer direct conceptual questioning over scenario-style phrasing.
- Avoid repeatedly using phrasing like 'tell me about a time', 'walk me through a real implementation', or other generic scenario wording for technical rounds.
- Ask about technologies first, but always anchor them to the candidate's real projects, modules, architecture, or integrations.
- Ask interconnected questions across related topics. For example: frontend structure with state flow and accessibility; Java with Spring and SQL; AWS with deployment and scaling; ML with data, evaluation, and inference.
- Make the technical questions feel like a strong interviewer probing conceptual understanding of related topics, not asking for stories.
- If there are multiple projects, cover each project at least once before repeating any single project.
- If there are at least two projects, include at least one cross-project comparison or transfer-of-learning question.
- If the project stack contains AI/ML, AWS/cloud, databases, or backend frameworks, ask conceptually deep implementation questions on those exact technologies rather than generic definitions.
- Do NOT ask textbook questions like 'What is Java?', 'Explain SQL joins', or 'What is Spring Boot?'
- Prefer the strongest and most JD-relevant projects first.
- Questions should become progressively deeper: project understanding -> implementation -> trade-offs/challenges.
- Avoid repeated angles across questions and do not repeat any question anywhere in the interview.
- If project details are limited, still anchor the question to the real project name and known stack.
- Use stack names naturally when present.

Quality bar examples:
- Good: 'In Movie Ticket Booking System, how did you implement seat selection and prevent users from booking invalid or expired shows?'
- Good: 'You used Spring Boot and AngularJS in Movie Ticket Booking System — how did you split responsibilities between frontend and backend?'
- Bad: 'Tell me about your main project.'
- Bad: 'What is Java?'

Each JSON object must match this shape:
{json.dumps(response_schema, ensure_ascii=False, indent=2)}
"""


def _call_llm_for_questions(
    *,
    resume_text: str,
    jd_title: str | None,
    jd_skill_scores: Mapping[str, int],
    projects: list[dict[str, object]],
    counts: Mapping[str, int],
    resume_skills: Sequence[str],
) -> list[dict[str, object]] | None:
    try:
        from groq import Groq
        api_key = os.getenv("GROQ_API_KEY") or os.getenv("LLM_API_KEY") or os.getenv("API_KEY") or ""
        if not api_key:
            logger.info("No LLM API key found for interview question generation.")
            return None
        system_prompt = (
            "You are a senior technical interviewer. "
            "Write sharp, resume-grounded interview questions. "
            "Prefer concrete implementation depth over generic theory."
        )
        response = Groq(api_key=api_key).chat.completions.create(
            model=os.getenv("GROQ_LLM_MODEL", "llama-3.1-8b-instant"),
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": _build_llm_prompt(
                        resume_text=resume_text,
                        jd_title=jd_title,
                        jd_skill_scores=jd_skill_scores,
                        projects=projects,
                        counts=counts,
                        resume_skills=resume_skills,
                    ),
                },
            ],
            temperature=0.35,
            max_tokens=3200,
        )
        raw = (response.choices[0].message.content or "").strip()
        raw = re.sub(r"```(?:json)?", "", raw).strip().strip("`")
        match = re.search(r"\[.*\]", raw, re.DOTALL)
        if match:
            raw = match.group(0)
        data = json.loads(raw)
        if not isinstance(data, list):
            return None
        result: list[dict[str, object]] = []
        used_fingerprints: set[str] = set()
        project_names = {str(project.get("title") or "").strip().lower() for project in projects if str(project.get("title") or "").strip()}
        for item in data:
            if not isinstance(item, dict):
                continue
            text = str(item.get("text") or "").strip()
            q_type = str(item.get("type") or "project")
            project_name = str(item.get("project_name") or "").strip() or None
            if not text:
                continue
            lowered_text = text.lower()
            if any(phrase in lowered_text for phrase in ["main project", "one of your projects", "your project", "tell me about your main project"]):
                continue
            if q_type == "project":
                resolved_project_name = (project_name or "").strip().lower()
                mentions_real_project = any(name and name in lowered_text for name in project_names)
                if not mentions_real_project and resolved_project_name not in project_names:
                    continue
            candidate = {
                "text": text if text.endswith("?") else f"{text}?",
                "type": q_type,
                "topic": str(item.get("topic") or "general"),
                "intent": str(item.get("intent") or "Assess candidate understanding and communication."),
                "focus_skill": item.get("focus_skill"),
                "project_name": project_name,
                "reference_answer": str(item.get("reference_answer") or "A strong answer should be relevant, practical, and clearly explained."),
                "difficulty": str(item.get("difficulty") or INTERVIEW_CONFIG["difficulty"]),
            }
            _append_unique_question(result, used_fingerprints, candidate)
        result = _sanitize_question_order(result)
        return result if len(result) >= sum(counts.values()) else None
    except Exception as exc:
        logger.warning("LLM question generation failed (%s). Using deterministic generator.", exc)
        return None


def build_question_bundle(*, resume_text: str, jd_title: str | None, jd_skill_scores: Mapping[str, int] | None, question_count: int | None = None, project_ratio: float | None = None) -> dict[str, object]:
    total = int(question_count or INTERVIEW_CONFIG["total_questions"])
    projects = extract_projects_from_resume(resume_text, known_skills=jd_skill_scores or {})
    resume_skills = _extract_resume_skills(resume_text, known_skills=jd_skill_scores or {})
    counts = _adjust_counts_for_projects(_section_counts(total, project_ratio=project_ratio), projects)
    questions = _call_llm_for_questions(
        resume_text=resume_text,
        jd_title=jd_title,
        jd_skill_scores=jd_skill_scores or {},
        projects=projects,
        counts=counts,
        resume_skills=resume_skills,
    )
    generated_by = "llm"

    if not questions and _llm_question_mode() == "required":
        raise RuntimeError(
            "LLM question generation is required, but no valid LLM-generated question set was produced. "
            "Set GROQ_API_KEY and ensure the LLM is reachable, or change INTERVIEW_QUESTION_MODE to 'preferred'."
        )

    if not questions:
        practical_questions = _build_practical_questions(projects, jd_skill_scores or {}, counts["project"], resume_skills=resume_skills)
        if len(practical_questions) < counts["project"] and projects:
            remaining_needed = counts["project"] - len(practical_questions)
            supplemental = _build_practical_questions(projects, {}, remaining_needed, resume_skills=resume_skills)
            seen = {_question_fingerprint(item.get("text", "")) for item in practical_questions}
            for item in supplemental:
                fingerprint = _question_fingerprint(str(item.get("text") or ""))
                if fingerprint and fingerprint not in seen:
                    seen.add(fingerprint)
                    practical_questions.append(item)
                if len(practical_questions) >= counts["project"]:
                    break
        if len(practical_questions) < counts["project"]:
            fallback_skill_questions = _build_resume_skill_fallback_questions(
                resume_skills=resume_skills,
                jd_skills=_sorted_jd_skills(jd_skill_scores or {}),
                count=counts["project"] - len(practical_questions),
            )
            seen = {_question_fingerprint(item.get("text", "")) for item in practical_questions}
            for item in fallback_skill_questions:
                fingerprint = _question_fingerprint(str(item.get("text") or ""))
                if fingerprint and fingerprint not in seen:
                    seen.add(fingerprint)
                    practical_questions.append(item)
                if len(practical_questions) >= counts["project"]:
                    break
        questions = _sanitize_question_order([dict(INTRO_QUESTION) for _ in range(counts["intro"])] + practical_questions[:counts["project"]] + _build_hr_questions(counts["hr"]))
        generated_by = "deterministic"
    return {
        "questions": questions[:sum(counts.values())],
        "total_questions": sum(counts.values()),
        "project_questions_count": counts["project"],
        "theory_questions_count": counts["hr"],
        "projects": projects,
        "config": INTERVIEW_CONFIG,
        "generated_by": generated_by,
    }


def build_interview_question_bank(*, resume_text: str, jd_title: str | None, jd_skill_scores: Mapping[str, int] | None, question_count: int = 8, project_ratio: float = 0.80) -> list[dict[str, object]]:
    return list(build_question_bundle(
        resume_text=resume_text,
        jd_title=jd_title,
        jd_skill_scores=jd_skill_scores or {},
        question_count=question_count,
        project_ratio=project_ratio,
    )["questions"])
