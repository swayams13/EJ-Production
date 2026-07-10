# Parts / process definitions.
#
# NEW MODEL (data-driven per tag): the *which components + how many* now comes
# from backend/services/joint_catalog.py (per joint tag, scaled by qty). This
# file provides the reusable pieces that turn a BOM component into trackable
# work:
#   - PROCESS_ROUTES  : component name  -> ordered list of process steps
#   - COMPONENT_WEIGHTS: component name -> relative importance for % progress
#                        (normalized per line so weights sum to 100)
#
# LEGACY MODEL (fallback only): EXPANSION_JOINT_TEMPLATE / DISMANTLING_JOINT_TEMPLATE
# are kept for production lines that predate the tag system (joint_type EJ/DJ
# with no joint_type_code). New lines never use these.

# --------------------------------------------------------------------------
# Component -> process routing (reused for every tag that contains the component)
# --------------------------------------------------------------------------
PROCESS_ROUTES = {
    # Expansion-joint components
    "Element":          ["Material Received", "Cutting", "Welding", "DP test", "Forming", "Ready"],
    "Collar":           ["Material Received", "Cutting", "Welding", "DP test", "Ready"],
    "Weldend":          ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "SF Cutting", "Ready"],
    "Spool":            ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"],
    "Flange":           ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"],
    "Matching Flanges": ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"],
    "Liner":            ["Material Received", "Cutting", "Welding", "Ready"],
    "Lug":              ["Material Received", "Cutting", "Drilling", "Ready"],
    "Limit rod":        ["PO", "Material Received", "Inward Insp", "Ready"],
    "Bolts, Nuts":      ["PO", "Material Received", "Inward Insp", "Ready"],
    "Gaskets":          ["PO", "Material Received", "Inward Insp", "Ready"],
    # Dismantling-joint components
    "Pipe-1":           ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"],
    "Pipe-2":           ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"],
    "Stopper Patti":    ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"],
    "Pipe-1 flange":    ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"],
    "Pipe-2 flange":    ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"],
    "Stopper flange":   ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"],
    "O-ring":           ["PO", "Material Received", "Inward Insp", "Ready"],
    "Studs Long":       ["PO", "Material Received", "Inward Insp", "Ready"],
    "Studs Short":      ["PO", "Material Received", "Inward Insp", "Ready"],
}

# Any component without an explicit route gets a minimal one.
DEFAULT_ROUTE = ["Material Received", "Ready"]

# Relative importance used to weight each part's contribution to line % progress.
# Normalized per line so the parts of a given tag always sum to 100 (the progress
# formula in mes_service depends on that — see docs/EJ_DJ_CALCULATION_LOGIC.md).
COMPONENT_WEIGHTS = {
    "Element": 20.0, "Collar": 5.0, "Weldend": 10.0, "Spool": 5.0,
    "Flange": 5.0, "Matching Flanges": 5.0, "Liner": 5.0, "Lug": 2.5,
    "Limit rod": 2.0, "Bolts, Nuts": 2.0, "Gaskets": 1.0,
    "Pipe-1": 10.0, "Pipe-2": 10.0, "Stopper Patti": 5.0,
    "Pipe-1 flange": 10.0, "Pipe-2 flange": 10.0, "Stopper flange": 10.0,
    "O-ring": 2.0, "Studs Long": 2.0, "Studs Short": 2.0,
}
DEFAULT_WEIGHT = 5.0


def route_for(component_name):
    return PROCESS_ROUTES.get(component_name, DEFAULT_ROUTE)


def base_weight_for(component_name):
    return COMPONENT_WEIGHTS.get(component_name, DEFAULT_WEIGHT)


