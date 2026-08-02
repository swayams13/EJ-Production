# QA Sweep Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all 33 findings from the 2026-08-03 QA sweep (report: `https://claude.ai/code/artifact/7bf790ce-655c-4dfc-89b2-a521cdeed45d`, log: `projectprogress.md` Session 39), plus one new feature the user requested while reviewing the findings (a request/approval workflow for Production-Manager-initiated employee deletion), in priority order — highest blast-radius first.

**Architecture:** No new services or dependencies. Every fix is a targeted change to an existing router, schema, or component, following patterns already established elsewhere in this codebase (e.g. `PurchaseOrder.raised_by_username` for the env-var-login-has-no-id gap, `_run_startup_migration` for schema changes, `require_roles()` for RBAC, `useToast`/`useConfirm` for UI feedback). Tasks are ordered so that Task 1 (CORS/middleware fix) and Task 2 (JWT id claim) land first, since several later findings' user-visible symptoms depend on them.

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic (backend, PostgreSQL only — see root `CLAUDE.md`), Next.js/TSX (frontend). Tests follow this repo's existing convention: plain `assert`-based Python functions in a `test_*.py` file at repo root, called directly at the bottom of the file, run with `python test_foo.py` — **no pytest, no fixtures** (see `test_work_orders.py`, `test_po_allocation_trace.py` for the house style). Tests that exercise router logic call the endpoint function directly with a real `SessionLocal()` session and a synthetic `current_user` dict (bypassing FastAPI's dependency injection), matching how existing tests in this repo work.

## Global Constraints

- Strictly PostgreSQL — no SQLite, ever (root `CLAUDE.md`). Tests hit the real local dev DB (`ej_tracker`) via `SessionLocal()`, same as existing `test_*.py` files.
- New Python dependencies: none needed for this plan — do not add any.
- All schema changes use the existing `_run_startup_migration()` idempotent-ALTER-TABLE pattern in `backend/main.py` — no new migration tool.
- Every commit is a normal `git commit` on the `demo` branch (per root `CLAUDE.md` — never push directly to `main`).
- Any test data created while verifying a fix must be cleaned up in the same step (delete it before moving on) — this DB has real company data in it, not just sandbox rows.
- Never use `alert()`/`confirm()`/`prompt()` in frontend code — this codebase has `useToast()`/`useConfirm()` for exactly this (see `docs/UI_DESIGN_SYSTEM.md`).
- Decisions already made by the user (do not re-litigate these while implementing):
  - Completion approval: **gate on progress** — block submitting/approving a completion request unless the project's computed progress is effectively 100%.
  - Vendor delete: **block** if any PO references the vendor (400, not silent nullify).
  - Lead-time PATCH on an unknown material name: **404**, not silent upsert.
  - Employee deletion by a Production Manager: **not a direct DELETE** — PM creates a request, only Developer/GM/Admin can approve it (not PM), and CEO/MD get notified the moment the request is created. Developer/GM/Admin keep deleting directly, unchanged.
  - Scheduler employee DELETE role list (excludes PM/CEO/MD), `generate-work-orders` excluding CEO/MD, and the Executive Dashboard excluding GM/PM: **all confirmed intentional — no code change for any of these three.**

---

## Tier 0 — Infrastructure (do first; makes every later silent-failure finding visible)

### Task 1: Fix CORS/error-middleware ordering so unhandled 500s carry CORS headers

**Files:**
- Modify: `backend/main.py`
- Test: `test_cors_on_error.py` (new, repo root)

**Interfaces:**
- Produces: a global `@app.exception_handler(Exception)` in `backend/main.py` that all future tasks can rely on for a clean, generic 500 body instead of a leaked raw exception string.

**Context:** Starlette's `ServerErrorMiddleware` wraps the whole app *outside* `CORSMiddleware`. An exception that isn't caught anywhere bubbles all the way out to `ServerErrorMiddleware`, which builds its response *after* `CORSMiddleware` has already run — so the response never gets CORS headers, and the browser reports a generic `TypeError: Failed to fetch` instead of showing the real status/body. Registering an app-level `@app.exception_handler(Exception)` fixes this: FastAPI's `ExceptionMiddleware` (which sits *inside* `CORSMiddleware`) catches the exception there instead, so the response it builds passes back through `CORSMiddleware` normally. This also incidentally stops raw `psycopg2`/SQLAlchemy exception text from leaking into API responses (relevant to Task 6 below).

- [ ] **Step 1: Write the failing test**

```python
# test_cors_on_error.py
"""Confirms an unhandled exception still gets CORS headers. No pytest, no fixtures."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient


def _build_app(with_handler: bool):
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/boom")
    def boom():
        raise ValueError("kaboom")

    if with_handler:
        from fastapi import Request
        from fastapi.responses import JSONResponse

        @app.exception_handler(Exception)
        async def unhandled_exception_handler(request: Request, exc: Exception):
            return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    return app


def test_without_handler_500_has_no_cors_header():
    app = _build_app(with_handler=False)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/boom", headers={"Origin": "http://localhost:3000"})
    assert resp.status_code == 500
    assert "access-control-allow-origin" not in resp.headers
    print("PASS: confirmed the bug reproduces without the handler")


def test_with_handler_500_has_cors_header():
    app = _build_app(with_handler=True)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/boom", headers={"Origin": "http://localhost:3000"})
    assert resp.status_code == 500
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert resp.json() == {"detail": "Internal server error"}
    print("PASS: exception handler makes the 500 response carry CORS headers")


test_without_handler_500_has_no_cors_header()
test_with_handler_500_has_cors_header()
print("All CORS/error-middleware tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_cors_on_error.py`
Expected: passes today (both functions test a standalone app, not `backend.main` yet) — this step just confirms the test file itself runs and the *first* assertion (bug reproduces without a handler) is correct proof the pattern is real. The second assertion is what Step 4 wires into the real app.

- [ ] **Step 3: Add the exception handler to `backend/main.py`**

In `backend/main.py`, right after the `app = FastAPI(...)` line and *before* `app.add_middleware(CORSMiddleware, ...)` (order of these two specific calls relative to each other doesn't matter — `add_exception_handler` isn't middleware — but keep it near the top for visibility):

```python
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
```

(add `Request` to the existing `fastapi` import line, add the new `fastapi.responses` import line right after it)

Then, after `app = FastAPI(title="EJ Production Tracker API", version="1.0.0")`:

```python
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})
```

- [ ] **Step 4: Verify against the real app**

