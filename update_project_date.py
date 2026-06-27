import sqlite3
import os
from dotenv import load_dotenv

load_dotenv()

# We need to run this against the local SQLite database if it exists, or the PostgreSQL database
# Wait, in the previous session we were strictly migrating to Postgres, but for local dev the user uses SQLite.
# Let's check what database is configured.
DB_URL = os.getenv("DATABASE_URL", "sqlite:///./production.db")
if DB_URL.startswith("sqlite"):
    try:
        conn = sqlite3.connect("production.db")
        cursor = conn.cursor()
        cursor.execute("ALTER TABLE projects ADD COLUMN target_date DATE;")
        conn.commit()
        conn.close()
        print("Added target_date to SQLite projects table.")
    except Exception as e:
        print(f"Migration error or column already exists: {e}")
else:
    import psycopg2
    try:
        conn = psycopg2.connect(DB_URL)
        cursor = conn.cursor()
        cursor.execute("ALTER TABLE projects ADD COLUMN target_date DATE;")
        conn.commit()
        conn.close()
        print("Added target_date to Postgres projects table.")
    except Exception as e:
        print(f"Postgres migration error: {e}")
