
# Procurement Module Design Spec
**Date:** 2026-07-15  
**Status:** Approved — ready for implementation planning  
**Replaces:** `/inventory` page and `RawMaterialInventory` table

---

## Overview

A full enterprise-grade procurement module for the Purchase Manager (PM). Replaces the existing Material Intelligence page with a smart, priority-driven purchasing dashboard. Core goals:

1. PM sees a color-coded morning action list of what to order today, ranked by composite priority score
2. Full PO lifecycle tracking: draft → raised → sent → partially received → received → cancelled
3. Material receipt entry auto-syncs to shop floor `PartProcess("Material Received")` — no double entry
4. Warehouse buffer stock tracked with reservation logic
5. Vendor master with delivery history feeding a variance penalty score over time

---

## Section 1: Data Model

### New tables (8)

#### `Vendor`
```
id, name, contact_person, phone, email, gstin, payment_terms, notes
```

#### `PurchaseOrder` (PO header)
```
id
po_number         String, unique
vendor_id         FK → Vendor
po_date           Date
expected_delivery_date  Date
status            String: draft | raised | sent | partially_received | received | cancelled
raised_by         FK → User
total_value       Float (nullable)
delay_reason      Text (nullable)
notes             Text (nullable)
created_at        DateTime
updated_at        DateTime
```

#### `PurchaseOrderLine` (one row per material type per PO)
```
id
purchase_order_id  FK → PurchaseOrder
material_name      String   (e.g. "Flange", "Bolts, Nuts")
size               Integer  (NB size)
joint_type         String   (EJ | DJ)
ordered_qty        Integer
unit_price         Float (nullable)
received_qty       Integer, default 0   (aggregate; updated on each GoodsReceipt)
status             String: pending | partially_received | received
```

#### `PurchaseOrderLineAllocation` (maps PO line to Part rows it covers)
```
id
po_line_id    FK → PurchaseOrderLine
part_id       FK → Part
allocated_qty Integer
```

#### `GoodsReceipt` (each physical delivery event)
```
id
purchase_order_id  FK → PurchaseOrder
receipt_date       Date
received_by        FK → User
notes              Text (nullable)
created_at         DateTime
```

#### `GoodsReceiptLine` (per material per delivery)
```
id
receipt_id    FK → GoodsReceipt
po_line_id    FK → PurchaseOrderLine
qty_received  Integer
```

#### `WarehouseStock` (replaces `RawMaterialInventory`)
```
id
material_name     String
size              Integer
joint_type        String
qty_on_hand       Integer, default 0
reserved_qty      Integer, default 0     (committed to projects, not yet on floor)
minimum_stock     Integer, default 0
updated_at        DateTime
UNIQUE (material_name, size, joint_type)
```

#### `MaterialLeadTime` (configurable per material type)
```
id
material_name    String, unique
lead_time_days   Integer

Default seed values:
  Element: 5        Collar: 5         Weldend: 5
  Spool: 5          Flange: 7         Matching Flanges: 7
  Liner: 4          Lug: 4            Limit rod: 5
  Bolts, Nuts: 3    Gaskets: 4        Pipe-1: 5
  Pipe-2: 5         Stopper Patti: 5  Pipe-1 flange: 7
  Pipe-2 flange: 7  Stopper flange: 7 O-ring: 5
  Studs Long: 4     Studs Short: 4    Box Packing: 3
```

### Project model additions (4 new fields)
```python
priority                 = Column(String, default="P2")        # P1 | P2 | P3
order_value              = Column(Float, nullable=True)         # quotation value ₹
advance_received         = Column(Float, default=0.0)          # % advance paid by client
committed_dispatch_date  = Column(Date, nullable=True)         # client-committed date
```

### Dropped table
`RawMaterialInventory` — data migrated to `WarehouseStock` on first startup (one-time migration: map existing rows, set `reserved_qty = 0`).

---

## Section 2: Business Logic

### 2.1 Order-by date
```
order_by_date = project.target_date - MaterialLeadTime[material_name] days
```
If `committed_dispatch_date` is set and earlier than `target_date`, use that instead.

### 2.2 Coverage check (run per Part requirement)
```
remaining_needed     = part.total_qty - PartProcess("Material Received").completed_qty
already_on_open_po   = SUM(PurchaseOrderLineAllocation.allocated_qty)
                       WHERE po.status NOT IN (cancelled, received)
uncovered_qty        = remaining_needed - already_on_open_po

available_from_stock = max(0, WarehouseStock.qty_on_hand - WarehouseStock.reserved_qty)
                       for (material_name, size, joint_type)
still_needs_ordering = max(0, uncovered_qty - available_from_stock)

If still_needs_ordering == 0 → skip from morning list (fully covered)
```

