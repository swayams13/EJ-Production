"""
Single source of truth for the Joint -> Type(tag) -> BOM hierarchy.

This replaces the old binary EJ/DJ hardcoding (templates.py TEMPLATES). Every
specific joint *tag* (e.g. "U-EJ-F-1MF-S-L") defines its exact bill-of-materials:
which components it has and the per-unit quantity of each. Quantities scale with
the production-line quantity n (10 units => every component x10).

Component kinds
---------------
- FIXED   : constant qty per unit (e.g. Collar = 2)
- ENTER   : qty entered by the user per unit at order time (e.g. Limit rod)
- DERIVED : qty = factor * another component's per-unit qty
            (e.g. Lug = 2 x Limit rod)  -> user only enters the source
- STATUS  : not a quantity at all. Paint is a status:
            "Yet to start" / "Started" / "In progress" / "Completed"

weld_family
-----------
Tells the welding-feet calc which master table to read. Per the requirement,
the existing EJ ("BELLOWS WELDING FEETS PER SIZE") master is used for BOTH
Simple and Universal expansion joints (same feet per size), and the DJ master
is used for Dismantling joints. So:
    SIMPLE_EJ    -> weld_family "EJ"
    UNIVERSAL_EJ -> weld_family "EJ"
    DJ           -> weld_family "DJ"

Extending: add a new dict to JOINT_TYPES. Nothing else needs to change.
"""

# ---- category codes ----
SIMPLE_EJ = "SIMPLE_EJ"
UNIVERSAL_EJ = "UNIVERSAL_EJ"
DJ = "DJ"

CATEGORY_LABELS = {
    SIMPLE_EJ: "Simple Expansion Joint",
    UNIVERSAL_EJ: "Universal Joint",
    DJ: "Dismantling Joint",
}
# Display order for the "Joint" dropdown
CATEGORY_ORDER = [SIMPLE_EJ, UNIVERSAL_EJ, DJ]

# ---- component kinds ----
FIXED = "FIXED"
ENTER = "ENTER"
DERIVED = "DERIVED"
STATUS = "STATUS"

# ---- paint status ----
PAINT_STATES = ["Yet to start", "Started", "In progress", "Completed"]
DEFAULT_PAINT_STATUS = "Yet to start"


# ---- component constructors (keep the tables below terse & readable) ----
def _f(name, qty):
    return {"name": name, "kind": FIXED, "qty": float(qty)}


def _e(name):
    return {"name": name, "kind": ENTER}


def _d(name, factor, source):
    return {"name": name, "kind": DERIVED, "factor": float(factor), "source": source}


def _s(name):
    return {"name": name, "kind": STATUS}


