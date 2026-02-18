import os
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))


def generate_dynamic_question(
    jd_text,
    resume_text,
    last_answer,
    stage,
    asked_questions,
    remaining_time_minutes,
    current_project=None,
    current_experience=None,
    question_mode="deep"
):

    # -------------------------------------------------
    # TIME-BASED QUESTION STYLE
    # -------------------------------------------------

    if question_mode == "lightning":
        time_instruction = """
Interview is ending very soon.
Ask extremely short, high-impact, rapid-fire technical questions.
No long scenarios.
No multi-part questions.
Be sharp and concise.
"""
    elif question_mode == "rapid":
        time_instruction = """
Time is limited.
Ask focused technical questions.
Avoid long system design problems.
Keep questions compact but meaningful.
"""
    else:
        time_instruction = """
Ask structured, in-depth, architecture-level questions.
Escalate difficulty logically.
Push for deep technical reasoning.
"""

    # -------------------------------------------------
    # WEAK ANSWER DETECTION
    # -------------------------------------------------

    weak_answer_instruction = ""
    if last_answer and len(last_answer.strip()) < 15:
        weak_answer_instruction = """
The candidate's previous answer was weak or too short.
Do NOT repeat the previous question.
Reframe the topic differently or move to a new angle.
Increase clarity and depth.
"""

    # -------------------------------------------------
    # STAGE FOCUS
    # -------------------------------------------------

    if stage == "experience" and current_experience:
        focus = f"""
Deeply analyze this work experience:
{current_experience}

Ask about:
- Production impact
- Architectural decisions
- Scaling challenges
- Debugging incidents
- Performance optimization
- Ownership
- Trade-offs

Drill based on the last answer.
No repetition.
"""

    elif stage == "advanced_projects" and current_project:
        focus = f"""
Focus deeply on this project:
{current_project}

If e-commerce:
Scalability, caching, microservices, payments, fraud detection,
cloud deployment, monitoring.

If AI/Cloud:
Model lifecycle, MLOps, deployment, distributed systems,
cost optimization, retraining, monitoring.

Escalate complexity.
No repetition.
"""

    elif stage == "deep_dive":
        focus = """
Ask advanced system design or architecture questions.
Discuss bottlenecks, failures, HA, distributed systems,
edge cases and trade-offs.
No repetition.
"""

    elif stage == "basics":
        focus = """
Ask foundational technical questions clearly.
Test conceptual clarity.
No repetition.
"""

    else:  # HR
        focus = """
Ask strong behavioral and leadership questions.
Focus on:
- Conflict
- Failures
- Ownership
- Pressure situations
- Decision making

No repetition.
"""

    # -------------------------------------------------
    # CONTEXT BLOCKS
    # -------------------------------------------------

    project_context = ""
    if current_project:
        project_context += f"\nCurrent Project:\n{current_project}\n"

    experience_context = ""
    if current_experience:
        experience_context += f"\nCurrent Experience:\n{current_experience}\n"

    # -------------------------------------------------
    # FINAL PROMPT
    # -------------------------------------------------

    prompt = f"""
You are conducting a dynamic FAANG-level technical interview.

Resume:
{resume_text}

Job Description:
{jd_text}

Last Answer:
{last_answer}

Forbidden Questions:
{asked_questions}

Remaining Time:
{remaining_time_minutes} minutes

Stage:
{stage}

{project_context}
{experience_context}

Time Behavior:
{time_instruction}

Weak Answer Behavior:
{weak_answer_instruction}

Stage Instructions:
{focus}

STRICT RULES:

1. Ask ONLY ONE question.
2. Never generate a question semantically similar to Forbidden Questions.
3. Do not restate previous topics in similar wording.
4. No numbering.
5. No explanations.
6. Output only the raw question.
7. Never ask to introduce again.
8. Avoid long multi-part structures in rapid/lightning mode.
9. If in lightning mode, keep question under 20 words.
10. Escalate difficulty logically.

Generate the next completely unique interview question.
"""

    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {
                "role": "system",
                "content": "You are a strict FAANG interviewer. Never repeat. Adapt to time pressure."
            },
            {"role": "user", "content": prompt}
        ],
        temperature=0.15,  # lower = less repetition
        max_tokens=180 if question_mode == "lightning" else 250
    )

    return response.choices[0].message.content.strip()
