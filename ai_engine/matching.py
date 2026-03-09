import re

import PyPDF2
from docx import Document
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity

# --------------------------------------------------
# Load model globally (VERY IMPORTANT for speed)
# --------------------------------------------------
model = SentenceTransformer("all-MiniLM-L6-v2")


# --------------------------------------------------
# TEXT EXTRACTION
# --------------------------------------------------
def extract_text_from_file(file_path):
    try:
        if file_path.endswith(".pdf"):
            text = ""
            with open(file_path, "rb") as f:
                reader = PyPDF2.PdfReader(f)
                for page in reader.pages:
                    if page.extract_text():
                        text += page.extract_text()
            return text

        elif file_path.endswith(".docx"):
            doc = Document(file_path)
            return "\n".join([para.text for para in doc.paragraphs])

        elif file_path.endswith(".txt"):
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read()
    except:
        return ""

    return ""


# --------------------------------------------------
# AUTO SKILL EXTRACTION FROM JD
# --------------------------------------------------
def extract_skills_from_jd(jd_path):
    jd_text = extract_text_from_file(jd_path).lower()

    # Canonical skill -> text aliases found in JDs.
    # This avoids misses like "Node.js", "NodeJS", "RESTful APIs", etc.
    skill_aliases = {
        "python": ["python"],
        "java": ["java"],
        "c++": ["c++", "cpp"],
        "c#": ["c#", "c sharp"],
        "javascript": ["javascript", "js"],
        "typescript": ["typescript", "ts"],
        "react": ["react", "react.js", "reactjs"],
        "angular": ["angular", "angularjs"],
        "vue": ["vue", "vue.js", "vuejs"],
        "node": ["node", "node.js", "nodejs"],
        "express": ["express", "express.js", "expressjs"],
        "django": ["django"],
        "flask": ["flask"],
        "fastapi": ["fastapi"],
        "spring boot": ["spring boot", "springboot"],
        "sql": ["sql"],
        "mysql": ["mysql"],
        "postgresql": ["postgresql", "postgres", "psql"],
        "mongodb": ["mongodb", "mongo db", "mongo"],
        "redis": ["redis"],
        "machine learning": ["machine learning", "ml"],
        "deep learning": ["deep learning", "dl"],
        "nlp": ["nlp", "natural language processing"],
        "tensorflow": ["tensorflow", "tf"],
        "pytorch": ["pytorch"],
        "scikit-learn": ["scikit-learn", "sklearn"],
        "pandas": ["pandas"],
        "numpy": ["numpy"],
        "aws": ["aws", "amazon web services"],
        "azure": ["azure", "microsoft azure"],
        "gcp": ["gcp", "google cloud", "google cloud platform"],
        "docker": ["docker"],
        "kubernetes": ["kubernetes", "k8s"],
        "git": ["git", "github", "gitlab", "bitbucket"],
        "linux": ["linux", "unix"],
        "power bi": ["power bi", "powerbi"],
        "tableau": ["tableau"],
        "html": ["html", "html5"],
        "css": ["css", "css3"],
        "bootstrap": ["bootstrap"],
        "tailwind": ["tailwind", "tailwindcss"],
        "rest api": ["rest api", "restful api", "restful apis", "apis"],
        "graphql": ["graphql"],
        "microservices": ["microservices", "microservice"],
        "ci/cd": ["ci/cd", "ci cd", "continuous integration", "continuous deployment"],
        "data analysis": ["data analysis", "analytics"],
        "data science": ["data science"],
    }

    detected = []

    for canonical, aliases in skill_aliases.items():
        for alias in aliases:
            # Keep symbols for "c++", "c#", and "ci/cd", while using word boundaries where possible.
            if any(ch in alias for ch in ["+", "#", "/"]):
                if alias in jd_text:
                    detected.append(canonical)
                    break
            else:
                if re.search(rf"\b{re.escape(alias)}\b", jd_text):
                    detected.append(canonical)
                    break

    return detected


# --------------------------------------------------
# SEMANTIC MATCH SCORE
# --------------------------------------------------
def calculate_semantic_score(jd_text, resume_text):
    jd_embedding = model.encode(jd_text)
    resume_embedding = model.encode(resume_text)

    similarity = cosine_similarity(
        [jd_embedding],
        [resume_embedding],
    )[0][0]

    return float(similarity)


# --------------------------------------------------
# SKILL MATCHING
# --------------------------------------------------
def calculate_skill_score(skill_scores_dict, resume_text):
    total_score = 0
    max_score = sum(skill_scores_dict.values())

    resume_text_lower = resume_text.lower()
    matched_skills = []

    for skill, score in skill_scores_dict.items():
        if skill.lower() in resume_text_lower:
            total_score += score
            matched_skills.append(skill)

    if max_score == 0:
        return 0, []

    normalized = total_score / max_score
    return normalized, matched_skills


# --------------------------------------------------
# EDUCATION EXTRACTION
# --------------------------------------------------
def extract_education(text):
    text = text.lower()

    education_map = {
        "phd": ["phd", "doctorate"],
        "master": ["master", "m.tech", "msc", "mba", "mca"],
        "bachelor": ["bachelor", "b.tech", "bsc", "be", "bca"],
    }

    for level, keywords in education_map.items():
        for keyword in keywords:
            if keyword in text:
                return level

    return None


