# Procurement Browse Mode + Linked PO Creation — Design Spec
**Date:** 2026-08-02
**Status:** Approved — ready for implementation planning

---

## Problem

The procurement dashboard (`/procurement`) shows every item that needs ordering, across every project, as one flat list bucketed by urgency (RED/ORANGE/GREEN). This is good for "what's on fire today" but bad for "what does Project X need" — the PM has no way to browse by project or job, and materials belong to a job (`ProjectProductionLine`), not the project directly, so there's no structure exposed at all today.

Separately, raising a PO means retyping material/size/qty from scratch on the PO form (`/procurement/po`), even when the PM just identified exactly which items need ordering. The backend already supports linking a PO line to a specific `Part` via `PurchaseOrderLineAllocation`, but nothing in the UI uses that link to save retyping, and the PO detail page doesn't surface which project/job a line belongs to.

---

## Solution

1. Add a **Browse by Project** view alongside the existing urgency list, using the same `/morning-list` data grouped client-side — no new list endpoint needed.
2. Let the PM select materials in the browse view and **raise a PO pre-filled** from that selection, using the allocation link that already exists on the backend.
3. Show **project/job traceability** on the PO detail page by resolving each allocation's `part_id` back to its project and job.

---

## Section 1: Browse Mode (Frontend only)

### Entry point

`/procurement` gets a segmented control at the top: **"Today's Priorities"** (existing content, unchanged, default) | **"Browse by Project"** (new). Both tabs read the same already-fetched `/morning-list` array — switching tabs does not refetch.

### Three drill-down levels, one page, local state (no new routes)

1. **Projects** — one row per project with ≥1 item in the morning-list (projects with nothing pending don't appear — keeps the list short). Shows project number/name, client, target date, and RED/ORANGE/GREEN badge counts rolled up from that project's items.
2. **Jobs** — after clicking a project: one row per distinct `line_id` (production line) within that project, tagged with its exact `joint_type_code` (one of the 12 tags defined in `backend/services/joint_catalog.py`: `S-EJ-F`, `S-EJ-F-S-L`, `S-EJ-F-1MF-S-L`, `S-EJ-F-2MF-S-L`, `S-EJ-W-S-L`, `U-EJ-F-S-L`, `U-EJ-F-1MF-S-L`, `U-EJ-F-2MF-S-L`, `U-EJ-W-S-L`, `DEJ-F`, `DEJ-F-1MF`, `DEJ-F-2MF`) shown verbatim as the badge — not collapsed to a SEJ/DEJ/UJ category — plus its own RED/ORANGE/GREEN counts. Breadcrumb back to Projects.
3. **Materials** — after clicking a job: same row shape as today's flat table (material, size, qty needed, order-by date, bucket), scoped to that job's `line_id`. Each row gets a checkbox.

All grouping/counting is done client-side by `project_id` and `line_id`, both already present on every morning-list item. No backend change in this section.

### Empty states

- No projects with pending items → reuse existing `EmptyState` ("Nothing to order right now").
- A project with pending items but a job the PM opens has none (shouldn't happen since jobs are derived from the same filtered list, but defensively) → show "All materials ordered for this job."

---

## Section 2: Raise PO From Selection

### Frontend flow

Checking ≥1 material row enables a **"Raise PO"** button. Clicking it stores the selected items (material_name, size, joint_type, part_id, `still_needs_ordering` qty) in `sessionStorage` and navigates to `/procurement/po`. That page, on mount, checks for a pending selection and if present:
- Opens the "New PO" form automatically.
- Pre-fills one line per selected material: `material_name`, `size`, `joint_type`, `ordered_qty` defaulted to `still_needs_ordering`, and carries `part_id` through (not shown as a form field — attached silently to the line so it serializes into `allocations` on submit).
- Clears the stored selection once consumed.

Vendor, PO number, dates, unit price remain manually entered, same as today.

### Backend

**No backend change needed for creation.** `POST /procurement/po` already accepts `lines[].allocations[]` with `part_id` + `allocated_qty` (`backend/app/procurement/router.py:138-162`) and already reserves warehouse stock per allocation. The frontend just needs to populate `allocations: [{part_id, allocated_qty: ordered_qty}]` instead of the current `allocations: []` (`po/page.tsx:133`) when a line originated from a browse selection.

---

## Section 3: PO Traceability

### Problem detail

`AllocationResponse` (`backend/app/procurement/schemas.py:80-87`) currently returns only `part_id`, `allocated_qty`, `already_received` — no project or job info. The PO detail page (`po/[id]/page.tsx`) has no way to show which project a line is for.

### Backend change

Extend `AllocationResponse` with two resolved fields:
```python
class AllocationResponse(BaseModel):
    id: int
    part_id: int
    allocated_qty: int
    already_received: int
    project_name: Optional[str] = None
    job_tag: Optional[str] = None   # ProjectProductionLine.joint_type_code, e.g. "DEJ-F" — same specific tag shown as the Jobs-level badge in Section 1
```
Populate them in `get_po()` (`router.py:169-174`) with one bulk join: `Part -> ProjectProductionLine -> Project`, keyed by the `part_id`s present across the PO's lines (avoid N+1 — one query for all parts referenced by this PO, not one per allocation).

### Frontend change

`po/[id]/page.tsx`: under each line, render its allocations' `project_name` / `job_tag` as small sub-rows (same visual pattern as the material-intelligence dashboard's project-impact sub-rows), so the PM can trace a line back to a project without leaving the page. Lines with no allocations (manually created, not from a browse selection) simply show nothing extra — this is expected, not an error.

---

## Section 4: Scope Boundaries

**In scope:**
- Browse tab on `/procurement` (Projects → Jobs → Materials, client-side grouping)
- Checkbox selection + "Raise PO" pre-fill flow
- `AllocationResponse` extended with `project_name` / `job_tag`
- PO detail page shows traceability sub-rows

**Out of scope:**
- Any change to receiving/goods-receipt — already works.
- New database tables or columns — none needed.
- New list/aggregate backend endpoints — morning-list data is reused as-is.
- Vendor delay-ranking table (separate backlog item noted in `projectprogress.md`).
- Bulk PO editing or multi-vendor split across one selection (if the PM selects materials from two different intended vendors, they raise two POs — not handled as a single flow).

---

## Section 5: Files Touched

| File | Change |
|------|--------|
| `next-frontend/src/app/(main)/procurement/page.tsx` | Add tab control + Browse mode (Projects/Jobs/Materials panels), selection state, "Raise PO" handoff via `sessionStorage` |
| `next-frontend/src/app/(main)/procurement/po/page.tsx` | On mount, consume pending selection from `sessionStorage`, pre-fill form + open it, include `part_id` in submitted `allocations` |
| `next-frontend/src/app/(main)/procurement/po/[id]/page.tsx` | Render `project_name`/`job_tag` sub-rows per allocation |
| `backend/app/procurement/schemas.py` | Add `project_name`, `job_tag` to `AllocationResponse` |
| `backend/app/procurement/router.py` | In `get_po()`, bulk-resolve project/job per allocation |

No schema changes. No new DB tables. No new backend modules.