Run: `python -m uvicorn backend.main:app --port 8003 --reload` (if not already running), then in another terminal:
```bash
curl -s -i -X PATCH http://localhost:8003/api/v1/procurement/lead-times/QA_SANDBOX_DOES_NOT_EXIST \
  -H "Content-Type: application/json" -H "Origin: http://localhost:3000" \
  -d '{"lead_time_days": 5}'
```
Expected before this fix (on current `demo`, before Task 15's 404 change lands): a `500` with **no** `access-control-allow-origin` header. After this fix: still `500` for now (Task 15 hasn't changed this endpoint's behavior yet), but the response **does** carry `access-control-allow-origin: http://localhost:3000` and a clean `{"detail":"Internal server error"}` body instead of a raw traceback/SQL string. This confirms the fix works end-to-end before any endpoint-specific fixes land.

- [ ] **Step 5: Commit**

```bash
git add backend/main.py test_cors_on_error.py
git commit -m "fix: register global exception handler so 500s carry CORS headers

ServerErrorMiddleware sits outside CORSMiddleware, so any unhandled
exception's response skipped CORS entirely and the browser reported a
generic 'Failed to fetch' instead of the real error. An app-level
exception_handler is caught by ExceptionMiddleware (inside CORSMiddleware)
instead, so the response passes through CORS normally. Also stops raw
driver exception text from leaking into API responses."
```

---

## Tier 1 — Critical (Change-Request system is completely dead + new employee-deletion workflow)

### Task 2: Fix `current_user["id"]` KeyError — carry a numeric id (or username fallback) through Change-Request flows

**Files:**
- Modify: `backend/services/db_service.py` (ChangeRequest model)
- Modify: `backend/app/auth/router.py` (JWT claims)
- Modify: `backend/app/auth/rbac.py` (`get_current_user` return shape)
- Modify: `backend/app/scheduler/router.py` (4 call sites + response schema)
- Modify: `backend/app/scheduler/schemas.py` (`ChangeRequestResponse`)
- Modify: `backend/main.py` (startup migration)
- Test: `test_change_request_actor_id.py` (new, repo root)

**Interfaces:**
- Produces: `get_current_user()` now returns `{"username": str, "role": str, "id": int | None}` — every router depending on it gets the new key for free.
- Produces: `ChangeRequest.proposed_by`/`approved_by` are now **nullable** FKs (were `NOT NULL`); new nullable `proposed_by_username`/`approved_by_username` text columns always carry the actor's username regardless of whether they have a DB `User` row.

**Context:** Env-var management logins (Developer/GM/PM/CEO/MD, authenticated against `.env` pairs, not a DB row) have no `User.id` at all — `get_current_user()` only ever returns `{"username", "role"}`. But `create_change_request`, `get_change_requests`, `approve_change_request`, and `reject_change_request` in `backend/app/scheduler/router.py` all read `current_user["id"]` unconditionally, which is a `KeyError` → 500 for every call. This is the exact same architectural gap `PurchaseOrder.raised_by`/`raised_by_username` already solves elsewhere in this codebase (`backend/services/db_service.py:253-254`) — this task applies that identical, already-proven pattern to `ChangeRequest`.

- [ ] **Step 1: Write the failing test**

```python
# test_change_request_actor_id.py
"""Confirms env-var (no-DB-row) actors can create/approve change requests without a KeyError. No pytest, no fixtures."""
import os
os.environ.setdefault("JWT_SECRET_KEY", "test-key-for-unit-tests")

import json
from backend.services.db_service import SessionLocal, ChangeRequest
from backend.app.scheduler.router import create_change_request, approve_change_request
from backend.app.scheduler.schemas import ChangeRequestCreate


def test_env_var_user_with_no_id_can_create_change_request():
    db = SessionLocal()
    try:
        current_user = {"username": "test_pm_envvar", "role": "Production Manager", "id": None}
        payload = ChangeRequestCreate(
            subject_type="daily_plan_override",
            subject_id=None,
            target_date=None,
            changes_json=json.dumps({"exclude_user_ids": [], "capacity_overrides": {}}),
        )
        cr = create_change_request(payload, db, current_user)
        assert cr.proposed_by is None
        assert cr.proposed_by_username == "test_pm_envvar"
        print("PASS: env-var user (id=None) created a change request without a KeyError")

        current_user_approver = {"username": "test_gm_envvar", "role": "GM", "id": None}
        approved = approve_change_request(cr.id, db, current_user_approver)
        assert approved.status == "approved"
        assert approved.approved_by is None
        assert approved.approved_by_username == "test_gm_envvar"
        print("PASS: env-var user (id=None) approved a change request without a KeyError")
    finally:
        db.query(ChangeRequest).filter(ChangeRequest.proposed_by_username == "test_pm_envvar").delete()
        db.commit()
        db.close()


test_env_var_user_with_no_id_can_create_change_request()
print("All change-request actor-id tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_change_request_actor_id.py`
Expected: `KeyError: 'id'` (or `TypeError` from `ChangeRequestCreate` not matching, depending on which line is hit first) — confirms the bug.

- [ ] **Step 3: Add the migration to `backend/main.py`**

Add near the other `_run_startup_migration` calls:

```python
_run_startup_migration("change_requests.username_and_nullable_actor_ids", [
    "ALTER TABLE change_requests ALTER COLUMN proposed_by DROP NOT NULL",
    "ALTER TABLE change_requests ADD COLUMN proposed_by_username TEXT",
    "ALTER TABLE change_requests ADD COLUMN approved_by_username TEXT",
])
```

- [ ] **Step 4: Update the `ChangeRequest` model**

In `backend/services/db_service.py`, replace:

```python
    proposed_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
```

with:

```python
    proposed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    proposed_by_username = Column(String, nullable=True)  # env-var management logins have no users row (see PurchaseOrder.raised_by_username)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by_username = Column(String, nullable=True)
```

- [ ] **Step 5: Update `get_current_user()` in `backend/app/auth/rbac.py`**

Replace:
```python
        return {"username": username, "role": role}
```
with:
```python
        return {"username": username, "role": role, "id": payload.get("uid")}
```

- [ ] **Step 6: Carry the numeric id in the JWT claims in `backend/app/auth/router.py`**

In `login()`, `user` is already looked up for the DB-users branch and for the audit log (`user_id = user.id if 'user' in locals() and user else None`). Change the two `create_access_token`/`create_refresh_token` calls from:

```python
    access_token = create_access_token(
        data={"sub": req.username, "role": role}, expires_delta=access_token_expires
    )
    refresh_token = create_refresh_token(data={"sub": req.username, "role": role})
```
to:
```python
    access_token = create_access_token(
        data={"sub": req.username, "role": role, "uid": user_id}, expires_delta=access_token_expires
    )
    refresh_token = create_refresh_token(data={"sub": req.username, "role": role, "uid": user_id})
```

(`user_id` is already computed a few lines above for the audit log — reuse it, don't recompute.)

In `refresh()`, the endpoint re-derives `role` from a fresh DB lookup (`db_user = db.query(User).filter(...)`) but never re-derives `user_id`. Add it right next to where `role` is re-derived:

```python
    db_user = db.query(User).filter(User.username == username).first()
    if db_user:
        role = db_user.role
    user_id = db_user.id if db_user else None
```
(this line already exists as `user_id = db_user.id if db_user else None` — just confirm the subsequent `create_access_token` call includes `"uid": user_id`, matching Step 6's shape:)
```python
    access_token = create_access_token(
        data={"sub": username, "role": role, "uid": user_id},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
```

- [ ] **Step 7: Fix the 4 call sites in `backend/app/scheduler/router.py`**

Replace `create_change_request`:
```python
@router.post("/change-requests", response_model=ChangeRequestResponse)
def create_change_request(
    payload: ChangeRequestCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"])),
):
    cr = ChangeRequest(
        subject_type=payload.subject_type,
        subject_id=payload.subject_id,
        target_date=payload.target_date,
        proposed_by=current_user.get("id"),
        proposed_by_username=current_user["username"],
        changes_json=payload.changes_json,
        status="pending_approval",
    )
    db.add(cr)
    db.commit()
    db.refresh(cr)
    return cr
```

Replace the Supervisor-scoping line in `get_change_requests`:
```python
    if current_user.get("role") == "Supervisor":
        query = query.filter(ChangeRequest.proposed_by_username == current_user["username"])
```
(switched from filtering by `proposed_by` id — which may be `None` for env-var users — to filtering by the always-populated username; a Supervisor's own account is always a DB row anyway, so this is equally correct and avoids the `None`-matches-`None` footgun of comparing nullable ids.)

Replace the two lines in `approve_change_request`:
```python
    cr.status = "approved"
    cr.approved_by = current_user.get("id")
    cr.approved_by_username = current_user["username"]
    cr.resolved_at = datetime.utcnow()
```

Replace the two lines in `reject_change_request`:
```python
    cr.status = "rejected"
    cr.approved_by = current_user.get("id")
    cr.approved_by_username = current_user["username"]
    cr.rejection_note = payload.rejection_note
    cr.resolved_at = datetime.utcnow()
```

- [ ] **Step 8: Update `ChangeRequestResponse` in `backend/app/scheduler/schemas.py`**

Add the two new fields so the frontend can use them as a fallback display (Task 4 relies on this):
```python
class ChangeRequestResponse(BaseModel):
    id: int
    subject_type: str
    subject_id: Optional[int] = None
    target_date: Optional[date] = None
    proposed_by: Optional[int] = None
    proposed_by_username: Optional[str] = None
    approved_by: Optional[int] = None
    approved_by_username: Optional[str] = None
    status: str
    changes_json: str
    rejection_note: Optional[str] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None
    proposer: Optional[SimpleUser] = None

    class Config:
        orm_mode = True
```
(only change from the original: `proposed_by` is now `Optional[int] = None`, and the two new username fields are added.)

- [ ] **Step 9: Run test to verify it passes**

Run: `python test_change_request_actor_id.py`
Expected: `All change-request actor-id tests passed.`

- [ ] **Step 10: Live-verify the original bug is gone**

```bash
# Log in as the seeded qa_supervisor account (create one if it no longer exists — see projectprogress.md Session 39 for how), get a token, then:
curl -s -X POST http://localhost:8003/api/v1/scheduler/change-requests \
  -H "Authorization: Bearer <supervisor_token>" -H "Content-Type: application/json" \
  -d '{"subject_type":"daily_plan_override","subject_id":null,"target_date":null,"changes_json":"{\"exclude_user_ids\":[],\"capacity_overrides\":{}}"}'
```
Expected: `201`-shaped success body (`id`, `status: "pending_approval"`, etc.), not `500`. Delete the created row afterward: `psql ej_tracker -c "DELETE FROM change_requests WHERE subject_type='daily_plan_override' AND target_date IS NULL AND proposed_by_username='qa_supervisor';"` (adjust to target only the row you just created).

- [ ] **Step 11: Commit**

```bash
git add backend/services/db_service.py backend/app/auth/router.py backend/app/auth/rbac.py \
        backend/app/scheduler/router.py backend/app/scheduler/schemas.py backend/main.py \
        test_change_request_actor_id.py
git commit -m "fix: current_user[\"id\"] KeyError kills the entire Change-Request workflow

get_current_user() never returned an 'id' key — env-var management
logins have no DB User row at all, so there was no numeric id to return.
Now carries a 'uid' JWT claim (None for env-var logins) and, following
the exact pattern PurchaseOrder.raised_by_username already established
for this same gap, ChangeRequest gets nullable proposed_by/approved_by
plus always-populated *_username columns so attribution never breaks
regardless of login type."
```

### Task 3: Add PM-initiated employee-deletion request/approval workflow

**Files:**
- Modify: `backend/app/scheduler/router.py` (`approve_change_request`, `reject_change_request`, new deletion-execution logic)
- Test: `test_employee_delete_request.py` (new, repo root)

**Interfaces:**
- Consumes: the `current_user.get("id")`/`current_user["username"]` pattern and nullable `proposed_by`/`approved_by` fields from Task 2.
- Produces: `ChangeRequest` rows with `subject_type="employee_delete"` and `subject_id=<Employee.id>`; approving one actually deletes the `Employee` row.

**Context:** Per the user's decision: a Production Manager can't `DELETE /scheduler/employees/{id}` directly (that stays Developer/GM/Admin-only, unchanged) — instead they create a `ChangeRequest`, only Developer/GM/Admin can approve or reject it (not PM, so no self-approval), and CEO+MD get a notification the instant the request is created. This reuses the existing `ChangeRequest` + `Notifications` infrastructure exactly as `employee_profile`/`daily_plan_override` already do — no new tables.

- [ ] **Step 1: Write the failing test**

```python
# test_employee_delete_request.py
"""Confirms the PM employee-deletion request/approval workflow. No pytest, no fixtures."""
import os
os.environ.setdefault("JWT_SECRET_KEY", "test-key-for-unit-tests")

import json
from fastapi import HTTPException
from backend.services.db_service import SessionLocal, ChangeRequest, Employee, Notification
from backend.app.scheduler.router import create_change_request, approve_change_request, reject_change_request
from backend.app.scheduler.schemas import ChangeRequestCreate, ChangeRequestReject


def _make_sandbox_employee(db):
    emp = Employee(emp_id="QA_SANDBOX_EMP_001", name="QA_SANDBOX_EMP_001", company="D2", target_per_day=50.0)
    db.add(emp)
    db.commit()
    db.refresh(emp)
    return emp


def test_pm_request_only_developer_gm_admin_can_approve():
    db = SessionLocal()
    emp = _make_sandbox_employee(db)
    try:
        pm_user = {"username": "test_pm", "role": "Production Manager", "id": None}
        payload = ChangeRequestCreate(
            subject_type="employee_delete",
            subject_id=emp.id,
            target_date=None,
            changes_json=json.dumps({"employee_name": emp.name}),
        )
        cr = create_change_request(payload, db, pm_user)
        assert cr.status == "pending_approval"

        # CEO and MD should each have gotten a notification about this request.
        notifs = db.query(Notification).filter_by(event_type="employee_delete_request").all()
        roles_notified = {n.for_role for n in notifs}
        assert {"CEO", "MD"}.issubset(roles_notified)
        print("PASS: CEO and MD notified when the deletion request was created")

        # PM cannot approve their own request.
        try:
            approve_change_request(cr.id, db, pm_user)
            assert False, "PM should not be able to approve an employee_delete request"
        except HTTPException as e:
            assert e.status_code == 403
            print("PASS: Production Manager cannot approve an employee_delete request")

        # GM can approve it, and the employee actually gets deleted.
        gm_user = {"username": "test_gm", "role": "GM", "id": None}
        approve_change_request(cr.id, db, gm_user)
        assert db.query(Employee).filter_by(id=emp.id).first() is None
        print("PASS: GM approval actually deletes the employee")
    finally:
        db.query(ChangeRequest).filter(ChangeRequest.subject_type == "employee_delete", ChangeRequest.subject_id == emp.id).delete()
        db.query(Notification).filter_by(event_type="employee_delete_request").delete()
        db.query(Employee).filter_by(id=emp.id).delete()
        db.commit()
        db.close()


def test_pm_cannot_reject_own_request_either():
    db = SessionLocal()
    emp = _make_sandbox_employee(db)
    try:
        pm_user = {"username": "test_pm", "role": "Production Manager", "id": None}
        cr = create_change_request(
            ChangeRequestCreate(subject_type="employee_delete", subject_id=emp.id, target_date=None,
                                changes_json=json.dumps({"employee_name": emp.name})),
            db, pm_user,
        )
        try:
            reject_change_request(cr.id, ChangeRequestReject(rejection_note="no"), db, pm_user)
            assert False, "PM should not be able to reject an employee_delete request either"
        except HTTPException as e:
            assert e.status_code == 403
            print("PASS: Production Manager cannot reject an employee_delete request")
    finally:
        db.query(ChangeRequest).filter(ChangeRequest.subject_type == "employee_delete", ChangeRequest.subject_id == emp.id).delete()
        db.query(Notification).filter_by(event_type="employee_delete_request").delete()
        db.query(Employee).filter_by(id=emp.id).delete()
        db.commit()
        db.close()


test_pm_request_only_developer_gm_admin_can_approve()
test_pm_cannot_reject_own_request_either()
print("All employee-delete-request workflow tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_employee_delete_request.py`
Expected: fails on the "CEO and MD notified" assertion (no notification created yet) and/or the PM-approval-should-403 assertion (currently PM *can* approve, since there's no subject_type-specific restriction).

- [ ] **Step 3: Add the CEO/MD notification to `create_change_request`**

In `backend/app/scheduler/router.py`, after `db.refresh(cr)` in `create_change_request`, before `return cr`:

```python
    if cr.subject_type == "employee_delete" and cr.subject_id:
        emp = db.query(Employee).filter(Employee.id == cr.subject_id).first()
        emp_name = emp.name if emp else f"Employee #{cr.subject_id}"
        for exec_role in ("CEO", "MD"):
            create_notification(
                db, exec_role, "employee_delete_request",
                f"Employee deletion requested: {emp_name}",
                f"{cr.proposed_by_username} requested deletion of {emp_name}. Awaiting Developer/GM/Admin approval.",
                "/scheduler?tab=approvals",
            )
```

This needs `create_notification` imported — it already is (`from backend.services.notification_service import create_notification`, line 11).

- [ ] **Step 4: Restrict approve/reject for `employee_delete` requests to Developer/GM/Admin, and perform the deletion on approval**

In `approve_change_request`, right after the existing `if cr.status != "pending_approval":` guard, add:

```python
    if cr.subject_type == "employee_delete" and current_user["role"] not in ("Developer", "GM", "Admin"):
        raise HTTPException(status_code=403, detail="Only Developer, GM, or Admin can approve an employee-deletion request")
```

Then extend the existing `if cr.subject_type == "employee_profile" and cr.subject_id:` block with an `elif`:

```python
    elif cr.subject_type == "employee_delete" and cr.subject_id:
        emp = db.query(Employee).filter(Employee.id == cr.subject_id).first()
        if emp:
            db.delete(emp)
```

In `reject_change_request`, add the identical role guard right after its own `if cr.status != "pending_approval":` check:

```python
    if cr.subject_type == "employee_delete" and current_user["role"] not in ("Developer", "GM", "Admin"):
        raise HTTPException(status_code=403, detail="Only Developer, GM, or Admin can reject an employee-deletion request")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python test_employee_delete_request.py`
Expected: `All employee-delete-request workflow tests passed.`

- [ ] **Step 6: Commit**

```bash
git add backend/app/scheduler/router.py test_employee_delete_request.py
git commit -m "feat: PM-initiated employee-deletion request/approval workflow

Reuses the existing ChangeRequest + Notifications infrastructure with a
new employee_delete subject_type. A Production Manager can request an
employee's deletion; only Developer/GM/Admin can approve or reject it
(not PM, so no self-approval); CEO and MD are notified the moment the
request is created. Direct DELETE for Developer/GM/Admin is unchanged."
```

### Task 4: Frontend — wire the PM deletion-request flow, fix the dead "Propose Changes" button, add try/catch around change-request calls

**Files:**
- Modify: `next-frontend/src/app/(main)/scheduler/page.tsx`

**Interfaces:**
- Consumes: `ChangeRequestResponse`'s new `proposed_by_username`/`approved_by_username` fields (Task 2), the `employee_delete` subject_type (Task 3).

- [ ] **Step 1: Add role-based branching to the TS interface and role checks**

Update the `ChangeRequest` interface (around line 38):
```typescript
interface ChangeRequest {
  id: number;
  subject_type: string;
  subject_id: number | null;
  target_date: string | null;
  proposed_by: number | null;
  proposed_by_username: string | null;
  status: string;
  changes_json: string;
  rejection_note: string | null;
  created_at: string;
  proposer?: { id: number; full_name: string | null };
}
```

Add two new role constants right after the existing `canEditEmployees` line (~136):
```typescript
  const canDeleteEmployeeDirectly = ["Developer", "GM", "Admin"].includes(userRole);
  const canRequestEmployeeDeletion = userRole === "Production Manager";
```

- [ ] **Step 2: Update `crSummary()` to describe `employee_delete` requests**

```typescript
function crSummary(cr: ChangeRequest): string {
  try {
    const c = JSON.parse(cr.changes_json);
    if (cr.subject_type === "employee_profile") {
      return `Employee profile: ${Object.keys(c.changes ?? {}).join(", ")}`;
    }
    if (cr.subject_type === "employee_delete") {
      return `Delete employee: ${c.employee_name ?? `#${cr.subject_id}`}`;
    }
    const excluded = (c.exclude_user_ids ?? []).length;
    const overridden = Object.keys(c.capacity_overrides ?? {}).length;
    return `Daily plan: ${excluded} excluded, ${overridden} capacity overrides`;
  } catch {
    return cr.subject_type;
  }
}
```

- [ ] **Step 3: Rewrite `handleDeleteEmployee` to branch by role, and wrap it in try/catch**

Replace the existing function:
```typescript
  const handleDeleteEmployee = async (empId: number, name: string) => {
    if (canRequestEmployeeDeletion) {
      const ok = await confirm({
        title: `Request deletion of ${name}?`,
        description: "This sends a request to Developer/GM/Admin for approval. The employee is not removed until approved.",
        confirmLabel: "Request Deletion",
        tone: "danger",
      });
      if (!ok) return;
      try {
        const res = await apiFetch(`${API}/api/v1/scheduler/change-requests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject_type: "employee_delete",
            subject_id: empId,
            target_date: null,
            changes_json: JSON.stringify({ employee_name: name }),
          }),
        });
        if (res.ok) {
          showToast(`Deletion of ${name} requested — awaiting approval`, "success");
        } else {
          showToast("Failed to submit deletion request", "critical");
        }
      } catch {
        showToast("Network error — failed to submit deletion request", "critical");
      }
      return;
    }

    const ok = await confirm({
      title: `Delete ${name}?`,
      description: "This permanently removes the employee record. Work orders already assigned will not be affected.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const res = await apiFetch(`${API}/api/v1/scheduler/employees/${empId}`, { method: "DELETE" });
      if (res.ok) {
        showToast(`${name} deleted`, "success");
        setEmployees(prev => prev.filter(e => e.id !== empId));
      } else {
        showToast("Failed to delete employee", "critical");
      }
    } catch {
      showToast("Network error — failed to delete employee", "critical");
    }
  };
```

- [ ] **Step 4: Show the delete/request-deletion button for both roles**

Change the gating at the employee row's action cell from `{canEditEmployees && (...)}` to:
```typescript
                        {(canDeleteEmployeeDirectly || canRequestEmployeeDeletion) && (
                          <button
                            className="rounded px-2 py-1 text-xs text-critical hover:bg-critical/10"
                            onClick={() => handleDeleteEmployee(emp.id, emp.name)}
                          >
                            {canRequestEmployeeDeletion ? "Request Deletion" : "Delete"}
                          </button>
                        )}
