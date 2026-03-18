import unittest

from ai_engine.phase2.question_builder import build_question_bundle


class QuestionBuilderTests(unittest.TestCase):
    def test_question_bundle_covers_projects_and_orders_sections(self):
        resume = """
        Candidate Name
        Skills: Python, FastAPI, AWS, S3, Lambda, Docker, TensorFlow, Scikit-learn, PostgreSQL, React
        Projects
        Smart Interview Analyzer
        Built an interview analysis platform using FastAPI, React, PostgreSQL, AWS S3 and Lambda.
        Implemented audio transcription pipeline, scoring workflow, validation rules, and admin dashboard.
        My role: designed backend APIs, integrated AWS storage, optimized response flow, and handled deployment.
        Crop Disease Detection System
        Developed an AI/ML system using Python, TensorFlow, OpenCV and AWS for classifying leaf diseases.
        Features: image preprocessing, model training, prediction API, confidence scoring
        Contribution: built training pipeline, evaluated model quality, and deployed inference endpoint.
        Expense Tracker Platform
        Created a personal finance app using React, FastAPI, Docker and PostgreSQL.
        Implemented authentication, transaction categorization, reporting dashboards, and export flow.
        """

        bundle = build_question_bundle(
            resume_text=resume,
            jd_title="AI Engineer",
            jd_skill_scores={
                "aws": 9,
                "tensorflow": 8,
                "python": 7,
                "postgresql": 6,
                "fastapi": 5,
                "react": 4,
            },
            question_count=8,
            project_ratio=0.8,
        )

        questions = bundle["questions"]
        texts = [item["text"] for item in questions]
        project_questions = [item for item in questions if item["type"] == "project"]

        self.assertEqual(questions[0]["type"], "intro")
        self.assertEqual(questions[-1]["type"], "hr")
        self.assertEqual(len(texts), len(set(texts)))
        self.assertTrue(any("Smart Interview Analyzer" in item["text"] for item in project_questions))
        self.assertTrue(any("Crop Disease Detection System" in item["text"] for item in project_questions))
        self.assertTrue(any("Expense Tracker Platform" in item["text"] for item in project_questions))
        self.assertTrue(any("both" in item["text"].lower() for item in project_questions))


if __name__ == "__main__":
    unittest.main()
