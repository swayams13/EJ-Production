# CONTRACT2 — Split Shop Floor Entry tracking UI into 5 top-level tabs

**Scope:** Pure frontend reorganization of ONE file:
`/tmp/ej_repo2/next-frontend/src/app/(main)/production/entry/page.tsx`

**Goal:** Turn the current 4-tab layout (`Material`, `Fabrication` [which embeds an Assembly card], `Welding`, `FinalChecks`) into 5 SEPARATE top-level tabs, in this exact display order:

1. **Material Status**
2. **Fabrication**
3. **Assembly** — new dedicated tab; hosts the existing "Proposed Assembly Sequence" card, relocated verbatim out of Fabrication
4. **Welding & Grinding** (DJ-conditional label preserved: "Welding" for DJ)
5. **Final Checks**

The **Assembly** tab is **hidden entirely** (not rendered as an empty state) whenever `assemblySteps.length === 0` for the currently selected requirement. So the tab bar shows **4 tabs** for legacy / un-recategorized lines and **5 tabs** for tagged lines that have assembly data.

This is a **tab-layout reorganization ONLY**. Do NOT redesign the assembly card's content or behavior, do NOT change any process-bucketing logic, do NOT touch the backend.

---

## 0. Out of scope — leave EXACTLY as-is

- **The `isMaterialProcess` / `isWeldingProcess` regex helpers** (lines 94-95):
  ```ts
  const isWeldingProcess = (name: string) => /weld|grind|tig|mig/i.test(name);
  const isMaterialProcess = (name: string) => /^(PO|Material Received|Inward Insp)$/i.test(name);
  ```
  These already bucket process steps into Material vs. Fabrication vs. Welding, matching the workbook's "Per-Tag BOM & Process Spec" process routes (e.g. `Material Received → Cutting → Welding → DP test → Forming → Ready`; flanges add `PO → … → Inward Insp`). The user asked only for a tab-layout reorg, NOT a recategorization of which processes count as material/fabrication/welding. **Do not modify these regexes or any `.filter(...)` that uses them.** The Fabrication filter `!isWeldingProcess(...) && !isMaterialProcess(...)` and the Material filter `isMaterialProcess(...)` stay byte-for-byte identical; they just live inside renamed/relocated branches.

- **All backend / data fetching** — see §6. No backend changes.

- **The `handleUpdateAssemblyStep` function** (lines 216-231) already exists and is correct — do NOT touch it. The relocated Assembly card keeps calling it unchanged.

- **The Final Checks block** (lines 674-717) and its hardcoded `["testing", "painting", "weight", "marking", "packing"]` filter — unchanged.

---

## 1. `activeTab` union type + state (line 92)

### Current (line 92)
```ts
const [activeTab, setActiveTab] = useState<"Material" | "Fabrication" | "Welding" | "FinalChecks">("Material");
```

### New — insert `"Assembly"` between `"Fabrication"` and `"Welding"`
```ts
const [activeTab, setActiveTab] = useState<"Material" | "Fabrication" | "Assembly" | "Welding" | "FinalChecks">("Material");
```

The five string literals — `"Material"`, `"Fabrication"`, `"Assembly"`, `"Welding"`, `"FinalChecks"` — are the canonical internal tab keys used everywhere below. Initial value stays `"Material"`.

> Optional but recommended: extract a named type alias `type TabKey = "Material" | "Fabrication" | "Assembly" | "Welding" | "FinalChecks";` near the top of the component and use it for both the `useState` generic and the `visibleTabs` array typing in §3, so the filter in §3 keeps a precise element type. If you skip the alias, use `TabKey[]`-equivalent inline typing as shown in §3.

---

## 2. Tab-label mapping

The label lookup currently lives inside the `.map()` over the tab-key tuple, **lines 388-392**:

### Current (lines 388-392)
```ts
const label =
  tab === "Material" ? "Material Status" :
  tab === "Fabrication" ? "Fabrication & Assembly" :
  tab === "Welding" ? (currentReqType === "DJ" ? "Welding" : "Welding & Grinding") :
  "Final Checks";
```

### New — change the Fabrication label to plain `"Fabrication"` and add an `"Assembly"` case; preserve the Welding DJ-conditional EXACTLY
```ts
const label =
  tab === "Material" ? "Material Status" :
  tab === "Fabrication" ? "Fabrication" :
  tab === "Assembly" ? "Assembly" :
  tab === "Welding" ? (currentReqType === "DJ" ? "Welding" : "Welding & Grinding") :
  "Final Checks";
```

Exact required mapping (internal key → display label):

| Internal key   | Display label                                                        |
|----------------|---------------------------------------------------------------------|
| `"Material"`   | `Material Status`                                                    |
| `"Fabrication"`| `Fabrication`  *(was `Fabrication & Assembly` — the "& Assembly" is removed because Assembly is now its own tab)* |
| `"Assembly"`   | `Assembly`                                                           |
| `"Welding"`    | `currentReqType === "DJ" ? "Welding" : "Welding & Grinding"` *(preserve this exact conditional, do not simplify)* |
| `"FinalChecks"`| `Final Checks`                                                       |

The trailing `else` of the chain (`"Final Checks"`) still handles `"FinalChecks"` — leave it as the final fallthrough.

---

## 3. Dynamic VISIBLE tab list for the tab bar

The tab bar currently maps over a **fixed 4-element tuple**, **line 387**:

### Current (line 387, opening the `.map`)
```tsx
{(["Material", "Fabrication", "Welding", "FinalChecks"] as const).map((tab) => {
```
(the `.map` body runs lines 388-403; it closes at line 404 `})}`)

### New — compute `visibleTabs` and map over it
Introduce a `visibleTabs` value that lists all five keys in the required order and **drops `"Assembly"` when there are no assembly steps**. Define it just before the `return (` (alongside `currentReqType`, `PAINT_STATUS_OPTIONS`, etc., around lines 273-275), or inline it at the map site — either is acceptable; define-before-return is cleaner:

```ts
const visibleTabs = (
  ["Material", "Fabrication", "Assembly", "Welding", "FinalChecks"] as const
).filter((tab) => tab !== "Assembly" || assemblySteps.length > 0);
```

- Order is fixed as written: Material → Fabrication → Assembly → Welding → FinalChecks, which renders as the required Material Status, Fabrication, Assembly, Welding & Grinding, Final Checks.
- The filter keeps every non-Assembly tab always, and keeps `"Assembly"` only when `assemblySteps.length > 0`. Result: 4 tabs when `assemblySteps.length === 0`, 5 tabs otherwise.

> Typing note: `["...","..."] as const` gives a readonly tuple; `.filter` returns `("Material" | "Fabrication" | "Assembly" | "Welding" | "FinalChecks")[]`, which is exactly the `activeTab` union element type — so `setActiveTab(tab)` inside the map stays type-correct with no cast. If you extracted a `TabKey` alias in §1, `visibleTabs` is `TabKey[]`.

Then change line 387 to map over `visibleTabs`:
```tsx
{visibleTabs.map((tab) => {
```
Everything inside the map body (the `label` computation from §2, the `<button>` with `onClick={() => setActiveTab(tab)}` and the `activeTab === tab` active-styling) stays unchanged. The `key={tab}` stays.

---

## 4. Fallback when the active tab disappears from the visible list

**Problem being prevented:** user has `activeTab === "Assembly"` on a tagged line, then switches the Requirement dropdown to a legacy/un-recategorized line. `assemblySteps` becomes `[]`, the Assembly tab vanishes from `visibleTabs`, but `activeTab` still equals `"Assembly"` — every content branch's condition is false, so the content area renders blank.