# =====================================================================
# THE CATALOG  (matches BOM_TABLES_BY_TAG.md, confirmed with the user)
# Zero-qty components from the sheet are simply omitted (nothing to track).
# =====================================================================
JOINT_TYPES = [
    # ---------------- SIMPLE EXPANSION JOINTS (weld_family EJ) --------------
    {
        "tag_no": "S-EJ-F",
        "category": SIMPLE_EJ,
        "weld_family": "EJ",
        "description": "Single with Flange End",
        "components": [
            _f("Element", 1), _f("Collar", 2), _f("Flange", 2), _f("Box Packing", 1), _s("Paint"),
        ],
    },
    {
        "tag_no": "S-EJ-F-S-L",
        "category": SIMPLE_EJ,
        "weld_family": "EJ",
        "description": "Single with Flange End, Lugs & Limit Rods",
        "components": [
            _f("Element", 1), _f("Collar", 2), _f("Flange", 2), _f("Weldend", 2),
            _e("Limit rod"), _d("Lug", 2, "Limit rod"), _f("Liner", 1), _f("Box Packing", 1), _s("Paint"),
        ],
    },
    {
        "tag_no": "S-EJ-F-1MF-S-L",
        "category": SIMPLE_EJ,
        "weld_family": "EJ",
        "description": "Single, Flange + 1 Matching Flange, Lugs & Limit Rods",
        "components": [
            _f("Element", 1), _f("Collar", 2), _f("Flange", 2), _f("Weldend", 2),
            _e("Limit rod"), _d("Lug", 2, "Limit rod"), _f("Liner", 1),
            _f("Matching Flanges", 1), _e("Bolts, Nuts"), _f("Gaskets", 2), _f("Box Packing", 1), _s("Paint"),
        ],
    },
    {
        "tag_no": "S-EJ-F-2MF-S-L",
        "category": SIMPLE_EJ,
        "weld_family": "EJ",
        "description": "Single, Flange + 2 Matching Flanges, Lugs & Limit Rods",
        "components": [
            _f("Element", 1), _f("Collar", 2), _f("Flange", 2), _f("Weldend", 2),
            _e("Limit rod"), _d("Lug", 2, "Limit rod"), _f("Liner", 1),
            _f("Matching Flanges", 2), _e("Bolts, Nuts"), _f("Gaskets", 2), _f("Box Packing", 1), _s("Paint"),
        ],
    },
    {
        "tag_no": "S-EJ-W-S-L",
        "category": SIMPLE_EJ,
        "weld_family": "EJ",
        "description": "Single with Weld End, Lugs & Limit Rods",
        "components": [
            _f("Element", 1), _f("Collar", 2), _f("Weldend", 2),
            _e("Limit rod"), _d("Lug", 2, "Limit rod"), _f("Liner", 1), _f("Box Packing", 1), _s("Paint"),
        ],
    },
    # ---------------- UNIVERSAL JOINTS (weld_family EJ) --------------------
    {
        "tag_no": "U-EJ-F-S-L",
        "category": UNIVERSAL_EJ,
        "weld_family": "EJ",
        "description": "Universal with Flange End, Lugs & Limit Rods",
        "components": [
            _f("Element", 2), _f("Collar", 4), _f("Flange", 2), _f("Weldend", 2),
            _e("Limit rod"), _d("Lug", 2, "Limit rod"), _f("Liner", 2), _f("Box Packing", 1), _s("Paint"),
        ],
    },
    {
        "tag_no": "U-EJ-F-1MF-S-L",
        "category": UNIVERSAL_EJ,
        "weld_family": "EJ",
        "description": "Universal, Flange + 1 Matching Flange, Lugs & Limit Rods",
        "components": [
            _f("Element", 2), _f("Collar", 4), _f("Flange", 2), _f("Weldend", 2),
            _e("Limit rod"), _d("Lug", 2, "Limit rod"), _f("Liner", 2),
            _f("Matching Flanges", 1), _e("Bolts, Nuts"), _f("Gaskets", 2), _f("Box Packing", 1), _s("Paint"),
        ],
    },
    {
        "tag_no": "U-EJ-F-2MF-S-L",
        "category": UNIVERSAL_EJ,
        "weld_family": "EJ",
        "description": "Universal, Flange + 2 Matching Flanges, Lugs & Limit Rods",
        "components": [
            _f("Element", 2), _f("Collar", 4), _f("Flange", 2), _f("Weldend", 2),
            _e("Limit rod"), _d("Lug", 2, "Limit rod"), _f("Liner", 2),
            _f("Matching Flanges", 2), _e("Bolts, Nuts"), _f("Gaskets", 2), _f("Box Packing", 1), _s("Paint"),
        ],
    },
    {
        "tag_no": "U-EJ-W-S-L",
        "category": UNIVERSAL_EJ,
        "weld_family": "EJ",
        "description": "Universal with Weld End, Lugs & Limit Rods",
        "components": [
            _f("Element", 2), _f("Collar", 4), _f("Flange", 2), _f("Weldend", 2),
            _f("Spool", 1), _e("Limit rod"), _d("Lug", 2, "Limit rod"), _f("Liner", 2),
            _f("Gaskets", 2), _f("Box Packing", 1), _s("Paint"),
        ],
    },
    # ---------------- DISMANTLING JOINTS (weld_family DJ) -----------------
    {
        "tag_no": "DEJ-F",
        "category": DJ,
        "weld_family": "DJ",
        "description": "Dismantling Joint with Flange End",
        "components": [
            _f("Pipe-1", 1), _f("Pipe-2", 1), _f("Stopper Patti", 1),
            _f("Pipe-1 flange", 1), _f("Pipe-2 flange", 1), _f("Stopper flange", 1),
            _f("O-ring", 2), _e("Studs Long"), _e("Studs Short"), _f("Box Packing", 1), _s("Paint"),
        ],
    },
    {
        "tag_no": "DEJ-F-1MF",
        "category": DJ,
        "weld_family": "DJ",
        "description": "Dismantling Joint, Flange + 1 Matching Flange",
        "components": [
            _f("Pipe-1", 1), _f("Pipe-2", 1), _f("Stopper Patti", 1),
            _f("Pipe-1 flange", 1), _f("Pipe-2 flange", 1), _f("Stopper flange", 1),
            _f("O-ring", 2), _e("Studs Long"), _e("Studs Short"),
            _f("Matching Flanges", 1), _e("Bolts, Nuts"), _e("Gaskets"), _f("Box Packing", 1), _s("Paint"),
        ],
    },
    {
        "tag_no": "DEJ-F-2MF",
        "category": DJ,
        "weld_family": "DJ",
        "description": "Dismantling Joint, Flange + 2 Matching Flanges",
        "components": [
            _f("Pipe-1", 1), _f("Pipe-2", 1), _f("Stopper Patti", 1),
            _f("Pipe-1 flange", 1), _f("Pipe-2 flange", 1), _f("Stopper flange", 1),
            _f("O-ring", 2), _e("Studs Long"), _e("Studs Short"),
            _f("Matching Flanges", 2), _e("Bolts, Nuts"), _e("Gaskets"), _f("Box Packing", 1), _s("Paint"),
        ],
    },
]

