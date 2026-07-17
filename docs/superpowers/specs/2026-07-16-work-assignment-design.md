# Work Assignment Feature — Design Spec
**Date:** 2026-07-16  
**Branch:** demo  
**Status:** Awaiting user approval before implementation

---

## Overview

Replaces the existing `DailyTaskAssignment`-based scheduler with a richer **WorkOrder** system that:
- Assigns workers to **specific parts** (not just project-level feet)
- **Material-gates** assignments: only generates work for parts whose materials are in `WarehouseStock`
- Supports a **Supervisor-proposes / PM-approves** workflow for both daily plan overrides and employee profile edits
- Embeds **workforce management** (skills, capacity, active status) directly in the scheduler dashboard

`DailyTaskAssignment` table and its endpoint are left untouched as legacy. The scheduler frontend page is replaced.

---

## 1. New DB Models

### `WorkOrder`
**Table:** `work_orders`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, index | |
| `project_id` | Integer | FK → projects.id, NOT NULL | |
| `user_id` | Integer | FK → users.id, NOT NULL | |
| `part_id` | Integer | FK → parts.id, nullable | Primary part being worked; null if no material-matched part found but still assigned |
| `date` | Date | NOT NULL, default today, index | |
| `process_type` | String | NOT NULL | `"TIG"` \| `"MIG"` \| `"Grinding"` |
| `target_feet` | Float | NOT NULL | Daily feet target for this worker on this part/project |
| `actual_feet` | Float | nullable | Logged on completion |
| `is_overtime` | Boolean | default False | |
| `status` | String | default `"Pending"` | `"Pending"` \| `"Completed"` \| `"Blocked"` |
| `completed_part_process_id` | Integer | FK → part_processes.id, nullable | Set on completion if supervisor marks a step ready |
| `notes` | Text | nullable | |
| `created_at` | DateTime | default utcnow | |

**Relationships:**
- `project = relationship("Project")`
- `user = relationship("User")`
- `part = relationship("Part")`
- `completed_part_process = relationship("PartProcess")`

**Indexes:** `(date, user_id)`, `(date, project_id)`

---

### `ChangeRequest`
**Table:** `change_requests`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, index | |
| `subject_type` | String | NOT NULL | `"daily_plan_override"` \| `"employee_profile"` |
| `subject_id` | Integer | nullable | `Employee.id` for `employee_profile`; null for `daily_plan_override` |
| `target_date` | Date | nullable | For `daily_plan_override`: which day this applies to |
| `proposed_by` | Integer | FK → users.id, NOT NULL | Supervisor's user id |
| `approved_by` | Integer | FK → users.id, nullable | PM's user id when resolved |
| `status` | String | default `"pending_approval"` | `"pending_approval"` \| `"approved"` \| `"rejected"` |
| `changes_json` | Text | NOT NULL | JSON blob — see structure below |
| `rejection_note` | Text | nullable | Set by PM on rejection |
| `created_at` | DateTime | default utcnow | |
| `resolved_at` | DateTime | nullable | Stamped when approved or rejected |

**Relationships:**
- `proposer = relationship("User", foreign_keys=[proposed_by])`
- `approver_user = relationship("User", foreign_keys=[approved_by])`

**`changes_json` structure:**

For `daily_plan_override`:
```json
{
  "exclude_user_ids": [5, 12],
  "capacity_overrides": {"3": 60.0, "7": 40.0},
  "notes": "Worker 5 on client site visit"
}
```

For `employee_profile`:
```json
{
  "employee_id": 3,
  "changes": {
    "skill_1": "TIG Welding",
    "skill_2": "MIG Welding",
    "target_per_day": 65.0,
    "active": true
  }
}
```

---

## 2. Algorithm: `generate-work-orders`

Endpoint: `POST /api/v1/scheduler/generate-work-orders?target_date={date}`

Clears existing `work_orders` for `target_date`, then regenerates. Closely mirrors `auto_assign_tasks` with three additions: daily-plan-override application, material gate, and `part_id` linkage.

### Step 1 — Get present workers
Same logic as `auto_assign_tasks`:
- Query `AttendanceLog` for `date == target_date`, `status IN ("Present", "Overtime")`
- If any attendance exists → use only present workers
- If no attendance recorded → assume all `User.role == "Operator"` available (future-date planning)
- Sort descending by `User.base_productivity`

