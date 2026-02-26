"""Quick local DB inspection and optional value cleanup."""

import argparse
from pathlib import Path
from typing import Iterable

from sqlalchemy import MetaData, inspect, text
from sqlalchemy.engine import make_url

from database import DATABASE_URL, SessionLocal, engine


def resolve_sqlite_path(db_url: str) -> str:
    """Resolve SQLite file path to an absolute path when possible."""
    parsed = make_url(db_url)
    if parsed.get_backend_name() != "sqlite":
        return "Not SQLite"

    db_name = parsed.database
    if not db_name:
        return "In-memory SQLite"

    path = Path(db_name)
    if not path.is_absolute():
        path = (Path.cwd() / path).resolve()
    return str(path)


def print_users(query: str, headers: Iterable[str], title: str) -> None:
    """Run a query and print user-like rows in a small table format."""
    print(f"\n{title}")
    print("-" * len(title))

    with SessionLocal() as db:
        rows = db.execute(text(query)).mappings().all()

    if not rows:
        print("No records found.")
        return

    print(" | ".join(headers))
    print("-" * (len(" | ".join(headers)) + 4))
    for row in rows:
        print(" | ".join(str(row.get(col, "")) for col in headers))


def show_db_snapshot() -> None:
    print(f"DATABASE_URL: {DATABASE_URL}")
    print(f"SQLite file : {resolve_sqlite_path(DATABASE_URL)}")

    inspector = inspect(engine)
    tables = inspector.get_table_names()

    print("\nTables in DB")
    print("------------")
    if not tables:
        print("No tables found.")
        return

    with SessionLocal() as db:
        for table in tables:
            count = db.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar_one()
            print(f"- {table}: {count} rows")

    if "candidates" in tables:
        print_users(
            query="SELECT id, name, email FROM candidates ORDER BY id",
            headers=["id", "name", "email"],
            title="Candidate users",
        )

    if "hr" in tables:
        print_users(
            query="SELECT id, company_name, email FROM hr ORDER BY id",
            headers=["id", "company_name", "email"],
            title="HR users",
        )


def clear_all_table_values() -> None:
    """Delete all rows from all tables but keep table structure."""
    metadata = MetaData()
    metadata.reflect(bind=engine)
    tables = list(metadata.sorted_tables)

    if not tables:
        print("No tables found. Nothing to clear.")
        return

    is_sqlite = engine.url.get_backend_name() == "sqlite"

    with SessionLocal() as db:
        if is_sqlite:
            db.execute(text("PRAGMA foreign_keys=OFF"))

        try:
            print("Deleting table values (tables will remain):")
            for table in reversed(tables):
                count = db.execute(text(f'SELECT COUNT(*) FROM "{table.name}"')).scalar_one()
                db.execute(table.delete())
                print(f"- {table.name}: deleted {count} rows")

            if is_sqlite:
                # Reset auto-increment counters when supported.
                try:
                    db.execute(text("DELETE FROM sqlite_sequence"))
                except Exception:
                    pass

            db.commit()
            print("All table values deleted successfully.")
        finally:
            if is_sqlite:
                db.execute(text("PRAGMA foreign_keys=ON"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect DB contents or clear all table values.")
    parser.add_argument(
        "--clear-all-values",
        action="store_true",
        help="Delete all rows from every table while keeping tables.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Required with --clear-all-values to confirm deletion.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.clear_all_values:
        if not args.yes:
            print("Refusing destructive action without confirmation.")
            print("Run: python checkin.py --clear-all-values --yes")
            return
        clear_all_table_values()
        return

    show_db_snapshot()


if __name__ == "__main__":
    main()