# Fast lookup by tag
_BY_TAG = {jt["tag_no"]: jt for jt in JOINT_TYPES}


def _step(no, label):
    return {"step_no": no, "label": label}

ASSEMBLY_CHAINS = {
    "S-EJ-F": [
        _step(1, "Bellows (Element) + Collar → Sub-assembly 'A'"),
        _step(2, "'A' + Job Flanges → FINAL"),
    ],
    "S-EJ-F-S-L": [
        _step(1, "Bellows + Collar → 'A'"),
        _step(2, "'A' + Weldend → 'B'"),
        _step(3, "'B' + Job Flanges → 'C'"),
        _step(4, "'C' + Internal Sleeve → 'D'"),
        _step(5, "'D' + Lugs & Limit Rods → FINAL"),
    ],
    "S-EJ-F-1MF-S-L": [
        _step(1, "Bellows + Collar → 'A'"),
        _step(2, "'A' + Weldend → 'B'"),
        _step(3, "'B' + Job Flanges → 'C'"),
        _step(4, "'C' + Companion (Matching) Flanges → 'D'"),
        _step(5, "'D' + Internal Sleeve → 'E'"),
        _step(6, "'E' + Lugs & Limit Rods → FINAL"),
    ],
    "S-EJ-F-2MF-S-L": [
        _step(1, "Bellows + Collar → 'A'"),
        _step(2, "'A' + Weldend → 'B'"),
        _step(3, "'B' + Job Flanges → 'C'"),
        _step(4, "'C' + Companion (Matching) Flanges ×2 → 'D'"),
        _step(5, "'D' + Internal Sleeve → 'E'"),
        _step(6, "'E' + Lugs & Limit Rods → FINAL"),
    ],
    "S-EJ-W-S-L": [
        _step(1, "Bellows + Collar → 'A'"),
        _step(2, "'A' + Weldend → 'B'"),
        _step(3, "'B' + Internal Sleeve → 'C'"),
        _step(4, "'C' + Lugs & Limit Rods → FINAL"),
    ],
    "U-EJ-F-S-L": [
        _step(1, "Bellows-1 + Collars → 'A1'"),
        _step(2, "Bellows-2 + Collars → 'A2'"),
        _step(3, "'A1' + 'A2' + Weldend (centre) → 'B'"),
        _step(4, "'B' + Job Flanges → 'C'"),
        _step(5, "'C' + Internal Sleeves → 'D'"),
        _step(6, "'D' + Lugs & Limit Rods → FINAL"),
    ],
    "U-EJ-F-1MF-S-L": [
        _step(1, "Bellows-1 + Collars → 'A1'"),
        _step(2, "Bellows-2 + Collars → 'A2'"),
        _step(3, "'A1' + 'A2' + Weldend (centre) → 'B'"),
        _step(4, "'B' + Job Flanges → 'C'"),
        _step(5, "'C' + Companion (Matching) Flanges → 'D'"),
        _step(6, "'D' + Internal Sleeves → 'E'"),
        _step(7, "'E' + Lugs & Limit Rods → FINAL"),
    ],
    "U-EJ-F-2MF-S-L": [
        _step(1, "Bellows-1 + Collars → 'A1'"),
        _step(2, "Bellows-2 + Collars → 'A2'"),
        _step(3, "'A1' + 'A2' + Weldend (centre) → 'B'"),
        _step(4, "'B' + Job Flanges → 'C'"),
        _step(5, "'C' + Companion (Matching) Flanges ×2 → 'D'"),
        _step(6, "'D' + Internal Sleeves → 'E'"),
        _step(7, "'E' + Lugs & Limit Rods → FINAL"),
    ],
    "U-EJ-W-S-L": [
        _step(1, "Bellows-1 + Collars → 'A1'"),
        _step(2, "Bellows-2 + Collars → 'A2'"),
        _step(3, "'A1' + 'A2' + Spool (centre) → 'B'"),
        _step(4, "'B' + Weldend → 'C'"),
        _step(5, "'C' + Job Flanges → 'D'"),
        _step(6, "'D' + Internal Sleeves → 'E'"),
        _step(7, "'E' + Lugs & Limit Rods → FINAL"),
    ],
    "DEJ-F": [
        _step(1, "Flange FP1 + Pipe-1 → 'A'"),
        _step(2, "Flange FP2 + Pipe-2 → 'B'"),
        _step(3, "Stopper Flange FS + Stopper Patti → 'C'"),
        _step(4, "'A' + 'B' + 'C' + Studs & O-rings → FINAL"),
    ],
    "DEJ-F-1MF": [
        _step(1, "Flange FP1 + Pipe-1 → 'A'"),
        _step(2, "Flange FP2 + Pipe-2 → 'B'"),
        _step(3, "Stopper Flange FS + Stopper Patti → 'C'"),
        _step(4, "'A' + 'B' + 'C' + Studs & O-rings → 'D'"),
        _step(5, "'D' + Companion (Matching) Flange → FINAL"),
    ],
    "DEJ-F-2MF": [
        _step(1, "Flange FP1 + Pipe-1 → 'A'"),
        _step(2, "Flange FP2 + Pipe-2 → 'B'"),
        _step(3, "Stopper Flange FS + Stopper Patti → 'C'"),
        _step(4, "'A' + 'B' + 'C' + Studs & O-rings → 'D'"),
        _step(5, "'D' + Companion (Matching) Flanges ×2 → FINAL"),
    ],
}

