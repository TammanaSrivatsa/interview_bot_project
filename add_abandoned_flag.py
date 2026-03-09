"""
Migration script to add interview_abandoned column to results table
"""

from database import engine
from sqlalchemy import text


def add_abandoned_column():
    with engine.connect() as conn:
        try:
            conn.execute(text(
                """
                ALTER TABLE results 
                ADD COLUMN IF NOT EXISTS interview_abandoned BOOLEAN DEFAULT FALSE
                """
            ))
            conn.commit()
            print("Successfully added interview_abandoned column")
        except Exception as e:
            print(f"Error: {e}")


if __name__ == "__main__":
    add_abandoned_column()
