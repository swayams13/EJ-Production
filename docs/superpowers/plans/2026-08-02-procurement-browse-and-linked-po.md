# Procurement Browse Mode + Linked PO Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Project → Job → Material browse view to the procurement dashboard, and let the PM raise a PO pre-filled from a selection of materials instead of retyping them.

**Architecture:** Everything reads the existing `/api/v1/procurement/morning-list` payload and groups it client-side by `project_id`/`line_id` — no new list endpoints. PO pre-fill reuses and fixes an existing (currently dead) `?prefill=` query-param convention already present in `procurement/page.tsx`'s `handleCreatePO`, which navigates to `/procurement/po?prefill=...` but the destination page never reads it. Two small, additive backend changes: `get_morning_list()` gains one more already-loaded field (`joint_type_code`), and `GET /po/{id}` resolves each allocation's project/job for display.

**Tech Stack:** FastAPI + SQLAlchemy (backend), Next.js 16 App Router + TypeScript (frontend), no ORM/schema changes, no new dependencies.

## Global Constraints

- Backend must remain PostgreSQL-only — every change here is additive (new dict key, new optional response fields) with no new tables, columns, or migrations.
- New Python packages are never needed for this plan; skip that step type entirely.
- This repo has no frontend test harness (no jest/vitest/playwright configured — confirmed absent from `next-frontend/package.json`). Frontend tasks below substitute a scripted manual browser check for the automated red/green test cycle, per this project's own CLAUDE.md instruction to verify UI changes in a running browser before calling them done. Do not add a test framework to satisfy this plan's template — that would be an unrequested dependency.
- Backend tests in this repo are plain top-level `test_*.py` scripts using bare `assert` + a final `print(...)`, not pytest — there is no `tests/` directory, no `conftest.py`, no pytest config anywhere. Follow that exact convention for any backend test in this plan.
- Push to `demo` (current branch) only, per this repo's CLAUDE.md. Do not merge to `main`. This plan does not include a push step — commit locally per task; pushing is a separate, explicit decision for the user.
- `next-frontend/AGENTS.md` warns this Next.js version (16.2.9) may differ from training data — Task 2 relies on the real `useSearchParams` doc at `next-frontend/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`, already confirmed during planning: a Client Component calling `useSearchParams()` must be wrapped in `<Suspense>` or the production build fails ("Missing Suspense boundary with useSearchParams").

---

## Task 1: Backend — resolve project/job for each PO line allocation

**Files:**
- Modify: `backend/app/procurement/schemas.py` (`AllocationResponse`, currently lines 80-87)
- Modify: `backend/app/procurement/router.py` (imports at lines 6-11, `get_po()` at lines 169-174)
- Create: `test_po_allocation_trace.py` (repo root, matches `test_priority_score.py` convention)

**Interfaces:**
- Produces: `AllocationResponse.project_name: Optional[str]`, `AllocationResponse.job_tag: Optional[str]` — consumed by Task 5's frontend rendering.
- Produces: `_resolve_allocation_trace(alloc) -> tuple[str | None, str | None]` in `backend/app/procurement/router.py`, returning `(project_name, job_tag)` for one `PurchaseOrderLineAllocation`-like object (duck-typed: needs `.part.production_line.project.project_name` and `.part.production_line.joint_type_code`, each safely `None`-checked).

- [ ] **Step 1: Add the two new fields to `AllocationResponse`**

In `backend/app/procurement/schemas.py`, replace:

```python
class AllocationResponse(BaseModel):
    id: int
    part_id: int
    allocated_qty: int
    already_received: int

    class Config:
        from_attributes = True
```

with:

```python
class AllocationResponse(BaseModel):
    id: int
    part_id: int
    allocated_qty: int
    already_received: int
    project_name: Optional[str] = None
    job_tag: Optional[str] = None

    class Config:
        from_attributes = True
```

(`Optional` is already imported at the top of this file — used elsewhere, e.g. `POLineCreate.unit_price`.)

- [ ] **Step 2: Write the resolver function and its standalone test**

Create `test_po_allocation_trace.py` at the repo root:

```python
from types import SimpleNamespace
from backend.app.procurement.router import _resolve_allocation_trace


def test_resolves_project_and_job_tag():
    alloc = SimpleNamespace(
        part=SimpleNamespace(
            production_line=SimpleNamespace(
                joint_type_code="DEJ-F",
                project=SimpleNamespace(project_name="BPCL-44"),
            )
        )
    )
    project_name, job_tag = _resolve_allocation_trace(alloc)
    assert project_name == "BPCL-44"
    assert job_tag == "DEJ-F"


def test_missing_part_returns_none():
    alloc = SimpleNamespace(part=None)
    project_name, job_tag = _resolve_allocation_trace(alloc)
    assert project_name is None
    assert job_tag is None


def test_missing_project_returns_none_name_but_keeps_tag():
    alloc = SimpleNamespace(
        part=SimpleNamespace(
            production_line=SimpleNamespace(joint_type_code="U-EJ-F-S-L", project=None)
        )
    )
    project_name, job_tag = _resolve_allocation_trace(alloc)
    assert project_name is None
    assert job_tag == "U-EJ-F-S-L"


test_resolves_project_and_job_tag()
test_missing_part_returns_none()
test_missing_project_returns_none_name_but_keeps_tag()
print("All PO allocation trace tests passed.")
```