### Step 2 — Apply approved daily_plan_override ChangeRequests
Before building the worker map:
```python
overrides = db.query(ChangeRequest).filter_by(
    subject_type="daily_plan_override",
    target_date=target_date,
    status="approved"
).all()
```
For each approved override:
- Remove `exclude_user_ids` from the present workers list
- Store `capacity_overrides` map (`user_id → float`) for use in Step 3

### Step 3 — Build worker_map and worker_skills_map
Identical to `auto_assign_tasks`:
- For each present worker: look up `Employee` record by `User.full_name`
- `base_productivity = emp.target_per_day` (or `User.base_productivity` or 50.0)
- Apply capacity override if one exists for this user: `base_productivity = capacity_overrides.get(str(user_id), base_productivity)`
- `remaining_capacity = base_productivity`
- `ot_remaining_capacity = base_productivity * 0.5`
- `worker_skills_map[user_id] = [(tier, skill_string), ...]` from `Employee.skill_1..4`

### Step 4 — Get active projects ordered by priority
```python
projects = db.query(Project).filter(
    Project.status == "Active",
    Project.hold_until_date == None
).order_by(
    asc(Project.priority).nullslast(),  # P1 < P2 < P3 < null
    asc(Project.target_date).nullslast(),
    asc(Project.created_at)
).all()
```

### Step 5 — Compute pacing requirements + material gate

For each project, compute `project_requirements` using the same backlog pacing as `auto_assign_tasks`:
- `aggregate_line_feet(p.production_lines)` → `(total_tig, total_mig, total_grind)`
- `base_daily_target`, `backlog`, `today_requirement` (same formulas as existing)
- `tig_req`, `mig_req`, `grind_req` proportional allocation

**Material gate** — then per process type, find the best available part to attach to the WorkOrder:
```python
def find_available_part(db, project, process_type) -> Part | None:
    """Return the first part with warehouse stock available for this project."""
    for line in project.production_lines:
        for part in line.parts:
            avail = _available_stock(db, part.name, line.size, line.joint_type)
            if avail > 0:
                # Check there's a non-ready PartProcess step for this process type
                relevant_step_names = PROCESS_TYPE_TO_STEPS.get(process_type, [])
                for proc in part.processes:
                    if proc.process_name in relevant_step_names and proc.status != "ready":
                        return part
    return None  # no materials available — still assign but part_id = None
```

`PROCESS_TYPE_TO_STEPS` mapping (defined as a constant):
```python
PROCESS_TYPE_TO_STEPS = {
    "TIG":      ["Welding"],           # EJ lines
    "MIG":      ["Welding"],           # DJ lines  
    "Grinding": ["Grinding", "DP test"],
}
```

> **Note:** If `find_available_part` returns `None` for a project-process combo, the WorkOrder is still generated (pacing continuity) but `part_id` is set to `None` and the supervisor sees a "⚠ No stock" indicator. This matches the design decision that pacing targets take precedence but material warnings are surfaced.

### Step 6 — Assignment loop (MIG → TIG → GRIND, tiers 0–3)

Identical to `auto_assign_tasks` loop structure:

```
for skill_keyword, req_key, process_type in [("MIG","remaining_MIG","MIG"), ("TIG","remaining_TIG","TIG"), ("GRIND","remaining_GRINDING","Grinding")]:
    for tier in range(4):
        tier_workers = [workers whose skill at this tier contains skill_keyword]
        sort by remaining_capacity desc
        assign feet round-robin across projects:
            assigned_feet = min(worker.remaining_capacity, req[req_key])
            part = find_available_part(db, req["project"], process_type)
            create WorkOrder(project_id, user_id, part_id=part.id if part else None,
                             date, process_type, target_feet=assigned_feet, is_overtime=False)
            decrement worker.remaining_capacity, req[req_key]
```

### Step 7 — Overtime (same as `auto_assign_tasks`)
If any `req[req_key] > 0` remains after all tiers:
- Gather all workers with the skill in any tier
- Assign from `ot_remaining_capacity` (max 50% of base)
- `is_overtime=True` on the WorkOrder

### Step 8 — Commit
`db.commit()` once. Return summary: workers assigned, work orders created, projects with no stock.

---

## 3. API Endpoints

### `POST /api/v1/scheduler/generate-work-orders`
- **Roles:** `["Developer", "GM", "Admin", "Production Manager"]`
- **Query param:** `target_date: date`
- **Body:** none
- **Action:** Deletes existing work_orders for target_date, runs the generation algorithm
- **Response:** `{success, message, orders_created: int, workers_assigned: int, no_stock_projects: [str]}`

