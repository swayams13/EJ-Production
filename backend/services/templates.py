# Defines the standard parts and their processes for different requirements
# Each part has a list of processes and an estimated "weight_percentage"
# which represents how much of the requirement's total effort it takes.

EXPANSION_JOINT_TEMPLATE = [
    {"name": "Bellows (B)", "weight": 20.0, "processes": ["Cutting", "Welding", "DP test", "Forming", "Ready"]},
    {"name": "Collar (C)", "weight": 5.0, "processes": ["Cutting", "Ready"]},
    {"name": "B/C Assembly Part 'P'", "weight": 10.0, "processes": ["Assembly", "Ready"]},
    {"name": "Weldend (W)", "weight": 10.0, "processes": ["Cutting", "Bending", "Welding", "Rolling", "Ready"]},
    {"name": "Spool (SP)", "weight": 5.0, "processes": ["Cutting", "Bending", "Welding", "Rolling", "Ready"]},
    {"name": "Part 'P'/W/SP Assembly Part 'Q'", "weight": 10.0, "processes": ["Assembly", "Ready"]},
    {"name": "Compensator Flanges (F)", "weight": 5.0, "processes": ["Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"]},
    {"name": "Companion Flanges (CF)", "weight": 5.0, "processes": ["Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"]},
    {"name": "Part 'Q'/F Assembly Part 'R'", "weight": 5.0, "processes": ["Assembly", "Ready"]},
    {"name": "Internal Sleeve (IS)", "weight": 5.0, "processes": ["Cutting", "Welding", "Ready"]},
    {"name": "Part 'R'/IS Assembly Part 'S'", "weight": 5.0, "processes": ["Assembly", "Ready"]},
    {"name": "Lugs (L)", "weight": 2.5, "processes": ["Cutting", "Drilling", "Ready"]},
    {"name": "Part 'S'/L Assembly Part 'T'", "weight": 2.5, "processes": ["Assembly", "Ready"]},
    {"name": "Limit Rods (LR)", "weight": 2.0, "processes": ["Ordered", "Received"]},
    {"name": "MAT. BOLTS, NUT, WASHER SET", "weight": 2.0, "processes": ["Ordered", "Received"]},
    {"name": "GASKET (G)", "weight": 1.0, "processes": ["Ordered", "Received"]},
    {"name": "Main Assembly", "weight": 5.0, "processes": ["Assembly", "Ready"]}
]

DISMANTLING_JOINT_TEMPLATE = [
    {"name": "PIPE-1 (P1)", "weight": 10.0, "processes": ["Marking", "Cutting", "Bending", "Welding", "Ready"]},
    {"name": "PIPE-2 (P2)", "weight": 10.0, "processes": ["Marking", "Cutting", "Bending", "Welding", "Ready"]},
    {"name": "STOPPER (S)", "weight": 5.0, "processes": ["Marking", "Cutting", "Bending", "Welding", "Ready"]},
    {"name": "Compensator Flanges (F)", "weight": 10.0, "processes": ["Cutting", "Bending", "Welding", "M/c", "Drilling", "Ready"]},
    {"name": "Companion Flanges (CF)", "weight": 10.0, "processes": ["Cutting", "Bending", "Welding", "M/c", "Drilling", "Ready"]},
    {"name": "Part 'P1'/F Assembly Part 'A'", "weight": 10.0, "processes": ["Assembly", "Ready"]},
    {"name": "Part 'P2'/F Assembly Part 'B'", "weight": 10.0, "processes": ["Assembly", "Ready"]},
    {"name": "Part 'S'/F Assembly Part 'C'", "weight": 10.0, "processes": ["Assembly", "Ready"]},
    {"name": "Limit Rods (LR)", "weight": 5.0, "processes": ["Ordered", "Received"]},
    {"name": "Part 'A', 'B', & 'C' FINAL ASSEMBLY", "weight": 15.0, "processes": ["Assembly", "Ready"]},
    {"name": "MAT. BOLTS, NUT, WASHER SET", "weight": 2.5, "processes": ["Ordered", "Received"]},
    {"name": "GASKET (G)", "weight": 2.5, "processes": ["Ordered", "Received"]},
    {"name": "Main Assembly", "weight": 5.0, "processes": ["Assembly", "Ready"]}
]

TEMPLATES = {
    "EJ": EXPANSION_JOINT_TEMPLATE,
    "DJ": DISMANTLING_JOINT_TEMPLATE
}