**Fix:** add a `useEffect` that resets `activeTab` off `"Assembly"` onto a sane always-present tab (`"Fabrication"`) whenever Assembly is active but no longer valid. Add it near the other effects (e.g. immediately after the `useEffect` that fetches parts, which ends at line 144). Write exactly:

```ts
// If the active tab is "Assembly" but the current requirement has no assembly
// steps, that tab is hidden — fall back to a tab that is always present so the
// content area never renders blank.
useEffect(() => {
  if (activeTab === "Assembly" && assemblySteps.length === 0) {
    setActiveTab("Fabrication");
  }
}, [assemblySteps, activeTab]);
```

Notes:
- `assemblySteps` is the correct dependency: it is reset to `[]` in the early-return of the parts `useEffect` (line 121) and re-populated from `resData.data.assembly_steps` on fetch (line 131), so it changes on every requirement switch. Keying on it (plus `activeTab`) covers both "requirement changed to one without steps" and "steps became empty" cases and satisfies react-hooks/exhaustive-deps.
- Fall back to `"Fabrication"` (not `"Material"`) — Fabrication is always present and is the tab Assembly was formerly embedded in, so it is the least surprising landing spot. Any always-visible tab is acceptable, but use `"Fabrication"` for determinism.
- Do NOT gate this on `requirementId`; `assemblySteps` already reflects requirement changes and adding `requirementId` would be redundant (harmless if added, but unnecessary).

---

## 5. Restructure the content ternary into 5 explicit branches

### 5a. Current structure (map of what's where)

The tracking content is rendered by **one big ternary chain (lines 408-672)** followed by **one separate `&&` block for Final Checks (lines 674-717)**:

- **`activeTab === "Material" ? ( … )`** — lines **408-493**. Material grid. Leave content unchanged.
- **`: activeTab === "Fabrication" ? ( <> … </> )`** — lines **494-608**. A **fragment** wrapping TWO things:
  - the **parts grid** `<div className="grid …"> … </div>` — lines **496-580**,
  - the **embedded assembly card** — lines **581-607**, i.e.:
    ```tsx
    {assemblySteps.length > 0 && (
      <Card className="p-5">
        …Proposed Assembly Sequence…
      </Card>
    )}
    ```
    (opening `{assemblySteps.length > 0 && (` at line 581, `<Card …>` at 582, closes `</Card>` 606, `)}` at 607).
  - fragment open `<>` at line 495, fragment close `</>` at line 608.
- **`: ( … )`** — lines **609-672**. This is the ternary's bare `else` and currently renders the **Welding** grid (lines 610-671). ⚠️ Because it is an unguarded `else`, it renders for BOTH `"Welding"` AND `"FinalChecks"` — see 5c.
- **`{activeTab === "FinalChecks" && ( … )}`** — lines **674-717**. Separate expression, renders the Final Checks grid. Leave content unchanged.

### 5b. Target structure

Rewrite the chain so every tab has its OWN explicit branch, ending in a `: null` fallback, and keep the Final Checks `&&` block exactly as it is:

```tsx
{activeTab === "Material" ? (
  /* UNCHANGED — existing Material grid, current lines 409-493 */
) : activeTab === "Fabrication" ? (
  /* UNCHANGED parts grid ONLY — current lines 496-580.
     The <> … </> fragment wrapper (lines 495 & 608) is REMOVED,
     and the embedded assembly card (lines 581-607) is REMOVED from here. */
) : activeTab === "Assembly" ? (
  /* NEW branch — the "Proposed Assembly Sequence" Card, moved verbatim
     from the Fabrication fragment (current lines 582-606), content unchanged. */
) : activeTab === "Welding" ? (
  /* UNCHANGED Welding grid — current lines 610-671.
     Now guarded by an explicit activeTab === "Welding" test instead of
     being the bare else. */
) : null}

{activeTab === "FinalChecks" && (
  /* UNCHANGED — current lines 674-717 */
)}
```

### 5c. Exact edits, branch by branch