### 2.3 Composite priority score
```
priority_score =
  tier_weight                 P1=1000 | P2=600 | P3=300
+ active_bonus                Active=200, Planning=0
+ deadline_urgency            max(0, 30 − days_to_target_date) × 5
+ dispatch_urgency            max(0, 20 − days_to_committed_dispatch) × 6   [if set]
+ overdue_penalty             days_past_order_by_date × 15
+ completion_factor           production_pct_complete × 30
+ remaining_feet_factor       (1 − remaining_feet / total_feet) × 20
+ value_factor                (order_value / avg_order_value_all_projects) × 20
+ qty_factor                  (1 / total_joints_on_project) × 100
+ advance_factor              advance_received_pct × 0.15
+ repeat_client_bonus         client appears in >1 project → +50
+ vendor_variance_penalty     avg_vendor_days_late × −8   [0 until receipt history exists]
− stock_relief                fully covered by stock → −9999 (removes from list)
− hold_penalty                project on non-material hold → −9999 (removes from list)
```

Higher score = higher urgency. Kill switches (`−9999`) remove items entirely.

### 2.4 Morning list buckets
```
RED    (Critical)  → score triggers: days_past_order_by_date ≥ 0
                     OR (P1 project AND days_to_order_by_date ≤ 2)
ORANGE (Urgent)    → days_to_order_by_date 1–3
                     OR (P1 project AND days_to_order_by_date ≤ 5)
GREEN  (Planned)   → days_to_order_by_date 4–7

Beyond 7 days → not shown in morning list; visible in full PO list only.
Within each bucket: sorted by priority_score DESC.
```

### 2.5 Red item accountability
If a RED item has no PO and no `delay_reason` by end of business:
- Item stays solid red, badge shows hours overdue
- PM must log a `delay_reason` (one-field modal) — moves item to "Delayed with Reason" amber sub-section
- Unlogged + overdue stays full red until actioned or PO is created

### 2.6 PO lifecycle
```
draft → raised → sent → partially_received → received
              ↘
           cancelled  (allowed from any state except received)
```
- On `raised`: update `PartProcess("PO").status = "ready"`, set `po_number`
- On `cancelled`: allocated `reserved_qty` on `WarehouseStock` is released; uncovered parts re-appear in morning list

### 2.7 Goods receipt sync (critical path)
On `GoodsReceiptLine` save:
1. Update `PurchaseOrderLine.received_qty` = sum of all receipts for that line
2. For each `PurchaseOrderLineAllocation` on that line:
   - Find `PartProcess(process_name="Material Received")` for `allocation.part_id`
   - Allocations are fulfilled FIFO by `PurchaseOrderLineAllocation.id` (insertion order)
   - Fill first allocation fully before moving to next: `remaining = qty_received`; for each allocation in order → `fill = min(remaining, allocation.allocated_qty - already_received_for_this_allocation)`; `completed_qty += fill`; `remaining -= fill`; stop when `remaining == 0`
3. If vendor PO (not warehouse allocation): `WarehouseStock.qty_on_hand += qty_received` then `qty_on_hand -= qty` as material moves to floor
4. Update `PurchaseOrderLine.status` → `partially_received` or `received`
5. Update `PurchaseOrder.status` accordingly

### 2.8 Warehouse stock flow
- PO allocation from stock: `reserved_qty += allocated_qty`
- GoodsReceipt from vendor: `qty_on_hand += qty_received`
- Sync to shop floor: `qty_on_hand -= qty` (material leaves warehouse)
- PO cancelled: `reserved_qty -= allocated_qty`

### 2.9 Vendor lead time variance (self-populating)
```
avg_days_late = AVG(final_receipt_date − PurchaseOrder.expected_delivery_date)
                per vendor, rolling last 10 POs (use date of last GoodsReceipt per PO as final_receipt_date)
                positive = late, negative = early
```
Computed at query time. Defaults to 0 if fewer than 3 completed POs exist for that vendor.

---

## Section 3: UI Structure

### Sidebar
`Material Intelligence → /inventory` removed. Replaced with:
```
Procurement
  ├── Dashboard        /procurement
  ├── Purchase Orders  /procurement/po
  ├── Vendors          /procurement/vendors
  ├── Warehouse Stock  /procurement/stock
  └── Settings         /procurement/settings
```

### `/procurement` — Morning Dashboard

