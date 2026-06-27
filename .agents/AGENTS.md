
## Daily Progress Tracking
- Make a habit of saving daily progress after every session.
- Store what was done, what problems were faced, how they were solved, what is pending, and what needs to be done in the next session.
- Always store this in `projectprogress.md` in the workspace root.

- **Database Requirement**: The system must strictly use PostgreSQL. Do NOT use SQLite or any other database options. All migrations and queries must be Postgres-compatible.

## Deployment Workflow
- **Git Push Rules**: Whatever code is being pushed should ALWAYS be pushed first to the `demo` branch. 
- The entire codebase (frontend, backend, database scripts, everything) must be pushed to the `demo` branch.
- Only after verification on the `demo` branch should the code be merged and pushed to the `main` branch.
