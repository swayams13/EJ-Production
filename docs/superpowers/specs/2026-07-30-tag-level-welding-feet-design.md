# Tag-level welding feet (TIG / MIG / Grinding) — Design

## Background

The GM handed over 4 Excel reference files, one per joint tag, each deriving TIG feet,
MIG feet, and Grinding sq.ft per pipe size (50mm–3000mm) from real pipe dimensions via
live formulas:

- `Feet - S-EJ-F.xlsx` — Simple EJ, no lugs (flange end only)
- `Feet - S-EJ-F-S-L.xlsx` — Simple EJ, flange end + lugs/limit rods
- `Feet - U-EJ-F-S-L.xlsx` — Universal EJ (2 bellows elements), flange end + lugs/limit rods
- `Feet - DEJ-F.xlsx` — Dismantling Joint, flange end (3-pipe construction, MIG+Grinding only, no TIG)

These 4 filenames are exact matches to 4 of the 12 `tag_no` values already defined in
`backend/services/joint_catalog.py`. That catalog is the single source of truth for the
Joint → Type(tag) → BOM hierarchy; every tag lists its exact welded/bolted components.

### The problem this fixes

Today, `WeldingMaster` (`backend/services/db_service.py`) is keyed only by
`(size, joint_type)` where `joint_type` is the coarse weld family — `"EJ"` or `"DJ"`.
Per `docs/EJ_DJ_CALCULATION_LOGIC.md`, this was a deliberate simplification: "Simple and
Universal expansion joints both use the EJ welding master (same feet per size)." The
GM's files disprove that assumption at the data level — at size 50mm, total welding feet
across the 3 EJ tags we now have real data for range from 5.30 ft (no-lug) to 14.73 ft
(Universal), a difference the app currently collapses to one number.

Additionally, the current app's "MIG feet" corresponds to the circumferential TIG-weld
term in the GM's sheets, not the flange/lug MIG welding the new files define — and DJ
grinding in `DEJ-F.xlsx` runs up to ~12x higher than today's generic DJ master at some
sizes. Per user decision, the GM's files are the trusted source of truth for the 4 tags
they cover; the app adopts those numbers as-is, including where they redefine what MIG
and DJ-grinding mean.

### Why 4 files can cover 10 of the 12 catalog tags

`joint_catalog.py`'s component lists show that the "1MF"/"2MF" ("Matching Flange")
variants of a tag differ from their base tag *only* by adding a bolted-on Matching
Flange (`Matching Flanges` + `Bolts, Nuts` + `Gaskets` — a bolted joint, not a weld). No
welded component changes. So:

| Base tag (has GM data) | Aliased "MF" variants (no new welding) |
|---|---|
| `S-EJ-F-S-L` | `S-EJ-F-1MF-S-L`, `S-EJ-F-2MF-S-L` |
| `U-EJ-F-S-L` | `U-EJ-F-1MF-S-L`, `U-EJ-F-2MF-S-L` |
| `DEJ-F` | `DEJ-F-1MF`, `DEJ-F-2MF` |

Combined with the 4 tags with direct GM data (`S-EJ-F`, `S-EJ-F-S-L`, `U-EJ-F-S-L`,
`DEJ-F`), that's **10 of 12 tags** covered with high confidence, with zero new welding
data required for the 6 aliased tags.

The remaining 2 tags — `S-EJ-W-S-L` and `U-EJ-W-S-L` (Weldend variants: no `Flange`
component at all, direct weld to customer pipe) — are structurally different (their BOM
drops `Flange` entirely) and are **out of scope for this change**. They keep using
today's generic `(size, joint_type)` fallback until the GM supplies exact data for them.

### Known data gaps (also handled by fallback, not blocking this work)