**Stats bar:** X Order Today | X Delayed | X Upcoming | X Low Stock Alerts

**🔴 CRITICAL — Order Today, No Exceptions**
- Columns: Project | Deadline | Days Left | Material | Size | Qty Needed | Action
- Actions: `[Create PO]` (pre-fills material + project) | `[Allocate from Stock]` (if stock available)
- Footer: `[Log Reason]` button for any item not actioned — mandatory before item leaves red

**Delayed with Reason** (amber sub-section within red block)
- Items that have a `delay_reason` logged but still no PO
- Shows reason text, logged timestamp

**🟠 URGENT — Order Within 3 Days**
- Same columns + "Order By" date column

**🟢 PLANNED — Upcoming This Week**
- Same columns + "Order By" date column

Clicking `[Create PO]` → opens new PO form pre-filled with material, size, joint type, project allocation. PM adds vendor + PO number and saves.

### `/procurement/po` — PO List
Table: PO Number | Vendor | Date | Status badge | Total Value | Actions  
Filter: status, vendor, date range  
`+ New PO` creates from scratch.

### `/procurement/po/[id]` — PO Detail
- Header: PO number, vendor, dates, status, raised by, total value
- Line items table: material / size / joint type / ordered qty / received qty / unit price / status
- Per line: expandable allocation row → which projects + parts covered
- `Log Receipt` button → inline form: receipt date, per-line qty received → triggers sync
- Receipt history at bottom: date, received by, qty per line

### `/procurement/vendors` — Vendor Master
CRUD table: name / contact / phone / GSTIN / payment terms / avg delivery days (computed)  
`+ Add Vendor` inline form.

### `/procurement/stock` — Warehouse Stock
Table: material / size / joint type / on hand / reserved / available / minimum / health badge  
Health badge: Low (on_hand < minimum) | Healthy  
`+ Adjust Stock` → manual correction with reason logged.

### `/procurement/settings` — Lead Times
Inline-editable table: material name → lead_time_days  
Pre-seeded with defaults on first run. PM can update at any time.

---

## Section 4: API Endpoints

### Procurement Dashboard
```
GET  /api/v1/procurement/morning-list   → priority-scored list, bucketed RED/ORANGE/GREEN
```

### Purchase Orders
```
GET    /api/v1/procurement/po                → list with filters
POST   /api/v1/procurement/po                → create PO (draft)
GET    /api/v1/procurement/po/{id}           → detail with lines + allocations + receipts
PATCH  /api/v1/procurement/po/{id}/status    → advance status (raised/sent/cancelled)
POST   /api/v1/procurement/po/{id}/receipt   → log GoodsReceipt → triggers shop floor sync
```

### PO Lines & Allocations
```
POST   /api/v1/procurement/po/{id}/lines                  → add line item
PATCH  /api/v1/procurement/po/{id}/lines/{line_id}        → update line
POST   /api/v1/procurement/po/{id}/lines/{line_id}/allocate → allocate line to Part(s)
```

### Vendors
```
GET    /api/v1/procurement/vendors
POST   /api/v1/procurement/vendors
PATCH  /api/v1/procurement/vendors/{id}
DELETE /api/v1/procurement/vendors/{id}
```

### Warehouse Stock
```
GET    /api/v1/procurement/stock
POST   /api/v1/procurement/stock/adjust   → manual correction with reason
```

### Settings
```
GET    /api/v1/procurement/lead-times
PATCH  /api/v1/procurement/lead-times/{material_name}
```

### Delay reason
```
POST   /api/v1/procurement/delay-reason   → {part_id, reason} — logs on draft PO
```

---

## Section 5: RBAC

| Action | Roles |
|--------|-------|
| View morning list, PO list, stock | Supervisor + Management |
| Create/edit PO, log receipts, manage vendors | Management only |
| Adjust stock | Management only |
| Edit lead times | Management only |
| Log delay reason | Management only |

---

## Section 6: Migration

On first startup after deployment:
1. Create all 8 new tables
2. Migrate `RawMaterialInventory` rows → `WarehouseStock` (set `reserved_qty = 0`)
3. Drop `RawMaterialInventory` table
4. Seed `MaterialLeadTime` table with defaults
5. Add 4 new columns to `Project` table (nullable / defaulted — zero-downtime)
6. Remove `/inventory` route from sidebar and backend router registration

---

## Out of Scope (v1)

- Seasonal client shutdown calendars
- PO document PDF generation (add later)
- Invoice / payment reconciliation (belongs in Tally)
- Multi-approver PO workflow