1. **Material branch (408-493):** no change to its body. It remains the first ternary arm.

2. **Fabrication branch (494-608):** keep ONLY the parts grid.
   - Delete the fragment open `<>` at **line 495**.
   - Keep the parts-grid `<div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3"> … </div>` (**lines 496-580**) exactly as-is — including its inner `part.processes.filter((proc) => !isWeldingProcess(proc.process_name) && !isMaterialProcess(proc.process_name))` logic and the "No Parts Found" empty state at lines 574-579. Do NOT alter these.
   - Delete the embedded assembly-card block (**lines 581-607**) from here — it moves to the new Assembly branch (see step 3).
   - Delete the fragment close `</>` at **line 608**.
   - Net: the Fabrication arm becomes `) : activeTab === "Fabrication" ? (` + the bare parts-grid `<div>…</div>` + `) :`. The fragment is no longer needed because the arm now returns a single element.

3. **NEW Assembly branch:** add `) : activeTab === "Assembly" ? (` and render the assembly card that was removed from Fabrication, **unchanged**. Move the card JSX from current **lines 582-606** verbatim:
   ```tsx
   ) : activeTab === "Assembly" ? (
     <Card className="p-5">
       <div className="mb-3 flex items-center gap-2">
         <h3 className="font-bold text-ink">Proposed Assembly Sequence</h3>
         <Badge tone="warning">Pending GM sign-off</Badge>
       </div>
       <div className="divide-y divide-line">
         {[...assemblySteps]
           .sort((a, b) => a.step_no - b.step_no)
           .map((step) => (
             <div key={step.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
               <div className="flex items-center gap-2">
                 <span className="font-bold text-ink">{step.step_no}. {step.label}</span>
                 <Badge tone={step.status === "ready" ? "success" : "neutral"}>{step.status}</Badge>
               </div>
               <Button
                 variant={step.status === "ready" ? "secondary" : "primary"}
                 disabled={submitting}
                 onClick={() => handleUpdateAssemblyStep(step.id, { status: step.status === "ready" ? "pending" : "ready", date_ready: new Date().toISOString().slice(0, 10) })}
               >
                 {step.status === "ready" ? "Mark Pending" : "Mark Ready"}
               </Button>
             </div>
           ))}
       </div>
     </Card>
   ) :
   ```
   - This is the SAME `<Card>` currently at lines 582-606 — do not restyle, re-title, or otherwise change it. Keep the `Badge tone="warning">Pending GM sign-off`, the `[...assemblySteps].sort(...)`, the per-step `handleUpdateAssemblyStep` toggle, all identical.
   - **Drop the `{assemblySteps.length > 0 && ( … )}` guard** that wrapped it at lines 581/607: it is now redundant because the Assembly tab (and hence `activeTab === "Assembly"`) can only be reached when `assemblySteps.length > 0` (guaranteed by the `visibleTabs` filter in §3 and the fallback effect in §4). Render the `<Card>` directly as the branch body. (Keeping the guard would also be functionally correct but is unnecessary dead-safety; prefer the clean direct render.)

4. **Welding branch (609-672):** change the bare `else` into an explicit branch.
   - Change **line 609** from `) : (` to `) : activeTab === "Welding" ? (`.
   - Keep the Welding grid body (**lines 610-671**) exactly as-is, including the `currentReqType === "DJ" ? ["MIG", "Grinding"] : ["TIG", "MIG", "Grinding"]` logic and the `isDJ && type === "MIG" ? "Welding" : type` display naming.
   - After the closing `)` of the Welding grid (**line 672** `)}`) becomes `) : null}` — i.e. the ternary chain now ends with `) : null}` instead of `)}`.
   - **Why explicit + `: null`:** currently the Welding grid is the unguarded `else`, so it renders for `"Welding"` AND `"FinalChecks"` (when `FinalChecks` is active, both the Welding grid from the `else` AND the separate Final Checks `&&` block render simultaneously — a latent double-render). Adding the Assembly branch does not fix this on its own, because a bare `else` would still catch both `"Welding"` and `"FinalChecks"`. Making Welding an explicit `activeTab === "Welding" ?` arm with a `: null` fallback confines Welding to its own tab and stops the Final Checks tab from also rendering Welding cards. This is required for the 5-tab layout to render one content pane per tab.

