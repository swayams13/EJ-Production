# EJ Production Tracker - Daily Progress Log

## Date: 2026-06-27

### What we did today:
- **Optimized Data Fetching:** Fixed massive N+1 query performance issues in the Progress Dashboard by implementing `selectinload` for SQLAlchemy relationships.
- **Cache Busting:** Eliminated persistent Next.js and browser caching issues on the frontend by adding dynamic timestamps to API calls.
- **Project Hold System:** Implemented a brand new "Hold" state for projects.
  - Added `status_note` and `hold_until_date` to the database via SQLite migrations.
  - Added an intuitive UI on the "Edit Projects" page to allow capturing hold reasons and dates.
  - Added "Edit Projects" permanently to the sidebar navigation.
- **Dashboard Hold Metrics:** Split dashboard metrics so that "On Hold" welding requirements do not inflate "Pending" capacity. Created a separate red highlight zone on the dashboard for held work.
- **Roadmap Organization:** Saved the complete Phase 1-18 project roadmap into `phase.md`.
- **Phase 3 Execution (Workforce Intelligence):** 
  - Updated the `users` database table to include `skill`, `department`, `experience`, and `base_productivity`.
  - Built the `/workforce` Next.js dashboard to track daily attendance and display efficiency rankings.
  - Removed `username` and `password` requirements for shop-floor workers, enabling fast supervisor entry.
- **Database Architecture Hardening:** Enforced PostgreSQL strictly across the backend and wrote a fully automated SQLite-to-PostgreSQL migration script (`migrate_sqlite_to_postgres.py`).
- **Phase 4 Execution (Smart Task Allocation Engine):**
  - Added the `DailyTaskAssignment` database model to `db_service.py` to store daily worker targets and overtime assignments.
  - Built the `scheduler` backend module to support fetching assignments and running the "Auto-Assign" algorithm based on worker `base_productivity`.
  - Implemented overtime allocation for high-efficiency workers when the project queue exceeds regular capacity.
  - Developed the `/scheduler` Next.js frontend page for supervisors to view and trigger auto-assignments.
  - Added the "Daily Scheduler" link to the main navigation sidebar.
- **Scheduler Enhancements & Bug Fixes:**
  - Standardized the frontend API calls in the scheduler to use `apiFetch` (including JWT authorization headers).
  - Fixed a critical `AttributeError` by sorting the task assignments using `created_at` instead of an invalid `target_date`.
  - Upgraded the Auto-Assign logic to support future planning dates (assumes all operators are available if no attendance logs exist for that date).
  - Enhanced the UI table to display real Worker Names and Project Quotation Numbers instead of raw database IDs.
- **Git Deployment Workflow Setup:** Established a strict rule in `.agents/AGENTS.md` to push all code to a `demo` branch first before merging to `main` for Railway deployments.

### Problems faced:
- The dashboard was very slow to load (15s+) due to hundreds of redundant database queries firing simultaneously.
- When saving changes, the frontend wouldn't update live due to aggressive Next.js static data caching.
- Railway deployments failed to add new database columns because the auto-migration transaction was rolling back if any single column already existed.
- Need to securely migrate existing SQLite data into the new strictly-enforced PostgreSQL database.
- We needed a way to assign tasks only to workers who were marked as "Present" for the day without manually filtering them.
- The `auto-assign` API crashed on Railway because it tried to sort projects by a non-existent `target_date` column, and it returned a 401 error because the frontend used a raw `fetch()` without passing the user's JWT token.
- Future date scheduling failed because the system aborted if zero attendance logs existed for that day.

### How we solved them:
- Rewrote `calculate_project_progress` to use explicit `selectinload` mapping, drastically reducing load times.
- Implemented `?t=timestamp` cache-busters on frontend API requests to guarantee live data.
- Refactored the `ALTER TABLE` startup script to run each column addition in isolated `try/except` blocks, fixing the Railway deploy.
- Built a secure, automated `migrate_sqlite_to_postgres.py` script that reads credentials directly from `.env` and transfers all data table-by-table.
- Integrated the new `AttendanceLog` table directly into the auto-assignment query to fetch only available workers dynamically.
- Replaced raw `fetch()` with the project's standard `apiFetch` utility to guarantee authentication headers, and changed the sort logic to `created_at`.
- Updated the auto-assign engine to check if *any* attendance was logged for a date; if not, it automatically assumes all Active Operators are available for future planning.

### What is pending:
- We need to test the Workforce Intelligence and Smart Task Allocation modules thoroughly with real workers on the shop floor.
- The metrics calculation currently uses placeholders for quality and efficiency scores; we need the precise formulas from management to calculate them based on actual feet welded / defects.
- Refine the auto-assignment algorithm to pull the exact remaining feet required per project from `ProjectProductionLine` instead of simulating distribution.

### What needs to be done next session:
- Execute Phase 5 (Weekly & Monthly Planning Engine).
- Finalize the Quality & Efficiency score calculation logic with exact formulas.