# --------------------------------------------------------------------------
# LEGACY templates — fallback for pre-tag production lines only.
# --------------------------------------------------------------------------
EXPANSION_JOINT_TEMPLATE = [
    {"name": "Bellows (B)", "weight": 20.0, "processes": ["Material Received", "Cutting", "Welding", "DP test", "Forming", "Ready"]},
    {"name": "Collar (C)", "weight": 5.0, "processes": ["Material Received", "Cutting", "Welding", "DP test", "Ready"]},
    {"name": "B/C Assembly Part 'P'", "weight": 10.0, "processes": ["Assembly", "Ready"]},
    {"name": "Weldend (W)", "weight": 10.0, "processes": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "SF Cutting", "Ready"]},
    {"name": "Spool (SP)", "weight": 5.0, "processes": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"]},
    {"name": "Part 'P'/W/SP Assembly Part 'Q'", "weight": 10.0, "processes": ["Assembly", "Ready"]},
    {"name": "Compensator Flanges (F)", "weight": 5.0, "processes": ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"]},
    {"name": "Companion Flanges (CF)", "weight": 5.0, "processes": ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"]},
    {"name": "Part 'Q'/F Assembly Part 'R'", "weight": 5.0, "processes": ["Assembly", "Ready"]},
    {"name": "Internal Sleeve (IS)", "weight": 5.0, "processes": ["Material Received", "Cutting", "Welding", "Ready"]},
    {"name": "Part 'R'/IS Assembly Part 'S'", "weight": 5.0, "processes": ["Assembly", "Ready"]},
    {"name": "Lugs (L)", "weight": 2.5, "processes": ["Material Received", "Cutting", "Drilling", "Ready"]},
    {"name": "Part 'S'/L Assembly Part 'T'", "weight": 2.5, "processes": ["Assembly", "Ready"]},
    {"name": "Limit Rods (LR)", "weight": 2.0, "processes": ["PO", "Material Received", "Inward Insp", "Ready"]},
    {"name": "MAT. BOLTS, NUT, WASHER SET", "weight": 2.0, "processes": ["PO", "Material Received", "Inward Insp", "Ready"]},
    {"name": "GASKET (G)", "weight": 1.0, "processes": ["PO", "Material Received", "Inward Insp", "Ready"]},
    {"name": "Main Assembly", "weight": 5.0, "processes": ["Assembly", "Ready"]}
]

DISMANTLING_JOINT_TEMPLATE = [
    {"name": "PIPE-1 (P1)", "weight": 10.0, "processes": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"]},
    {"name": "PIPE-2 (P2)", "weight": 10.0, "processes": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"]},
    {"name": "STOPPER (S)", "weight": 5.0, "processes": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"]},
    {"name": "Compensator Flanges (F)", "weight": 10.0, "processes": ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"]},
    {"name": "Companion Flanges (CF)", "weight": 10.0, "processes": ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"]},
    {"name": "Part 'P1'/F Assembly Part 'A'", "weight": 10.0, "processes": ["Assembly", "Ready"]},
    {"name": "Part 'P2'/F Assembly Part 'B'", "weight": 10.0, "processes": ["Assembly", "Ready"]},
    {"name": "Part 'S'/F Assembly Part 'C'", "weight": 10.0, "processes": ["Assembly", "Ready"]},
    {"name": "Limit Rods (LR)", "weight": 5.0, "processes": ["PO", "Material Received", "Inward Insp", "Ready"]},
    {"name": "Part 'A', 'B', & 'C' FINAL ASSEMBLY", "weight": 15.0, "processes": ["Assembly", "Ready"]},
    {"name": "MAT. BOLTS, NUT, WASHER SET", "weight": 2.5, "processes": ["PO", "Material Received", "Inward Insp", "Ready"]},
    {"name": "GASKET (G)", "weight": 2.5, "processes": ["PO", "Material Received", "Inward Insp", "Ready"]},
    {"name": "Main Assembly", "weight": 5.0, "processes": ["Assembly", "Ready"]}
]

TEMPLATES = {
    "EJ": EXPANSION_JOINT_TEMPLATE,
    "DJ": DISMANTLING_JOINT_TEMPLATE
}
