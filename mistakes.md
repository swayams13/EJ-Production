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