### `GET /api/v1/scheduler/work-orders`
- **Roles:** `["Developer", "GM", "Admin", "Production Manager", "Supervisor"]`
- **Query params:** `target_date: date`
- **Response:** `List[WorkOrderResponse]` — includes nested `user`, `project`, `part` (with `part.production_line.size` and `part.production_line.joint_type`)

### `PATCH /api/v1/scheduler/work-orders/{id}`
- **Roles:** `["Developer", "GM", "Admin", "Production Manager", "Supervisor"]`
- **Body:**
  ```json
  {
    "actual_feet": 14.5,
    "status": "Completed",
    "mark_step_ready": true,
    "part_process_id": 42,
    "notes": "Completed ahead of schedule"
  }
  ```
- **Action:**
  1. Updates WorkOrder: `actual_feet`, `status`, `notes`, `completed_part_process_id`
  2. If `mark_step_ready=true` and `part_process_id` provided: sets `PartProcess.status = "ready"`, `PartProcess.date_ready = today`
- **Response:** Updated `WorkOrderResponse`

### `POST /api/v1/scheduler/change-requests`
- **Roles:** `["Developer", "GM", "Admin", "Production Manager", "Supervisor"]`
- **Body:**
  ```json
  {
    "subject_type": "employee_profile",
    "subject_id": 3,
    "target_date": null,
    "changes_json": "{...}"
  }
  ```
- **Response:** Created `ChangeRequestResponse`

### `GET /api/v1/scheduler/change-requests`
- **Roles:** `["Developer", "GM", "Admin", "Production Manager", "Supervisor"]`
- **Query params:** `status: str = "pending_approval"`, `target_date: date = None`, `proposed_by: int = None`
- **Access rule:** Supervisors calling this endpoint can only see their own requests (backend enforces `proposed_by = current_user.id`); PM/management see all
- **Response:** `List[ChangeRequestResponse]`

### `PATCH /api/v1/scheduler/change-requests/{id}/approve`
- **Roles:** `["Developer", "GM", "Admin", "Production Manager"]`
- **Action:**
  - Sets `status = "approved"`, `approved_by = current_user.id`, `resolved_at = now`
  - If `subject_type == "employee_profile"`: immediately applies `changes_json` to the `Employee` record
  - If `subject_type == "daily_plan_override"`: no immediate action — applied on next `generate-work-orders` call for `target_date`
- **Response:** Updated `ChangeRequestResponse`

### `PATCH /api/v1/scheduler/change-requests/{id}/reject`
- **Roles:** `["Developer", "GM", "Admin", "Production Manager"]`
- **Body:** `{"rejection_note": "Skills already updated in system"}`
- **Action:** Sets `status = "rejected"`, `rejection_note`, `resolved_at`
- **Response:** Updated `ChangeRequestResponse`

---

## 4. Approval Flow State Machine

```
[Supervisor creates]
        ↓
  pending_approval
        ↓
   PM reviews
   /         \
approved    rejected
   ↓              ↓
Apply changes   rejection_note
(immediate for   surfaced to
 employee_profile) supervisor
```

**State transitions:**
| Event | From | To | Side effect |
|---|---|---|---|
| Supervisor submits | — | `pending_approval` | PM notified via badge count |
| PM approves | `pending_approval` | `approved` | Employee profile: fields updated; daily override: queued for next generate |
| PM rejects | `pending_approval` | `rejected` | `rejection_note` set; supervisor sees Alert on next page load |

**Applying `employee_profile` changes on approval:**
```python
emp = db.query(Employee).filter(Employee.id == cr.subject_id).first()
changes = json.loads(cr.changes_json)["changes"]
for field, value in changes.items():
    if field in ("skill_1","skill_2","skill_3","skill_4","target_per_day","active"):
        setattr(emp, field, value)
db.commit()
```

**Applying `daily_plan_override` changes:**
- Applied automatically in Step 2 of `generate-work-orders` — no explicit apply action needed on approval
- The approved record just needs to exist before the supervisor or PM triggers generation

**Surfacing rejections to supervisors:**
- `GET /api/v1/scheduler/change-requests?status=rejected&proposed_by=current_user_id` (add filter to the GET endpoint)
- Frontend shows a dismissible `Alert tone="critical"` for any unread rejections with the `rejection_note`

---

## 5. Frontend Pages & Components

### `/scheduler` — Work Orders (replaces existing page)

**Visible to:** All authenticated users (Supervisor+)

