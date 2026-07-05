# CLAUDE.md - Project Instructions & Guidelines

This file lists the command-line patterns, development constraints, database requirements, and git workflow rules for the EJ Production Tracker.

---

## 🚀 Build, Run & Test Commands

### 1. Backend (Python/FastAPI)
- **Start Development Server**: `python -m uvicorn backend.main:app --port 8003 --reload` (or run `python backend/main.py` directly)
- **Install Dependencies**: `pip install -r requirements.txt` (always run from the project root)
- **Run Individual Scripts**: `python <script_name>.py` (run from the project root)

### 2. Frontend (Next.js/TSX)
- **Start Development Server**: `npm --prefix next-frontend run dev`
- **Build Production Bundle**: `npm --prefix next-frontend run build`
- **Lint Codebase**: `npm --prefix next-frontend run lint`
- **Install Dependencies**: `npm --prefix next-frontend install`

---

## 🛠️ Codebase & Architecture Rules

### 1. Database Requirements
- ⚠️ **Strictly PostgreSQL**: The application must strictly use PostgreSQL. Do NOT use SQLite or any other database options. All models, queries, and migrations must remain fully Postgres-compatible.

### 2. Dependency Management
- 📦 **Root requirements.txt**: Always add new python packages/dependencies to the **root** `requirements.txt` file (not inside `/backend/requirements.txt`). Railway builds python environments from the root `requirements.txt`, and sub-directory files will lead to missing dependency runtime errors.

### 3. Git Deployment Workflow (Railway)
- 🚩 **Push to `demo` First**: All changes must be committed and pushed to the `demo` branch first. The entire codebase (frontend, backend, database scripts) must be tested on the `demo` branch.
- 🚫 **No Automatic Merging**: Do NOT automatically merge `demo` into `main`. Always ask the user for permission to merge after they have manually verified the changes on the `demo` deployment.
- 🚀 **Railway Tracking**: Railway deploys automatically from the `main` branch. Never push experimental or unverified changes directly to `main`.

### 4. Progress Tracking
- 📝 **Update projectprogress.md**: At the end of every development session, document the work in `projectprogress.md` in the workspace root.
- **Content**: Detail what was done, what problems were faced, how they were solved, what is pending, and what needs to be done in the next session.

### 5. Mistakes Log
- Refer to `mistakes.md` in the workspace root for past deployment logs, branch configuration errors, and dependency resolution details to avoid repeat issues.

### 6. Domain Logic Reference
- 📚 **Read `docs/EJ_DJ_CALCULATION_LOGIC.md` before touching welding-feet, resource-count, or scheduler calculations.** It documents the EJ (TIG+MIG+Grinding) vs DJ (MIG+Grinding only, no TIG) business rule, the full data flow from Excel import to per-project feet, the two centralized helper functions (`compute_master_feet`, `aggregate_line_feet`) that must not be re-duplicated, and known/deliberate limitations. This logic was fixed after being independently reimplemented in 7 different files — don't add an 8th.
