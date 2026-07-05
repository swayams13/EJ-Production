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

## 5. Dynamic Tailwind Class Names Are Silently Dropped From Production Builds

**The Mistake:**
The original Executive Dashboard built CSS class names at runtime via string interpolation — `` bg-${kpi.color}-500 ``, `` text-${dept.color}-600 `` — using color names sent from the backend (`"orange"`, `"emerald"`, `"blue"`, `"purple"`, `"rose"`, `"amber"`). This looks correct in development because Tailwind's dev-mode JIT can pick up classes that happen to exist elsewhere in the codebase as literal strings, but Tailwind's production build only includes classes it can find as complete, literal strings in the source — it cannot execute JavaScript to discover `` `bg-${x}-500` `` at build time. In a from-scratch build these interpolated classes are silently absent from the generated CSS, so the styling would have quietly broken in production with no error anywhere.

**The Rectification:**
- Replaced the dynamic interpolation with a literal `Record<string, Tone>` lookup object mapping each known color-name string to one of a small, fixed set of tone variants, and passed the resolved tone into shared components (`MetricCard`, `ProgressBar`) that themselves only ever reference complete literal class strings.
- **Future Rule:** Never build a Tailwind class name by interpolating a runtime value into the class string (`` className={`bg-${x}-500`} ``). Always map the runtime value to one of a fixed set of complete, literal class strings via a lookup object or switch, even if it means writing out every case by hand. This applies to any Tailwind project, not just this one.

## 6. Native Browser Dialogs (alert/confirm/prompt) as an Enterprise-UI Anti-Pattern

**The Mistake:**
Across the frontend, destructive or state-changing actions used native browser dialogs: `window.confirm()` for re-running the scheduler's auto-assign, `window.prompt()` requiring the user to type "DELETE" before removing a project, and `window.alert()` for success/failure feedback on attendance recording, custom master-data sizes, and pool/workforce updates. These are jarring, unstyled, block the whole page, and were one of the clearest "generic/unfinished" tells found during the UI audit.

**The Rectification:**
- Built two small reusable primitives instead of reaching for a heavier modal/toast library: `useConfirm()` (a hook returning a `confirm()` promise plus a `<Modal>` to render) and `useToast()` (a hook returning a `showToast()` function plus a portal-rendered toast stack), both under `next-frontend/src/components/ui/`.
- Preserved the exact same safety guarantees where they mattered — e.g. the project-deletion flow still requires typing "DELETE" before the button un-disables, just via a styled `Modal` + `Input` instead of `window.prompt()`.
- **Future Rule:** Treat `alert()`/`confirm()`/`prompt()` as a code smell in any UI meant to look and feel like a real product. Build (or adopt) a themed replacement early, before they spread across many files — retrofitting them one page at a time, as happened here, is strictly more work than doing it once at the start.
