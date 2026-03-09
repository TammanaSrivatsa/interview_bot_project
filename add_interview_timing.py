"""
Migration script to add interview timing columns to results table
"""

from database import engine
from sqlalchemy import text


def add_timing_columns():
    with engine.connect() as conn:
        try:
            conn.execute(text(
                """
                ALTER TABLE results 
                ADD COLUMN IF NOT EXISTS interview_start_time VARCHAR(50)
                """
            ))
            conn.execute(text(
                """
                ALTER TABLE results 
                ADD COLUMN IF NOT EXISTS interview_end_time VARCHAR(50)
                """
            ))
            conn.commit()
            print("Successfully added interview_start_time and interview_end_time columns")
        except Exception as e:
            print(f"Error: {e}")


if __name__ == "__main__":
    add_timing_columns()
