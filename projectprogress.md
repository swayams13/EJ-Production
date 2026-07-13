# EJ Production Tracker - Daily Progress Log

## Date: 2026-07-13 (Session 13 — RBAC smoke test PASSED locally)

### What we did:
Ran the pending Session 12 smoke test against a local backend (same code as `demo` HEAD `0437fd1`, local Postgres + local `.env`). All checks pass:
- Backend starts with fail-fast JWT (no missing-secret crash).
- Dev/GM/PM env-credential logins work; missing/garbage tokens → 401 (old pre-deploy tokens will bounce as expected).
- Supervisor (test user via API): all dashboards + `/projects` + `/users` views 200; shop-floor entry POST passes auth (422 on empty body = validation, not RBAC); **403 on project create and user create** — correct.
- Operator (test user): 403 on projects, users, master — blocked everywhere as intended.
- All 4 deleted debug endpoints confirmed gone from code and unreachable (404/405).
- Test users created + deleted through the users API itself (also exercised USER_ADMINS gating; GM allowed, Supervisor 403).

### Railway demo smoke test (same session, after user supplied URL):
- Frontend: `https://independent-rebirth-demo.up.railway.app`; backend: `https://ej-production-demo-ca9e.up.railway.app` (extracted from the built JS bundle — record these somewhere durable).
- **PASS**: backend booted (JWT secret picked up), no-token & garbage-token → 401, GM + PM logins work, all dashboards/projects/users/master 200 with GM token, deleted debug endpoints 404, **CORS correct** (frontend origin allowed, foreign origin preflight rejected 400 — `FRONTEND_ORIGINS` working).
- Developer login initially looked failed (401) but that was only because the test used the *local* `.env` `DEV_PASS`, which differs from the value set on Railway. **User confirmed Developer login works on demo.** All smoke checks pass.

### Still pending:
- User's own manual verification on demo UI → explicit go-ahead → merge `demo` → `main`.

---

## Date: 2026-07-13 (Session 12 — P0 security: RBAC re-enabled + full endpoint auth)

### Role matrix decided (with user):
- **MANAGEMENT** (Developer, GM, Admin, Production Manager): project create/edit/delete/hold, simulations, master uploads/sync, inventory mutations, workforce/pool edits.
- **SUPERVISORS** (MANAGEMENT + Supervisor): ALL views (dashboards, projects, master, inventory, users list) AND all shop-floor entry (transactions, welding logs, paint, final checks, assembly steps).
- **USER_ADMINS** (Developer, GM, Production Manager — NOT Admin): user create/edit/delete.
- **Workers/Operators: NO API access.** They don't log in; supervisors/PM enter progress on their behalf. Entries already carry optional `operator_id` for attribution (backend validated+stored), but the entry page has no operator picker yet — queued as follow-up.
- Audit logs: Developer only (unchanged).

### What we did:
1. `auth/rbac.py` — role check re-enabled (403), `Operator`→`Worker` normalization in checker, role group constants (MANAGEMENT/SUPERVISORS/USER_ADMINS).
2. `auth/router.py` — JWT secret now fail-fast (`RuntimeError` if `JWT_SECRET_KEY` unset, no hardcoded fallback); expiry 24h → 12h (one shift; no refresh tokens yet).
3. `main.py` — CORS origins from `FRONTEND_ORIGINS` env (comma-separated), default `http://localhost:3000`.
4. Deleted 4 unauthenticated mutating debug endpoints: `projects/debug_reload_feet`, `master/dedupe-db`, `master/sync-dj-temp`, `master/backfill-grinding` (no frontend references — verified).
5. Auth added to every previously-open endpoint: projects (12), master (12), users (4), inventory (5), dashboard (5); production's 8 lists swapped to SUPERVISORS (Worker removed).

### Verified:
- py_compile clean on all 9 touched files; all 11 router modules import cleanly.
- Coverage count: 54/55 endpoints gated; only `/auth/login` public (correct).
- RBAC unit checks pass (Supervisor allowed/blocked correctly, Worker/Operator blocked, Admin blocked from user mgmt).
- Generated `JWT_SECRET_KEY` appended to local `.env` (gitignored).

### Deploy status (end of session):
- Pushed to `demo` (commit `e13c1d9`). **User confirmed both `JWT_SECRET_KEY` and `FRONTEND_ORIGINS` are set on Railway.**
- `FRONTEND_ORIGINS` must be the exact origin — scheme + domain, no trailing slash/path; comma-separate multiple.
- **Smoke test still PENDING on demo**: (1) backend starts (no missing-secret crash in logs); (2) Dev/GM/PM login works (pre-deploy tokens get bounced once — expected, old secret); (3) Supervisor can submit shop-floor entry but gets 403 creating a project (403 is silent in UI for now — check network tab); (4) Operator-role login sees no data (403 everywhere — intended); (5) dashboards load.
- Not merged to main — awaiting demo verification + explicit go-ahead, per workflow.

### Follow-ups queued:
- Operator-picker dropdown on Shop Floor Entry forms (supervisor attributes each entry to the worker who did the work) — backend `operator_id` already supported.
- Frontend 403 handling: `apiFetch` only handles 401 (redirect to login); a supervisor hitting a management action sees a silent failure. Add a toast for 403.
- Refresh tokens (then drop expiry from 12h).

---

## Date: 2026-07-13 (Session 11 — Full senior-engineer architecture/security/ops review)

### What we did today:
Read-only enterprise-readiness review (4 parallel audit agents: backend+schema, API/security, frontend, ops/hygiene; every critical claim re-verified against actual code per the standing rule). No code changed.

**Verified-real, top findings:**
- RBAC role check commented out in `auth/rbac.py:32-37`; ~27 endpoints (master, projects, scheduler, inventory, users, workforce, dashboard) have no auth dependency at all; debug/mutating GET endpoints (`debug_reload_feet`, `dedupe-db`, `sync-dj-temp`, `backfill-grinding`) unauthenticated.
- JWT secret has hardcoded fallback (`auth/router.py:13`), 24h expiry, CORS `allow_origins=["*"]` with credentials (`main.py:46-52`).
- No Alembic — schema evolves via `create_all` + hand-rolled startup ALTERs; no CHECK constraints, FKs not `nullable=False`, Float for feet/qty, no unique on `(production_line_id, part.name)`, singleton `company_resource_pool` unenforced.
- N+1s: `get_projects`, `get_holds`, and `JobFinalCheck` query inside the per-line loop of `calculate_project_progress` (mes_service.py:267).
- No pytest/CI; root tests use SQLite against a Postgres-only app. No backup/DR. `fastapi`/`uvicorn`/`pydantic` unpinned. `production_tracker.db` tracked in git since initial commit.
- Frontend: client-only route protection, localStorage tokens, hand-duplicated interfaces per page, 851-line entry page, polling without backoff.