5. **Final Checks block (674-717):** leave the separate `{activeTab === "FinalChecks" && ( … )}` expression exactly as-is. It already correctly renders only when Final Checks is active; with the Welding branch now explicit (step 4) it is the sole content pane for that tab.

### 5d. Resulting branch → content map (verification)

| `activeTab`     | Visible in tab bar?                   | Content rendered                          |
|-----------------|---------------------------------------|-------------------------------------------|
| `"Material"`    | always                                | Material grid (unchanged, 409-493)        |
| `"Fabrication"` | always                                | Parts grid ONLY (unchanged, 496-580)      |
| `"Assembly"`    | only when `assemblySteps.length > 0`  | Proposed Assembly Sequence card (moved 582-606) |
| `"Welding"`     | always                                | Welding grid (unchanged, 610-671)         |
| `"FinalChecks"` | always                                | Final Checks grid (unchanged, 674-717)    |

No tab ever renders a blank pane (fallback effect §4 guarantees `activeTab` is always in `visibleTabs`), and no tab renders two panes (explicit Welding branch, step 4).

---

## 6. No backend changes

This is a pure frontend reorganization. Confirmed by reading the fetch effect (lines 114-144): `assembly_steps`, `parts`, and `final_checks` are already fetched together from `GET /production/parts/{requirementId}` and set into state (`setAssemblySteps(resData.data.assembly_steps || [])` at line 131, `setParts` at 129, `setFinalChecks` at 130). The `PUT /production/assembly-steps/{id}` endpoint and its `handleUpdateAssemblyStep` handler (lines 216-231) already exist and are unchanged. Nothing in `backend/` needs to change: no new endpoint, no schema change, no migration. The reorg only moves already-fetched state between JSX branches and recomputes which tab buttons render.

---

## 7. Implementation checklist

- [ ] Line 92: add `"Assembly"` to the `activeTab` union (between `"Fabrication"` and `"Welding"`).
- [ ] Lines 388-392: change Fabrication label `"Fabrication & Assembly"` → `"Fabrication"`; add `tab === "Assembly" ? "Assembly" :` case; preserve Welding DJ-conditional verbatim.
- [ ] Line 387: replace the fixed `["Material","Fabrication","Welding","FinalChecks"] as const` map source with `visibleTabs.map(...)`; define `visibleTabs` (5 keys in order, `.filter((tab) => tab !== "Assembly" || assemblySteps.length > 0)`).
- [ ] After line 144: add the fallback `useEffect` (resets `activeTab` off `"Assembly"` to `"Fabrication"` when `assemblySteps.length === 0`), deps `[assemblySteps, activeTab]`.
- [ ] Fabrication branch (494-608): remove `<>`/`</>` (495, 608) and the embedded assembly card (581-607); keep only the parts grid (496-580).
- [ ] Add `) : activeTab === "Assembly" ? (` branch rendering the moved card (verbatim from 582-606), without the `assemblySteps.length > 0 &&` guard.
- [ ] Welding: change line 609 `) : (` → `) : activeTab === "Welding" ? (`; change the ternary's closing `)}` (line 672) → `) : null}`.
- [ ] Do NOT touch: `isMaterialProcess`/`isWeldingProcess` regexes (94-95), any process `.filter`, the Final Checks block (674-717), `handleUpdateAssemblyStep` (216-231), any backend.
- [ ] Run `npm --prefix next-frontend run build` and `npm --prefix next-frontend run lint`; resolve any TS/exhaustive-deps issues.
