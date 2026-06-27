import os
import sqlite3
from sqlalchemy import create_engine, MetaData
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

# Load the secure credentials from .env
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("❌ ERROR: DATABASE_URL is not set in the .env file.")
    print("Please add it to your .env file in the following format:")
    print("DATABASE_URL=postgresql://user:password@localhost:5432/ej_tracker")
    exit(1)

# Ensure correct prefix for SQLAlchemy
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Paths
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
SQLITE_DB_PATH = os.path.join(PROJECT_ROOT, "data", "production_tracker.db")

if not os.path.exists(SQLITE_DB_PATH):
    print(f"❌ ERROR: SQLite database not found at {SQLITE_DB_PATH}")
    exit(1)

print(f"🔄 Preparing to migrate from SQLite to PostgreSQL...")

# 1. Connect to PostgreSQL and create schemas
try:
    # We import the models to ensure metadata is registered
    from backend.services.db_service import Base
    pg_engine = create_engine(DATABASE_URL)
    Base.metadata.create_all(bind=pg_engine)
    print("✅ PostgreSQL schemas created successfully.")
except Exception as e:
    print(f"❌ ERROR connecting to PostgreSQL: {e}")
    exit(1)

# 2. Connect to SQLite
sqlite_engine = create_engine(f"sqlite:///{SQLITE_DB_PATH}")

# Set up metadata to reflect both databases
sqlite_meta = MetaData()
sqlite_meta.reflect(bind=sqlite_engine)

pg_meta = MetaData()
pg_meta.reflect(bind=pg_engine)

# 3. Migrate data table by table
with sqlite_engine.connect() as sqlite_conn:
    with pg_engine.begin() as pg_conn:
        for table_name in sqlite_meta.sorted_tables:
            print(f"Migrating table: {table_name.name}...")
            
            # Fetch all rows from SQLite
            rows = sqlite_conn.execute(table_name.select()).fetchall()
            
            if not rows:
                print(f"   -> Table is empty, skipping.")
                continue
                
            # Convert rows to a list of dicts
            data_to_insert = [dict(row._mapping) for row in rows]
            
            # Get the corresponding Postgres table
            pg_table = pg_meta.tables.get(table_name.name)
            
            if pg_table is not None:
                # Truncate existing data to prevent primary key collisions
                pg_conn.execute(pg_table.delete())
                # Insert data
                pg_conn.execute(pg_table.insert(), data_to_insert)
                print(f"   -> Migrated {len(rows)} rows.")
            else:
                print(f"   -> ❌ Table {table_name.name} does not exist in PostgreSQL!")

print("\n🎉 Migration completed successfully! Your data is now in PostgreSQL.")
print("You can now safely delete the SQLite database file if you wish.")
