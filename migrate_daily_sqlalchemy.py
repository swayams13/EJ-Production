import os
from sqlalchemy import text
from backend.services.db_service import engine

def run_migration():
    with engine.connect() as conn:
        try:
            print("Renaming column from avg_productivity_per_hour to avg_productivity_per_day...")
            conn.execute(text("ALTER TABLE workforce_master RENAME COLUMN avg_productivity_per_hour TO avg_productivity_per_day;"))
            print("Converting values to daily (* 8)...")
            conn.execute(text("UPDATE workforce_master SET avg_productivity_per_day = avg_productivity_per_day * 8.0;"))
            conn.commit()
            print("Migration successful.")
        except Exception as e:
            print("Migration error:", e)

if __name__ == "__main__":
    run_migration()
