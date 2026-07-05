# Development Log: Mistakes & Rectifications

This document tracks common pitfalls, deployment issues, and architectural mistakes encountered during the development of the EJ Production Tracker, alongside their rectifications to ensure they are avoided in the future.

## 1. Branch Syncing & Railway Deployments
**The Mistake:**
During the heavy Phase 1 architectural refactoring (moving the monolithic `main.py` into a Domain-Driven Design), significant updates were pushed to the `demo` branch. However, Railway was configured to deploy from the `main` branch by default, meaning the live server was running an outdated version of the Next.js frontend and the old monolithic backend.

**The Rectification:**
- Diagnosed the issue by comparing the frontend UI discrepancies between localhost and the Railway dashboard.
- Ran `git checkout main && git merge demo && git push origin main` to sync the changes to the deployment target.
- **Future Rule:** Always verify which branch the cloud provider (Railway) is tracking. When deploying updates, ensure they are merged into the correct deployment branch (e.g., `main`).

## 2. Dependency Management in Monorepos
**The Mistake:**
After migrating to stateless JWT Authentication, the backend started crashing on Railway with a `ModuleNotFoundError: No module named 'jwt'`. The `PyJWT` package was mistakenly added to `backend/requirements.txt`, but Railway was configured to build the Python environment from the root `requirements.txt`.

**The Rectification:**
- Inspected the Railway crash logs to confirm the missing dependency.
- Checked the directory structure to realize Railway invokes `pip install -r requirements.txt` from the repository root.
- Moved `PyJWT==2.13.0` into the root `/requirements.txt` file and pushed the hotfix to trigger a successful rebuild.
- **Future Rule:** Always add new Python package dependencies to the root `requirements.txt` file, not sub-directory files, to ensure the CI/CD pipeline installs them correctly.

## 3. Trusting Automated Bug Audits Without Re-Verifying Against Actual Code

**The Mistake:**
During a bug-hunting pass (2026-07-05), two independent audit sub-agents both confidently flagged the same "bug" in `mes_service.py`'s progress-completion formula (`fabrication * 0.7 + welding_pct * 30.0`), claiming the `30.0` should be `0.3`. Both were wrong — the formula is correct because `Part.weight_percentage` values sum to 100 per joint template (see `backend/services/templates.py`), not 0–1 as the agents assumed. A separate agent also mis-reported the DJ MIG-feet aggregation as an active "double-counting" bug in files where it was actually harmless (the addition only has a real effect in one narrow fallback path).

**The Rectification:**
- Before acting on any audit finding, independently re-read the actual source data/code the claim depends on (e.g. checked `templates.py`'s weight values summed to 100, not assumed a 0–1 scale).
- Ran direct Python snippets to verify formula behavior with real inputs rather than trusting the sub-agent's narrative.
- **Future Rule:** Treat automated code-audit findings (from sub-agents or otherwise) as hypotheses, not facts. Always verify the specific claim against the actual code/data before reporting it to the user or fixing it — especially for claims about mathematical/scaling correctness, which are easy to get wrong by assuming a variable's range without checking.

## 4. Centralizing Duplicated Business Logic — Missing Sites on the First Pass

**The Mistake:**
When centralizing the EJ/DJ welding-feet-splitting rule (which had been copy-pasted across the codebase over time) into shared helper functions, the first pass found and fixed 5 duplicate sites but missed 2 more (`master/router.py`'s `auto_sync_all_projects_with_master`, and `dashboard/router.py`'s planning-forecast loop). They were only found later — one by the user asking "from where is the model taking values" (which prompted re-tracing the full data path), and the other during a subsequent full-codebase bug audit.

**The Rectification:**
- Grepped the whole repository for the pattern's distinctive substring (the exact `if joint_type == 'DJ':` / `tig_feet + mig_feet` fold logic) instead of relying on memory of "the places already checked."
- **Future Rule:** When centralizing duplicated logic, search the entire repo by the pattern's literal substring before declaring the refactor complete — don't rely on having found "all the callers" from context alone. Re-check after any related bug-hunt, since new duplicate sites tend to surface exactly when least expected.