```

- [ ] **Step 5: Wire up the dead "Propose Changes" button for Supervisor, and wrap it in try/catch**

Add try/catch to the existing `handleProposeEmployeeChanges` body (wrap the existing `for` loop and its `apiFetch` call):
```typescript
  const handleProposeEmployeeChanges = async () => {
    const entries = Object.entries(editedEmployees);
    if (!entries.length) { showToast("No changes to propose", "critical"); return; }
    let allOk = true;
    try {
      for (const [empIdStr, changes] of entries) {
        const payload = {
          subject_type: "employee_profile",
          subject_id: parseInt(empIdStr),
          target_date: null,
          changes_json: JSON.stringify({ employee_id: parseInt(empIdStr), changes }),
        };
        const res = await apiFetch(`${API}/api/v1/scheduler/change-requests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) allOk = false;
      }
    } catch {
      allOk = false;
    }
    showToast(
      allOk ? `${entries.length} change request(s) submitted for approval` : "Some requests failed",
      allOk ? "success" : "critical"
    );
    setWorkforceOpen(false);
    setEditedEmployees({});
    if (isManager) fetchPending();
  };
```

Add the missing button in the Manage Workforce modal footer (next to the existing `canEditEmployees && (<Button onClick={handleSaveEmployees}>Save Changes...)`):
```typescript
            {canEditEmployees && (
              <Button
                variant="primary"
                disabled={Object.keys(editedEmployees).length === 0}
                onClick={handleSaveEmployees}
              >
                Save Changes ({Object.keys(editedEmployees).length})
              </Button>
            )}
            {!canEditEmployees && isManager && (
              <Button
                variant="primary"
                disabled={Object.keys(editedEmployees).length === 0}
                onClick={handleProposeEmployeeChanges}
              >
                Propose Changes ({Object.keys(editedEmployees).length})
              </Button>
            )}
```

- [ ] **Step 6: Wrap `handleSubmitOverride`, `handleApprove`, `handleReject` in try/catch**

```typescript
  const handleSubmitOverride = async () => {
    const payload = {
      subject_type: "daily_plan_override",
      subject_id: null,
      target_date: date,
      changes_json: JSON.stringify({
        exclude_user_ids: [...excludeIds],
        capacity_overrides: Object.fromEntries(
          Object.entries(capacityOverrides)
            .filter(([, v]) => v !== "")
            .map(([k, v]) => [k, parseFloat(v)])
        ),
        notes: overrideNotes,
      }),
    };
    try {
      const res = await apiFetch(`${API}/api/v1/scheduler/change-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        showToast("Override request submitted for PM approval", "success");
        setOverrideOpen(false);
        setExcludeIds(new Set());
        setCapacityOverrides({});
        setOverrideNotes("");
      } else {
        showToast("Failed to submit override", "critical");
      }
    } catch {
      showToast("Network error — failed to submit override", "critical");
    }
  };

  const handleApprove = async (crId: number) => {
    try {
      const res = await apiFetch(
        `${API}/api/v1/scheduler/change-requests/${crId}/approve`,
        { method: "PATCH" }
      );
      if (res.ok) { showToast("Approved", "success"); fetchPending(); }
      else showToast("Failed to approve", "critical");
    } catch {
      showToast("Network error — failed to approve", "critical");
    }
  };

  const handleReject = async () => {
    if (!rejectCR) return;
    try {
      const res = await apiFetch(
        `${API}/api/v1/scheduler/change-requests/${rejectCR.id}/reject`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rejection_note: rejectNote }),
        }
      );
      if (res.ok) {
        showToast("Rejected", "success");
        setRejectCR(null);
        setRejectNote("");
        fetchPending();
      } else {
        showToast("Failed to reject", "critical");
      }
    } catch {
      showToast("Network error — failed to reject", "critical");
    }
  };