# --------------------------------------------------
# EXPERIENCE EXTRACTION
# --------------------------------------------------
def extract_experience(text):
    text = text.lower()
    matches = re.findall(r"(\d+)\s*(?:years|year|yrs|yr)", text)

    if matches:
        return max([int(m) for m in matches])

    return 0


# --------------------------------------------------
# ACADEMIC PERCENTAGE EXTRACTION (FINAL ROBUST VERSION)
# --------------------------------------------------
def extract_academic_percentages(text):
    text = text.lower()
    text = re.sub(r"\s+", " ", text)  # normalize spaces

    academic_data = {
        "10th": None,
        "intermediate": None,
        "engineering": None,
    }

    # -------------------------
    # 10th Detection
    # -------------------------
    tenth = re.search(r"(x boards|10th|ssc).*?(\d{2,3}(?:\.\d+)?)\s*%", text)
    if tenth:
        academic_data["10th"] = float(tenth.group(2))

    # -------------------------
    # Intermediate Detection
    # -------------------------
    inter = re.search(r"(xii boards|12th|intermediate|hsc).*?(\d{2,3}(?:\.\d+)?)\s*%", text)
    if inter:
        academic_data["intermediate"] = float(inter.group(2))

    # ------------------------------------------------
    # Engineering Detection (SUPER ROBUST)
    # ------------------------------------------------

    # 1) Direct percentage near engineering keywords
    eng_percent = re.search(
        r"(engineering|b\.?tech|b\.?e|bachelor).*?(\d{2,3}(?:\.\d+)?)\s*%",
        text,
    )

    if eng_percent:
        academic_data["engineering"] = float(eng_percent.group(2))
        return academic_data

    # 2) CGPA detection anywhere in resume
    cgpa_match = re.search(r"cgpa\s*[:\-]?\s*(\d+(?:\.\d+)?)", text)

    if cgpa_match:
        cgpa = float(cgpa_match.group(1))

        # If CGPA out of 10
        if cgpa <= 10:
            academic_data["engineering"] = round((cgpa / 10) * 100, 2)
        else:
            academic_data["engineering"] = cgpa

        return academic_data

    # 3) Generic GPA detection fallback
    gpa_match = re.search(r"(\d+(?:\.\d+)?)\s*(cgpa|gpa)", text)

    if gpa_match:
        gpa = float(gpa_match.group(1))
        if gpa <= 10:
            academic_data["engineering"] = round((gpa / 10) * 100, 2)
        else:
            academic_data["engineering"] = gpa

    return academic_data


# --------------------------------------------------
# FINAL AI SCORING ENGINE
# --------------------------------------------------
def final_score(
    jd_path,
    resume_path,
    skill_scores_dict,
    education_requirement=None,
    experience_requirement=0,
):
    jd_text = extract_text_from_file(jd_path)
    resume_text = extract_text_from_file(resume_path)

    # Extract Academic %
    academic_percentages = extract_academic_percentages(resume_text)

    # Semantic
    semantic_score = calculate_semantic_score(jd_text, resume_text)

    # Skills
    skill_score, matched_skills = calculate_skill_score(
        skill_scores_dict,
        resume_text,
    )

    # Education Check (Improved Matching)
    candidate_education = extract_education(resume_text)
    education_score = 1.0
    education_reason = "Education requirement satisfied."

    if education_requirement:
        req = education_requirement.lower()

        # Normalize resume education
        resume_edu = (candidate_education or "").lower()

        bachelor_keywords = ["bachelor", "b.tech", "btech", "b.e", "be", "bsc", "bca"]
        master_keywords = ["master", "m.tech", "mtech", "m.e", "me", "msc", "mca"]

        matched = False

        if req in bachelor_keywords:
            for word in bachelor_keywords:
                if word in resume_edu:
                    matched = True
                    break

        elif req in master_keywords:
            for word in master_keywords:
                if word in resume_edu:
                    matched = True
                    break

        else:
            if req in resume_edu:
                matched = True

        if not matched:
            education_score = 0.0
            education_reason = f"Required {education_requirement}, found {candidate_education or 'None'}"

    # Experience Check
    candidate_experience = extract_experience(resume_text)
    experience_score = 1.0
    experience_reason = "Experience requirement satisfied."

    if experience_requirement:
        if candidate_experience < experience_requirement:
            experience_score = 0.0
            experience_reason = f"Required {experience_requirement} years, found {candidate_experience}"

    # Academic 60% Rule
    percentage_score = 1.0
    percentage_reason = "Academic percentage criteria satisfied."

    for level, value in academic_percentages.items():
        if value is not None and value < 60:
            percentage_score = 0.0
            percentage_reason = f"{level} below 60%"
            break

    # Final Score Calculation
    final = (
        semantic_score * 0.30
        + skill_score * 0.25
        + education_score * 0.15
        + experience_score * 0.15
        + percentage_score * 0.15
    )

    final_percentage = round(final * 100, 2)

    explanation = {
        "semantic_score": round(semantic_score * 100, 2),
        "skill_score": round(skill_score * 100, 2),
        "matched_skills": matched_skills,
        "education_reason": education_reason,
        "experience_reason": experience_reason,
        "total_experience_detected": candidate_experience,
        "academic_percentages": academic_percentages,
        "percentage_reason": percentage_reason,
    }

    return final_percentage, explanation