# Attach each tag's proposed assembly chain onto its JOINT_TYPES entry.
for _jt in JOINT_TYPES:
    _jt["assembly_chain"] = ASSEMBLY_CHAINS.get(_jt["tag_no"], [])


def assembly_chain_for(tag_no):
    """Ordered proposed sub-assembly steps for a tag. Empty list if none (legacy/unknown tag)."""
    jt = _BY_TAG.get(tag_no)
    return jt.get("assembly_chain", []) if jt else []


def get_type(tag_no):
    """Return the catalog entry for a tag, or None."""
    return _BY_TAG.get(tag_no)


def weld_family_for(tag_no, fallback="EJ"):
    """Which welding-feet master a tag uses ('EJ' or 'DJ')."""
    jt = _BY_TAG.get(tag_no)
    return jt["weld_family"] if jt else fallback


def category_for(tag_no):
    jt = _BY_TAG.get(tag_no)
    return jt["category"] if jt else None


def variable_component_names(tag_no):
    """Names of the ENTER (user-supplied) components for a tag."""
    jt = _BY_TAG.get(tag_no)
    if not jt:
        return []
    return [c["name"] for c in jt["components"] if c["kind"] == ENTER]


def list_catalog():
    """
    Catalog shaped for the frontend Joint -> Type dropdowns.
    Returns a list of category groups in display order.
    """
    groups = []
    for cat in CATEGORY_ORDER:
        types = []
        for jt in JOINT_TYPES:
            if jt["category"] != cat:
                continue
            types.append({
                "tag_no": jt["tag_no"],
                "description": jt["description"],
                "weld_family": jt["weld_family"],
                # component summary for the BOM viewer + variable-qty inputs
                "components": [
                    {
                        "name": c["name"],
                        "kind": c["kind"],
                        "qty": c.get("qty"),
                        "factor": c.get("factor"),
                        "source": c.get("source"),
                    }
                    for c in jt["components"]
                ],
                "assembly_chain": jt.get("assembly_chain", []),
                "variable_components": [
                    c["name"] for c in jt["components"] if c["kind"] == ENTER
                ],
            })
        groups.append({
            "category": cat,
            "label": CATEGORY_LABELS[cat],
            "types": types,
        })
    return groups


def _per_unit(component, variable_qtys):
    """Resolve one component's per-unit quantity given the user's ENTER values."""
    kind = component["kind"]
    if kind == FIXED:
        return float(component["qty"])
    if kind == ENTER:
        return float(variable_qtys.get(component["name"], 0) or 0)
    if kind == DERIVED:
        src = float(variable_qtys.get(component["source"], 0) or 0)
        return component["factor"] * src
    return 0.0  # STATUS has no quantity


def resolve_components(tag_no, qty, variable_qtys=None):
    """
    Resolve a tag's BOM to concrete per-line quantities.

    tag_no        : e.g. "U-EJ-F-1MF-S-L"
    qty           : n, the production-line quantity
    variable_qtys : {component_name: per_unit_value} for ENTER components

    Returns a list of dicts (Paint/STATUS is excluded — tracked on the line):
        {name, kind, per_unit, total_qty}
    total_qty = round(per_unit * n).
    """
    variable_qtys = variable_qtys or {}
    jt = _BY_TAG.get(tag_no)
    if not jt:
        return []
    n = int(qty or 0)
    out = []
    for c in jt["components"]:
        if c["kind"] == STATUS:
            continue
        per_unit = _per_unit(c, variable_qtys)
        if per_unit <= 0:
            # a fixed 0, or an ENTER/DERIVED the user left blank -> not tracked
            continue
        out.append({
            "name": c["name"],
            "kind": c["kind"],
            "per_unit": per_unit,
            "total_qty": int(round(per_unit * n)),
        })
    return out