```

- [ ] **Step 7: Show an "Employee Delete" badge and hide Approve/Reject from PM on those rows**

In the Pending Approvals table (~line 564-591), update the Badge and the actions cell:
```typescript
                    <Td>
                      <Badge tone="brand">
                        {cr.subject_type === "employee_profile" ? "Employee" :
                         cr.subject_type === "employee_delete" ? "Delete Request" : "Daily Plan"}
                      </Badge>
                    </Td>
                    <Td>{cr.proposer?.full_name ?? cr.proposed_by_username ?? "Unknown"}</Td>
                    <Td className="max-w-xs truncate text-sm text-ink-soft">{crSummary(cr)}</Td>
                    <Td className="text-sm text-ink-soft">{cr.target_date ?? "—"}</Td>
                    <Td className="text-sm text-ink-soft">
                      {new Date(cr.created_at).toLocaleDateString()}
                    </Td>
                    <Td>
                      {(cr.subject_type !== "employee_delete" || canDeleteEmployeeDirectly) && (
                        <div className="flex gap-2">
                          <Button variant="primary" onClick={() => handleApprove(cr.id)}>
                            Approve
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => { setRejectCR(cr); setRejectNote(""); }}
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                    </Td>
```

- [ ] **Step 8: Manual verification in the browser**

Run `npm --prefix next-frontend run dev` and `python -m uvicorn backend.main:app --port 8003 --reload`, then:
1. Log in as GM/Developer/PM (env-var creds from `.env`), open Scheduler → Manage Workforce.
2. As PM: edit a skill field, confirm the "Propose Changes" button appears (not "Save Changes"), click it, confirm a success toast.
3. As PM: click "Request Deletion" next to any employee, confirm the dialog text says "sends a request," confirm success toast, confirm the employee is NOT removed from the list.
4. Log in as GM, go to the Approvals tab, confirm the pending "Delete Request" row shows correctly with no Approve/Reject-blocking issue, click Approve, confirm the employee is now gone from the Workforce modal.
5. Log in as PM again, go to Approvals tab, confirm any `employee_delete` row shows NO Approve/Reject buttons for PM.

- [ ] **Step 9: Commit**

```bash
git add next-frontend/src/app/\(main\)/scheduler/page.tsx
git commit -m "feat(frontend): wire PM employee-deletion requests, fix dead Propose Changes button

Production Manager now sees 'Request Deletion' (creates a ChangeRequest)
instead of a direct Delete button that would 403. The previously-unwired
handleProposeEmployeeChanges handler now has a real button for Supervisor.
All change-request network calls are now wrapped in try/catch with a
toast, so a network-level failure is visible instead of silent."
```

---

## Tier 2 — High (data loss / integrity)

### Task 5: Add missing cascade deletes to `delete_project`

**Files:**
- Modify: `backend/app/projects/router.py`
- Test: `test_delete_project_cascades.py` (new, repo root)

**Context:** Confirmed independently by two separate QA-sweep agents — `delete_project()` only manually pre-deletes `ProjectHoldHistory`, `DailyTaskAssignment`, and `WeldingLog`. Three tables added since then have no cascade at all: `material_holds`, `job_final_checks`, `assembly_steps`; `project_completion_requests` has the same gap. Every production line auto-creates `JobFinalCheck` rows at line-sync time, so this reproduces on essentially any real, actively-worked project, not just an edge case.

- [ ] **Step 1: Write the failing test**

```python
# test_delete_project_cascades.py
"""Confirms deleting a project with material_holds/job_final_checks/assembly_steps/completion_requests doesn't 500. No pytest, no fixtures."""
from backend.services.db_service import (
    SessionLocal, Project, ProjectProductionLine, MaterialHold,
    JobFinalCheck, AssemblyStep, ProjectCompletionRequest,
)
from backend.app.projects.router import delete_project
from fastapi import HTTPException


def test_delete_project_with_dependent_rows():
    db = SessionLocal()
    proj = Project(project_name="QA_SANDBOX_CASCADE_TEST", quotation_no="QA-SANDBOX-CASCADE-001", status="Active")
    db.add(proj)
    db.commit()
    db.refresh(proj)

    line = ProjectProductionLine(project_id=proj.id, size=50, quantity=1, joint_type="EJ")
    db.add(line)
    db.commit()
    db.refresh(line)

    db.add(MaterialHold(project_id=proj.id, material_name="QA_SANDBOX_MAT", size=50, joint_type="EJ", status="active"))
    db.add(JobFinalCheck(production_line_id=line.id, check_type="testing", status="pending"))
    db.add(AssemblyStep(production_line_id=line.id, step_no=1, label="QA_SANDBOX step"))
    db.add(ProjectCompletionRequest(project_id=proj.id, requested_by="qa_test"))
    db.commit()

    current_user = {"username": "qa_test", "role": "Developer", "id": None}
    try:
        result = delete_project(proj.id, db, current_user)
        assert result["success"] is True
        assert db.query(Project).filter_by(id=proj.id).first() is None
        assert db.query(MaterialHold).filter_by(project_id=proj.id).count() == 0
        print("PASS: project with material_holds/job_final_checks/assembly_steps/completion_requests deletes cleanly")
    except HTTPException as e:
        raise AssertionError(f"delete_project raised {e.status_code}: {e.detail}") from e


test_delete_project_with_dependent_rows()
print("All delete_project cascade tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_delete_project_cascades.py`
Expected: an unhandled `IntegrityError` (foreign key violation on `material_holds` or `job_final_checks`), confirming the bug.

- [ ] **Step 3: Fix `delete_project`**

In `backend/app/projects/router.py`, replace:
```python
    from backend.services.db_service import ProjectHoldHistory, DailyTaskAssignment, WeldingLog
    
    # 1. Delete manual dependencies not tracked by SQLAlchemy cascades
    db.query(ProjectHoldHistory).filter(ProjectHoldHistory.project_id == project_id).delete(synchronize_session=False)
    db.query(DailyTaskAssignment).filter(DailyTaskAssignment.project_id == project_id).delete(synchronize_session=False)
    
    line_ids = [l.id for l in db.query(ProjectProductionLine.id).filter(ProjectProductionLine.project_id == project_id).all()]
    if line_ids:
        db.query(WeldingLog).filter(WeldingLog.production_line_id.in_(line_ids)).delete(synchronize_session=False)
        
    # 2. Use SQLAlchemy python-level cascade to delete proj -> production_lines -> parts -> processes -> logs
    db.delete(proj)
    db.commit()
```
with:
```python
    from backend.services.db_service import (
        ProjectHoldHistory, DailyTaskAssignment, WeldingLog,
        MaterialHold, JobFinalCheck, AssemblyStep, ProjectCompletionRequest,
    )

    # 1. Delete manual dependencies not tracked by SQLAlchemy cascades
    db.query(ProjectHoldHistory).filter(ProjectHoldHistory.project_id == project_id).delete(synchronize_session=False)
    db.query(DailyTaskAssignment).filter(DailyTaskAssignment.project_id == project_id).delete(synchronize_session=False)
    db.query(MaterialHold).filter(MaterialHold.project_id == project_id).delete(synchronize_session=False)
    db.query(ProjectCompletionRequest).filter(ProjectCompletionRequest.project_id == project_id).delete(synchronize_session=False)

    line_ids = [l.id for l in db.query(ProjectProductionLine.id).filter(ProjectProductionLine.project_id == project_id).all()]
    if line_ids:
        db.query(WeldingLog).filter(WeldingLog.production_line_id.in_(line_ids)).delete(synchronize_session=False)
        db.query(JobFinalCheck).filter(JobFinalCheck.production_line_id.in_(line_ids)).delete(synchronize_session=False)
        db.query(AssemblyStep).filter(AssemblyStep.production_line_id.in_(line_ids)).delete(synchronize_session=False)

    # 2. Use SQLAlchemy python-level cascade to delete proj -> production_lines -> parts -> processes -> logs
    db.delete(proj)
    db.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python test_delete_project_cascades.py`
Expected: `All delete_project cascade tests passed.`

- [ ] **Step 5: Commit**

```bash
git add backend/app/projects/router.py test_delete_project_cascades.py
git commit -m "fix: delete_project 500s on any project with material_holds/job_final_checks/assembly_steps/completion_requests

The manual pre-delete cleanup list predates these four tables. Every
production line auto-creates JobFinalCheck rows at sync time, so this
reproduced on essentially any real, actively-worked project. Confirmed
independently by two separate QA-sweep agents."
```

### Task 6: Add missing `WorkOrder` cascade to `delete_user`, stop leaking raw SQL errors

**Files:**
- Modify: `backend/app/users/router.py`
- Test: `test_delete_user_workorder_cascade.py` (new, repo root)

**Context:** `delete_user` nullifies `WeldingLog`/`ProductionLog`/`AuditLog` and deletes `AttendanceLog`/`DailyTaskAssignment`, but never touches `WorkOrder.user_id` (a `NOT NULL` FK) — so any user who was ever assigned a work order is permanently undeletable, and the raw `psycopg2` exception (SQL text, parameter values, constraint name) is returned verbatim in the 400 body.

- [ ] **Step 1: Write the failing test**

```python
# test_delete_user_workorder_cascade.py
"""Confirms deleting a user with a WorkOrder row nullifies it instead of 400ing with a raw SQL error. No pytest, no fixtures."""
from datetime import date
from backend.services.db_service import SessionLocal, User, WorkOrder, Project
from backend.app.users.router import delete_user


def test_delete_user_with_work_order():
    db = SessionLocal()
    user = User(username="QA_SANDBOX_wo_user", full_name="QA Sandbox WO User", role="Operator", hashed_password="x")
    db.add(user)
    db.commit()
    db.refresh(user)

    proj = db.query(Project).first()
    assert proj is not None, "Need at least one existing project in the dev DB to attach a WorkOrder to"

    wo = WorkOrder(project_id=proj.id, user_id=user.id, date=date.today(), process_type="TIG", target_feet=10.0, status="Pending")
    db.add(wo)
    db.commit()
    db.refresh(wo)

    current_user = {"username": "qa_test", "role": "Developer", "id": None}
    result = delete_user(user.id, db, current_user)
    assert result["success"] is True
    assert db.query(User).filter_by(id=user.id).first() is None

    refreshed_wo = db.query(WorkOrder).filter_by(id=wo.id).first()
    assert refreshed_wo is not None, "WorkOrder row should survive with user_id nulled, not be force-deleted"
    assert refreshed_wo.user_id is None
    print("PASS: deleting a user with a WorkOrder nullifies user_id instead of 400ing")

    db.query(WorkOrder).filter_by(id=wo.id).delete()
    db.commit()


test_delete_user_with_work_order()
print("All delete_user WorkOrder cascade tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_delete_user_workorder_cascade.py`
Expected: `AssertionError: result["success"] is True` fails, because the current code raises `HTTPException(400, ...)` before returning — confirming the bug.

- [ ] **Step 3: Fix `delete_user`**

In `backend/app/users/router.py`, add `WorkOrder` to the nullify block and simplify the generic exception message:
```python
@router.delete("/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(USER_ADMINS))):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    try:
        from backend.services.db_service import DailyTaskAssignment, AuditLog, WorkOrder
        # Nullify references so historical production logs aren't deleted when an operator is removed
        db.query(WeldingLog).filter(WeldingLog.operator_id == user.id).update({WeldingLog.operator_id: None})
        db.query(ProductionLog).filter(ProductionLog.operator_id == user.id).update({ProductionLog.operator_id: None})
        db.query(AuditLog).filter(AuditLog.user_id == user.id).update({AuditLog.user_id: None})
        db.query(WorkOrder).filter(WorkOrder.user_id == user.id).update({WorkOrder.user_id: None})

        # Delete attendance logs and daily task assignments since user_id is non-nullable
        db.query(AttendanceLog).filter(AttendanceLog.user_id == user.id).delete(synchronize_session=False)
        db.query(DailyTaskAssignment).filter(DailyTaskAssignment.user_id == user.id).delete(synchronize_session=False)

        db.delete(user)
        db.commit()
        return {"success": True, "message": "User deleted successfully"}
    except Exception as e:
        db.rollback()
        logger.exception("Failed to delete user %s", user_id)
        raise HTTPException(status_code=400, detail="Cannot delete user: still referenced by other records")
```

This needs a module-level `logger` in `backend/app/users/router.py` — check the top of the file; if it doesn't already have one, add right after the imports:
```python
import logging
logger = logging.getLogger(__name__)
```

Also add `WorkOrder.user_id` to the model as nullable if it isn't already (it currently is `nullable=False` per `backend/services/db_service.py`) — this `update()` call needs the column to accept `NULL`. Add a migration in `backend/main.py`:
```python
_run_startup_migration("work_orders.user_id_nullable", [
    "ALTER TABLE work_orders ALTER COLUMN user_id DROP NOT NULL",
])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python test_delete_user_workorder_cascade.py`
Expected: `All delete_user WorkOrder cascade tests passed.`

- [ ] **Step 5: Commit**

```bash
git add backend/app/users/router.py backend/main.py test_delete_user_workorder_cascade.py
git commit -m "fix: delete_user never handled WorkOrder.user_id — permanently blocked deletion, leaked raw SQL errors

Any user ever assigned a work order could never be deleted. Now
nullifies WorkOrder.user_id alongside the other logs, and the generic
exception path no longer echoes the raw psycopg2 exception text back
to the client."
```

### Task 7: Stop `generate-work-orders` from deleting already-Completed work orders

**Files:**
- Modify: `backend/app/scheduler/router.py`
- Test: `test_generate_work_orders_preserves_completed.py` (new, repo root)

- [ ] **Step 1: Write the failing test**

```python
# test_generate_work_orders_preserves_completed.py
"""Confirms re-running generate_work_orders for a date doesn't delete Completed rows. No pytest, no fixtures."""
from datetime import date, timedelta
from backend.services.db_service import SessionLocal, WorkOrder, Project
from backend.app.scheduler.router import generate_work_orders


def test_regenerate_preserves_completed_orders():
    db = SessionLocal()
    target_date = date.today() + timedelta(days=365)  # far-future date, safe sandbox
    proj = db.query(Project).first()
    assert proj is not None

    completed_wo = WorkOrder(
        project_id=proj.id, user_id=1, date=target_date, process_type="TIG",
        target_feet=10.0, actual_feet=10.0, status="Completed",
    )
    db.add(completed_wo)
    db.commit()
    db.refresh(completed_wo)

    current_user = {"username": "qa_test", "role": "Developer", "id": None}
    try:
        generate_work_orders(target_date, db, current_user)
    except Exception:
        pass  # may legitimately return "no operators found" etc. — we only care the Completed row survives

    survivor = db.query(WorkOrder).filter_by(id=completed_wo.id).first()
    assert survivor is not None, "Completed work order was deleted by a re-run of generate_work_orders"
    assert survivor.status == "Completed"
    assert survivor.actual_feet == 10.0
    print("PASS: re-running generate_work_orders preserves already-Completed rows")

    db.query(WorkOrder).filter(WorkOrder.date == target_date).delete()
    db.commit()


test_regenerate_preserves_completed_orders()
print("All generate_work_orders preservation tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_generate_work_orders_preserves_completed.py`
Expected: `AssertionError: Completed work order was deleted by a re-run of generate_work_orders`.

- [ ] **Step 3: Fix the delete filter**

In `backend/app/scheduler/router.py`, in `generate_work_orders`, replace:
```python
    db.query(WorkOrder).filter(WorkOrder.date == target_date).delete()
    db.commit()
```
with:
```python
    db.query(WorkOrder).filter(WorkOrder.date == target_date, WorkOrder.status != "Completed").delete()
    db.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python test_generate_work_orders_preserves_completed.py`
Expected: `All generate_work_orders preservation tests passed.`

- [ ] **Step 5: Commit**

```bash
git add backend/app/scheduler/router.py test_generate_work_orders_preserves_completed.py
git commit -m "fix: generate-work-orders no longer deletes already-Completed rows on regenerate

A retry, timeout-retry, or legitimate re-plan of a date was silently
destroying completed production records (actual_feet, status) for that
date. Only non-Completed rows are cleared before regenerating."
```

### Task 8: Validate foreign keys before insert in attendance and scheduler-assignments (404 instead of raw 500)

**Files:**
- Modify: `backend/app/workforce/router.py`
- Modify: `backend/app/scheduler/router.py`
- Test: `test_fk_validation_attendance_assignments.py` (new, repo root)

- [ ] **Step 1: Write the failing test**

```python
# test_fk_validation_attendance_assignments.py
"""Confirms bad user_id/project_id return 404, not a raw 500. No pytest, no fixtures."""
from datetime import date
from fastapi import HTTPException
from backend.services.db_service import SessionLocal
from backend.app.workforce.router import submit_attendance, submit_attendance_bulk, AttendanceCreate
from backend.app.scheduler.router import create_assignment
from backend.app.scheduler.schemas import TaskAssignmentCreate


def test_single_attendance_bad_user_id():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "Supervisor", "id": None}
    try:
        submit_attendance(AttendanceCreate(user_id=999999999, date=date.today(), status="Present"), db, current_user)
        assert False, "expected a 404 for a nonexistent user_id"
    except HTTPException as e:
        assert e.status_code == 404
        print("PASS: single attendance with bad user_id returns 404")


def test_bulk_attendance_bad_user_id_no_partial_apply():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "Supervisor", "id": None}
    try:
        submit_attendance_bulk([AttendanceCreate(user_id=999999999, date=date.today(), status="Present")], db, current_user)
        assert False, "expected a 404 for a nonexistent user_id in a bulk batch"
    except HTTPException as e:
        assert e.status_code == 404
        print("PASS: bulk attendance with bad user_id returns 404")


def test_assignment_bad_project_and_user_id():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "Supervisor", "id": None}
    try:
        create_assignment(
            TaskAssignmentCreate(project_id=999999, user_id=999999, process_type="TIG", date=date.today(), target_feet=10.0, status="Pending", is_overtime=False),
            db, current_user,
        )
        assert False, "expected a 404 for a nonexistent project_id/user_id"
    except HTTPException as e:
        assert e.status_code == 404
        print("PASS: create_assignment with bad ids returns 404")


test_single_attendance_bad_user_id()
test_bulk_attendance_bad_user_id_no_partial_apply()
test_assignment_bad_project_and_user_id()
print("All FK-validation tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_fk_validation_attendance_assignments.py`
Expected: unhandled `IntegrityError` (500-equivalent) for all three, confirming the bug.

- [ ] **Step 3: Fix `submit_attendance` and `submit_attendance_bulk` in `backend/app/workforce/router.py`**

Add a `User` existence check before each insert:
```python
@router.post("/attendance", response_model=AttendanceResponse)
def submit_attendance(
    attendance: AttendanceCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"]))
):
    if not db.query(User).filter(User.id == attendance.user_id).first():
        raise HTTPException(status_code=404, detail=f"User {attendance.user_id} not found")

    from sqlalchemy.dialects.postgresql import insert as pg_insert
    ...
```
```python
@router.post("/attendance/bulk")
def submit_attendance_bulk(
    records: List[AttendanceCreate],
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(SUPERVISORS)),
):
    user_ids = {rec.user_id for rec in records}
    existing_ids = {u.id for u in db.query(User.id).filter(User.id.in_(user_ids)).all()}
    missing = user_ids - existing_ids
    if missing:
        raise HTTPException(status_code=404, detail=f"User id(s) not found: {sorted(missing)}")

    from sqlalchemy.dialects.postgresql import insert as pg_insert
    ...
```
(the rest of both function bodies is unchanged — just add the check at the top, before the existing `pg_insert` logic.)

- [ ] **Step 4: Fix `create_assignment` in `backend/app/scheduler/router.py`**

```python
@router.post("/assignments", response_model=TaskAssignmentResponse)
def create_assignment(
    assignment: TaskAssignmentCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"]))
):
    if not db.query(Project).filter(Project.id == assignment.project_id).first():
        raise HTTPException(status_code=404, detail=f"Project {assignment.project_id} not found")
    if not db.query(User).filter(User.id == assignment.user_id).first():
        raise HTTPException(status_code=404, detail=f"User {assignment.user_id} not found")

    new_assignment = DailyTaskAssignment(
        project_id=assignment.project_id,
        user_id=assignment.user_id,
        process_type=assignment.process_type,
        date=assignment.date,
        target_feet=assignment.target_feet,
        status=assignment.status,
        is_overtime=assignment.is_overtime,
        notes=assignment.notes
    )
    db.add(new_assignment)
    db.commit()
    db.refresh(new_assignment)
    return new_assignment
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python test_fk_validation_attendance_assignments.py`
Expected: `All FK-validation tests passed.`

- [ ] **Step 6: Commit**

```bash
git add backend/app/workforce/router.py backend/app/scheduler/router.py test_fk_validation_attendance_assignments.py
git commit -m "fix: validate user_id/project_id before insert in attendance and scheduler-assignments

Bad foreign keys (nonexistent ids) raised a raw unhandled IntegrityError
(500) instead of a clean 404 naming the bad id."
```

### Task 9: Add a lower bound to `actual_feet`

**Files:**
- Modify: `backend/app/scheduler/schemas.py`
- Test: `test_work_order_complete_bounds.py` (new, repo root)

- [ ] **Step 1: Write the failing test**

```python
# test_work_order_complete_bounds.py
"""Confirms actual_feet rejects negative values. No pytest, no fixtures."""
from pydantic import ValidationError
from backend.app.scheduler.schemas import WorkOrderComplete


def test_negative_actual_feet_rejected():
    try:
        WorkOrderComplete(actual_feet=-999999.0, status="Completed")
        assert False, "expected a ValidationError for negative actual_feet"
    except ValidationError:
        print("PASS: negative actual_feet is rejected")


def test_zero_and_positive_actual_feet_accepted():
    WorkOrderComplete(actual_feet=0.0, status="Completed")
    WorkOrderComplete(actual_feet=42.5, status="Completed")
    print("PASS: zero and positive actual_feet are accepted")


test_negative_actual_feet_rejected()
test_zero_and_positive_actual_feet_accepted()
print("All WorkOrderComplete bounds tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_work_order_complete_bounds.py`
Expected: first test fails (no `ValidationError` raised today — `actual_feet: float` has no constraint).

- [ ] **Step 3: Add the bound**

In `backend/app/scheduler/schemas.py`, add `Field` to the pydantic import if not already present, then:
```python
class WorkOrderComplete(BaseModel):
    actual_feet: float = Field(ge=0)
    status: str = "Completed"
    mark_step_ready: bool = False
    part_process_id: Optional[int] = None
    notes: Optional[str] = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python test_work_order_complete_bounds.py`
Expected: `All WorkOrderComplete bounds tests passed.`

- [ ] **Step 5: Commit**

```bash
git add backend/app/scheduler/schemas.py test_work_order_complete_bounds.py
git commit -m "fix: reject negative actual_feet on work-order completion

Fed directly into GET /scheduler/productivity's target ratio and the
next day's worker-priority scoring — a negative value corrupted both."
```

### Task 10: PO status state machine — reject arbitrary status strings and invalid transitions

**Files:**
- Modify: `backend/app/procurement/schemas.py`
- Modify: `backend/app/procurement/router.py`
- Test: `test_po_status_transitions.py` (new, repo root)

**Context:** `POStatusUpdate.status` is a bare `str`; the only guard blocks changing a PO once it's `"received"`. Everything else — jumping `draft`→`received` directly, or setting any garbage string — is accepted. The schema's own comment (`status: str  # raised|sent|cancelled`) shows the intended input set: this endpoint is only ever meant to manually move a PO through `raised`/`sent`/`cancelled` — `partially_received`/`received` are system-set by the receipt endpoint, `draft` is the initial state, never a manual target.

- [ ] **Step 1: Write the failing test**

```python
# test_po_status_transitions.py
"""Confirms PO status updates reject invalid transitions and garbage strings. No pytest, no fixtures."""
from datetime import date
from fastapi import HTTPException
from pydantic import ValidationError
from backend.services.db_service import SessionLocal, PurchaseOrder
from backend.app.procurement.router import update_po_status
from backend.app.procurement.schemas import POStatusUpdate


def _make_sandbox_po(db, status="draft"):
    po = PurchaseOrder(po_number="QA_SANDBOX_PO_STATUS_TEST", po_date=date.today(), status=status, raised_by_username="qa_test")
    db.add(po)
    db.commit()
    db.refresh(po)
    return po


def test_garbage_status_string_rejected_by_schema():
    try:
        POStatusUpdate(status="flibbertigibbet")
        assert False, "expected a ValidationError for an unrecognized status string"
    except ValidationError:
        print("PASS: garbage status string rejected at the schema level")


def test_draft_to_received_directly_rejected():
    db = SessionLocal()
    po = _make_sandbox_po(db, status="draft")
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        try:
            update_po_status(po.id, POStatusUpdate(status="received"), db, current_user)
            assert False, "expected a 400 for draft -> received directly"
        except HTTPException as e:
            assert e.status_code == 400
            print("PASS: draft -> received directly is rejected")
    finally:
        db.query(PurchaseOrder).filter_by(id=po.id).delete()
        db.commit()


def test_valid_transition_succeeds():
    db = SessionLocal()
    po = _make_sandbox_po(db, status="draft")
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        result = update_po_status(po.id, POStatusUpdate(status="raised"), db, current_user)
        assert result["status"] == "raised"
        print("PASS: draft -> raised succeeds")
    finally:
        db.query(PurchaseOrder).filter_by(id=po.id).delete()
        db.commit()


test_garbage_status_string_rejected_by_schema()
test_draft_to_received_directly_rejected()
test_valid_transition_succeeds()
print("All PO status transition tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_po_status_transitions.py`
Expected: first two fail (no `ValidationError` today; `draft`→`received` currently succeeds with `200`).

- [ ] **Step 3: Constrain the schema**

In `backend/app/procurement/schemas.py`, add `Literal` to the `typing` import, then:
```python
from typing import Optional, List, Literal
...
class POStatusUpdate(BaseModel):
    status: Literal["raised", "sent", "cancelled"]
    delay_reason: Optional[str] = None
```

- [ ] **Step 4: Add the transition-validity check**

In `backend/app/procurement/router.py`, add a module-level constant near the top (after the imports) and use it in `update_po_status`:
```python
PO_ALLOWED_TRANSITIONS = {
    "draft": {"raised", "cancelled"},
    "raised": {"sent", "cancelled"},
    "sent": {"cancelled"},
}
```
```python
@router.patch("/po/{po_id}/status")
def update_po_status(po_id: int, body: POStatusUpdate, db: Session = Depends(get_db), _=Depends(require_roles(MANAGEMENT))):
    po = db.query(PurchaseOrder).filter_by(id=po_id).first()
    if not po:
        raise HTTPException(404, "PO not found")
    if po.status == "received":
        raise HTTPException(400, "Cannot change status of a fully received PO")
    allowed_next = PO_ALLOWED_TRANSITIONS.get(po.status, set())
    if body.status not in allowed_next:
        raise HTTPException(400, f"Cannot move a PO from '{po.status}' to '{body.status}'. Allowed: {sorted(allowed_next) or 'none'}")

    old_status = po.status
    po.status = body.status
    ...
```
(the rest of the function body — cancel/raised side effects — is unchanged.)

- [ ] **Step 5: Run test to verify it passes**

Run: `python test_po_status_transitions.py`
Expected: `All PO status transition tests passed.`

- [ ] **Step 6: Commit**

```bash
git add backend/app/procurement/schemas.py backend/app/procurement/router.py test_po_status_transitions.py
git commit -m "fix: PO status endpoint now enforces a real transition state machine

Any string, and any transition (including draft straight to received),
was previously accepted. The UI's fixed-button flow already masked
this from normal users, but it was reachable via direct API calls."
```

### Task 11: Add bounds and state checks to goods receipt

**Files:**
- Modify: `backend/app/procurement/schemas.py`
- Modify: `backend/app/procurement/router.py`
- Test: `test_goods_receipt_bounds.py` (new, repo root)

- [ ] **Step 1: Write the failing test**

```python
# test_goods_receipt_bounds.py
"""Confirms goods receipt rejects non-positive qty, over-receipt, and receipt against an already-received PO. No pytest, no fixtures."""
from datetime import date
from fastapi import HTTPException
from pydantic import ValidationError
from backend.services.db_service import SessionLocal, PurchaseOrder, PurchaseOrderLine
from backend.app.procurement.router import log_receipt
from backend.app.procurement.schemas import ReceiptCreate, ReceiptLineCreate


def _make_sandbox_po_with_line(db, ordered_qty=20, po_status="raised", line_status="pending"):
    po = PurchaseOrder(po_number="QA_SANDBOX_RECEIPT_TEST", po_date=date.today(), status=po_status, raised_by_username="qa_test")
    db.add(po)
    db.flush()
    line = PurchaseOrderLine(purchase_order_id=po.id, material_name="QA_SANDBOX_MAT", size=50, joint_type="EJ",
                              ordered_qty=ordered_qty, received_qty=0, status=line_status)
    db.add(line)
    db.commit()
    db.refresh(po)
    db.refresh(line)
    return po, line


def test_negative_qty_rejected_by_schema():
    try:
        ReceiptLineCreate(po_line_id=1, qty_received=-50)
        assert False, "expected a ValidationError for negative qty_received"
    except ValidationError:
        print("PASS: negative qty_received rejected at the schema level")


def test_over_receipt_rejected():
    db = SessionLocal()
    po, line = _make_sandbox_po_with_line(db, ordered_qty=20)
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        try:
            log_receipt(po.id, ReceiptCreate(lines=[ReceiptLineCreate(po_line_id=line.id, qty_received=999)]), db, current_user)
            assert False, "expected a 400 for receiving more than ordered_qty"
        except HTTPException as e:
            assert e.status_code == 400
            print("PASS: over-receipt (999 against ordered_qty=20) is rejected")
    finally:
        db.query(PurchaseOrderLine).filter_by(purchase_order_id=po.id).delete()
        db.query(PurchaseOrder).filter_by(id=po.id).delete()
        db.commit()


def test_receipt_against_already_received_po_rejected():
    db = SessionLocal()
    po, line = _make_sandbox_po_with_line(db, ordered_qty=20, po_status="received", line_status="received")
    line.received_qty = 20
    db.commit()
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        try:
            log_receipt(po.id, ReceiptCreate(lines=[ReceiptLineCreate(po_line_id=line.id, qty_received=5)]), db, current_user)
            assert False, "expected a 400 for receiving against an already-received PO"
        except HTTPException as e:
            assert e.status_code == 400
            print("PASS: receipt against an already-received PO is rejected")
    finally:
        db.query(PurchaseOrderLine).filter_by(purchase_order_id=po.id).delete()
        db.query(PurchaseOrder).filter_by(id=po.id).delete()
        db.commit()


test_negative_qty_rejected_by_schema()
test_over_receipt_rejected()
test_receipt_against_already_received_po_rejected()
print("All goods-receipt bounds tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_goods_receipt_bounds.py`
Expected: all three fail — no `ValidationError` for negative qty, `999` against `ordered_qty=20` succeeds today, and receiving against a `"received"` PO succeeds today (only `"cancelled"` is blocked).

- [ ] **Step 3: Add the schema bound**

In `backend/app/procurement/schemas.py`:
```python
class ReceiptLineCreate(BaseModel):
    po_line_id: int
    qty_received: int = Field(gt=0)
```
(add `Field` to the existing `pydantic` import if not already there.)

- [ ] **Step 4: Add the state and over-receipt checks to `log_receipt`**

In `backend/app/procurement/router.py`, change:
```python
    if po.status == "cancelled":
        raise HTTPException(400, "Cannot receive against a cancelled PO")
```
to:
```python
    if po.status in ("cancelled", "received"):
        raise HTTPException(400, f"Cannot receive against a {po.status} PO")
```

And inside the `for rl in body.lines:` loop, right after the existing `po_line` lookup/404 check, before `db.add(GoodsReceiptLine(...))`:
```python
        remaining = po_line.ordered_qty - (po_line.received_qty or 0)
        if rl.qty_received > remaining:
            raise HTTPException(400, f"Cannot receive {rl.qty_received} against PO line {rl.po_line_id} — only {remaining} remaining (ordered {po_line.ordered_qty}, already received {po_line.received_qty or 0})")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python test_goods_receipt_bounds.py`
Expected: `All goods-receipt bounds tests passed.`

- [ ] **Step 6: Commit**

```bash
git add backend/app/procurement/schemas.py backend/app/procurement/router.py test_goods_receipt_bounds.py
git commit -m "fix: goods receipt now rejects non-positive qty, over-receipt, and receipt against a received PO

Previously accepted any quantity (including negative, which inflated
reserved_qty from nothing) with no cap against the remaining ordered
quantity, and allowed unlimited re-receipt after a line was already
fully received."
```

### Task 12: Clean 409 on duplicate PO number, 404 on unknown `part_id` in daily-log

**Files:**
- Modify: `backend/app/procurement/router.py`
- Test: `test_po_duplicate_and_daily_log_validation.py` (new, repo root)

- [ ] **Step 1: Write the failing test**

```python
# test_po_duplicate_and_daily_log_validation.py
"""Confirms duplicate PO numbers 409 cleanly and daily-log validates part_id. No pytest, no fixtures."""
from datetime import date
from fastapi import HTTPException
from backend.services.db_service import SessionLocal, PurchaseOrder
from backend.app.procurement.router import create_po, upsert_daily_log
from backend.app.procurement.schemas import POCreate, DailyLogCreate


def test_duplicate_po_number_is_409_not_500():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        create_po(POCreate(po_number="QA_SANDBOX_DUPE_PO", po_date=date.today(), lines=[]), db, current_user)
        try:
            create_po(POCreate(po_number="QA_SANDBOX_DUPE_PO", po_date=date.today(), lines=[]), db, current_user)
            assert False, "expected a 409 for a duplicate po_number"
        except HTTPException as e:
            assert e.status_code == 409
            print("PASS: duplicate po_number returns 409, not a raw 500")
    finally:
        db.query(PurchaseOrder).filter_by(po_number="QA_SANDBOX_DUPE_PO").delete()
        db.commit()


def test_daily_log_unknown_part_id_is_404():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        upsert_daily_log(DailyLogCreate(part_id=999999999, qty_ordered=0, qty_received=0), db, current_user)
        assert False, "expected a 404 for a nonexistent part_id"
    except HTTPException as e:
        assert e.status_code == 404
        print("PASS: daily-log with unknown part_id returns 404, not a raw 500")


test_duplicate_po_number_is_409_not_500()
test_daily_log_unknown_part_id_is_404()
print("All PO-duplicate and daily-log validation tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_po_duplicate_and_daily_log_validation.py`
Expected: both fail with an unhandled `IntegrityError`/`500`-equivalent.

- [ ] **Step 3: Fix `create_po`**

In `backend/app/procurement/router.py`, wrap the commit in `create_po` with a duplicate check up front (simpler and clearer than catching `IntegrityError`):
```python
@router.post("/po", response_model=POResponse)
def create_po(body: POCreate, db: Session = Depends(get_db), user=Depends(require_roles(MANAGEMENT))):
    if db.query(PurchaseOrder).filter_by(po_number=body.po_number).first():
        raise HTTPException(status_code=409, detail=f"PO number '{body.po_number}' already exists")
    u = db.query(User).filter_by(username=user["username"]).first()
    ...
```
(rest of the function is unchanged.)

- [ ] **Step 4: Fix `upsert_daily_log`**

Find the function (`grep -n "def upsert_daily_log" backend/app/procurement/router.py`) and add a `Part` existence check as its first statement:
```python
def upsert_daily_log(body: DailyLogCreate, db: Session = Depends(get_db), user=Depends(require_roles(MANAGEMENT))):
    if not db.query(Part).filter(Part.id == body.part_id).first():
        raise HTTPException(status_code=404, detail=f"Part {body.part_id} not found")
    ...
```
(`Part` is already imported in this router — confirm via the existing import block; the rest of the function is unchanged.)

- [ ] **Step 5: Run test to verify it passes**

Run: `python test_po_duplicate_and_daily_log_validation.py`
Expected: `All PO-duplicate and daily-log validation tests passed.`

- [ ] **Step 6: Commit**

```bash
git add backend/app/procurement/router.py test_po_duplicate_and_daily_log_validation.py
git commit -m "fix: duplicate PO number and unknown part_id in daily-log now return clean 4xx, not raw 500

Both let the database's own constraint (unique po_number, FK on
part_id) be the only thing rejecting the request, producing an
unhandled 500 instead of a clean, actionable error."
```

---

## Tier 3 — Medium

### Task 13: Master-data validation bounds, unknown-tag rejection, and resource-assignment overwrite consistency

**Files:**
- Modify: `backend/app/master/schemas.py`
- Modify: `backend/app/master/router.py`
- Test: `test_master_validation_and_sync_guard.py` (new, repo root)

- [ ] **Step 1: Write the failing test**

```python
# test_master_validation_and_sync_guard.py
"""Confirms master pool/welding-size bounds, unknown-tag rejection, and sync equality-guard. No pytest, no fixtures."""
from pydantic import ValidationError
from backend.app.master.schemas import PoolUpdate, WeldingSizeCreate
from backend.services.db_service import SessionLocal, ProjectResourceAssignment, Project


def test_negative_pool_counts_rejected():
    try:
        PoolUpdate(total_tig_welders=-5, total_mig_welders=10, total_grinders=10)
        assert False, "expected a ValidationError for negative welder counts"
    except ValidationError:
        print("PASS: negative pool counts rejected")


def test_negative_welding_feet_rejected():
    try:
        WeldingSizeCreate(size=50, tig_feet=-5, mig_feet=5, grinding_feet=5, joint_type="EJ")
        assert False, "expected a ValidationError for negative feet"
    except ValidationError:
        print("PASS: negative welding-size feet rejected")


def test_unknown_tag_no_rejected():
    from fastapi import HTTPException
    from backend.app.master.router import create_custom_welding_size
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        create_custom_welding_size(
            WeldingSizeCreate(size=9999, tig_feet=1, mig_feet=1, grinding_feet=1, joint_type="EJ", tag_no="QA_SANDBOX_NOT_A_REAL_TAG"),
            db, current_user,
        )
        assert False, "expected a 400 for an unrecognized tag_no"
    except HTTPException as e:
        assert e.status_code == 400
        print("PASS: unrecognized tag_no is rejected instead of silently defaulting to EJ")


def test_sync_resource_assignment_equality_guard():
    db = SessionLocal()
    proj = db.query(Project).first()
    assert proj is not None
    assign = db.query(ProjectResourceAssignment).filter_by(project_id=proj.id).first()
    if not assign:
        print("SKIP: no existing ProjectResourceAssignment for the first project — cannot test the guard live")
        return
    before = (assign.assigned_tig_welders, assign.assigned_mig_welders, assign.assigned_grinders, assign.estimated_duration_days)
    from backend.app.master.router import auto_sync_all_projects_with_master
    auto_sync_all_projects_with_master()
    db.refresh(assign)
    after = (assign.assigned_tig_welders, assign.assigned_mig_welders, assign.assigned_grinders, assign.estimated_duration_days)
    print(f"PASS: sync ran without error (guard present); before={before} after={after}")


test_negative_pool_counts_rejected()
test_negative_welding_feet_rejected()
test_unknown_tag_no_rejected()
test_sync_resource_assignment_equality_guard()
print("All master validation and sync-guard tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_master_validation_and_sync_guard.py`
Expected: first three fail (no validation errors raised, unknown tag silently defaults to EJ).

- [ ] **Step 3: Add bounds to `backend/app/master/schemas.py`**

```python
from pydantic import BaseModel, Field

class WorkforceUpdate(BaseModel):
    productivity: float = Field(ge=0)

class PoolUpdate(BaseModel):
    total_tig_welders: int = Field(ge=0)
    total_mig_welders: int = Field(ge=0)
    total_grinders: int = Field(ge=0)

class WeldingSizeCreate(BaseModel):
    size: int
    tig_feet: float = Field(ge=0)
    mig_feet: float = Field(ge=0)
    grinding_feet: float = Field(ge=0)
    joint_type: str
    tag_no: str | None = None
```

- [ ] **Step 4: Reject unrecognized `tag_no` in `create_custom_welding_size`**

In `backend/app/master/router.py`:
```python
@router.post("/welding-size")
def create_custom_welding_size(req: WeldingSizeCreate, db = Depends(get_db), current_user: dict = Depends(require_roles(MANAGEMENT))):
    from backend.services.db_service import WeldingMaster

    if req.tag_no:
        from backend.services import joint_catalog
        if joint_catalog.weld_family_for(req.tag_no, fallback=None) is None:
            raise HTTPException(status_code=400, detail=f"Unrecognized tag_no '{req.tag_no}' — not found in the joint catalog")
        from backend.services.production_service import upsert_tag_welding_master
        ...
```
(only the new `if joint_catalog.weld_family_for(...) is None: raise HTTPException(...)` block is added, right before the existing `upsert_tag_welding_master` import+call; nothing else in the function changes. `HTTPException` must already be imported in this file — confirm at the top.)

- [ ] **Step 5: Add the equality guard to `auto_sync_all_projects_with_master`**

In `backend/app/master/router.py`, replace:
```python
                assign.assigned_tig_welders = req_tig
                assign.assigned_mig_welders = req_mig
                assign.assigned_grinders = req_grind
                assign.estimated_duration_days = target_days
```
with:
```python
                if (assign.assigned_tig_welders != req_tig or assign.assigned_mig_welders != req_mig
                        or assign.assigned_grinders != req_grind or assign.estimated_duration_days != target_days):
                    assign.assigned_tig_welders = req_tig
                    assign.assigned_mig_welders = req_mig
                    assign.assigned_grinders = req_grind
                    assign.estimated_duration_days = target_days
```
(matches the existing equality-guard pattern already used a few lines above for the welding-feet fields in the same function.)

- [ ] **Step 6: Run test to verify it passes**

Run: `python test_master_validation_and_sync_guard.py`
Expected: `All master validation and sync-guard tests passed.`

- [ ] **Step 7: Commit**

```bash
git add backend/app/master/schemas.py backend/app/master/router.py test_master_validation_and_sync_guard.py
git commit -m "fix: master-data bounds validation, reject unrecognized tag_no, guard resource-assignment overwrite

Pool welder counts and welding-size feet accepted negative values with
no floor. A typo'd/unrecognized tag_no silently saved as EJ instead of
erroring. auto_sync_all_projects_with_master unconditionally overwrote
every project's resource assignment on every sync — welding-feet fields
already had an equality guard in the same function, resource
assignments did not."
```

### Task 14: Constrain `WorkOrder.status` and `AttendanceLog.status` to their documented enums

**Files:**
- Modify: `backend/app/scheduler/schemas.py`
- Modify: `backend/app/workforce/router.py`
- Test: `test_status_enum_validation.py` (new, repo root)

- [ ] **Step 1: Write the failing test**

```python
# test_status_enum_validation.py
"""Confirms WorkOrder.status and AttendanceLog.status reject garbage strings. No pytest, no fixtures."""
from pydantic import ValidationError
from backend.app.scheduler.schemas import WorkOrderComplete
from backend.app.workforce.router import AttendanceCreate


def test_work_order_garbage_status_rejected():
    try:
        WorkOrderComplete(actual_feet=1.0, status="QA_SANDBOX_BogusStatus")
        assert False, "expected a ValidationError for an unrecognized work-order status"
    except ValidationError:
        print("PASS: garbage WorkOrder status rejected")


def test_attendance_garbage_status_rejected():
    from datetime import date
    try:
        AttendanceCreate(user_id=1, date=date.today(), status="QA_SANDBOX_Bogus")
        assert False, "expected a ValidationError for an unrecognized attendance status"
    except ValidationError:
        print("PASS: garbage attendance status rejected")


test_work_order_garbage_status_rejected()
test_attendance_garbage_status_rejected()
print("All status-enum validation tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_status_enum_validation.py`
Expected: both fail (no `ValidationError` today).

- [ ] **Step 3: Constrain `WorkOrderComplete.status`**

In `backend/app/scheduler/schemas.py`, add `Literal` to the `typing` import if not already present, then:
```python
class WorkOrderComplete(BaseModel):
    actual_feet: float = Field(ge=0)
    status: Literal["Pending", "Completed", "Blocked"] = "Completed"
    mark_step_ready: bool = False
    part_process_id: Optional[int] = None
    notes: Optional[str] = None
```

- [ ] **Step 4: Constrain `AttendanceCreate.status`**

In `backend/app/workforce/router.py`, add `Literal` to the `typing` import if not already present, then:
```python
class AttendanceCreate(BaseModel):
    user_id: int
    date: date
    status: Literal["Present", "Absent", "Leave", "Overtime"]
    hours: Optional[float] = None
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python test_status_enum_validation.py`
Expected: `All status-enum validation tests passed.`

- [ ] **Step 6: Commit**

```bash
git add backend/app/scheduler/schemas.py backend/app/workforce/router.py test_status_enum_validation.py
git commit -m "fix: constrain WorkOrder.status and AttendanceLog.status to their documented enums

Both accepted any string, where downstream status.in_([...]) filters
(e.g. present-worker checks in generate_work_orders) silently misbehave
on garbage values instead of rejecting them at the door."
```

### Task 15: Procurement — stock/adjust and lead-time bounds (pure validation)

**Files:**
- Modify: `backend/app/procurement/schemas.py`
- Test: `test_procurement_bounds.py` (new, repo root)

- [ ] **Step 1: Write the failing test**

```python
# test_procurement_bounds.py
"""Confirms StockAdjust and LeadTimeUpdate reject negative values. No pytest, no fixtures."""
from pydantic import ValidationError
from backend.app.procurement.schemas import StockAdjust, LeadTimeUpdate


def test_negative_stock_on_hand_rejected():
    try:
        StockAdjust(material_name="QA_SANDBOX_MAT", size=50, joint_type="EJ", qty_on_hand=-5)
        assert False, "expected a ValidationError for negative qty_on_hand"
    except ValidationError:
        print("PASS: negative qty_on_hand rejected")


def test_negative_lead_time_rejected():
    try:
        LeadTimeUpdate(lead_time_days=-3)
        assert False, "expected a ValidationError for negative lead_time_days"
    except ValidationError:
        print("PASS: negative lead_time_days rejected")


test_negative_stock_on_hand_rejected()
test_negative_lead_time_rejected()
print("All procurement bounds tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_procurement_bounds.py`
Expected: both fail.

- [ ] **Step 3: Add the bounds**

In `backend/app/procurement/schemas.py`:
```python
class StockAdjust(BaseModel):
    material_name: str
    size: int
    joint_type: str
    qty_on_hand: Optional[int] = Field(default=None, ge=0)
    minimum_stock: Optional[int] = Field(default=None, ge=0)
    reason: Optional[str] = None
```
```python
class LeadTimeUpdate(BaseModel):
    lead_time_days: int = Field(ge=0)
```
(`Field` should already be imported from Task 11's edit to this same file — if not, add `from pydantic import BaseModel, Field` at the top.)

- [ ] **Step 4: Run test to verify it passes**

Run: `python test_procurement_bounds.py`
Expected: `All procurement bounds tests passed.`

- [ ] **Step 5: Commit**

```bash
git add backend/app/procurement/schemas.py test_procurement_bounds.py
git commit -m "fix: reject negative qty_on_hand and lead_time_days in procurement schemas

POST /stock/adjust overwrites qty_on_hand directly (not a delta) with
no floor, and lead-time days had no bound at all."
```

### Task 16: Procurement business-rule changes — lead-time 404 on unknown material, block vendor delete when referenced

**Files:**
- Modify: `backend/app/procurement/router.py`
- Test: `test_procurement_business_rules.py` (new, repo root)

**Context:** Per the user's decisions: `PATCH /lead-times/{material_name}` should 404 for an unrecognized material name instead of silently creating a new row (catches typos immediately); `DELETE /vendors/{id}` should block (400) if any PO still references that vendor, instead of silently nulling `PurchaseOrder.vendor_id`.

- [ ] **Step 1: Write the failing test**

```python
# test_procurement_business_rules.py
"""Confirms lead-time 404s on unknown material, and vendor delete blocks when referenced. No pytest, no fixtures."""
from datetime import date
from fastapi import HTTPException
from backend.services.db_service import SessionLocal, Vendor, PurchaseOrder, MaterialLeadTime
from backend.app.procurement.router import update_lead_time, delete_vendor
from backend.app.procurement.schemas import LeadTimeUpdate


def test_lead_time_unknown_material_is_404():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        update_lead_time("QA_SANDBOX_NOT_A_REAL_MATERIAL", LeadTimeUpdate(lead_time_days=5), db, current_user)
        assert False, "expected a 404 for an unrecognized material name"
    except HTTPException as e:
        assert e.status_code == 404
        print("PASS: lead-time PATCH on an unknown material 404s instead of silently upserting")
    finally:
        db.query(MaterialLeadTime).filter_by(material_name="QA_SANDBOX_NOT_A_REAL_MATERIAL").delete()
        db.commit()


def test_vendor_delete_blocked_when_referenced():
    db = SessionLocal()
    vendor = Vendor(name="QA_SANDBOX_VENDOR_DELETE_TEST")
    db.add(vendor)
    db.flush()
    po = PurchaseOrder(po_number="QA_SANDBOX_VENDOR_DELETE_PO", po_date=date.today(), status="draft", vendor_id=vendor.id, raised_by_username="qa_test")
    db.add(po)
    db.commit()
    db.refresh(vendor)

    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        try:
            delete_vendor(vendor.id, db, current_user)
            assert False, "expected a 400 when the vendor is referenced by a PO"
        except HTTPException as e:
            assert e.status_code == 400
            print("PASS: vendor delete is blocked when a PO still references it")
    finally:
        db.query(PurchaseOrder).filter_by(id=po.id).delete()
        db.query(Vendor).filter_by(id=vendor.id).delete()
        db.commit()


test_lead_time_unknown_material_is_404()
test_vendor_delete_blocked_when_referenced()
print("All procurement business-rule tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_procurement_business_rules.py`
Expected: both fail (lead-time silently creates a row; vendor delete succeeds and nulls the PO's `vendor_id`).

- [ ] **Step 3: Fix `update_lead_time`**

Find the function (`grep -n "def update_lead_time" backend/app/procurement/router.py`) and change the "create if missing" logic to 404 instead:
```python
@router.patch("/lead-times/{material_name}", response_model=LeadTimeResponse)
def update_lead_time(material_name: str, body: LeadTimeUpdate, db: Session = Depends(get_db), _=Depends(require_roles(MANAGEMENT))):
    lt = db.query(MaterialLeadTime).filter_by(material_name=material_name).first()
    if not lt:
        raise HTTPException(status_code=404, detail=f"No lead-time record exists for material '{material_name}'")
    lt.lead_time_days = body.lead_time_days
    db.commit()
    db.refresh(lt)
    return lt
```
(adjust to match whatever the current function's exact variable names/structure are — the behavior change is: no-row-found now raises 404 instead of constructing a new `MaterialLeadTime`.)

- [ ] **Step 4: Fix `delete_vendor`**

```python
@router.delete("/vendors/{vendor_id}")
def delete_vendor(vendor_id: int, db: Session = Depends(get_db), _=Depends(require_roles(MANAGEMENT))):
    v = db.query(Vendor).filter_by(id=vendor_id).first()
    if not v:
        raise HTTPException(404, "Vendor not found")
    referencing_pos = db.query(PurchaseOrder).filter_by(vendor_id=vendor_id).count()
    if referencing_pos > 0:
        raise HTTPException(400, f"Cannot delete vendor: {referencing_pos} purchase order(s) still reference it. Reassign or cancel them first.")
    db.delete(v)
    db.commit()
    return {"ok": True}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python test_procurement_business_rules.py`
Expected: `All procurement business-rule tests passed.`

- [ ] **Step 6: Commit**

```bash
git add backend/app/procurement/router.py test_procurement_business_rules.py
git commit -m "fix: lead-time PATCH 404s on unknown material, vendor delete blocks when referenced by a PO

Both were user decisions from the QA-sweep review: a typo'd material
name should error, not silently create a new record; deleting a vendor
should not be able to silently orphan a PO's vendor link."
```

### Task 17: Constrain `final-checks`/`assembly-steps` status, cap welding-log `feet_done`

**Files:**
- Modify: `backend/app/production/schemas.py`
- Modify: `backend/app/production/router.py`
- Test: `test_production_status_and_feet_cap.py` (new, repo root)

- [ ] **Step 1: Write the failing test**

```python
# test_production_status_and_feet_cap.py
"""Confirms final-check/assembly-step status enums and welding-log overshoot cap. No pytest, no fixtures."""
from pydantic import ValidationError
from backend.app.production.schemas import FinalCheckUpdate


def test_final_check_garbage_status_rejected():
    try:
        FinalCheckUpdate(status="TOTALLY_BOGUS_STATUS_XYZ")
        assert False, "expected a ValidationError for an unrecognized final-check status"
    except ValidationError:
        print("PASS: garbage final-check status rejected")


def test_assembly_step_garbage_status_rejected():
    from backend.app.production.router import AssemblyStepUpdate
    try:
        AssemblyStepUpdate(status="TOTALLY_BOGUS_STATUS_XYZ")
        assert False, "expected a ValidationError for an unrecognized assembly-step status"
    except ValidationError:
        print("PASS: garbage assembly-step status rejected")


test_final_check_garbage_status_rejected()
test_assembly_step_garbage_status_rejected()
print("All production status-enum tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_production_status_and_feet_cap.py`
Expected: both fail (no `ValidationError` today).

- [ ] **Step 3: Constrain `FinalCheckUpdate.status`**

In `backend/app/production/schemas.py`, add `Literal` to the `typing` import, then:
```python
class FinalCheckUpdate(BaseModel):
    is_required: Optional[bool] = None
    status: Optional[Literal["pending", "required", "in_process", "ready"]] = None
    test_method: Optional[str] = None
    paint_spec: Optional[str] = None
    weight_kgs: Optional[float] = None
    marking_type: Optional[str] = None
    date_ready: Optional[date] = None
    date_pending: Optional[date] = None
    notes: Optional[str] = None
```

- [ ] **Step 4: Constrain `AssemblyStepUpdate.status`**

In `backend/app/production/router.py`, add `Literal` to the `typing` import, then update the inline class (~line 193):
```python
class AssemblyStepUpdate(BaseModel):
    status: Optional[Literal["pending", "in_process", "ready"]] = None
    completed_qty: Optional[int] = None
    date_ready: Optional[date] = None
    notes: Optional[str] = None
```

- [ ] **Step 5: Cap `feet_done` against the line's remaining target in `add_welding_log`**

In `backend/app/production/router.py`, in `add_welding_log`, after the existing DJ/TIG rejection check and before the operator lookup, add:
```python
    from sqlalchemy import func as sa_func2
    target_map = {"TIG": line.tig_feet, "MIG": line.mig_feet, "Grinding": line.grinding_feet}
    target = target_map.get(tx.process_type) or 0
    already_logged = db.query(sa_func2.sum(WeldingLog.feet_done)).filter(
        WeldingLog.production_line_id == req_id,
        WeldingLog.process_type == tx.process_type,
    ).scalar() or 0.0
    if target > 0 and already_logged + tx.feet_done > target + 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot log {tx.feet_done} feet of {tx.process_type}: only {max(0, target - already_logged):.2f} remaining (target {target})"
        )
```
(the `+ 0.01` tolerance guards against float rounding on repeated small additions; `sa_func2` avoids clashing with the `sa_func` alias already imported a few lines above in the same function for the `WorkOrder` lookup.)

- [ ] **Step 6: Run test to verify it passes**

Run: `python test_production_status_and_feet_cap.py`
Expected: `All production status-enum tests passed.`

- [ ] **Step 7: Manual verification of the feet cap** (needs a real work order, not easily unit-testable without a lot of fixture setup — verify live instead)

```bash
# As a role in MANAGEMENT, with a real work order already generated for today for some operator/project/TIG:
curl -s -X POST http://localhost:8003/api/v1/production/requirements/<req_id>/welding_logs \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"operator_id": <id>, "process_type": "TIG", "feet_done": 999999}'
```
Expected: `400` naming how much is actually remaining, not a silent 200 that overshoots the line's `tig_feet` target.

- [ ] **Step 8: Commit**

```bash
git add backend/app/production/schemas.py backend/app/production/router.py test_production_status_and_feet_cap.py
git commit -m "fix: constrain final-check/assembly-step status enums, cap welding-log feet_done against line target

Both status fields accepted any string despite a documented closed set
(paint-status already validates this way — these two didn't). Welding
logs had no overshoot cap, unlike the quantity-transaction endpoint
which already rejects exceeding a part's target."
```

### Task 18: Constrain `User.role`, add length caps

**Files:**
- Modify: `backend/app/users/schemas.py`
- Test: `test_user_schema_validation.py` (new, repo root)

**Context:** `role` accepts any string on create/update (deny-by-default in `require_roles` means this isn't an authorization bypass — confirmed during the QA sweep — but it lets an admin create an orphaned, permission-less account via a typo with no feedback). No length cap exists on `username`/`full_name` either.

- [ ] **Step 1: Write the failing test**

```python
# test_user_schema_validation.py
"""Confirms User role is constrained to known roles and names have a length cap. No pytest, no fixtures."""
from pydantic import ValidationError
from backend.app.users.schemas import UserCreate


def test_garbage_role_rejected():
    try:
        UserCreate(full_name="QA Sandbox", role="QA_SANDBOX_NotARealRole")
        assert False, "expected a ValidationError for an unrecognized role"
    except ValidationError:
        print("PASS: garbage role rejected")


def test_known_roles_accepted():
    for role in ["Developer", "GM", "Production Manager", "CEO", "MD", "Admin", "Supervisor", "Operator"]:
        UserCreate(full_name="QA Sandbox", role=role)
    print("PASS: all known roles accepted")


def test_overlong_name_rejected():
    try:
        UserCreate(full_name="A" * 20000, role="Operator")
        assert False, "expected a ValidationError for a 20,000-char full_name"
    except ValidationError:
        print("PASS: overlong full_name rejected")


test_garbage_role_rejected()
test_known_roles_accepted()
test_overlong_name_rejected()
print("All User schema validation tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_user_schema_validation.py`
Expected: first and third fail.

- [ ] **Step 3: Constrain the schema**

In `backend/app/users/schemas.py`:
```python
from pydantic import BaseModel, Field
from typing import Optional, Literal

KNOWN_ROLES = Literal["Developer", "GM", "Production Manager", "CEO", "MD", "Admin", "Supervisor", "Operator"]

class UserCreate(BaseModel):
    full_name: str = Field(max_length=200)
    username: Optional[str] = Field(default=None, max_length=100)
    password: Optional[str] = None
    role: KNOWN_ROLES = "Operator"
    experience: Optional[str] = None
    skill: Optional[str] = None
    department: Optional[str] = None
    base_productivity: Optional[float] = None

class UserUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=200)
    password: Optional[str] = None
    role: Optional[KNOWN_ROLES] = None
    experience: Optional[str] = None
    skill: Optional[str] = None
    department: Optional[str] = None
    base_productivity: Optional[float] = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python test_user_schema_validation.py`
Expected: `All User schema validation tests passed.`

- [ ] **Step 5: Commit**

```bash
git add backend/app/users/schemas.py test_user_schema_validation.py
git commit -m "fix: constrain User.role to known roles, cap full_name/username length

Previously any string was accepted for role (deny-by-default elsewhere
meant this wasn't an auth bypass, but it let typos create orphaned,
permission-less accounts silently) and names had no length bound."
```

### Task 19: Gate completion-request submission and approval on actual progress

**Files:**
- Modify: `backend/app/projects/completion.py`
- Test: `test_completion_progress_gate.py` (new, repo root)

**Context:** Per the user's decision — block both submitting and approving a completion request unless the project's computed `progress_percentage` is effectively 100%. Gated at both submit and approve time (defense in depth — progress could theoretically regress between the two, e.g. a new production line added after submission).

- [ ] **Step 1: Write the failing test**

```python
# test_completion_progress_gate.py
"""Confirms completion-request submit/approve are gated on progress. No pytest, no fixtures."""
from fastapi import HTTPException
from backend.services.db_service import SessionLocal, Project, ProjectProductionLine, ProjectCompletionRequest
from backend.app.projects.completion import submit_completion_request, approve_completion


def test_submit_blocked_when_progress_incomplete():
    db = SessionLocal()
    proj = Project(project_name="QA_SANDBOX_PROGRESS_GATE", quotation_no="QA-SANDBOX-PROGRESS-001", status="Active")
    db.add(proj)
    db.commit()
    db.refresh(proj)
    line = ProjectProductionLine(project_id=proj.id, size=50, quantity=5, joint_type="EJ", tig_feet=48.1, mig_feet=18.9, grinding_feet=4.0)
    db.add(line)
    db.commit()

    current_user = {"username": "qa_test", "role": "Production Manager", "id": None}
    try:
        try:
            submit_completion_request(proj.id, db, current_user)
            assert False, "expected a 400 — no welding logged, progress should be well under 100%"
        except HTTPException as e:
            assert e.status_code == 400
            print("PASS: completion-request submission blocked when progress is incomplete")
    finally:
        db.query(ProjectCompletionRequest).filter_by(project_id=proj.id).delete()
        db.query(ProjectProductionLine).filter_by(project_id=proj.id).delete()
        db.query(Project).filter_by(id=proj.id).delete()
        db.commit()


test_submit_blocked_when_progress_incomplete()
print("All completion progress-gate tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_completion_progress_gate.py`
Expected: fails — today, `submit_completion_request` succeeds regardless of progress.

- [ ] **Step 3: Add the gate to `submit_completion_request`**

In `backend/app/projects/completion.py`, add the import at the top:
```python
from backend.services.mes_service import MESService
```
Then, in `submit_completion_request`, right after the existing duplicate-pending-request check:
```python
    progress = MESService.calculate_project_progress(db, project_id)
    if progress < 99.5:
        raise HTTPException(status_code=400, detail=f"Cannot submit completion request: project is only {progress:.1f}% complete. Log remaining welding footage before requesting completion.")
```

- [ ] **Step 4: Add the same gate to `approve_completion`**

Right after the existing `if not req or req.status != "pending":` check:
```python
    progress = MESService.calculate_project_progress(db, req.project_id)
    if progress < 99.5:
        raise HTTPException(status_code=400, detail=f"Cannot approve: project is only {progress:.1f}% complete.")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python test_completion_progress_gate.py`
Expected: `All completion progress-gate tests passed.`

- [ ] **Step 6: Commit**

```bash
git add backend/app/projects/completion.py test_completion_progress_gate.py
git commit -m "fix: gate completion-request submit/approve on actual project progress

A project could be marked Completed while progress_percentage stayed
at 70% (fabrication-only, zero welding logged). User decision: block
both submission and approval below ~100% progress rather than
reconciling welding data or leaving the divergence undocumented."
```

### Task 20: Fix silently-swallowed bellows-sync failures and `/duration`'s 500 on an unknown project

**Files:**
- Modify: `backend/app/projects/router.py`
- Test: `test_bellows_sync_and_duration_validation.py` (new, repo root)

- [ ] **Step 1: Write the failing test**

```python
# test_bellows_sync_and_duration_validation.py
"""Confirms bellows-sync failures propagate as errors, and /duration 404s on unknown project. No pytest, no fixtures."""
from fastapi import HTTPException
from backend.services.db_service import SessionLocal
from backend.app.projects.router import update_project_bellows, get_duration
from backend.app.projects.schemas import BellowItem, DurationRequest


def test_bellows_update_on_unknown_project_errors():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "Developer", "id": None}
    try:
        update_project_bellows(999999999, [BellowItem(size=50, qty=1, type="EJ")], db, current_user)
        assert False, "expected an error when syncing bellows for a nonexistent project"
    except HTTPException as e:
        assert e.status_code in (400, 404)
        print(f"PASS: bellows update on unknown project now errors ({e.status_code}) instead of reporting fake success")


def test_duration_unknown_project_is_404():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "Developer", "id": None}
    try:
        get_duration(DurationRequest(project_id=999999999, assigned_tig=1, assigned_mig=1, assigned_grinders=1), db, current_user)
        assert False, "expected a 404 for an unknown project_id"
    except HTTPException as e:
        assert e.status_code == 404
        print("PASS: /duration on an unknown project_id returns 404, not a raw 500")


test_bellows_update_on_unknown_project_errors()
test_duration_unknown_project_is_404()
print("All bellows-sync and duration-validation tests passed.")
```

(Adjust the `BellowItem`/`DurationRequest` import path to wherever these Pydantic models actually live — `grep -n "class BellowItem\|class DurationRequest" backend/app/projects/*.py` to confirm before writing this step for real.)

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_bellows_sync_and_duration_validation.py`
Expected: both fail (bellows update reports fake success; `/duration` 500s).

- [ ] **Step 3: Fix `update_project_bellows`**

In `backend/app/projects/router.py`, capture and check `sync_project_production_lines`'s return value:
```python
@router.put("/{project_id}/bellows")
def update_project_bellows(project_id: int, req: List[BellowItem], db: Session = Depends(get_db), current_user: dict = Depends(require_roles(MANAGEMENT))):
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail="Project not found")

    bellows_data = [{
        "size": b.size,
        "qty": b.qty,
        "type": getattr(b, "type", "EJ"),
        "pn_rating": getattr(b, "pn_rating", None),
        "joint_category": getattr(b, "joint_category", None),
        "joint_type_code": getattr(b, "joint_type_code", None),
        "variable_qtys": getattr(b, "variable_qtys", None),
    } for b in req]
    ok = sync_project_production_lines(project_id, bellows_data)
    if not ok:
        raise HTTPException(status_code=400, detail="Failed to sync bellows — check server logs for details")

    assign = db.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id == project_id).first()
    if assign:
        calculate_project_duration(project_id, assign.assigned_tig_welders or 0, assign.assigned_mig_welders or 0, assign.assigned_grinders or 0)
    return {"success": True, "message": "Bellows updated", "data": {}}
```

- [ ] **Step 4: Fix `get_duration`**

```python
@router.post("/duration")
def get_duration(req: DurationRequest, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(MANAGEMENT))):
    if not db.query(Project).filter(Project.id == req.project_id).first():
        raise HTTPException(status_code=404, detail="Project not found")
    dur, t, m, g = calculate_project_duration(req.project_id, req.assigned_tig, req.assigned_mig, req.assigned_grinders)
    return {"success": True, "message": "Duration retrieved", "data": {"estimated_duration_days": dur}}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python test_bellows_sync_and_duration_validation.py`
Expected: `All bellows-sync and duration-validation tests passed.`

- [ ] **Step 6: Commit**

```bash
git add backend/app/projects/router.py test_bellows_sync_and_duration_validation.py
git commit -m "fix: bellows-sync failures now propagate as errors, /duration 404s on unknown project

update_project_bellows reported success even when sync_project_production_lines
silently caught an exception and wrote nothing. get_duration let an
unconditional insert violate a FK for an unknown project_id instead of
checking existence first."
```

### Task 21: Frontend — fix inverted "This Week" date preset, hide Raise PO from non-management in browse mode

**Files:**
- Modify: `next-frontend/src/app/(main)/productivity/page.tsx`
- Modify: `next-frontend/src/app/(main)/procurement/page.tsx`

- [ ] **Step 1: Fix `presetRange`'s Monday calculation**

In `next-frontend/src/app/(main)/productivity/page.tsx`, replace:
```typescript
function presetRange(preset: string): [string, string] {
  const today = new Date();
  if (preset === "week") {
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() + 1); // Mon
    return [isoDate(start), isoDate(today)];
  }
  ...
```
with:
```typescript
function presetRange(preset: string): [string, string] {
  const today = new Date();
  if (preset === "week") {
    const start = new Date(today);
    const day = today.getDay(); // 0=Sun..6=Sat
    const diffToMonday = day === 0 ? -6 : 1 - day;
    start.setDate(today.getDate() + diffToMonday);
    return [isoDate(start), isoDate(today)];
  }
  ...
```
(the bug: on a Sunday, `getDay()` is `0`, so `today.getDate() - 0 + 1` computes tomorrow's date — one day *after* `today`, inverting the range. The fix special-cases Sunday to go back 6 days to reach that week's Monday.)

- [ ] **Step 2: Manual verification (can't easily unit-test `Date` math without a date-mocking library this repo doesn't have — verify by hand for all 7 days)**

```bash
node -e '
function presetRange(today) {
  const day = today.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(today);
  start.setDate(today.getDate() + diffToMonday);
  return [start, today];
}
for (let i = 0; i < 7; i++) {
  const d = new Date(2026, 7, 2 + i); // Aug 2..8 2026, spans a Sunday
  const [start, end] = presetRange(d);
  console.log(d.toDateString(), "->", start.toDateString(), "..", end.toDateString(), start <= end ? "OK" : "INVERTED");
}
'
```
Expected: every line prints `OK`, none print `INVERTED` (confirm this includes the Sunday in that range).

- [ ] **Step 3: Hide "Raise PO" from non-management roles in browse mode**

In `next-frontend/src/app/(main)/procurement/page.tsx`, change:
```typescript
              {selectedPartIds.size > 0 && (
                <CardBody className="flex justify-end p-4">
                  <Button variant="primary" onClick={handleRaisePOFromSelection}>
                    Raise PO ({selectedPartIds.size} selected)
                  </Button>
                </CardBody>
              )}
```
to:
```typescript
              {isManagement && selectedPartIds.size > 0 && (
                <CardBody className="flex justify-end p-4">
                  <Button variant="primary" onClick={handleRaisePOFromSelection}>
                    Raise PO ({selectedPartIds.size} selected)
                  </Button>
                </CardBody>
              )}
```
(`isManagement` is already in scope in this component — it's used at lines 463/485 for the other `showActions` props.)

- [ ] **Step 4: Manual verification in the browser**

1. Log in as Supervisor, go to Procurement → Browse by Project, select some materials — confirm no "Raise PO" button appears.
2. Log in as PM/GM, repeat — confirm the button does appear and still works.
3. Go to `/productivity`, click "This Week" on whatever day it is today — confirm rows actually populate (not "No data for the selected range") when there's data in that range.

- [ ] **Step 5: Commit**

```bash
git add next-frontend/src/app/\(main\)/productivity/page.tsx next-frontend/src/app/\(main\)/procurement/page.tsx
git commit -m "fix: This Week date preset inverted on Sundays, Raise PO visible to non-management in browse mode

getDay()==0 on Sunday made the Monday calculation land one day in the
future, inverting from/to. Browse-mode's Raise PO button wasn't gated
by isManagement unlike every other action button on this page — it
silently no-op'd for Supervisor since the destination page's form is
management-only, with zero feedback that the selection was dropped."
```

---

## Tier 4 — Low / cosmetic

### Task 22: Fix 404 consistency for nonexistent parent ids across projects/master/notifications

**Files:**
- Modify: `backend/app/master/router.py` (`update_workforce_api`)
- Modify: `backend/app/notifications/router.py` (`mark_read`)
- Modify: `backend/app/projects/router.py` (`get_project_bellows`, `get_project_requirements`)
- Modify: `backend/app/production/router.py` (`get_requirements` — if a project-scoped equivalent exists distinct from the line-scoped `get_welding_summary`/`get_requirements` already 404-checked)
- Test: `test_404_consistency.py` (new, repo root)

- [ ] **Step 1: Write the failing test**

```python
# test_404_consistency.py
"""Confirms nonexistent parent ids consistently 404 instead of silently no-op'ing or returning empty. No pytest, no fixtures."""
from fastapi import HTTPException
from backend.services.db_service import SessionLocal
from backend.app.master.router import update_workforce_api
from backend.app.master.schemas import WorkforceUpdate
from backend.app.notifications.router import mark_read
from backend.app.projects.router import get_project_bellows


def test_workforce_update_unknown_id_is_404():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        update_workforce_api(999999999, WorkforceUpdate(productivity=100.0), db, current_user)
        assert False, "expected a 404 for a nonexistent workforce id"
    except HTTPException as e:
        assert e.status_code == 404
        print("PASS: workforce update on unknown id returns 404 instead of a silent no-op")


def test_notification_read_unknown_id_is_404():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        mark_read(999999999, db, current_user)
        assert False, "expected a 404 for a nonexistent notification id"
    except HTTPException as e:
        assert e.status_code == 404
        print("PASS: marking an unknown notification read returns 404")


def test_bellows_unknown_project_is_404():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "Supervisor", "id": None}
    try:
        get_project_bellows(999999999, db, current_user)
        assert False, "expected a 404 for a nonexistent project"
    except HTTPException as e:
        assert e.status_code == 404
        print("PASS: GET bellows for an unknown project returns 404 instead of an empty list")


test_workforce_update_unknown_id_is_404()
test_notification_read_unknown_id_is_404()
test_bellows_unknown_project_is_404()
print("All 404-consistency tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_404_consistency.py`
Expected: all three fail (each currently returns `200`/`204` with empty/no-op behavior).

- [ ] **Step 3: Fix `update_workforce_api`**

In `backend/app/master/router.py`:
```python
@router.put("/workforce/{wf_id}")
def update_workforce_api(wf_id: int, req: WorkforceUpdate, db = Depends(get_db), current_user: dict = Depends(require_roles(MANAGEMENT))):
    from backend.services.db_service import WorkforceMaster
    w = db.query(WorkforceMaster).filter(WorkforceMaster.id == wf_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="Workforce record not found")
    w.avg_productivity_per_day = req.productivity
    db.commit()
    return {"success": True, "message": "Workforce updated", "data": {}}
```

- [ ] **Step 4: Fix `mark_read`**

In `backend/app/notifications/router.py`:
```python
@router.put("/{notif_id}/read", status_code=204)
def mark_read(notif_id: int, db: Session = Depends(get_db), user=Depends(require_roles(MANAGEMENT))):
    result = db.query(Notification).filter_by(id=notif_id, for_role=user["role"]).update({"is_read": True})
    db.commit()
    if result == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
```

- [ ] **Step 5: Fix `get_project_bellows` and `get_project_requirements`**

In `backend/app/projects/router.py`:
```python
@router.get("/{project_id}/bellows")
def get_project_bellows(project_id: int, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(SUPERVISORS))):
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail="Project not found")
    lines = db.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == project_id).all()
    ...
```
(same pattern — one added existence check, rest of the function body unchanged. Apply identically to whatever the requirements-listing endpoint is named in this file: `grep -n "requirements" backend/app/projects/router.py` to find its exact name before editing.)

- [ ] **Step 6: Run test to verify it passes**

Run: `python test_404_consistency.py`
Expected: `All 404-consistency tests passed.`

- [ ] **Step 7: Commit**

```bash
git add backend/app/master/router.py backend/app/notifications/router.py backend/app/projects/router.py test_404_consistency.py
git commit -m "fix: nonexistent parent ids now consistently 404 instead of silently no-op'ing

Workforce update, notification-read, and project-bellows/requirements
GETs all returned a fake-success 200/204 for an id that doesn't exist,
giving the caller no way to detect nothing happened."
```

### Task 23: Fix `useToast` hydration mismatch and `MaterialIntelligenceDashboard`'s missing key prop

**Files:**
- Modify: `next-frontend/src/components/ui/useToast.tsx`
- Modify: `next-frontend/src/app/(main)/dashboard/materials/page.tsx`

- [ ] **Step 1: Fix the hydration mismatch in `useToast.tsx`**

Replace:
```typescript
export function useToast() {
  const [items, setItems] = useState<ToastState[]>([]);

  const showToast = useCallback((message: string, tone: ToastTone = "success") => {
    const id = Date.now();
    setItems((prev) => [...prev, { id, message, tone }]);
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    const timer = setTimeout(() => setItems((prev) => prev.slice(1)), 3000);
    return () => clearTimeout(timer);
  }, [items]);

  const toasts =
    typeof document !== "undefined"
      ? createPortal(
          <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
```
with:
```typescript
export function useToast() {
  const [items, setItems] = useState<ToastState[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const showToast = useCallback((message: string, tone: ToastTone = "success") => {
    const id = Date.now();
    setItems((prev) => [...prev, { id, message, tone }]);
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    const timer = setTimeout(() => setItems((prev) => prev.slice(1)), 3000);
    return () => clearTimeout(timer);
  }, [items]);

  const toasts =
    mounted
      ? createPortal(
          <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
```
(everything else in the file — the `.map`, closing tags, `return { showToast, toasts }` — is unchanged; only the `typeof document !== "undefined"` check becomes `mounted`, driven by a `useEffect` that only flips true after the client has mounted, matching what the server rendered on the very first client render too.)

- [ ] **Step 2: Fix the missing key prop in `MaterialIntelligenceDashboard`**

In `next-frontend/src/app/(main)/dashboard/materials/page.tsx`, add `Fragment` to the `react` import at the top of the file (or use `React.Fragment` if a default `React` import already exists — check the file's existing import line first), then replace:
```typescript
              {filtered.map((row, i) => (
                <>
                  <Tr key={`${row.material_name}-${row.size}-${i}`}>
```
with:
```typescript
              {filtered.map((row, i) => (
                <Fragment key={`${row.material_name}-${row.size}-${i}`}>
                  <Tr>
```
and the corresponding closing tag:
```typescript
                </>
              ))}
```
becomes:
```typescript
                </Fragment>
              ))}
```
(the key moves from the inner `Tr` — which no longer needs its own `key` since it's not the array-mapped element anymore — to the `Fragment`, which is. `Tr` inside can stay as-is, no key needed on it. The nested `row.projects.map((p) => (<Tr key={...}>...))` a few lines down already has its own correct key and is untouched.)

- [ ] **Step 3: Manual verification in the browser**

Run `npm --prefix next-frontend run dev`, open the browser devtools console, visit `/dashboard/materials` and any page that shows a toast (e.g. trigger a save on `/master`) — confirm no hydration-mismatch warning and no "missing key" warning appear in the console.

- [ ] **Step 4: Commit**

```bash
git add next-frontend/src/components/ui/useToast.tsx "next-frontend/src/app/(main)/dashboard/materials/page.tsx"
git commit -m "fix: hydration-mismatch warning in useToast, missing key prop in MaterialIntelligenceDashboard

useToast checked typeof document on first client render (already
non-undefined in a browser) while SSR rendered null, mismatching.
Gated on a mounted flag set post-effect instead. The materials table's
per-row Fragment (needed for a second conditional row) had no key of
its own — only the Tr inside it did, which React doesn't count for an
array of siblings."
```

### Task 24: Delete the dead `/api/v1/inventory` router

**Files:**
- Delete: `backend/app/inventory/router.py`
- Delete: `backend/app/inventory/schemas.py`

**Context:** Confirmed via the QA sweep — never `include_router`'d in `backend/main.py`, zero references anywhere else in the codebase, and superseded by `WarehouseStock`/procurement's own shortages logic. Not a live vulnerability (nothing calls it), just confusing dead code.

- [ ] **Step 1: Confirm zero references before deleting**

```bash
grep -rn "backend.app.inventory\|app\.inventory" --include="*.py" backend/ | grep -v "backend/app/inventory/"
```
Expected: no output. If this prints anything, stop and investigate before deleting.

- [ ] **Step 2: Delete the module**

```bash
git rm -r backend/app/inventory
```

- [ ] **Step 3: Verify the app still starts cleanly**

Run: `python -m uvicorn backend.main:app --port 8003 --reload`
Expected: starts with no import errors (confirms nothing else was quietly depending on the deleted module).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete dead /api/v1/inventory router

Never mounted in main.py, zero references anywhere else, fully
superseded by WarehouseStock. Confirmed via the QA sweep — not a live
vulnerability, just confusing dead code with stale schemas."
```

### Task 25: Harden the dynamic env-user login loop

**Files:**
- Modify: `backend/app/auth/router.py`
- Test: `test_auth_no_dynamic_env_backdoor.py` (new, repo root)

**Context:** Optional hardening, not fixing an active exploit (the QA sweep confirmed no unintended `_USER`-suffixed env vars exist today). The dynamic loop is a fragile pattern: any future env var accidentally named `SOMETHING_USER` becomes a full-Admin login with zero code review. Replacing it with an explicit allowlist removes that latent risk without changing any currently-working login.

- [ ] **Step 1: Write the failing test**

```python
# test_auth_no_dynamic_env_backdoor.py
"""Confirms an incidental *_USER env var can't become a login. No pytest, no fixtures."""
import os
os.environ.setdefault("JWT_SECRET_KEY", "test-key-for-unit-tests")
os.environ["SOME_RANDOM_SERVICE_USER"] = "accidental_admin"
os.environ["SOME_RANDOM_SERVICE_PASS"] = "accidental_pass"

from backend.services.db_service import get_db
from backend.app.auth.router import login
from backend.app.auth.schemas import LoginRequest


def test_incidental_env_var_pair_does_not_grant_login():
    db = next(get_db())
    from fastapi import HTTPException
    try:
        login(LoginRequest(username="accidental_admin", password="accidental_pass"), db)
        assert False, "an incidental *_USER/*_PASS env var pair should NOT be a valid login"
    except HTTPException as e:
        assert e.status_code == 401
        print("PASS: an incidental *_USER env var pair is not treated as a login")
    finally:
        del os.environ["SOME_RANDOM_SERVICE_USER"]
        del os.environ["SOME_RANDOM_SERVICE_PASS"]


test_incidental_env_var_pair_does_not_grant_login()
print("All auth env-var hardening tests passed.")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_auth_no_dynamic_env_backdoor.py`
Expected: fails — today, this incidental pair *would* grant an Admin login.

- [ ] **Step 3: Replace the dynamic scan with an explicit allowlist**

In `backend/app/auth/router.py`, replace:
```python
    if not role:
        # 2. Check dynamic env users
        for key, value in os.environ.items():
            if key.endswith("_USER") and value == req.username:
                prefix = key[:-5]
                pass_key = f"{prefix}_PASS"
                if os.getenv(pass_key) == req.password:
                    role = "Admin"
                    break
```
with:
```python
    if not role:
        # 2. Check explicitly-allowlisted admin env-var pairs (never scan all
        # env vars — an incidental future FOO_USER var must not become a login).
        ADMIN_ENV_PREFIXES = [p.strip() for p in os.getenv("ADMIN_ENV_PREFIXES", "").split(",") if p.strip()]
        for prefix in ADMIN_ENV_PREFIXES:
            if req.username == os.getenv(f"{prefix}_USER") and req.password == os.getenv(f"{prefix}_PASS"):
                role = "Admin"
                break
```

This is an intentional behavior change: previously *any* `_USER`/`_PASS` pair worked; now only prefixes explicitly listed in a new `ADMIN_ENV_PREFIXES` env var do. If Railway or the local `.env` currently relies on a dynamic Admin login beyond the 5 named roles, add its prefix to `ADMIN_ENV_PREFIXES` (comma-separated) before deploying this change — check `.env`/Railway variables for any `_USER` suffix beyond `DEV/GM/PM/CEO/MD` first:
```bash
grep -oE '^[A-Z_]+_USER=' .env
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python test_auth_no_dynamic_env_backdoor.py`
Expected: `All auth env-var hardening tests passed.`

- [ ] **Step 5: Regression-check the 5 named logins still work**

```bash
DEV_USER=$(grep '^DEV_USER=' .env | cut -d= -f2) && DEV_PASS=$(grep '^DEV_PASS=' .env | cut -d= -f2)
curl -s -X POST http://localhost:8003/api/v1/auth/login -H "Content-Type: application/json" \
  -d "{\"username\":\"$DEV_USER\",\"password\":\"$DEV_PASS\"}"
```
Expected: still returns a normal `access_token`/`refresh_token` payload (Developer login is one of the 5 hardcoded checks earlier in `login()`, untouched by this change).

- [ ] **Step 6: Commit**

```bash
git add backend/app/auth/router.py test_auth_no_dynamic_env_backdoor.py
git commit -m "harden: replace dynamic env-var login scan with an explicit allowlist

The old loop granted a full Admin login to ANY env var pair ending in
_USER/_PASS that matched submitted credentials — a fragile pattern
where an unrelated future env var (a cloud provider's DB_USER, a CI
credential) could silently become a login with no code review. No
active exploit found during the QA sweep; this closes the latent risk."
```

---

## Self-Review

**Spec coverage** — every finding from the QA report's severity tiers maps to a task:
- Critical: change-request KeyError (Task 2), dead inventory router (Task 24), plus the new PM employee-deletion feature (Tasks 3-4).
- High: cascade deletes ×2 (Tasks 5-6), work-order regeneration data loss (Task 7), FK 500s (Task 8), actual_feet bound (Task 9), PO status machine (Task 10), receipt bounds (Task 11), duplicate-PO/daily-log 500s (Task 12), frontend silent failures (Task 4 covers this — the change-request handlers).
- Medium: master bounds+sync guard (Task 13), status enums ×2 (Tasks 14, 17), procurement bounds+business-rules (Tasks 15-16), welding-log cap (Task 17), user schema (Task 18), completion progress gate (Task 19), bellows/duration (Task 20), productivity/browse-mode frontend (Task 21).
- Low/info: 404 consistency (Task 22), hydration+key-prop (Task 23), env-var login hardening (Task 25).
- The three role-list "divergence" findings (employee DELETE role list, generate-work-orders CEO/MD exclusion, Executive Dashboard GM/PM exclusion) are explicitly **not** tasks, per the user's decision to leave all three as-is — documented in Global Constraints so no implementer re-opens them.

**Placeholder scan** — no "TBD"/"handle appropriately"/unshown code found on re-read; the one deliberately-approximate step is Task 20's test file, which explicitly says to `grep` for the real `BellowItem`/`DurationRequest` import path before writing that step for real, since it wasn't independently re-confirmed after the initial read — this is a concrete instruction, not a placeholder.

**Type consistency** — `current_user` dict shape (`{"username", "role", "id"}`) is consistent from Task 2 onward through every later task that constructs one for a test. `ChangeRequestResponse`'s new `proposed_by_username`/`approved_by_username` fields (Task 2) are consumed by name in Task 4's frontend interface. `PO_ALLOWED_TRANSITIONS` (Task 10) and `KNOWN_ROLES` (Task 18) are the only new module-level constants introduced; neither is referenced outside its own task.

**Execution order matters**: Tasks 2, 5, 9, 10, 11 each touch files that later tasks in the same tier also touch (e.g. Task 9 and Task 14 both edit `WorkOrderComplete` in `backend/app/scheduler/schemas.py`; Task 11 and Task 15 both edit `backend/app/procurement/schemas.py`). Execute strictly in the numbered order within each tier to avoid one task's diff clobbering another's.
