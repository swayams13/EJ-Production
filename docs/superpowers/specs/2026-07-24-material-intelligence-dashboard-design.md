# Material Intelligence Dashboard — Design Spec
**Date:** 2026-07-24
**Phase:** 7 — Material Intelligence Engine
**Status:** Approved — ready for implementation planning

---

## Problem

The PM has three blind spots today:
1. Can only see what's already blocked — no forward visibility into next week's demand
2. Can't tell if current stock will last until the next PO arrives (lead time vs. demand)
3. Can't tell which projects get hit first when stock runs low

The procurement morning list is reactive. This dashboard is proactive.

---

## Solution

A new page at `/dashboard/materials` — one row per `(material_name, size, joint_type)` — that answers all three questions at a glance using data already in the DB. No new tables required.

---

## Section 1: Data & Computation Model

### Demand source

For each `(material_name, size, joint_type)` spec, **total demand** = sum of `(Part.total_qty - PartProcess.completed_qty)` for the `"Material Received"` process step, across all projects where `status != "Completed"` (Active + Hold + Planning).

- If `completed_qty == total_qty`: material fully received, part excluded from demand.
- If a `Part` has no `"Material Received"` `PartProcess` row at all: full `total_qty` is demanded.

`Part.name` maps to `material_name`; `Part` is linked to `ProjectProductionLine` which carries `size` and `joint_type`.

### Supply sources

- **Available stock:** `WarehouseStock.qty_on_hand - WarehouseStock.reserved_qty`
- **Incoming supply:** Sum of `(PurchaseOrderLine.ordered_qty - PurchaseOrderLine.received_qty)` for all open PO lines (status ≠ `received`/`cancelled`) grouped by `(material_name, size, joint_type)`. Earliest `PurchaseOrder.expected_delivery_date` across matching lines = `expected_delivery_date`.

### Coverage formula

```
available_stock  = qty_on_hand - reserved_qty
incoming_qty     = sum of open PO remaining qty
total_demand     = sum of unmet Part quantities from active projects
net_gap          = total_demand - available_stock - incoming_qty
```

Positive `net_gap` = shortage. Zero or negative = covered.

### Traffic light

| Status | Condition |
|--------|-----------|
| 🔴 Red (Short) | `net_gap > 0` — stock + open POs cannot cover demand |
| 🟡 Amber (Low buffer) | `net_gap ≤ 0` but `available_stock < minimum_stock` |
| 🟢 Green (OK) | `net_gap ≤ 0` and `available_stock ≥ minimum_stock` |

Materials with unmet demand but **no `WarehouseStock` row** are treated as Red (zero stock known).

### Project impact list

Each material row includes a `projects` array: `{id, name, qty_needed, delivery_date}` — all projects that need this material (unmet demand), sorted by `delivery_date` ascending. PM sees which project gets hit first.

---

## Section 2: API

**One new endpoint** added to `backend/app/dashboard/router.py` (existing file):

```
GET /api/v1/dashboard/materials
Auth: SUPERVISORS+ (same as other dashboard endpoints)
```

**Response:** Array of material rows.

```json
[
  {
    "material_name": "Element",
    "size": 200,
    "joint_type": "EJ",
    "qty_on_hand": 5,
    "reserved_qty": 2,
    "minimum_stock": 10,
    "incoming_qty": 8,
    "expected_delivery_date": "2026-07-30",
    "total_demand": 18,
    "net_gap": 7,
    "status": "red",
    "projects": [
      { "id": 12, "name": "BPCL-44", "qty_needed": 6, "delivery_date": "2026-08-05" },
      { "id": 9,  "name": "HPCL-12", "qty_needed": 12, "delivery_date": "2026-08-18" }
    ]
  }
]
```

**Implementation — 3 bulk pre-fetches, no N+1:**

1. All `WarehouseStock` rows → dict keyed by `(material_name, size, joint_type)`
2. All open `PurchaseOrderLine` rows (joined to parent PO for `expected_delivery_date`) → group by spec, accumulate `remaining_qty` and `min(expected_delivery_date)`
3. All `Part` rows from active projects where `"Material Received"` process not complete — joined to `Project` for `name` and `delivery_date` — group by spec, accumulate demand and build project list

Then one pass over the union of all specs: compute `net_gap`, assign status, sort (red → amber → green, then by `net_gap` descending within each group).

---

## Section 3: UI

**New page:** `next-frontend/src/app/(main)/dashboard/materials/page.tsx`

### Layout

```
┌─ Material Intelligence ─────────────────────────────[Filter: All ▾]─┐
│  3 at risk    5 low stock    12 healthy                              │
├──────────────────────────────────────────────────────────────────────┤
│ Material    Size  Type │ Stock │ Incoming │ Demand │ Gap  │ Status   │
│─────────────────────────┼───────┼──────────┼────────┼──────┼────────│
│ Element     200   EJ   │   3   │    8     │   18   │  +7  │ 🔴 Short│
│   └ BPCL-44 · needs 6 · due Aug 5                                   │
│   └ HPCL-12 · needs 12 · due Aug 18                                 │
│ Collar      150   DJ   │  12   │    0     │    8   │   0  │ 🟡 Low  │
│   └ IOC-03  · needs 8  · due Aug 22                                 │
│ Flange      100   EJ   │  20   │    5     │   10   │   0  │ 🟢 OK   │
└──────────────────────────────────────────────────────────────────────┘
```

### Behaviour

- **Sort order:** Red → Amber → Green. Within Red, highest `net_gap` first.
- **Auto-expand:** Red and Amber rows show project list inline (no click needed). Green rows collapsed.
- **Filter chips:** All / At Risk / Low Stock — client-side filter on the loaded data.
- **Gap column:** Positive gap shown in red text with `+` prefix. Zero shown as `—`.
- **Summary bar:** Three counters at top (at risk / low stock / healthy) update with filter.
- **Link to procurement:** Each red row has a small "Order →" link that navigates to `/procurement` — PM can act immediately.
- **Empty state:** If no materials have unmet demand, show `EmptyState` ("All materials fully covered").

### Components

No new components. Uses existing: `Card`, `CardHeader`, `CardBody`, `Table`, `THead`, `TBody`, `Tr`, `Th`, `Td`, `Badge`, `Spinner`, `Alert` from `next-frontend/src/components/ui/`.

### Nav

Add "Materials" entry to the dashboard sidebar/nav after "Holds" — consistent with other dashboard sub-pages ordering.

---

## Section 4: Scope Boundaries

**In scope:**
- `/dashboard/materials` page
- `GET /api/v1/dashboard/materials` endpoint
- Nav link in dashboard section

**Out of scope (future phases):**
- Auto-draft POs when stock goes red (Phase 8+)
- Consumption rate learning from history (not needed — demand is known from project pipeline)
- Email/push alerts when status goes red (Phase 13: Notification Engine)
- Morning list filter pre-fill via URL param (nice-to-have, add if trivial during implementation)

---

## Section 5: Files Touched

| File | Change |
|------|--------|
| `backend/app/dashboard/router.py` | Add `GET /dashboard/materials` route |
| `next-frontend/src/app/(main)/dashboard/materials/page.tsx` | New page |
| `next-frontend/src/components/ui/nav` or layout file | Add "Materials" nav link |

No schema changes. No new DB tables. No new backend modules.