- [ ] **Step 3: Run the test to confirm it fails (function doesn't exist yet)**

Run: `python test_po_allocation_trace.py`
Expected: `ImportError: cannot import name '_resolve_allocation_trace'`

- [ ] **Step 4: Implement the resolver and wire it into `get_po()`**

In `backend/app/procurement/router.py`, change the import block (lines 6-11) from:

```python
from backend.services.db_service import (
    get_db, Vendor, WarehouseStock, MaterialLeadTime,
    PurchaseOrder, PurchaseOrderLine, PurchaseOrderLineAllocation,
    GoodsReceipt, GoodsReceiptLine, PartProcess, Part, User,
    DailyProcurementLog, MaterialHold,
)
```

to:

```python
from backend.services.db_service import (
    get_db, Vendor, WarehouseStock, MaterialLeadTime,
    PurchaseOrder, PurchaseOrderLine, PurchaseOrderLineAllocation,
    GoodsReceipt, GoodsReceiptLine, PartProcess, Part, User,
    DailyProcurementLog, MaterialHold, ProjectProductionLine,
)
```

Then replace the `get_po` route (lines 169-174):

```python
@router.get("/po/{po_id}", response_model=POResponse)
def get_po(po_id: int, db: Session = Depends(get_db), _=Depends(require_roles(SUPERVISORS))):
    po = db.query(PurchaseOrder).filter_by(id=po_id).first()
    if not po:
        raise HTTPException(404, "PO not found")
    return po
```

with:

```python
def _resolve_allocation_trace(alloc):
    """(project_name, job_tag) for a PO line allocation, via its part's production line."""
    part = alloc.part
    line = part.production_line if part else None
    if not line:
        return None, None
    project_name = line.project.project_name if line.project else None
    return project_name, line.joint_type_code


@router.get("/po/{po_id}", response_model=POResponse)
def get_po(po_id: int, db: Session = Depends(get_db), _=Depends(require_roles(SUPERVISORS))):
    po = (
        db.query(PurchaseOrder)
        .filter_by(id=po_id)
        .options(
            subqueryload(PurchaseOrder.lines)
            .subqueryload(PurchaseOrderLine.allocations)
            .subqueryload(PurchaseOrderLineAllocation.part)
            .subqueryload(Part.production_line)
            .subqueryload(ProjectProductionLine.project)
        )
        .first()
    )
    if not po:
        raise HTTPException(404, "PO not found")

    response = POResponse.model_validate(po)
    for line, line_resp in zip(po.lines, response.lines):
        for alloc, alloc_resp in zip(line.allocations, line_resp.allocations):
            alloc_resp.project_name, alloc_resp.job_tag = _resolve_allocation_trace(alloc)
    return response
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `python test_po_allocation_trace.py`
Expected: `All PO allocation trace tests passed.`

- [ ] **Step 6: Commit**

```bash
git add backend/app/procurement/schemas.py backend/app/procurement/router.py test_po_allocation_trace.py
git commit -m "feat: resolve project/job trace on PO line allocations"
```

---

## Task 2: Frontend — fix the "Create PO" prefill hand-off (single item)

The morning-list page already has a `Create PO` button (`onCreatePO`) that navigates to `/procurement/po?prefill=<JSON>`, but `po/page.tsx` never reads that param — it's a dead code path today. This task makes it work, and standardizes the payload shape so Task 4 (multi-item selection) can reuse the exact same mechanism.

**Files:**
- Modify: `next-frontend/src/app/(main)/procurement/page.tsx` (`handleCreatePO`, currently lines 240-242)
- Modify: `next-frontend/src/app/(main)/procurement/po/page.tsx` (imports lines 1-13, `POLine` interface line 35-41, default export line 63, `save()` body lines 116-154)

**Interfaces:**
- Produces: the `prefill` query-param payload shape — `Array<{ part_id: number; material_name: string; size: number; joint_type: string; ordered_qty: number }>` — a JSON array (always an array, even for one item). Consumed by Task 4.
- Consumes: none (self-contained fix).

- [ ] **Step 1: Standardize `handleCreatePO`'s payload to an array**

In `next-frontend/src/app/(main)/procurement/page.tsx`, replace:

```typescript
  const handleCreatePO = (item: MorningListItem) => {
    router.push(`/procurement/po?prefill=${encodeURIComponent(JSON.stringify(item))}`);
  };
```

with:

```typescript
  const handleCreatePO = (item: MorningListItem) => {
    const payload = [{
      part_id: item.part_id,
      material_name: item.material_name,
      size: item.size,
      joint_type: item.joint_type,
      ordered_qty: item.still_needs_ordering,
    }];
    router.push(`/procurement/po?prefill=${encodeURIComponent(JSON.stringify(payload))}`);
  };
```

- [ ] **Step 2: Wrap the PO list page in `Suspense` and split out the content component**

`useSearchParams()` requires a `<Suspense>` boundary around the component that calls it, or the production build fails (confirmed in Next 16 docs at `next-frontend/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`).

In `next-frontend/src/app/(main)/procurement/po/page.tsx`, change the imports (lines 1-13) from:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import {
  Button, Card, CardHeader, CardBody,
  Input, Label, Select, Textarea,
  Table, THead, TBody, Tr, Th, Td,
  Badge, Spinner, Alert,
  useToast,
} from "@/components/ui";
```

to:

```tsx
"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import {
  Button, Card, CardHeader, CardBody,
  Input, Label, Select, Textarea,
  Table, THead, TBody, Tr, Th, Td,
  Badge, Spinner, Alert,
  useToast,
} from "@/components/ui";
```

Then change the default export (`export default function POListPage() {` at line 63) so the existing function is renamed and wrapped. Replace:

```tsx
export default function POListPage() {
  const router = useRouter();
```

with:

```tsx
export default function POListPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center p-16"><Spinner label="Loading purchase orders…" /></div>}>
      <POListPageContent />
    </Suspense>
  );
}

function POListPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
```

(The rest of the original function body — from `const { showToast, toasts } = useToast();` through its closing `}` — is unchanged; only the function's name and this new wrapper export change.)

- [ ] **Step 3: Add `part_id` to the form-line type and consume `prefill` on mount**

Replace the `POLine` interface (lines 35-41):

```typescript
interface POLine {
  material_name: string;
  size: number;
  joint_type: string;
  ordered_qty: number;
  unit_price: string;
}
```

with:

```typescript
interface POLine {
  material_name: string;
  size: number;
  joint_type: string;
  ordered_qty: number;
  unit_price: string;
  part_id?: number;
}
```

Then, immediately after the existing `useEffect(() => { load(); }, []);` line, add a second effect that reads and consumes the `prefill` param once:

```typescript
  useEffect(() => {
    const prefill = searchParams.get("prefill");
    if (!prefill || !isManagement) return;
    try {
      const parsed = JSON.parse(prefill) as Array<{
        part_id: number; material_name: string; size: number; joint_type: string; ordered_qty: number;
      }>;
      if (Array.isArray(parsed) && parsed.length > 0) {
        setForm({ ...EMPTY_FORM });
        setLines(parsed.map(p => ({
          material_name: p.material_name,
          size: p.size,
          joint_type: p.joint_type,
          ordered_qty: p.ordered_qty,
          unit_price: "",
          part_id: p.part_id,
        })));
        setFormOpen(true);
      }
    } catch {
      // ponytail: malformed prefill param — ignore, form stays closed
    }
  }, []);
```

- [ ] **Step 4: Carry `part_id` through into the submitted allocation**

In the `save` function, replace:

```typescript
        lines: lines.map(l => ({
          material_name: l.material_name,
          size: +l.size,
          joint_type: l.joint_type,
          ordered_qty: +l.ordered_qty,
          unit_price: l.unit_price ? +l.unit_price : null,
          allocations: [],
        })),
```

with:

```typescript
        lines: lines.map(l => ({
          material_name: l.material_name,
          size: +l.size,
          joint_type: l.joint_type,
          ordered_qty: +l.ordered_qty,
          unit_price: l.unit_price ? +l.unit_price : null,
          allocations: l.part_id ? [{ part_id: l.part_id, allocated_qty: +l.ordered_qty }] : [],
        })),
```

- [ ] **Step 5: Manually verify in the browser**

Run: `python -m uvicorn backend.main:app --port 8003 --reload` (separate terminal) and `npm --prefix next-frontend run dev`.

With a MANAGEMENT-role login: open `/procurement`, find any row in a RED/ORANGE/GREEN section, click **Create PO**. Confirm:
1. You land on `/procurement/po` with the "New Purchase Order" form already open.
2. The one line item is pre-filled with that row's material, size, joint type, and quantity.
3. Filling in a PO Number and Vendor and clicking **Create PO** succeeds, and the new PO appears in the list.

With a non-MANAGEMENT login, click **Create PO** on a row and confirm the form does **not** auto-open (since that role can't submit anyway) — you should land on a plain PO list.

- [ ] **Step 6: Commit**

```bash
git add "next-frontend/src/app/(main)/procurement/page.tsx" "next-frontend/src/app/(main)/procurement/po/page.tsx"
git commit -m "feat: wire up PO prefill so Create PO actually pre-fills the form"
```

---

## Task 3: Backend + Frontend — Browse by Project drill-down (read-only)

**Files:**
- Modify: `backend/services/procurement_service.py` (`get_morning_list`, the `items.append({...})` block, currently lines 220-243)
- Modify: `next-frontend/src/app/(main)/procurement/page.tsx` (`MorningListItem` interface lines 34-49, component body)

**Interfaces:**
- Produces: `get_morning_list()` items now include `"joint_type_code": line.joint_type_code`. Consumed by the frontend Jobs panel below and by Task 4.
- Produces: `view` state (`"priorities" | "browse"`), `browseProjectId`, `browseLineId`, `selectedPartIds` state and the `projectGroups`/`jobGroupsForProject`/`materialsForLine` derived data — consumed by Task 4.
- Consumes: nothing from Tasks 1-2 (independent).

- [ ] **Step 1: Add `joint_type_code` to the morning-list item shape**

In `backend/services/procurement_service.py`, inside `get_morning_list()`, find the `items.append({...})` block and change:

```python
                    "line_id": line.id,
                    "size": line.size,
                    "joint_type": line.joint_type,
```

to:

```python
                    "line_id": line.id,
                    "size": line.size,
                    "joint_type": line.joint_type,
                    "joint_type_code": line.joint_type_code,
```

This is a one-line pass-through of an already-loaded attribute (the eager-load in `get_morning_list()` already pulls `ProjectProductionLine` rows into `line`); it has no branch or loop of its own, so per this project's ponytail convention it needs no dedicated automated test — its correctness is confirmed visually in Step 5 below.

- [ ] **Step 2: Widen the frontend's `MorningListItem` type to match what the API already sends**

The backend has always returned `project_id`, `line_id`, `quotation_no`, and `client_name` on every item (confirmed by reading `get_morning_list()` and the `/morning-list` route, which returns the raw dicts with no field-stripping) — the frontend interface just never declared them. Replace the interface (lines 34-49):

```typescript
interface MorningListItem {
  part_id: number;
  project_name: string;
  priority: string;
  target_date: string | null;
  days_to_order_by: number;
  material_name: string;
  size: number;
  joint_type: string;
  still_needs_ordering: number;
  priority_score: number;
  bucket: string;
  delay_reason: string | null;
  qty_ordered_today: number;
  qty_received_today: number;
}
```

with:

```typescript
interface MorningListItem {
  part_id: number;
  project_id: number;
  quotation_no: string;
  project_name: string;
  client_name: string;
  line_id: number;
  joint_type_code: string | null;
  priority: string;
  target_date: string | null;
  order_by_date: string | null;
  days_to_order_by: number;
  material_name: string;
  size: number;
  joint_type: string;
  still_needs_ordering: number;
  priority_score: number;
  bucket: string;
  delay_reason: string | null;
  qty_ordered_today: number;
  qty_received_today: number;
}
```

- [ ] **Step 3: Add browse-mode state and grouping helpers**

Immediately after the existing state declarations in `ProcurementDashboard` (after the line `const [savingReason, setSavingReason] = useState(false);`), add:

```typescript
  // Browse-by-project mode
  const [view, setView] = useState<"priorities" | "browse">("priorities");
  const [browseProjectId, setBrowseProjectId] = useState<number | null>(null);
  const [browseLineId, setBrowseLineId] = useState<number | null>(null);
```

After the existing bucketing lines (`const green = items.filter(i => i.bucket === "GREEN");`), add the browse-mode grouping — these are pure derived values recomputed each render from `items`, no new state needed:

```typescript
  type BucketCounts = { RED: number; ORANGE: number; GREEN: number };
  const emptyCounts = (): BucketCounts => ({ RED: 0, ORANGE: 0, GREEN: 0 });

  type ProjectGroup = {
    project_id: number; quotation_no: string; project_name: string;
    client_name: string; target_date: string | null; counts: BucketCounts;
  };
  const projectGroups: ProjectGroup[] = Object.values(
    items.reduce<Record<number, ProjectGroup>>((acc, item) => {
      const g = acc[item.project_id] ?? {
        project_id: item.project_id, quotation_no: item.quotation_no,
        project_name: item.project_name, client_name: item.client_name,
        target_date: item.target_date, counts: emptyCounts(),
      };
      if (item.bucket === "RED" || item.bucket === "ORANGE" || item.bucket === "GREEN") {
        g.counts[item.bucket]++;
      }
      acc[item.project_id] = g;
      return acc;
    }, {})
  );

  type JobGroup = { line_id: number; joint_type_code: string | null; size: number; counts: BucketCounts };
  const jobGroupsForProject = (projectId: number): JobGroup[] => Object.values(
    items.filter(i => i.project_id === projectId).reduce<Record<number, JobGroup>>((acc, item) => {
      const g = acc[item.line_id] ?? {
        line_id: item.line_id, joint_type_code: item.joint_type_code,
        size: item.size, counts: emptyCounts(),
      };
      if (item.bucket === "RED" || item.bucket === "ORANGE" || item.bucket === "GREEN") {
        g.counts[item.bucket]++;
      }
      acc[item.line_id] = g;
      return acc;
    }, {})
  );

  const materialsForLine = (lineId: number): MorningListItem[] =>
    items.filter(i => i.line_id === lineId);

  const openBrowseProject = (projectId: number) => {
    setBrowseProjectId(projectId);
    setBrowseLineId(null);
  };
  const openBrowseLine = (lineId: number) => {
    setBrowseLineId(lineId);
  };
```

- [ ] **Step 4: Add the tab control and the three browse panels to the JSX**

First, wrap the existing "Today's Priorities" content so it only renders in that view. Immediately after the closing `</div>` of the header block (the one containing the `<h1>Morning Dashboard</h1>`, right before `{fetchError && (`), insert the tab control:

```tsx
      <div className="flex gap-2">
        <Button variant={view === "priorities" ? "primary" : "secondary"} onClick={() => setView("priorities")}>
          Today&apos;s Priorities
        </Button>
        <Button variant={view === "browse" ? "primary" : "secondary"} onClick={() => setView("browse")}>
          Browse by Project
        </Button>
      </div>
```

Then wrap everything from `{/* Stats bar */}` through the `{/* All clear */}` block (i.e. the stats grid, the delay-reason form, all four RED/ORANGE/GREEN sections, and the empty state — everything currently between the `fetchError` block and the final closing `</div>` of the component) in `{view === "priorities" && ( ... )}`.

Immediately after that closing `)}`, add the browse-mode block as a sibling:

```tsx
      {view === "browse" && (
        <div className="flex flex-col gap-4">
          {browseProjectId === null && (
            <Card>
              <CardHeader title="Projects" />
              <Table>
                <THead>
                  <Tr>
                    <Th>Project</Th>
                    <Th>Client</Th>
                    <Th>Target Date</Th>
                    <Th numeric>Red</Th>
                    <Th numeric>Orange</Th>
                    <Th numeric>Green</Th>
                    <Th></Th>
                  </Tr>
                </THead>
                <TBody>
                  {projectGroups.map(g => (
                    <Tr key={g.project_id}>
                      <Td>
                        <div className="font-semibold text-ink">{g.project_name}</div>
                        <div className="font-data text-xs text-ink-soft">{g.quotation_no}</div>
                      </Td>
                      <Td>{g.client_name}</Td>
                      <Td className="font-data text-sm">{g.target_date ?? "—"}</Td>
                      <Td numeric>{g.counts.RED > 0 && <Badge tone="critical">{g.counts.RED}</Badge>}</Td>
                      <Td numeric>{g.counts.ORANGE > 0 && <Badge tone="warning">{g.counts.ORANGE}</Badge>}</Td>
                      <Td numeric>{g.counts.GREEN > 0 && <Badge tone="success">{g.counts.GREEN}</Badge>}</Td>
                      <Td numeric>
                        <Button variant="secondary" onClick={() => openBrowseProject(g.project_id)}>Open</Button>
                      </Td>
                    </Tr>
                  ))}
                  {projectGroups.length === 0 && (
                    <Tr><Td colSpan={7} className="py-8 text-center text-ink-soft">Nothing to order right now.</Td></Tr>
                  )}
                </TBody>
              </Table>
            </Card>
          )}

          {browseProjectId !== null && browseLineId === null && (
            <Card>
              <CardHeader
                title={`Jobs — ${projectGroups.find(g => g.project_id === browseProjectId)?.project_name ?? ""}`}
                action={<Button variant="ghost" onClick={() => setBrowseProjectId(null)}>&larr; Projects</Button>}
              />
              <Table>
                <THead>
                  <Tr>
                    <Th>Tag</Th>
                    <Th numeric>Size</Th>
                    <Th numeric>Red</Th>
                    <Th numeric>Orange</Th>
                    <Th numeric>Green</Th>
                    <Th></Th>
                  </Tr>
                </THead>
                <TBody>
                  {jobGroupsForProject(browseProjectId).map(g => (
                    <Tr key={g.line_id}>
                      <Td className="font-data font-semibold text-ink">{g.joint_type_code ?? "—"}</Td>
                      <Td numeric>{g.size}</Td>
                      <Td numeric>{g.counts.RED > 0 && <Badge tone="critical">{g.counts.RED}</Badge>}</Td>
                      <Td numeric>{g.counts.ORANGE > 0 && <Badge tone="warning">{g.counts.ORANGE}</Badge>}</Td>
                      <Td numeric>{g.counts.GREEN > 0 && <Badge tone="success">{g.counts.GREEN}</Badge>}</Td>
                      <Td numeric>
                        <Button variant="secondary" onClick={() => openBrowseLine(g.line_id)}>Open</Button>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}

          {browseLineId !== null && (
            <Card>
              <CardHeader
                title="Materials"
                action={<Button variant="ghost" onClick={() => setBrowseLineId(null)}>&larr; Jobs</Button>}
              />
              <Table>
                <THead>
                  <Tr>
                    <Th>Material</Th>
                    <Th numeric>Size</Th>
                    <Th numeric>Qty Needed</Th>
                    <Th>Order By</Th>
                    <Th>Status</Th>
                  </Tr>
                </THead>
                <TBody>
                  {materialsForLine(browseLineId).map(item => (
                    <Tr key={item.part_id}>
                      <Td>{item.material_name}</Td>
                      <Td numeric>{item.size}</Td>
                      <Td numeric>{item.still_needs_ordering}</Td>
                      <Td className="font-data text-sm">{item.order_by_date ?? "—"}</Td>
                      <Td>
                        <Badge tone={item.bucket === "RED" ? "critical" : item.bucket === "ORANGE" ? "warning" : "success"}>
                          {item.bucket}
                        </Badge>
                      </Td>
                    </Tr>
                  ))}
                  {materialsForLine(browseLineId).length === 0 && (
                    <Tr><Td colSpan={5} className="py-8 text-center text-ink-soft">All materials ordered for this job.</Td></Tr>
                  )}
                </TBody>
              </Table>
            </Card>
          )}
        </div>
      )}
```

(Selection checkboxes and the "Raise PO" button are added in Task 4 — this task is read-only browsing.)

- [ ] **Step 5: Manually verify in the browser**

With both servers running, open `/procurement`, click **Browse by Project**. Confirm:
1. The Projects panel lists only projects that have at least one item in today's morning list, each showing correct RED/ORANGE/GREEN counts (cross-check against the **Today's Priorities** tab's stats bar totals).
2. Clicking **Open** on a project shows its jobs, each tagged with its real `joint_type_code` (e.g. `DEJ-F`, `U-EJ-F-1MF-S-L`) — not a generic "SEJ/DEJ/UJ" label.
3. Clicking **Open** on a job shows its pending materials with qty needed, order-by date, and bucket.
4. The breadcrumb buttons (`← Projects`, `← Jobs`) navigate back correctly.
5. Switching back to **Today's Priorities** still shows the original flat list unchanged.

- [ ] **Step 6: Commit**

```bash
git add backend/services/procurement_service.py "next-frontend/src/app/(main)/procurement/page.tsx"
git commit -m "feat: add read-only Project -> Job -> Material browse view to procurement dashboard"
```

---

## Task 4: Frontend — select materials in Browse mode and raise a PO

**Files:**
- Modify: `next-frontend/src/app/(main)/procurement/page.tsx` (state, materials panel from Task 3, imports)

**Interfaces:**
- Consumes: the `prefill` payload shape from Task 2 (`Array<{ part_id, material_name, size, joint_type, ordered_qty }>`), the `materialsForLine`/`browseLineId` state from Task 3.

- [ ] **Step 1: Add selection state**

Add alongside the other browse-mode state from Task 3 (after `const [browseLineId, setBrowseLineId] = useState<number | null>(null);`):

```typescript
  const [selectedPartIds, setSelectedPartIds] = useState<Set<number>>(new Set());
```

Update `openBrowseLine` to clear the selection when switching jobs:

```typescript
  const openBrowseLine = (lineId: number) => {
    setBrowseLineId(lineId);
    setSelectedPartIds(new Set());
  };
```

- [ ] **Step 2: Add the "Raise PO" handler**

Add near `handleCreatePO`:

```typescript
  const handleRaisePOFromSelection = () => {
    const selected = items.filter(i => selectedPartIds.has(i.part_id));
    const payload = selected.map(i => ({
      part_id: i.part_id,
      material_name: i.material_name,
      size: i.size,
      joint_type: i.joint_type,
      ordered_qty: i.still_needs_ordering,
    }));
    router.push(`/procurement/po?prefill=${encodeURIComponent(JSON.stringify(payload))}`);
  };
```

- [ ] **Step 3: Add checkboxes to the Materials panel and a "Raise PO" action**

In the Materials `<Card>` from Task 3, add a checkbox column. Change the header row from:

```tsx
                <THead>
                  <Tr>
                    <Th>Material</Th>
                    <Th numeric>Size</Th>
                    <Th numeric>Qty Needed</Th>
                    <Th>Order By</Th>
                    <Th>Status</Th>
                  </Tr>
                </THead>
```

to:

```tsx
                <THead>
                  <Tr>
                    <Th></Th>
                    <Th>Material</Th>
                    <Th numeric>Size</Th>
                    <Th numeric>Qty Needed</Th>
                    <Th>Order By</Th>
                    <Th>Status</Th>
                  </Tr>
                </THead>
```

Change each material row from:

```tsx
                    <Tr key={item.part_id}>
                      <Td>{item.material_name}</Td>
```

to:

```tsx
                    <Tr key={item.part_id}>
                      <Td numeric>
                        <input
                          type="checkbox"
                          checked={selectedPartIds.has(item.part_id)}
                          onChange={() => setSelectedPartIds(s => {
                            const next = new Set(s);
                            if (next.has(item.part_id)) next.delete(item.part_id); else next.add(item.part_id);
                            return next;
                          })}
                        />
                      </Td>
                      <Td>{item.material_name}</Td>
```

And change the empty-state colspan from `colSpan={5}` to `colSpan={6}` (one more column now).

Finally, add the "Raise PO" action bar right after the closing `</Table>` of the Materials card, still inside that `<Card>`:

```tsx
              {selectedPartIds.size > 0 && (
                <CardBody className="flex justify-end p-4">
                  <Button variant="primary" onClick={handleRaisePOFromSelection}>
                    Raise PO ({selectedPartIds.size} selected)
                  </Button>
                </CardBody>
              )}
```

- [ ] **Step 4: Manually verify in the browser**

With a MANAGEMENT-role login: go to **Browse by Project**, open a project, open a job with 2+ pending materials, check 2 of them, click **Raise PO (2 selected)**. Confirm:
1. You land on `/procurement/po` with the New PO form open and exactly 2 pre-filled lines matching the checked materials.
2. Submitting the PO succeeds.
3. Opening that PO's detail page and expanding its allocations shows 2 `Part ID` sub-rows (traceability display is added in Task 5 — for now just confirm the allocations exist).

- [ ] **Step 5: Commit**

```bash
git add "next-frontend/src/app/(main)/procurement/page.tsx"
git commit -m "feat: select materials in browse mode and raise a PO pre-filled from the selection"
```

---

## Task 5: Frontend — show project/job on the PO detail page

**Files:**
- Modify: `next-frontend/src/app/(main)/procurement/po/[id]/page.tsx` (`Allocation` interface lines 33-38, allocation sub-row JSX lines 373-386)

**Interfaces:**
- Consumes: `AllocationResponse.project_name`/`AllocationResponse.job_tag` from Task 1.

- [ ] **Step 1: Add the two fields to the `Allocation` type**

Replace:

```typescript
interface Allocation {
  id: number;
  part_id: number;
  allocated_qty: number;
  already_received: number;
}
```

with:

```typescript
interface Allocation {
  id: number;
  part_id: number;
  allocated_qty: number;
  already_received: number;
  project_name?: string | null;
  job_tag?: string | null;
}
```

- [ ] **Step 2: Render the trace info in the expanded allocation sub-row**

Replace:

```tsx
                    <Td colSpan={3} className="pl-8 text-sm text-ink-soft">
                      Part ID: <span className="font-data font-bold text-ink">{alloc.part_id}</span>
                    </Td>
```

with:

```tsx
                    <Td colSpan={3} className="pl-8 text-sm text-ink-soft">
                      Part ID: <span className="font-data font-bold text-ink">{alloc.part_id}</span>
                      {alloc.project_name && (
                        <span className="ml-2">
                          — <span className="font-semibold text-ink">{alloc.project_name}</span>
                          {alloc.job_tag && <span className="font-data text-ink-soft"> / {alloc.job_tag}</span>}
                        </span>
                      )}
                    </Td>
```

- [ ] **Step 3: Manually verify in the browser**

Open the PO created during Task 4's verification (or any PO whose lines have allocations — created via any prefilled flow from Task 2 or Task 4). On its detail page, expand a line's allocations. Confirm each `Part ID` sub-row also shows `— <Project Name> / <joint_type_code>` (e.g. `— BPCL-44 / DEJ-F`). For a PO created the old manual way (no `part_id`, empty `allocations`), confirm the line simply shows no expandable "N parts" button at all (unchanged from today) — no error, no blank trace text.

- [ ] **Step 4: Commit**

```bash
git add "next-frontend/src/app/(main)/procurement/po/[id]/page.tsx"
git commit -m "feat: show project/job traceability on PO allocation detail rows"
```

---

## Self-Review Notes

- **Spec coverage:** Section 1 (Browse Mode) → Task 3. Section 2 (Raise PO from selection) → Tasks 2 + 4. Section 3 (PO traceability) → Tasks 1 + 5. Section 4 (scope boundaries) — no task touches receiving, adds no tables, no vendor-ranking work. All covered.
- **Placeholder scan:** no TBD/TODO; every step has literal code or literal manual-check instructions.
- **Type consistency:** `MorningListItem` (Task 3) matches the real `get_morning_list()` dict keys exactly, verified against the live source in `backend/services/procurement_service.py`. The `prefill` payload shape (`part_id, material_name, size, joint_type, ordered_qty`) is identical across Task 2's `handleCreatePO`, Task 4's `handleRaisePOFromSelection`, and Task 2's `po/page.tsx` consumer — one shape, three call sites.