**Layout:**
```
[Work Orders]  [date picker]  [Generate Work Orders btn — PM only]

[Alert: "3 workers have no materials — Projects: EJ-123, DJ-456"]  ← conditional

Tabs: [Work Orders (badge: count)] [Pending Approvals (badge: count) — PM only]

[Manage Workforce btn — Supervisor+]
```

**Work Orders tab — Table:**

| Column | Notes |
|---|---|
| Worker Name | `user.full_name` |
| Project | `project.quotation_no` |
| Part | `part.name` + `part.production_line.size`mm — e.g. "Element 200mm" |
| Process | `Badge tone="brand"` |
| Target Feet | `Th numeric` / `Td numeric` |
| Overtime | `Badge tone="warning"` if true |
| Status | `Badge` — Pending→warning, Completed→success, Blocked→critical |
| ⚠ No Stock | `Badge tone="critical"` if `part_id == null` |
| Actions | "Complete" button → opens completion Modal |

**Completion Modal** (opens on "Complete" click):
- `Input type="number"` for actual_feet
- `Select` for optional PartProcess step: "Also mark step ready?" — loads steps for `part_id` where status != "ready"
- `Textarea` for notes (optional)
- Buttons: "Save" (primary) | "Cancel" (secondary)

**Pending Approvals tab** (PM only):
- Table: Type | Proposed By | Summary | Target Date | Submitted | Actions
- Summary = human-readable description of the change (generated on the frontend from `changes_json`)
- "Approve" button (primary) — calls approve endpoint
- "Reject" button (danger) → opens small Modal with `Textarea` for rejection_note

**"Manage Workforce" Modal** (Supervisor+):
- Table of employees: Name | Company | Skill 1 | Skill 2 | Skill 3 | Skill 4 | Target/Day | Active
- Each row is editable inline (Input/Select per cell)
- "Propose Changes" button at bottom (primary) — creates one ChangeRequest per modified employee
- "Override Today's Plan" button (secondary) → opens a nested second Modal

**Daily Override nested Modal:**
- Worker checklist: all present workers with checkbox (check = include)
- Capacity override: per-worker numeric Input (empty = use default)
- `Textarea` for notes
- "Submit for Approval" button → creates one ChangeRequest of type `daily_plan_override`

**Sidebar nav:** Add "Work Orders" under the Scheduler group in `Sidebar.tsx` (replace existing Daily Scheduler entry or rename it).

---

## 6. Migration & Startup

Two new `CREATE TABLE` calls added to `init_db()` in `db_service.py` (or via `Base.metadata.create_all` — same pattern as all other tables). No existing tables modified. No ALTER TABLE.

```python
# In db_service.py — just add the two new model classes and they'll be created
# by Base.metadata.create_all(engine) in main.py on startup.
```

No seed data needed.

---

## 7. Open Questions / Deliberate Simplifications

1. **`PROCESS_TYPE_TO_STEPS` mapping** — the strawman `{"TIG": ["Welding"], "MIG": ["Welding"], "Grinding": ["Grinding","DP test"]}` is a guess. The actual mapping of production process names to weld skill types needs confirmation from the GM/PM before implementation.

2. **One WorkOrder per (worker, project, process_type, day)** — the current design generates one work order per worker-project-processtype combination, same granularity as `DailyTaskAssignment`. A finer grain (one per part) would be more accurate but increases row count significantly. Revisit if the supervisor reports confusion about which part to prioritize.

3. **Material gate is advisory, not hard-blocking** — if no stock is found, the WorkOrder is still created with `part_id=null` and a warning badge. The system never blocks generation due to stock. This matches production reality where workers may continue previously-started work even if new material is not yet received.

4. **`daily_plan_override` has no conflict resolution** — if two supervisors both submit overrides for the same date, both are applied in insertion order. Last writer wins for overlapping `capacity_overrides`. Acceptable for a single-supervisor-per-shift shop; revisit if multiple supervisors need to coordinate.

5. **Rejection "unread" state** — the spec surfaces rejections via a GET query but has no explicit `is_read` flag on ChangeRequest. The frontend dismisses the Alert when the user closes it (local state). If persistence is needed, add a `read_at` column to ChangeRequest.

6. **`progress_status.compute_process_status`** — when marking a step ready from WorkOrder completion, we set `PartProcess.status = "ready"` directly (bypassing `compute_process_status`). This is intentional: the supervisor is explicitly declaring the step done. Ensure `date_ready` is also set.
