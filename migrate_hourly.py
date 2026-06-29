import sqlite3
import psycopg2
from urllib.parse import urlparse

DATABASE_URL = "postgresql://user:password@localhost:5432/ej_tracker"
# In case it uses SQLite, I will try to detect what the app is using.
# Wait, from previous context, the user is strictly on PostgreSQL. Rule: 
# "The system must strictly use PostgreSQL. Do NOT use SQLite or any other database options. All migrations and queries must be Postgres-compatible."

def migrate_postgres():
    try:
        conn = psycopg2.connect("dbname=ej_tracker user=user password=password host=localhost port=5432")
        conn.autocommit = True
        cur = conn.cursor()
        
        # Check if the column exists
        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='workforce_master' and column_name='avg_productivity_per_day';
        """)
        if cur.fetchone():
            print("Renaming column from avg_productivity_per_day to avg_productivity_per_hour...")
            cur.execute("ALTER TABLE workforce_master RENAME COLUMN avg_productivity_per_day TO avg_productivity_per_hour;")
            print("Converting values to hourly (/ 8)...")
            cur.execute("UPDATE workforce_master SET avg_productivity_per_hour = avg_productivity_per_hour / 8.0;")
            print("Migration successful.")
        else:
            print("Column avg_productivity_per_day does not exist. Already migrated?")
            
        cur.close()
        conn.close()
    except Exception as e:
        print("Error migrating postgres:", e)

migrate_postgres()