- Size 125mm is absent from all 4 GM files (today's generic table does have it).
- `S-EJ-F.xlsx` only covers 50mm–1500mm; blank above that (the other 3 files cover the
  full 50–3000mm range).

Both gaps are resolved by the same fallback rule described below — no special-casing.

## Non-goals

- Not resolving the 2 Weldend-variant tags now (waiting on GM data).
- Not backfilling size 125 or the S-EJ-F 1600–3000mm gap with estimated numbers — they
  fall back to the generic master until real data is entered (by GM/PM) or supplied.
- Not changing `compute_master_feet`'s DJ TIG-folding safety net, `aggregate_line_feet`,
  or any scheduling/resource-requirement logic downstream of `ProjectProductionLine`
  feet columns — this change only affects which `WeldingMaster` row gets selected at
  sync time; everything downstream keeps consuming `tig_feet`/`mig_feet`/`grinding_feet`
  exactly as it does today.
- Not adding a version-history mechanism for tag-specific rows (see Data Model).

## Design

### 1. Data model

Add a nullable `tag_no` column to the existing `WeldingMaster` table
(`backend/services/db_service.py`), via the same idempotent `ALTER TABLE ADD COLUMN`
pattern already used in `init_db()` for prior schema additions (Session 36 precedent).

```python
class WeldingMaster(Base):
    __tablename__ = "welding_master"
    ...
    tag_no = Column(String, nullable=True, index=True)   # NEW
```

- Existing rows are untouched: `tag_no` stays `NULL`, meaning "generic weld-family data"
  — exactly what they are today. All current query paths that don't know about `tag_no`
  keep working unmodified.
- New tag-specific rows get `tag_no` set to one of the 4 canonical tags
  (`S-EJ-F`, `S-EJ-F-S-L`, `U-EJ-F-S-L`, `DEJ-F`).
- Tag-specific rows are **not** part of the existing version-history mechanism (the
  `version` column and `get_welding_master_latest()`'s per-joint_type "latest version"
  grouping). That mechanism exists for whole-file bulk re-imports of the generic master;
  tag-specific data is maintained by direct, single-row upserts (seed import + PM/GM
  frontend edits), so there is always exactly one row per `(tag_no, size)` pair, updated
  in place. This means tag-specific data has no historical-version audit trail in v1 —
  `updated_at` on the row is the only record of "last changed." Acceptable trade-off: the
  legacy generic table's version history remains fully intact for the 2 unresolved tags
  and any future full-file re-imports; only the new tag-specific slice forgoes it.
- No new DB-level uniqueness constraint on `(tag_no, size)` — enforced at the application
  layer via upsert-by-query (query for existing `(tag_no, size)` row, update if found,
  insert if not), consistent with this codebase's existing light-constraint style.

### 2. MF-alias resolution

Add to `backend/services/joint_catalog.py`:

```python
WELD_TAG_ALIAS = {
    "S-EJ-F-1MF-S-L": "S-EJ-F-S-L",
    "S-EJ-F-2MF-S-L": "S-EJ-F-S-L",
    "U-EJ-F-1MF-S-L": "U-EJ-F-S-L",
    "U-EJ-F-2MF-S-L": "U-EJ-F-S-L",
    "DEJ-F-1MF": "DEJ-F",
    "DEJ-F-2MF": "DEJ-F",
}

def canonical_weld_tag(tag_no):
    """Resolve a tag to the tag whose WeldingMaster row it should use.
    MF variants alias to their base tag (same welded joint, bolted-on
    Matching Flange only). Unaliased tags (including the 2 not-yet-seeded
    Weldend variants) resolve to themselves."""
    return WELD_TAG_ALIAS.get(tag_no, tag_no)
```

Aliased tags never get their own `WeldingMaster` row — resolved at lookup time, so a
future correction to `S-EJ-F-S-L`'s numbers automatically applies to its 2 MF variants
too, with nothing to keep in sync.

### 3. Seed import

A one-off script (e.g. `scripts/import_tag_welding_master.py`, run manually once, not
wired into `init_db()` or app startup) reads each of the 4 GM files' final TIG-feet /
MIG-feet / Grinding-sqft columns and upserts one row per size into `WeldingMaster` with
`tag_no` set to that file's tag and `joint_type` set to the tag's `weld_family` (via
`joint_catalog.weld_family_for(tag_no)`, for consistency with the generic rows' column).
`DEJ-F.xlsx`'s output columns are confirmed (`R` = Feet/Size → `mig_feet`, `tig_feet`
fixed at 0 per the DJ no-TIG rule, `S` = Grinding → `grinding_feet`); the exact output
columns for the 3 EJ-family files (`S-EJ-F.xlsx`, `S-EJ-F-S-L.xlsx`, `U-EJ-F-S-L.xlsx`)
are pinned during implementation by opening each file with formulas visible, the same
way the initial analysis was done — their column layout differs per file (up to column
`AC`) but each file's final TIG-feet/MIG-feet/Grinding-sqft columns are unambiguous once
opened.

Upsert semantics: for each `(tag_no, size)`, update the existing row if present, insert
if not — re-running the script (e.g. after a corrected file from the GM) is safe and
idempotent, matching this codebase's existing idempotent-migration conventions.

This script is intentionally separate from `_import_ej_master_dataframe` /
`_import_dj_master_dataframe` (the existing versioned bulk-upload code path used by
`/master/welding-import` and `/master/dj-import`) — those exist for whole-file
"replace the generic master" workflows; this is a distinct, smaller, tag-scoped import
that doesn't participate in that versioning.

### 4. Lookup / fallback

`sync_project_production_lines` (`backend/services/production_service.py`) changes its
master lookup from weld-family-only to tag-aware with fallback:

```python
canonical = joint_catalog.canonical_weld_tag(tag) if tag else None
m = master_data.get((size, canonical)) if canonical else None   # tag-specific row
if not m:
    m = master_data.get((size, weld_family))                    # existing generic fallback
    if not m and weld_family == 'DJ':
        m = master_data.get((size, 'EJ'))                       # existing DJ→EJ same-size fallback, unchanged
```

`master_data` becomes a dict keyed by `(size, tag_no_or_weld_family)`, built from both
tag-specific rows (`tag_no` set) and generic rows (`tag_no` NULL, keyed by their
`joint_type`) — i.e. `get_welding_master_latest()` (or a sibling function) needs to also
return the tag-specific rows alongside the existing generic "latest version" set.

This single fallback rule transparently covers all three gap cases from the Background
section — missing size 125, the S-EJ-F 1600–3000mm gap, and the 2 unresolved Weldend
tags — with no special-casing: absence of a tag-specific row for a given `(tag, size)`
always means "use the generic number for now," which is exactly today's behavior for
every tag.

`auto_sync_all_projects_with_master()` (`backend/app/master/router.py`) gets the same
tag-aware lookup change, since it re-syncs feet for existing lines the same way.

`compute_master_feet` and `aggregate_line_feet` are unchanged — they already operate on
whatever `WeldingMaster` row they're handed, regardless of whether it's tag-specific or
generic.

### 5. Frontend entry (PM/GM fills a gap)

Extend the existing "Custom Size" flow, which already lets a PM type in TIG/MIG/Grinding
feet for a size missing from the master, from the project add/edit pages
(`next-frontend/src/app/(main)/projects/add/page.tsx`,
`next-frontend/src/app/(main)/projects/edit/page.tsx`) via `POST /api/v1/master/welding-size`:

- `WeldingSizeCreate` schema (`backend/app/master/schemas.py`) gets an optional
  `tag_no: str | None` field.
- `create_custom_welding_size` (`backend/app/master/router.py`) — when `tag_no` is
  provided, upsert into the tag-specific `(tag_no, size)` slot (insert-or-update, no
  `version` bump — see Data Model) instead of appending to the generic versioned
  lineage; when omitted, behavior is identical to today (generic row, existing
  versioning).
- Frontend: the Custom Size modal already knows the current row's `joint_type_code`
  (tag) from `bellows[index].joint_type_code` — pass it through as `tag_no` in the
  POST body. No new UI surface; same modal, one more field wired through.

Saved rows are immediately available for that project (current sync) and every future
project (next `sync_project_production_lines` call for that tag+size finds the
tag-specific row first).

### 6. Testing

One test module (e.g. `test_weld_tag_resolution.py`, following this repo's existing
`test_*.py` + manual-curl verification convention — no pytest framework in this repo):

- `canonical_weld_tag()` resolves all 6 MF-variant tags to their correct base tag, and
  returns unaliased tags (including the 2 Weldend variants) unchanged.
- Lookup falls back to the generic `(size, weld_family)` row when no tag-specific row
  exists for a given `(tag, size)` — covering the size-125 and Weldend-tag cases.
- Seeded values for 2–3 spot-checked `(tag, size)` pairs match the GM files' final
  TIG/MIG/Grinding numbers exactly (regression guard against a future re-import
  mis-mapping a column).

Manual verification (matching this repo's established pattern): run the seed import
against the local dev DB, `sync_project_production_lines` for a project using each of
the 4 newly-covered tags plus one aliased MF tag, and confirm via the API/UI that the
resulting `tig_feet`/`mig_feet`/`grinding_feet` match the GM files' numbers (aliased tag
matching its base tag's numbers exactly).

## Rollout

1. Schema migration (`tag_no` column) ships first — no behavior change until rows with
   `tag_no` set exist.
2. Seed import script run once against the dev DB, verified, then run once against
   production (Railway) after `demo` verification per this repo's standard workflow.
3. `sync_project_production_lines` / `auto_sync_all_projects_with_master` fallback logic
   ships alongside the schema migration — safe to deploy before the seed import runs,
   since with no tag-specific rows yet, every lookup falls through to the existing
   generic path unchanged.
4. Frontend Custom Size `tag_no` wiring can ship independently, any time after step 1.
