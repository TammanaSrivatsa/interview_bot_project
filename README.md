Perfect 🔥
You’ve built a **serious AI system**, so your GitHub README should look professional and impressive.

Below is a clean, strong, FAANG-level README text you can directly paste into GitHub.

---

# 🚀 AI Interview Platform (Berribot-Style)

An AI-powered, real-time technical interview simulation platform that conducts dynamic, time-bound interviews based on the candidate’s resume and job description.

This system behaves like an intelligent FAANG-style interviewer — asking adaptive follow-up questions, analyzing silence, shifting phases automatically, and managing interview timing in real time.

---

## 🧠 Key Features

### 🎯 Resume + JD Based Dynamic Questioning

* Extracts resume and job description content
* Generates intelligent, context-aware questions
* Covers:

  * Academic background
  * Work experience
  * Projects
  * System design
  * Behavioral round

---

### 🔁 Anti-Repetition Engine

* Strict duplicate prevention
* Semantic comparison against previous questions
* AI instructed to never repeat similar variations
* Fallback protection logic included

---

### ⏳ Live Countdown Timer

* Real-time front-end countdown
* Auto ends interview when time expires
* Dynamic color transitions (Warning → Danger)

---

### 🎤 Voice-Based Interaction

* Speech-to-text for capturing answers
* Text-to-speech for asking questions
* Auto-detect silence
* Auto-move to next question if:

  * Candidate stops speaking
  * Candidate remains silent
  * Hard per-question timeout triggers

---

### 🧩 Adaptive Interview Flow (State Machine)

The interview follows a structured phase engine:

1. Introduction (fixed first question)
2. Resume Clarification
3. Work Experience Deep Dive
4. Project Deep Dive
5. System Design
6. HR / Behavioral

Automatically shifts based on:

* Time remaining
* Depth covered
* Silence detection

---

### ⚡ Time-Optimized Question Strategy

* If total interview is 2 minutes → rapid-fire questions
* If longer interview → deeper follow-ups
* Adjusts difficulty based on:

  * Candidate answer
  * Remaining time
  * Current interview phase

---

## 🏗 Tech Stack

### Backend

* FastAPI
* SQLAlchemy
* Groq LLM (Llama 3.1)
* Sentence Transformers
* Session-based state engine

### Frontend

* HTML + Jinja
* Web Speech API
* Speech Recognition API
* Live countdown system
* Camera + microphone integration

---

## 🧠 AI Intelligence Layer

The system uses:

* Context-aware prompt engineering
* Stage-based questioning strategy
* Deep drilling follow-up logic
* Anti-duplicate semantic guardrails
* Time-sensitive question generation

---

## 🔄 Interview Flow Logic

```
Start Interview
    ↓
Intro Question
    ↓
Resume-based Questions
    ↓
Experience Deep Dive
    ↓
Project Architecture Drill
    ↓
System Design Challenges
    ↓
HR Round
    ↓
Auto Interview Completion
```

---

## 🛡 Robust Controls

* Auto end on timeout
* Silence handling
* Per-question time cap
* Backend time validation
* Session reset protection
* Duplicate prevention layer

---

## 📂 Project Structure

```
AI_Interview_Platform/
│
├── routes/
│   ├── interview.py
│   ├── candidate.py
│   └── hr.py
│
├── ai_engine/
│   ├── question_generator.py
│   └── matching.py
│
├── templates/
│   ├── interview.html
│   └── base.html
│
├── models.py
├── database.py
├── main.py
└── README.md
```

---

## 🧪 Future Improvements (Planned)

* Emotion detection
* Confidence scoring
* Resume scoring system
* AI feedback report generation
* Performance analytics dashboard
* Multi-role interview modes
* Interview recording & playback
* Admin interview analytics panel

---

## 📌 What Makes This Unique?

Unlike basic chatbot interviews:

* Fully timed system
* Berribot-style structured flow
* Automatic silence handling
* Deep project drilling
* Dynamic question shifting
* Production-like interviewer behavior

---

## 💡 Use Cases

* College placement preparation
* Technical interview practice
* Hiring automation
* Resume-based screening
* AI-powered mock interviews

---

## ⚙ Setup

1. Clone repository
2. Create `.env` with:

```
GROQ_API_KEY=your_key_here
```

3. Install dependencies

```
pip install -r requirements.txt
```

4. Run

```
uvicorn main:app --reload
```

---

## 🧑‍💻 Author

Built as an advanced AI Interview Automation System for scalable hiring simulation and interview preparation.