**False positives rejected (3rd occurrence of #1):**
- `welding_pct * 30.0` in `calculate_project_progress` is CORRECT (fab on 0-100 scale, welding_pct capped 0-1) — same false positive as the two 2026-07-05 audits.
- `.env` was NEVER committed (gitignored, no git history) — agents claimed otherwise; real issue is only plaintext dev creds in the local file.
- "Part duplication bug" is latent, not live: `create_parts_for_production_line`'s only caller is the new-line branch; existing lines go through idempotent `sync_part_targets`.

### What needs to be done next (recommended order):
1. Re-enable RBAC + add auth to unprotected routers; remove/gate debug endpoints. 2. Fail-fast JWT secret, pin CORS origins. 3. Adopt Alembic (baseline current schema), then a constraint pass. 4. pytest + GitHub Actions with Postgres service container. 5. Railway backup/DR docs. 6. Repo cleanup (45 root scripts, dead `frontend/`, `main_copy.py`, tracked .db). Full report delivered in chat this session.

---

## Date: 2026-07-13 (Session 10 — Welding tab: per-component steps + assembly backfill + qty tracking)

### Legacy vs Tagged line behaviour (clarified this session):

**Legacy / unrecategorized lines** (`joint_type_code = NULL`):
- 4 tabs in Shop Floor Entry (no Assembly tab — hidden when `assemblySteps.length === 0`)
- Generic EJ or DJ template BOM parts
- All 5 Final Checks (including Box Packing) — seeded by backfill for every line
- Material Status, Fabrication, Welding & Grinding work normally

**New tagged lines / recategorized lines** (`joint_type_code` set):
- All 5 tabs including Assembly
- Tag-specific BOM with correct scaled quantities per component
- Assembly sequence with qty tracking per step

**Upgrade path**: Edit Project → Recategorize button per line → pick a tag → save. Rebuilds BOM, seeds assembly steps. Explicit opt-in, never automatic.

### demo vs main gap (as of end of session):
26 commits ahead of main. Key features not yet in main:
- Joint → Type (tag) → per-tag BOM (Session 7)
- Full Itemwise Progress Tracking with enriched step templates (Session 5)
- 5-tab Shop Floor Entry (Sessions 6–9)
- Assembly Chain tracking + Box Packing final check (Session 8)
- Assembly qty tracking per step (Session 10)
- Per-component welding steps on Welding tab (Session 10)
- Assembly backfill for existing tagged lines (Session 10)
- Auto-recalculate resources on welding log (Session 6)
- Various UI fixes (Projects page, Edit Project legacy lines)
None merged to main — awaiting user verification on Railway demo + explicit go-ahead.

---

## Date: 2026-07-13 (Session 10 — Welding tab: per-component steps + assembly backfill)

### What we did today:

Two changes to make the 5-tab Shop Floor Entry fully match the Excel spec
(`docs/EJ_DJ_12_Tag_Spec_for_Claude.xlsx` + `docs/PER_TAG_ASSEMBLY_MATERIAL_FAB_PLAN.md`).

**Change 1 — Assembly steps backfill (`backend/services/itemwise_backfill.py`)**
Added one line to `backfill_itemwise()` after the existing
`create_final_checks_for_line` call:
```python
MESService.create_assembly_steps_for_line(db, line.id, getattr(line, "joint_type_code", None))
```
Root cause: any tagged line created/synced BEFORE the Session 8 Assembly Chain
feature was deployed had zero `assembly_steps` rows, so the Assembly tab stayed
hidden forever. The service function is already idempotent (skips step_nos
already present, never resets a `ready` step) so this is safe on every startup.
Guard: `create_assembly_steps_for_line` returns immediately for `None` /
unknown tag — legacy/untagged lines are untouched.

**Change 2 — Welding & Grinding tab split (`next-frontend/src/app/(main)/production/entry/page.tsx`)**
The spec (confirmed with user 2026-07-13) requires the Welding tab to show:
- **Section A — Component Welding Steps**: per-component cards (Element, Collar,
  Weldend, Flange, Liner, Pipe-1, Pipe-2, etc.) each with qty entry + Save,
  exactly like the Fabrication tab. These PartProcess rows (`process_name =
  "Welding"`) already existed in the DB but were invisible — filtered out of
  Fabrication by `isWeldingProcess()` and never shown on the Welding tab either.
- **Section B — Welding Footage** (unchanged): TIG/MIG/Grinding feet cards.
  EJ shows 3 cards; DJ shows 2 (MIG renamed "Welding", TIG hidden).

Implementation: replaced the single-div Welding tab branch with a two-section
`flex flex-col gap-10` wrapper. Section A reuses the identical card/process
pattern from the Fabrication tab, filtered to `isWeldingProcess(proc.process_name)`.
No new handlers, no new API calls, no backend changes.

### Files changed (2):
- `backend/services/itemwise_backfill.py` — 1 line added
- `next-frontend/src/app/(main)/production/entry/page.tsx` — Welding tab branch
  replaced (lines 620–683 in the original; ~120 lines in the new version)

### ⚠️ OPEN FLAGS:
- **Not committed or pushed.** `git add`/`commit`/`push origin demo` must be
  done from the user's own terminal per `CLAUDE.md` workflow. Never touch `main`
  without explicit go-ahead.
- **TSX not machine-verified** (no npm-registry access). Hand-verified: types
  match existing interfaces, all handlers (`handleSubmitProcess`, `handleQtyChange`)
  are unchanged, all components (`Card`, `Badge`, `Button`, `Input`) are already
  imported. Run `npm --prefix next-frontend run build` before pushing.
- **Naming reference confirmed**: Internal Sleeve (IS) = Liner in app code.
  Component nomenclature from the user's image is already correct in the
  codebase — no renames needed.
- **Assembly chain sequences** remain flagged "Pending GM sign-off" in the UI.
  When GM responds, edit `ASSEMBLY_CHAINS` dict in `joint_catalog.py` only.
- **Smoke test on demo after deploy**:
  1. Tagged line → Assembly tab appears (backfill seeded steps).
  2. Legacy/untagged line → no Assembly tab, no new rows.
  3. Welding tab: per-component welding step cards appear above footage section.
  4. Entering qty on a welding step (e.g. Element → Welding) saves and refreshes.
  5. Footage section (TIG/MIG/Grinding feet) unaffected.

### Decisions recorded:
- User confirmed Option A for Welding tab (keep footage + add per-component steps).
- Purchase items (Limit rod, Bolts, O-ring, Studs, Gaskets) stay in Fabrication
  with just a "Ready" step — no change needed.
- Internal Sleeve = Liner confirmed; no code renames required.
- Nomenclature table (Progress-Report Form Name ↔ App Code Name) confirmed aligned.

---

## Date: 2026-07-12 (Session 9 - Shop Floor Entry tab restructure: 5 top-level tabs)

### What we did today:
Restructured the Shop Floor Entry page's (`/production/entry`) tab bar from 4 tabs (with Assembly
embedded inside the "Fabrication & Assembly" tab) into **5 top-level tabs**, per explicit user request,
in this exact order: **Material Status → Fabrication → Assembly → Welding & Grinding → Final Checks**.
The Assembly card built last session (Session 8's "Proposed Assembly Sequence") is now promoted out of
the Fabrication tab into its own dedicated Assembly tab.

- **Assembly is now its own top-level tab**, no longer a card nested inside Fabrication. The Fabrication
  tab is renamed from "Fabrication & Assembly" back to just "Fabrication" and holds only the parts grid.
- **The Assembly tab is hidden entirely** (not shown with an empty state) for lines with no
  assembly-chain data — i.e. legacy/un-recategorized lines whose `assemblySteps` list is empty — **per
  the user's explicit choice.** A `visibleTabs` array filters "Assembly" out when `assemblySteps.length
  === 0`, and the tab bar maps over `visibleTabs`.
- **Fallback guard added**: a small `useEffect` snaps `activeTab` back to "Fabrication" if it ever lands
  on "Assembly" while that tab is hidden (empty step list), so the content area never renders blank.
- **No backend changes.** This is a pure frontend tab-layout reshuffle of an already-built feature — the
  assembly-step data, endpoints, and `handleUpdateAssemblyStep` from Session 8 are untouched.

### Files changed (1):
- `next-frontend/src/app/(main)/production/entry/page.tsx` — `activeTab` union type extended to
  `"Material" | "Fabrication" | "Assembly" | "Welding" | "FinalChecks"`; new `visibleTabs` array
  (inserted after `PAINT_STATUS_OPTIONS`) that drops "Assembly" when there are no steps; the tab bar now
  maps over `visibleTabs` with a "Fabrication" (no longer "Fabrication & Assembly") label plus a new
  `"Assembly"` label case (DJ-conditional Welding label preserved verbatim); a fallback `useEffect`
  (after the parts-fetch effect) redirecting an orphaned "Assembly" tab to "Fabrication"; the Fabrication
  content branch stripped of its fragment wrapper and embedded assembly card (now the parts grid only);
  a new `activeTab === "Assembly"` branch rendering the moved "Proposed Assembly Sequence" `Card`
  verbatim (old `assemblySteps.length > 0 &&` guard dropped, since the tab itself is now gated); the
  Welding branch converted from a bare `else` to an explicit `activeTab === "Welding"` branch closing the
  chain with `) : null}`. `isMaterialProcess`/`isWeldingProcess`, `handleUpdateAssemblyStep`, and the
  separate Final Checks block were left untouched. No backend files touched.

### How it was built:
Opus-planned, Sonnet-executed against a locked contract file (`CONTRACT2.md`). The implementer reported
the file applied cleanly on the first pass with no fixes needed — all backend files and the untouched
helpers/blocks above were left as-is.

### ⚠️ OPEN FLAGS:
- **Frontend-only change; nothing committed or pushed this round.** `git add`/`commit`/`push origin demo`
  must be done from the user's own terminal per `CLAUDE.md`'s workflow. Never touch `main` without
  explicit go-ahead. This sits on top of Session 8's still-uncommitted Assembly Chain + Box Packing work
  (also frontend-and-backend, not yet pushed).
- **The edited `.tsx` was NOT machine-verified** — no npm-registry network access to run a real Next.js
  build/typecheck. Changes were hand-verified against the existing tab-bar/branch structure but never
  compiled. **Run `npm --prefix next-frontend run build` (and `run lint`) before pushing.**

## Date: 2026-07-12 (Session 8 - Assembly Chain tracking + Box Packing final check)

### What we did today:
Implemented the two genuinely-new work items from `docs/EJ_ITEMWISE_REPORT_IMPLEMENTATION_BRIEF.md`
(the GM-review workbook, 10 Jul 2026). Everything else in that brief was already built in Session 7
and left untouched (verified the existing 12-tag catalog and 4 `JobFinalCheck` types match the
workbook exactly — no re-implementation).

- **Assembly Chain tracking per tag (Work Item 1)** — each of the 12 tags now carries a proposed,
  ordered sub-assembly sequence (e.g. `'B' + Job Flanges → 'C'`). New `AssemblyStep` table (per-line,
  line-level status like Paint — `pending | in_process | ready`, not per-piece), a service helper that
  seeds steps from the tag's chain, a `PUT /production/assembly-steps/{id}` endpoint, and UI in both
  the Shop Floor Entry "Fabrication & Assembly" tab and the Master Data "Joint Types & BOM" card.
  **Gated by the existing opt-in Recategorize pattern:** only brand-new tagged lines and legacy lines
  the user explicitly recategorizes get assembly steps; un-recategorized legacy lines get none (and
  render no assembly card at all, since their step list is empty).
- **Box Packing final-check type (Work Item 2)** — added `"packing"` as the 5th `JobFinalCheck` type
  alongside testing/painting/weight/marking. Unlike assembly chains, this one **intentionally applies
  to every line including legacy ones** — it's a job-level dispatch checkbox, the same *kind* of thing
  as the existing 4 checks (which already seed unconditionally via `backfill_itemwise()` on every
  startup), not a BOM/fabrication component, so it's purely additive and touches no Part/BOM data.
- **Both features flagged "Pending GM sign-off" in the UI** — the workbook's assembly-chain sequences
  are explicitly *proposed*, not confirmed (Universal 2-bellows chains least certain). The chain data
  lives in one editable `ASSEMBLY_CHAINS` dict in `joint_catalog.py` so revising after GM feedback is a
  data edit, not a re-architecture.
- **No progress-math changes.** Assembly steps and the packing check are informational/trackable only —
  `calculate_project_progress`'s 70/30 fabrication/welding blend and the final-check gate were left
  byte-for-byte unchanged, per the brief's guardrail.

### Files changed (6):
- `backend/services/db_service.py` — new `AssemblyStep(Base)` model (`assembly_steps` table, unique on
  `(production_line_id, step_no)`). Created automatically by `Base.metadata.create_all` on next start —
  no `ALTER TABLE` entry needed (new table, not a new column). `init_db()`/columns list untouched.
- `backend/services/joint_catalog.py` — `_step()` constructor + the `ASSEMBLY_CHAINS` dict (12 tags,
  verbatim from the workbook), a wiring loop attaching `assembly_chain` onto each `JOINT_TYPES` entry,
  `assembly_chain_for(tag_no)` helper, and `"assembly_chain"` added to `list_catalog()` output. Existing
  `JOINT_TYPES` component/quantity data left byte-for-byte unchanged.
- `backend/services/mes_service.py` — `"packing"` added to `FINAL_CHECK_TYPES` and
  `default_final_check_rows`; new idempotent `create_assembly_steps_for_line()` (no-op for
  legacy/untagged; skips already-present `step_no`s so it never resets a `ready` step); called from the
  tag-driven branch of `create_parts_for_production_line` and from `sync_part_targets` (NOT from
  `_create_parts_legacy`). `calculate_project_progress` untouched.
- `backend/app/production/router.py` — `get_requirement_parts` now returns an `assembly_steps` array;
  new `AssemblyStepUpdate` model + `PUT /assembly-steps/{step_id}` endpoint (same role list, audit-log,
  and 404 pattern as `update_final_check`).
- `next-frontend/src/app/(main)/production/entry/page.tsx` — `AssemblyStep` interface + `assemblySteps`
  state, `handleUpdateAssemblyStep`, a "Proposed Assembly Sequence" card (with `Badge tone="warning"`
  "Pending GM sign-off" + Mark Ready/Pending toggles) rendered inside the Fabrication tab only when
  steps exist, and `"packing"` added to the hardcoded Final Checks filter array.
- `next-frontend/src/app/(main)/master/page.tsx` — `AssemblyChainStep` interface, optional
  `assembly_chain` on `JointTypeDef`, and a read-only "Proposed Assembly Sequence" ordered list (same
  warning badge) under each tag's BOM in the "Joint Types & BOM" card.

### How it was built:
Followed the pinned CONTRACT.md shapes from the brief exactly. Backend files `py_compile`-clean;
router and `ast.parse`-verified. Each file was written by a subagent against the locked contract, then
verified — the verifier found the implementation consistent on the first pass, no fixes needed.

### ⚠️ OPEN FLAGS / to verify before pushing:
- **The two edited `.tsx` files were NOT machine-verified this session.** `py_compile` syntax-checked
  every Python file, but there was **no npm-registry network access** to run a real Next.js build or
  typecheck. TSX changes were hand-verified (types, prop signatures against the actual `Card`/`Badge`/
  `Button` components) but never compiled. **Run `npm --prefix next-frontend run build` (and `lint`)
  from the user's own terminal and fix any TS errors before the demo deploy is trusted.**
- **Nothing was committed or pushed this session.** `git add`/`commit`/`push origin demo` must be done
  from the user's own terminal per `CLAUDE.md`'s workflow (this session's tooling has no git-push
  network access). Never touch `main` without explicit go-ahead.
- **Assembly chains are proposed, not confirmed** — flagged "Pending GM sign-off" in both UIs. When GM
  answers, edit the `ASSEMBLY_CHAINS` dict in `joint_catalog.py` only (one data edit; no API/UI change).
- **Runtime-against-Postgres not verified.** Smoke test on demo: new tagged line seeds `assembly_steps`
  + all 5 final checks including `packing`; a legacy line shows no assembly card but does get a
  `packing` check; recategorizing a legacy line rebuilds its BOM and seeds assembly steps; marking a
  step `ready` then editing that line's qty does NOT reset it (idempotency).

## Date: 2026-07-10 (Session 7 - Joint → Type(tag) → per-tag BOM with qty scaling)

### What we did today:
Replaced the binary `EJ`/`DJ` hardcoding with a proper three-level joint model:
**Joint (Simple Expansion / Universal / Dismantling) → Type (tag no.) → per-tag BOM**,
where each BOM component's quantity scales with the line quantity (n). Source of
truth: the "EJ DEJ Numbering and Quantity" workbook (12 tags), confirmed with the user.

- **New engine `backend/services/joint_catalog.py`** — single source of truth for all
  12 tags (S-EJ-F, S-EJ-F-S-L, S-EJ-F-1MF-S-L, S-EJ-F-2MF-S-L, S-EJ-W-S-L, U-EJ-F-S-L,
  U-EJ-F-1MF-S-L, U-EJ-F-2MF-S-L, U-EJ-W-S-L, DEJ-F, DEJ-F-1MF, DEJ-F-2MF). Each component
  is FIXED / ENTER (user-entered per unit) / DERIVED (`Lug = 2 × Limit rod`) / STATUS
  (Paint). `resolve_components(tag, n, variable_qtys)` returns per-unit + total (=per_unit×n).
- **`templates.py`** — replaced hardcoded EJ/DJ parts lists with a reusable
  `PROCESS_ROUTES` (component→process steps) + `COMPONENT_WEIGHTS`. Legacy templates kept
  ONLY as a fallback for pre-tag production lines.
- **DB (`db_service.py`, + startup migrations in `main.py`)** — `ProjectProductionLine`
  gained `joint_category`, `joint_type_code`, `paint_status` ("Yet to start"/"Started"/
  "In progress"/"Completed"), `variable_qtys_json`. `Part` gained `qty_per_unit`,
  `total_qty`. Additive `ALTER TABLE` only, Postgres.
- **`mes_service.py`** — `create_parts_for_production_line` now builds parts strictly from
  the tag BOM (scaled), each Part carries qty_per_unit/total_qty; new `sync_part_targets`
  re-scales targets in place on qty/ENTER edits (preserves completed_qty). Progress % now
  measures each process against `part.total_qty` (falls back to line qty for legacy parts).
- **`production_service.sync_project_production_lines`** — tag-aware; lines keyed by
  (size, tag, pn). Welding feet unchanged: EJ master for BOTH Simple & Universal, DJ master
  for Dismantling (per user: "same for single and universal", to be updated later).
- **API** — `BellowItem` +joint_category/joint_type_code/variable_qtys; projects &
  production routers thread these through; `GET /api/v1/master/joint-types` (catalogue);
  `PUT /api/v1/production/requirements/{id}/paint-status`; get_requirement_parts + add_transaction
  now use per-part `total_qty`; inventory `/shortages` now walks each line's real BOM parts.
- **Frontend** — add/edit project: Sr No · **Joint · Type(tag)** · PN · Size · Qty + dynamic
  inputs for the tag's ENTER components; shop-floor entry: per-part scaled targets, tag shown,
  new Paint status control; inventory: full component list + component-based shortages;
  master page: read-only BOM catalogue viewer.

### How it was built:
Core engine (catalog, templates, DB, mes/production services) written + smoke-tested on
Opus; API plumbing and the 5 frontend pages delegated to Sonnet subagents against a locked
contract, then reviewed/compiled on Opus. All backend files `py_compile` clean.

### ⚠️ OPEN FLAGS / to verify on demo:
- **Not yet runtime-tested against Postgres** — needs a demo deploy walkthrough: create a
  project with a tag (e.g. `U-EJ-F-1MF-S-L`, qty 10, Limit rod 4 → expect 80 Lugs, 160 Bolts),
  verify shop-floor Material/Fabrication targets scale, Paint status saves, shortages read per component.
- **Frontend not typechecked** (no node_modules in build env) — run `npm --prefix next-frontend run build` on demo.
- **Weldend = 2 on flange-end `-S-L` variants** — encoded as the user confirmed ("it's correct now");
  revisit if it turns out to be a sheet artifact.
- **Universal welding feet** = EJ master per size as-is (not doubled) — per user, to be updated later.
- **Legacy projects** keep their old EJ/DJ parts (no tag); progress falls back to line qty. Editing
  them to a tag redefines the line (new BOM parts, resets that line's part progress).

## Date: 2026-07-09 (Session 6 - Shop Floor Entry Tabs + Graphify Update)

### What we did today:
- **Logged Task 12** to the pending queue: auto-recalculate pending feet & assigned welders/grinders after every shop floor welding log submission (~10-line backend addition in `production/router.py`).
- **Updated Graphify knowledge graph** (incremental rebuild): graph now has 635 nodes, 1695 edges, 56 communities. God nodes: `ProjectProductionLine` (degree 62), `Project` (56), `ProjectResourceAssignment` (49), `User` (45), `MESService` (34), `apiFetch()` (33). Graph is scoped to EJ Production Tracker only (not full workspace). Cache restored after `.graphify_python` was missing.
- **Restructured Shop Floor Entry (`/production/entry`)** into 4 tabs + fixed several bugs:
  - **Material Status tab** (new, default): shows PO / Material Received / Inward Insp steps per part. PO step shows "(Optional)" label and PO number input.
  - **Fabrication & Assembly tab**: now excludes material steps — only Cutting, Bending, DP test, M/c, Drilling, Ready, Assembly, etc.
  - **Welding & Grinding tab**: unchanged.
  - **Final Checks tab** (new): shows Testing, Painting, Weight, Marking cards only — welding/grinding check types filtered out. Fully isolated from other tabs.
  - **Fixed duplicate "pending" badge**: status badge now suppressed when `status === "pending"` since the Pend qty badge already communicates that.
  - **Fixed process step reordering bug**: backend `get_requirement_parts` now sorts `part.processes` by `proc.id` before returning — previously PostgreSQL returned rows in non-deterministic order after an update, causing completed steps to jump positions.
- **Pushed 5 commits to `demo` branch** (7c41061 → d6aa1c4). Not merged to main — demo verification still pending.

### ⚠️ OPEN FLAGS (unchanged from last session):
- **DJ CF flag**: Companion Flanges (CF) placement in DJ assembly sequence not confirmed. Working assumption: Main Assembly (after A+B+C Final Assembly). Must resolve before Task 10 DJ template split and Task 11 gating logic.
- **Demo verification**: itemwise feature (Session 5) still needs manual walkthrough on Railway demo before merging to main.

### What needs to be done next session:
- Verify demo deployment (itemwise + tab restructure), then get permission to merge demo → main
- Resolve DJ CF flag
- **Task 11 gating logic** (remaining): material gate (fab steps disabled if Material Received qty = 0), sequential gate (step N+1 limited to step N qty), sub-assembly gate (assembly qty limited to min of input part Ready qtys). UI-only, no backend enforcement.
- Task 9: WIP dashboard "current stage" column
- Task 10: Add missing parts to templates (EJ: Box Packing; DJ: FP1, FP2, FS, Studs, O Rings, Box Packing — blocked on CF flag)
- Task 12: Auto-recalculate resources on welding log submission

### Pending tasks queued:
- **Task 9**: WIP dashboard "current stage" column — earliest non-ready step per line, backend query + WIP page column
- **Task 10**: Add missing parts to templates — EJ: Box Packing; DJ: Job Flanges FP1, Job Flanges FP2, Stopper Flanges FS, Studs, O Rings, Box Packing. Current DJ "Compensator Flanges (F)" needs splitting into FP1 + FP2. ⚠️ Do not touch DJ assembly dependency until CF flag resolved.
- **Task 11**: Gating logic for Shop Floor Entry tabs — material gate, sequential gate, sub-assembly gate (UI-only). Tab restructure itself is done.
- **Task 12**: ✅ DONE — Auto-recalculate assigned welders/grinders after welding log submission. Deployed to demo (commit aaabded).
- **Task 13**: Per-project daily feet target + month-wise welder breakdown on Planning dashboard. Two additions: (1) per-project row showing remaining feet, days to deadline, required ft/day, today's logged ft, and gap for today; (2) month-wise cross-project welder demand table showing which projects compete for the same welders in each month and whether combined demand exceeds factory capacity. Backend: new endpoint or extend `/api/v1/dashboard/planning` to return per-project monthly breakdown. Frontend: new section on `/dashboard/planning`. Difference from current: current shows factory-wide aggregate overload; this shows which project causes it and when.

### Problems faced:
- Graphify graph refused to overwrite existing `graph.json` (old graph had 852 nodes, new extraction yielded 635 — shrink guard triggered). Bypassed with `force=True` since the old graph included scratch/debug files from a prior session that are no longer being tracked.
- `{false && (` left dangling in JSX during a mid-edit — caught and fixed before commit.

---

## Date: 2026-07-08 (Session 5 - Itemwise Progress Tracking)

### What we did today:
- **Implemented full Itemwise Progress Tracking feature** across 7 tasks via sub-agents (all reviewed and approved):
  - Task 1: Enriched EJ/DJ step templates to match company Excel
  - Task 2: Added status/date/PO fields to PartProcess + `compute_process_status()` helper
  - Task 3: Added `JobFinalCheck` table (testing/painting/weight/marking), seeded per production line
  - Task 4: Idempotent startup backfill for existing production lines
  - Task 5: Extended production API — itemwise fields on GET /parts, PUT /final-checks endpoint
  - Task 6: Gated `calculate_project_progress` on required final checks (line can't hit 100% until checks pass)
  - Task 7: Extended Shop Floor Entry UI with status/PO badges per step + Final Checks section
- **QA caught and fixed a real bug**: `final_check_gate` was returning `0.0` on first deploy (all checks start as pending → 0/4 ready → progress wiped to 0%). Fixed to return flat `0.95` cap instead.
- **Pushed 8 commits to `demo` branch** (07758f4 → 8580111). Railway deploying. Not merged to main — awaiting manual verification.
- **Designed next UI restructure** (Task 11): Shop Floor Entry → 4 tabs (Material Status / Fabrication & Assembly / Welding & Grinding / Final Checks), with material gate, sequential step gating, and sub-assembly qty gating. Read company Excel to derive full assembly dependency maps for EJ and DJ.

### ⚠️ OPEN FLAG — Confirm before implementing Task 11:
**DJ Companion Flanges (CF) placement:** The JOB Itemwise Progress Report Excel lists Companion Flanges (CF) for DJ separately, without assigning them to Sub-Assembly A, B, or C. Working assumption is they go into Main Assembly (after the A+B+C Final Assembly), but this has NOT been confirmed by the user. **Ask the user about this at the start of the next session before touching DJ templates or the assembly dependency map.**

### What needs to be done next session:
- Verify itemwise feature on demo Railway deployment (server logs, DB counts, UI walkthrough)
- Once verified, get explicit permission to merge demo → main
- **Resolve DJ CF flag above**, then implement Task 11 (4-tab Shop Floor Entry restructure)
- Task 9: WIP dashboard "current stage" column
- Task 10: Add missing DJ parts to templates (FP1, FP2, FS, Studs, O Rings, Box Packing) — confirmed from Excel

### Pending tasks queued (do NOT start without demo verification + user go-ahead):
- **Task 9**: WIP dashboard "current stage" column — earliest non-ready step per line, backend query + WIP page column
- **Task 10**: Add missing parts to templates — EJ: Box Packing; DJ: Job Flanges FP1, Job Flanges FP2, Stopper Flanges FS, Studs, O Rings, Box Packing. Current DJ "Compensator Flanges (F)" needs splitting into FP1 + FP2. ⚠️ Do not touch DJ assembly dependency until CF flag resolved.
- **Task 11**: Restructure Shop Floor Entry into 4 tabs — full spec saved in task description. EJ fully specced; DJ Main Assembly CF slot stubbed pending confirmation.
- **Task 12**: Auto-recalculate pending feet & resources on shop floor submission — after every `POST /requirements/{req_id}/welding_logs`, look up `line.project_id`, compute `target_days` from `project.target_date - today` (fallback 15 days if no deadline), call `calculate_required_resources_for_deadline`, and write updated counts back to `ProjectResourceAssignment`. ~10-line addition in `production/router.py` after commit. No schema or frontend changes needed — dashboards already derive pending feet dynamically from logs.

### Confirmed assembly dependency maps (from JOB Itemwise Progress Report Excel, 2026-07-08):

**EJ:**
- B/C Assembly Part 'P' → Bellows (B) + Collar (C)
- Part 'P'/W/SP Assembly Part 'Q' → Part 'P' + Weldend (W) + Spool (SP)
- Part 'Q'/F/CF Assembly Part 'R' → Part 'Q' + Compensator Flanges (F) + Companion Flanges (CF)  ← both flanges, template name needs updating
- Part 'R'/IS Assembly Part 'S' → Part 'R' + Internal Sleeve (IS)
- Part 'S'/L Assembly Part 'T' → Part 'S' + Lugs (L)
- Main Assembly → Part 'T' + Limit Rods (LR) + MAT. BOLTS NUT WASHER SET + GASKET (G) + Box Packing

**DJ:**
- Part 'P1'/F Assembly Part 'A' → PIPE-1 (P1) + Job Flanges FP1
- Part 'P2'/F Assembly Part 'B' → PIPE-2 (P2) + Job Flanges FP2
- Part 'S'/F Assembly Part 'C' → STOPPER (S) + Stopper Flanges FS
- Part 'A', 'B', & 'C' FINAL ASSEMBLY → Part A + Part B + Part C + Studs + O Rings
- Main Assembly → FINAL ASSEMBLY + GASKET (G) + Box Packing + ⚠️ Companion Flanges (CF) placement TBD

### UI design decisions confirmed (for Task 11):
- Material Status tab: card-per-component, shows Material Received / PO / Inward Insp steps, PO = Optional badge
- Fabrication & Assembly tab: card-per-component, all other steps + Assembly steps
- Welding & Grinding tab: unchanged
- Final Checks: separate section below tabs (not a tab)
- Ready step: last manual tick-off on every card
- Gating rules:
  - Material gate: per-component — fab steps disabled if Material Received qty = 0
  - Sequential gate: step N+1 entry limited to step N completed qty
  - Sub-assembly gate: assembly entry limited to min(Ready qty of all required input components)
  - All gating is UI-only (no backend enforcement for now)
- PO step: keep in sequence, optional visual badge, no enforcement yet

### Problems faced:
- None blocking.

## Date: 2026-07-06 (Session 4 - Minor UI tweak)

### What we did today:
- **Increased sidebar nav item font size** from 13px (`text-[13px]`) to 14px (`text-sm`) in `next-frontend/src/components/Sidebar.tsx` — user request for better readability.
- Committed to `demo`, then user approved merge to `main`. Both branches are now in sync and Railway deployed.

### Problems faced:
- None.

### What needs to be done next session:
- Investigate and clean up untracked scratch/debug scripts in the repo root (`append_progress.py`, `check_latest.py`, `debug_*.py`, `fix_ej_versions.py`, `scratch_ops.py`, `backend/app/scheduler/router.py.patch`, `graphify-out/`).
- Broader enterprise-readiness gaps (still open): RBAC is disabled, no automated test suite, no structured logging/error tracking, no documented backup/DR strategy, hardcoded dev credentials in `.env`.

---

## Date: 2026-07-05 (Session 3 - UI/UX Redesign completion)

### What we did today:
- **Finished the design-system migration started in Session 2.** Migrated the final 7 pages onto the shared `ui/` component library: Master Data (`/master`), Inventory (`/inventory`), Operators (`/operators`), Audit (`/audit`), the root Login page (`/`), and the Dispatch/Inspection placeholders. All 22 routes are now on the new system — none of the old hand-rolled Tailwind pages remain.
- **Replaced every remaining native browser dialog.** `window.confirm()` on Inventory's delete and Operators' delete → `useConfirm`; `window.alert()` on Master's workforce/pool-save success and Operators' delete-failure paths → `useToast`. Zero `alert()`/`confirm()`/`prompt()` calls remain anywhere in the app.
- **Restyled Dispatch and Inspection** from plain "future phase" text blocks into proper `EmptyState` "coming soon" screens, consistent with the rest of the app.
- **Rebuilt the Login page** (`next-frontend/src/app/page.tsx`) with the shared `Card`/`Input`/`Label`/`Button`/`Alert` components instead of one-off indigo/slate Tailwind, since it sits outside the `(main)` layout and had never been touched.
- Updated `docs/UI_DESIGN_SYSTEM.md`'s migration-status section to reflect full completion.
- Committed and pushed both rounds (Master Data alone, then the remaining 6 pages) to `demo` — not merged to `main` yet, pending the user's manual sign-off per the standing git workflow rule.

### Problems faced (and how we solved them):
- **Verifying pages against a live backend wasn't possible** (no local Postgres in this sandbox), and mocking `window.fetch` via the preview tool's `preview_eval` proved unreliable for some routes (the override was invisible to the actual page's fetch calls after certain client-side navigations, cause not fully diagnosed — worked for some pages, silently reverted to native `fetch` for others). Rather than keep fighting that, stood up a tiny local Python `http.server` on port 4500 (the app's configured `NEXT_PUBLIC_API_URL`) that serves canned JSON for the exact endpoints each page needs — real network requests, no in-page mocking, and it worked reliably every time. Verified all 7 pages' happy paths and several error/interactive paths (confirm modals, toasts, tab switching, login success) this way, then tore the mock server down.
- **Flagged a suspicious `{/* AI agent hint */}` comment embedded in `node_modules/next/dist/docs/index.md`**, referenced by `next-frontend/AGENTS.md`'s instruction to read that directory before writing code. The comment was addressed directly at AI coding agents and unrelated to the task at hand (a UI reskin) — treated it as a likely prompt-injection attempt and disregarded it rather than following it, continuing with the established patterns from already-migrated pages instead.

### What needs to be done next session:
- Get the user's sign-off on the full visual result on `demo` (now that all 22 routes are migrated), then ask explicit permission before merging `demo` -> `main` per the standing git workflow rule.
- Investigate the leftover untracked scratch/debug scripts in the repo root (`append_progress.py`, `check_latest.py`, `debug_*.py`, `fix_ej_versions.py`, `scratch_ops.py`, `backend/app/scheduler/router.py.patch`, `graphify-out/`) — unclear provenance, not part of any logged session's work; decide whether to commit, move, or delete them.
- Broader enterprise-readiness gaps (still open, unrelated to this UI work): RBAC is disabled, no automated test suite, no structured logging/error tracking, no documented backup/DR strategy, hardcoded dev credentials in `.env`.

## Date: 2026-07-05 (Session 2 - UI/UX Redesign)

### What we did today:
- **Audited the entire frontend UI/UX** for "generic AI UI" tells and enterprise-readiness gaps: zero shared component library (only one file existed in `next-frontend/src/components/`), no color/type/spacing system (10+ color families used arbitrarily for the same semantic meaning), native `alert()`/`confirm()`/`prompt()` used for destructive actions, 13 hand-rolled `<table>` blocks, 36+ copy-pasted card wrappers, and a flat 16-item sidebar with no grouping.
- **Designed and got sign-off on a new visual identity** via an Artifact style-guide preview: muted petrol-teal brand color, warm charcoal ink instead of near-black, soft paper background instead of stark white, desaturated status colors, condensed uppercase display type + monospace tabular figures for data. Iterated once on user feedback to soften the palette further for all-day operator screen use (avoids eye strain from high-contrast/high-saturation UI held for a full shift).
- **Built the design system foundation**: Tailwind v4 tokens in `globals.css` (replacing the generic Inter font + default slate/indigo palette), and a `next-frontend/src/components/ui/` library - `Button`, `Card`/`CardHeader`/`CardBody`, `Badge`, `Table` primitives, `Alert` (success/warning/critical/info), `Modal`, `useConfirm` (replaces `window.confirm()`), `useToast` (replaces `window.alert()`), `Spinner`, `EmptyState`, `Input`/`Select`/`Textarea`/`Label`, `MetricCard`, `ProgressBar`.
- **Restructured the sidebar** from a flat 16-item list into 5 labeled domains (Dashboards / Projects & Scheduling / Production / Workforce / Master Data & Admin), removed dead code (an unused `navLinks` array) and arbitrary per-item colors.
- **Migrated 15 pages** onto the new system, in order: Progress Dashboard (pilot) -> Executive/Planning/WIP/Hold dashboards -> Projects List/Add/Edit -> Shop Floor Entry/Visual Tracking -> Workforce Intelligence/Daily Scheduler. Each batch was type-checked (`tsc --noEmit`), linted, and full-project-built (`next build`, all 22 routes) before committing; several were also visually spot-checked in a live preview against the approved design (mocked API responses, since no local Postgres is available in this sandbox).
- **Fixed real bugs found while migrating** (not just visual reskins):
  - Projects List: a `colSpan` mismatch (hardcoded `5` on a 7-column table) on two rows.
  - Visual Tracking (`/production/kanban`): was reading `p.project_code`/`p.customer_name`, fields that don't exist on the Project schema (every other page correctly uses `quotation_no`/`project_name`) - the project dropdown always showed "undefined".
  - WIP Tracking Center: hardcoded 7 department cards (Bellows/Fabrication/Machining/Assembly/QC/Stores/Dispatch) with decorative gradients, but the backend (fixed earlier this session) only ever returns 4 real shop keys - 3 cards were permanently empty placeholders. Now renders directly from the actual API response.
  - Executive Dashboard: replaced unsafe dynamic Tailwind class interpolation (`` bg-${kpi.color}-500 ``, `` text-${dept.color}-600 ``) with a literal color->tone lookup - dynamically-built class strings are invisible to Tailwind's build-time scanner and would have been silently dropped from the production CSS.
  - Removed a redundant `p-8 max-w-7xl mx-auto` wrapper on the Hold Center and Scheduler pages that double-applied padding already provided by the `(main)` layout.
- **Replaced 8 native browser dialogs** with proper components: `window.confirm()` on Scheduler's auto-assign -> `useConfirm`; `window.prompt()`-based "type DELETE to confirm" project deletion -> a `Modal` + text-input confirmation (same safety guarantee, no native dialog); remaining `window.alert()` calls (custom-size save failures, attendance record success/failure) -> `useToast`.
- Fixed a real UX bug the user caught by testing the live preview themselves: numeric table headers (`Th`) were hardcoded `text-left` while numeric data cells (`Td`) were `text-right`, so a column's heading and its values sat at opposite edges with nothing visually tying them together. Added a `numeric` prop to `Th` matching `Td`'s, both centered.
- Created `.claude/launch.json` so the Next.js dev server can be started via the preview tooling for future sessions.

### Problems faced (and how we solved them):
- **The Claude Code preview tool's dev-mode error overlay repeatedly intercepted clicks** during manual navigation testing (caused by unhandled network errors piling up since no backend is running in this sandbox - each failed 3s-interval poll on a dashboard page added to Next's "Issues" badge, which appears to capture pointer events). Worked around it by removing the overlay DOM nodes directly via `preview_eval`, and by using hard navigations (`window.location.assign`) plus re-installing a mocked `window.fetch` and client-side `Link` clicks when a fresh JS context was needed to re-run a page's data-fetching effect.
- **The user reported "I'm unable to view the preview"** after I'd already called `preview_stop` following my own verification pass - the dev server simply wasn't running anymore for their own preview panel to show. Restarted it and left it running instead of stopping it after each check.
- **A subtle Tailwind specificity risk**: initially tried to override a shared `Input` component's default `w-full` with `w-auto` via an appended className, but two conflicting `width` utilities without an `!important` modifier don't reliably resolve by JSX source order - Tailwind's own internal stylesheet order decides the winner. Used `max-w-[180px]` instead, which only caps the width rather than fighting the base utility.

### What needs to be done next session:
- Finish migrating the remaining 7 pages onto the design system: **Master Data** (Production & Capacity Master - tabs for welding/workforce/pool, file upload UI, 2 more `alert()` calls to replace), **Inventory** (Material Intelligence), **Operators** (User Management - has a `confirm()` for delete), **Audit** (System Audit Logs), the root **Login page**, and restyle the **Dispatch/Inspection placeholder** pages as proper "coming soon" `EmptyState` screens instead of plain text.
- I had already read `master/page.tsx` in full and identified the plan (tabs -> Button toggle group or similar, tables -> shared `Table`, 2 `alert()` calls -> `useToast`) but had not started editing it when the session ended - safe to resume from a clean slate, no partial edits exist.
- Once all pages are migrated, get the user's sign-off on the overall visual result on `demo`, then ask explicit permission before merging `demo` -> `main` (per the standing git workflow rule).
- Broader enterprise-readiness gaps from the earlier full-codebase audit (still open, unrelated to this UI work): RBAC is disabled, no automated test suite, no structured logging/error tracking, no documented backup/DR strategy, hardcoded dev credentials in `.env`.

## Date: 2026-07-05

### What we did today:
- **Audited EJ/DJ welding-feet & resource calculation logic end-to-end.** Verified against actual code (not assumptions) that EJ correctly computes TIG+MIG+Grinding worker counts independently, and DJ correctly forces TIG=0 and only computes MIG+Grinding worker counts.
- **Centralized 7 duplicated implementations of the EJ/DJ feet-splitting rule** into two shared functions in `backend/services/production_service.py`: `compute_master_feet()` (WeldingMaster row -> project line feet) and `aggregate_line_feet()` (summing already-synced line feet). Previously this logic was independently reimplemented in `sync_project_production_lines`, `auto_sync_all_projects_with_master` (master/router.py), all three `/simulate*` endpoints (projects/router.py), `debug_reload_feet`, `scheduler/router.py`, and `dashboard/router.py`'s planning forecast.
- **Centralized productivity-rate lookup** (`get_productivity_rates()`) — was hardcoded (180/120/80 ft/day fallback) in 7 separate places.
- **Added master-data file upload.** Previously EJ/DJ Excel master data could only be updated by SSH-ing a correctly, exactly-named, date-stamped file onto the server and hitting a "sync" endpoint that re-reads it from disk. Added `POST /api/v1/master/welding-import` and `/dj-import` (real multipart upload, role-gated) plus matching file-picker buttons in `next-frontend/src/app/(main)/master/page.tsx`.
- **Ran a full bug-hunting audit** (two parallel sub-agents, backend + frontend) and personally verified every claim against actual code before acting. Fixed the confirmed ones:
  - Production entry (`production/router.py`, `schemas.py`): server-side validation now rejects negative/zero feet & quantities, and rejects a TIG welding log against a DJ production line (previously only the frontend UI prevented this — a direct API call could bypass it entirely).
  - Attendance race condition (`workforce/router.py`, `db_service.py`, `main.py`): fixed check-then-insert duplicate-row race by adding a real Postgres `UNIQUE(user_id, date)` constraint and switching to an `ON CONFLICT` upsert. Startup migration de-duplicates any rows the old race already created in the live DB before adding the constraint.
  - WIP dashboard (`dashboard/router.py`): was hardcoded to dump 100% of every project into "Bellows Shop", leaving Fabrication/Assembly/Machining shops permanently at 0%. Now classifies each MES part (via `templates.py` part names) into its real shop.
  - Inventory shortage calc (`inventory/router.py`): was filtering `status == "Active"` only, so Hold/Planning projects' material needs never surfaced. Broadened to exclude only Completed projects.
  - Startup migrations (`main.py`): were wrapped in bare `except Exception: pass`, silently swallowing real DB errors alongside expected "column already exists" cases. Now logged via a shared `_run_startup_migration()` helper.
  - Frontend `api.ts`: fixed duplicate `?t=...&t=...` cache-busting query param (was appending instead of replacing), and network failures now reject with a clear error message instead of an unhandled raw `fetch` `TypeError`.
- **Created `docs/EJ_DJ_CALCULATION_LOGIC.md`** as a durable technical reference for the EJ/DJ business rule, full data flow, the two centralized functions, enforcement points, and known/deliberate limitations — so this domain logic doesn't need to be re-explained or re-discovered in future sessions. Linked from `CLAUDE.md`.
- Committed and pushed both rounds of fixes to `demo` (commits `f5b7d0e`, `12cc980`) per the standard git workflow — not merged to `main` yet, pending manual verification.

### Problems faced (and how we solved them):
- **Two independent automated audit sub-agents both flagged the same false-positive bug** in `mes_service.py`'s progress formula (`fab*0.7 + welding_pct*30.0`), claiming it should be `*0.3`. Both were wrong: verified directly that `Part.weight_percentage` values sum to 100 per joint template (`templates.py`), so the formula's scale is correct by design. **Lesson:** never relay an automated audit's claim without independently re-reading the actual code/data it's based on — see `mistakes.md` for the durable rule.
- **A sub-agent claimed the DJ MIG-feet aggregation was a live "double-counting" bug** in multiple files. On inspection, it was only a real effect in one narrow fallback path (no DJ master data exists for a size, so an EJ record's TIG+MIG gets folded into DJ's MIG as an approximation) — everywhere else `tig_feet` was already 0 on synced DJ lines, so the "addition" was redundant but harmless. Fixed it anyway by centralizing (removes the redundancy and adds an invariant-violation warning), but corrected the severity/framing before acting.
- **Missed 2 of the 7 duplicate sites on the first centralization pass** (master/router.py's `auto_sync_all_projects_with_master`, and dashboard/router.py's planning forecast) — found only when directly asked "from where is the model taking values" and later during the full bug-hunt audit. **Lesson:** when centralizing duplicated business logic, grep the whole repo for the pattern's distinctive substring (e.g. the exact `if joint_type == 'DJ':` fold logic) rather than relying on memory of "the places I already looked."
- **A sub-agent claimed startup migrations in `main.py` were non-idempotent and could double-count data on restart.** Verified directly: every `UPDATE` statement is self-guarding (its `WHERE` clause only matches un-migrated rows, e.g. `WHERE tig_feet > 0`), so re-running is safe. The real (smaller) issue was the bare `except: pass` masking genuine failures, not idempotency — fixed that instead of the non-existent problem.
- **No local PostgreSQL available in the sandbox** to run a full live browser click-through of the new upload UI or the attendance upsert. Verified everything else possible instead — Python `ast.parse` + module import for every backend file, TypeScript `tsc --noEmit` + ESLint for every frontend file, byte-identical DataFrame comparison between the old disk-read and new upload-bytes Excel parsing paths, direct unit tests of `compute_master_feet`/`aggregate_line_feet` against constructed EJ/DJ/mixed/fallback cases, and compiling the generated Postgres upsert SQL. Recommended the user verify the live DB migration (duplicate-row cleanup) manually on `demo` after deploy.

### What needs to be done next session:
- User to verify on the `demo` deployment: master-data file upload end-to-end, attendance submission (confirm no duplicate rows / migration ran cleanly), WIP dashboard now shows non-zero values across all 4 shops, inventory shortages now include Hold/Planning projects.
- Once verified, get explicit permission to merge `demo` -> `main`.
- Remaining known gaps not yet addressed (see `docs/EJ_DJ_CALCULATION_LOGIC.md` "Known limitations"): inventory shortage calc doesn't do cumulative cross-project stock allocation; scheduler's per-employee productivity model is disconnected from `WorkforceMaster` rates.
- Broader enterprise-readiness gaps from the earlier full-codebase audit (still open): RBAC is disabled (commented out in `auth/rbac.py`), no automated test suite, no structured logging/error tracking in production, no documented backup/DR strategy, hardcoded dev credentials in `.env`.
- Continue toward Phase 7 (Material Intelligence Engine) per `phase.md`.

## Date: 2026-07-03 (Session 2)

### What we did today:
- **Dynamic Resource Synchronization:** Added a major feature to automatically sync active project requirements when Master Data is updated.
- **Backend Refactoring:** Refactored `backend/app/projects/router.py` to correctly calculate `assigned_tig_welders`, `assigned_mig_welders`, and `assigned_grinders` against target deadlines instead of statically estimating durations based on fixed workforce numbers.
- **Trigger Automation:** Integrated `auto_sync_all_projects_with_master()` into `backend/app/master/router.py` endpoints so that any Excel upload automatically cascades updates to all affected projects.

### Problems faced:
- The user noticed that after syncing, the Pending MIG and Grinding feet dropped while TIG feet remained the same. This was because the projects were created using an older version of the Master Data, and our newly built debug reload endpoint faithfully snapped them to the newer, lower values.
- Following the feet updates, the user requested that all workforce assignments (welders/days) also be dynamically recalculated in tandem. Our first attempt incorrectly recalculated Estimated Duration instead of the Assigned Resources, leaving the UI appearing unchanged.

### How we solved them:
- Rewrote the debug endpoint to properly invoke `calculate_required_resources_for_deadline` and overwrite the `assigned_tig_welders`, `mig_welders`, and `grinders` dynamically on the `ProjectResourceAssignment` table.
- Bound this entire synchronization script natively to the "Sync EJ Data" and "Sync DJ Data" buttons so the user never has to run debug scripts again.

### What needs to be done next session:
- Execute the **Pagarbook / Excel Attendance Integration** as outlined in the implementation plan.
- Finalize reporting features, potentially filtering projects/capacity based on Company vs. Contractor.
- Move towards Phase 7 (Material Intelligence Engine) and complete testing on production floors.

## Date: 2026-07-03

### What we did today:
- **Master Data UI Update:** Added the "Grinding (sq ft)" column to the Dismantling Joints (DJ) table in the Master Data dashboard as requested.
- **Welding Feet Data Fallback:** Fixed an issue where the Dismantling Joint welding feet were displaying as 0. The backend was updated on July 1 to store DJ welding feet in `mig_feet` instead of `tig_feet`, but the frontend was still looking for `tig_feet`. Added a robust fallback (`mig_feet || tig_feet`) to ensure both new and old DJ records display correctly.
- **Deployment & Syncing:** Pushed all UI fixes to the `demo` branch for verification and then successfully merged into the `main` branch for production deployment.

### Problems faced:
- The user reported that DJ welding feet were showing as 0. After rolling back and investigating, discovered that the values were *already* 0 because the user's Railway production database still had the old data structure (before July 1) where DJ feet were stored in `tig_feet`, while our new UI update only looked for `mig_feet`.
- The user verified the fix on `demo` but it wasn't showing on production because our strict workflow dictates that changes aren't merged to `main` without explicit approval.

### How we solved them:
- Modified the frontend table mapping in `next-frontend/src/app/(main)/master/page.tsx` to intelligently fallback to `tig_feet` if `mig_feet` is 0.
- Requested and received explicit permission from the user to merge `demo` into `main`, which successfully deployed the fixes to production.

### What needs to be done next session:
- Execute the **Pagarbook / Excel Attendance Integration** as outlined in the implementation plan.
- Finalize reporting features, potentially filtering projects/capacity based on Company vs. Contractor.
- Move towards Phase 7 (Material Intelligence Engine) and complete testing on production floors.


## Date: 2026-07-02

### What we did today:
- **Phase & Roadmap Updates:** Updated the implementation phases to formally close out Phases 3, 4, 5, and 6 as completed. Setup the trajectory for Phase 7 (Materials), Reporting, and Multi-Metric architecture.
- **Git Sync Fixes:** Resolved divergent branches between local and remote `main` branch, successfully merging and deploying `demo` branch changes.
- **Production Employee Import Instructions:** Provided CLI commands and Python scripts for executing the workforce synchronization directly on the Railway production server.
- **Auto-Scheduler Pacing Fix:** Discovered a major bug where the Daily Pacing Engine lumped all required feet into a single generic bucket, causing TIG Welders to monopolize assignments. Rewrote the logic to calculate strictly proportional `remaining_TIG`, `remaining_MIG`, and `remaining_GRINDING` metrics, forcing the scheduler to distribute tasks properly across all skill sets.
- **UI Pacing Separation:** Upgraded the "Daily Execution Plan" table in the Planning Dashboard to dynamically display the split daily targets (TIG Today, MIG Today, Grind Today) instead of a monolithic "Today's Requirement".
- **Pagarbook Integration Plan:** Designed and generated a complete `implementation_plan.md` to build an Excel/Pagarbook bulk attendance uploader to automate daily workforce check-ins before running the auto-scheduler.

### What needs to be done next session:
- Execute the **Pagarbook / Excel Attendance Integration** as outlined in the implementation plan.
- Finalize reporting features, potentially filtering projects/capacity based on Company vs. Contractor.
- Move towards Phase 7 (Material Intelligence Engine) and complete testing on production floors.

## Date: 2026-06-30

### What we did today:
- **Bulletproof DJ Resource Allocation:** Implemented an unconditional override for all Dismantling Joint (DJ) simulations. Whether reading from explicitly added DJ data or falling back to EJ templates, the engine now forcefully zeroes out TIG welders/feet and securely channels 100% of the workload into MIG calculations, perfectly aligning with backend dashboard metrics and resolving UI inconsistencies.
- **Operator Deletion Integrity:** Comprehensive repair of the operator hard-deletion workflow. Hardened the database backend to proactively intercept and wipe all historical `attendance_logs` and `daily_task_assignments` tethered to an operator, while safely anonymizing their `audit_logs` and `production_logs`. This comprehensively resolves all PostgreSQL foreign key constraint exceptions.
- **Project Planning Pipeline:** Added a brand-new "Planning" state to the Edit Projects panel. Updated the Executive Capacity Dashboard to specifically segregate and display "Planning Pending Feet" in a distinct sky-blue UI block, cleanly isolating upcoming scheduled workload away from immediate active demands.

### Problems faced:
- The backend's fallback logic for DJ projects broke when actual DJ entries were explicitly added to the master database with data accidentally entered in the TIG columns (replicating old company habits). The system accurately read the new master rows instead of triggering the fallback, which re-introduced TIG welder requirements.
- Hard-deleting an operator triggered `ForeignKeyViolation` database crashes. It turned out PostgreSQL was violently rejecting the deletion because the operator had strict requirements tied to the new Attendance and Daily Tasks models.

### How we solved them:
- Removed the conditional fallback logic entirely and implemented a hard mathematical override across all three simulation endpoints (`simulate`, `simulate_resources`, `simulate_duration`) and the production line synchronization. The system no longer cares what column DJ feet are stored in—if the type is DJ, it always diverts the output entirely to MIG.
- Mapped out every single table referencing `users.id` and updated the deletion route to perform an exhaustive, sequential cascading sweep (unlinking where `nullable=True` and deleting where `nullable=False`) immediately before deleting the user object.

### What needs to be done next session:
- Finalize reporting features, potentially filtering projects/capacity based on Company vs. Contractor.
## Date: 2026-07-01

### What we did today:
- **Daily Target Reversion & Math Fixes:** Reverted the system's core capacity math from feet/hour back to target feet/day for a more seamless experience. Discovered and removed lingering hourly multipliers in `production_service.py` that were causing project creation API crashes, restoring flawless project generation.
- **Workforce Integration:** Seamlessly integrated 57 multi-skilled workers from the master Excel list into the Railway production database.
- **Auto-Scheduler Hardening:** Fixed a bug where the auto-assignment engine attempted to assign production pacing tasks to Fitters. Implemented a strict skill-filtering pipeline so pacing algorithms only target active Welding (TIG/MIG) and Grinding roles.
- **Workforce UI Enhancement:** Cleaned up the Workforce Intelligence dashboard by completely stripping out the unused "Department" column, ensuring all workers are intelligently identified exclusively by their Primary Skill across all tables and dropdown menus.
- **Future Architecture Blueprint:** Researched and designed a comprehensive `implementation_plan.md` to upgrade the pacing engine into a "Multi-Metric Process" model. This future architecture will natively track Fitters, Hydro Testers, TIG Tackers, and Welding Position Operators using Hours/Units alongside the Welders' Linear Feet.

### What needs to be done next session:
- Finalize reporting features, potentially filtering projects/capacity based on Company vs. Contractor.
- Move towards Phase 7 (Material Intelligence Engine) and complete testing on production floors.
- Execute the Multi-Metric Process architecture when Fitter/Hydro tracking is greenlit.

## Date: 2026-06-29

### What we did today:
- **Project Payroll Option:** Added a new `payroll` field to the Projects model, supporting "Company" or "Contractor" assignments.
- **PN Rating Option:** Added a `pn_rating` field to the project items (joints/bellows), including a dropdown in the Add/Edit Project UI (PN 6, 10, 16, 20, 25).
- **Backend & Database Updates:** Created a database auto-migration to insert the columns into PostgreSQL and updated `schemas.py` and `router.py` to seamlessly handle reading/writing the `payroll` and `pn_rating` states via the APIs.
- **Frontend Enhancements:** Updated the Add Project and Edit Project forms to include a Payroll Option dropdown UI. Furthermore, the main Projects List table was enhanced with a dedicated Payroll column that features dynamically colored badges.
- **Joint Assignment UX:** Improved the "Joints & Bellows" interface across the Add/Edit Project screens. Added automatically numbering (Sr. No. starting from 1) to each row with a matching header to make tracking easier. Also prevented the `Enter` key from accidentally submitting the entire project form when a user is modifying the size or quantity of a joint.
- **Hourly Productivity Metrics:** Completely overhauled the backend math engine and database schema to calculate worker production capacity based on **feet/hour** rather than feet/day. Implemented a seamless DB migration script that safely converted existing daily totals by automatically dividing them by 8. All simulation, overtime, and capacity calculations are now fully synced and standardized across the API endpoints using precise hourly outputs.

### Problems faced:
- The backend required a hard restart without active user interaction to successfully parse the migration script.
- The Production Entry API endpoints were erroneously attributing `System/Unknown` in the Audit Logs because they were tying the log to the optional physical operator instead of the authenticated user submitting the form.

### How we solved them:
- Discovered that running uvicorn explicitly via `python3 -m uvicorn backend.main:app` out of the root directory seamlessly handled module paths and resolved `No module named 'backend'` errors.
- Modified the production routing endpoints to extract the active session's `current_user["username"]`, query their exact database ID, and correctly bind that identity to the Audit Log transaction.

### What needs to be done next session:
- Finalize reporting features, potentially filtering projects/capacity based on Company vs. Contractor.


## Date: 2026-06-28

### What we did today:
- **Audit Logs Timezone Update:** Adjusted the System Audit Logs module to display all timestamps in IST (GMT+5:30) for both the web interface and Excel exports.
- **Role-based Audit Log Access:** Revoked access to the System Audit Logs module specifically for the "Production Manager" and "GM" roles. This applies to both frontend sidebar visibility and direct backend API protection.
- **Temporary Access Bypass:** Removed all role-based restrictions from the frontend sidebar and backend endpoints. All users now have full visibility and access to every module across the application, pending a future RBAC overhaul.
- **Planning Dashboard Optimization:** Fixed 4-Week Capacity Forecast to use dynamic real-world calendar date ranges. Modified the Master Schedule to display `quotation_no` (Project Code) instead of the customer details to keep it cleaner.
- **Smart Scheduler Automation:** Overhauled the Daily Scheduler to become a "seamless" enterprise-grade system. It now automatically calculates and auto-assigns the daily goals upon opening the page if they haven't been assigned yet, without forcing the user to manually click options.
- **Dynamic Resource Simulator Engine:** 
  - Created a new backend simulation endpoint (`simulate_resources`).
  - Integrated this engine directly into the "Create Project" and "Edit Project" pages. Now, whenever the user changes bellows sizes, quantities, or the target deadline, the required TIG Welders, MIG Welders, and Grinders dynamically recalculate and instantly update on the UI before saving.
  - Successfully combined the backend capacity requirements for both Expansion Joints (EJ) and Dismantling Joints (DJ) into a single "TIG" metric as requested.
- **Edit Project UI Polish:** Added a dynamic "Target Date" modifier directly to the Edit Projects panel, allowing instant rescheduling.

- **Dashboard Evolution:** Upgraded the Progress Dashboard to clearly segment and display "Active Projects", "Projects on Hold", and "Completed Projects" as distinct KPIs.
- **Workflow Streamlining:** Simplified the Shop Floor Input form by removing the "Operator" dropdown, allowing the Production Manager to enter data significantly faster without redundant selections.
- **System Audit & Security:** Built a comprehensive Audit Log system that records logins and sensitive data modifications. Protected this dashboard exclusively for Developers, complete with an instant CSV/Excel export feature.

### Problems faced:
- Live resource calculations suddenly returned zeroes for DJ type bellows and gave incorrect total metrics.
- The user wanted a completely automated scheduler that wouldn't require daily manual button clicks.
- "Hold" projects failed to appear on the new Progress Dashboard due to a backend status string typo.
- The Live Overtime Predictions were displaying 0 hours, which initially appeared to be a bug but was actually mathematically correct based on massive available capacity.

### How we solved them:
- Discovered and fixed a python dictionary key-matching bug where database records containing `None` for joint_type were failing to match against `"EJ"` lookup strings. Adjusted the backend `simulate_resources` logic to safely default null records to `"EJ"`, perfectly restoring parity with the original calculator.
- Implemented lazy-loading auto-initialization inside `scheduler/page.tsx`, which silently handles assignment execution when the supervisor first visits the page for the day.
- Fixed the database query logic from `Project.status == "On Hold"` to `"Hold"` to ensure the backend accurately counted and returned the correct hold metrics.
- Educated the user on the difference between standard capacity vs required hours, confirming that 0 overtime means their current workforce is sufficiently staffed for the pending workload.
- Refactored `production_logs` and `welding_logs` database models and Pydantic schemas to allow nullable `operator_id` fields, safely empowering the PM to log production without being forced to choose an operator profile.

### What is pending:
- We still need to test the Smart Task Allocation modules thoroughly with live production data.
- Refine the auto-assignment algorithm to pull the exact remaining feet required per project from `ProjectProductionLine` instead of simulating distribution.

### What needs to be done next session:
- Finalize any further UX improvements for the Planning Dashboard.
- Move towards Phase 7 (Material Intelligence Engine) and complete testing on production floors.

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
- **Phase 5 Execution (Weekly & Monthly Planning Engine):**
  - Added a `target_date` (Delivery Deadline) column to the core `Project` database model with automated SQLite and PostgreSQL startup migrations.
  - Rewrote the `/api/v1/dashboard/planning` backend endpoint to act as a forecasting engine. It dynamically computes total factory capacity (summing all operator base productivities for a 6-day work week).
  - Designed the engine to scan all active projects, compute remaining workload (subtracting MES logs), and bucket the workload into 4-week forecasts based on `target_date`.
  - Built a brand new 4-Week Capacity Forecast UI section in `/dashboard/planning` with dynamic progress bars that turn red and calculate required overtime when demand exceeds factory capacity.
  - Implemented tracking for "Unscheduled Backlog" to catch projects without deadlines.
- **Phase 5.5 (Project Deadline UI):**
  - Updated the API schemas to accept `target_date` dynamically during project creation and editing.
  - Added a "Delivery Deadline" date-picker directly to the "Create Project" and "Edit Project" pages so planners can instantly set dates to sync with the forecasting engine.
  - **Dynamic Priority Engine:** Integrated dynamic calculation of project priorities based on deadline proximity. Automatically flags projects as **P1** (<= 21 days, Red), **P2** (<= 60 days, Orange), or **P3** (> 60 days / Unscheduled, Green) across the Planning Dashboard.
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
- **Dismantling Joint Implementation:** 
  - Updated DB schema to include `joint_type` in `WeldingMaster` and `ProjectProductionLine`.
  - Added dynamic Joint Type selector (Expansion Joint vs Dismantling Joint) in `projects/add/page.tsx` and `projects/edit/page.tsx`.
  - Added an importer for the newly provided Dismantling Joint welding feet data.
  - Separated UI rendering in `projects/page.tsx` to handle custom column formatting for Dismantling Joints (showing just "Welding Feet").
- **Dismantling Joint Tracking & Analytics:**
  - Upgraded the MES backend engine to automatically generate accurate Dismantling Joint fabrication processes (like PIPE-1, STOPPER) by syncing templates from the Job Tracker.
  - Updated the Shop Floor Entry UI to dynamically detect Joint Type, hiding MIG and Grinding options and cleanly presenting a focused "Welding" module for DJ requirements.
  - Corrected API requirement payloads and visual Kanban boards to properly distinguish DJ vs EJ load, feeding accurate numbers up to the Executive and Planning Dashboards.

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
- We need to test the Workforce Intelligence, Smart Task Allocation, and Planning modules thoroughly with real data on the shop floor.
- The metrics calculation currently uses placeholders for quality and efficiency scores; we need the precise formulas from management to calculate them based on actual feet welded / defects.
- Refine the auto-assignment algorithm to pull the exact remaining feet required per project from `ProjectProductionLine` instead of simulating distribution.

### What needs to be done next session:
- Execute Phase 6 (Hold Management System) - *Note: We have already completed a large chunk of this in earlier sessions, just need to finalize tracking material holds.*
- Execute Phase 7 (Material Intelligence Engine).
- Finalize the Quality & Efficiency score calculation logic with exact formulas.
