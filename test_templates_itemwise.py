# Verifies templates.py step lists match the company Excel (itemwise progress report).
from backend.services.templates import TEMPLATES

# Expected process lists per part NAME (names/weights unchanged; only processes enriched).
EJ_EXPECTED = {
    "Bellows (B)": ["Material Received", "Cutting", "Welding", "DP test", "Forming", "Ready"],
    "Collar (C)": ["Material Received", "Cutting", "Welding", "DP test", "Ready"],
    "Weldend (W)": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "SF Cutting", "Ready"],
    "Spool (SP)": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"],
    "Compensator Flanges (F)": ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"],
    "Companion Flanges (CF)": ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"],
    "Internal Sleeve (IS)": ["Material Received", "Cutting", "Welding", "Ready"],
    "Lugs (L)": ["Material Received", "Cutting", "Drilling", "Ready"],
    "Limit Rods (LR)": ["PO", "Material Received", "Inward Insp", "Ready"],
    "MAT. BOLTS, NUT, WASHER SET": ["PO", "Material Received", "Inward Insp", "Ready"],
    "GASKET (G)": ["PO", "Material Received", "Inward Insp", "Ready"],
}
# Assembly parts (names containing "Assembly") keep ["Assembly", "Ready"] — not asserted here.

DJ_EXPECTED = {
    "PIPE-1 (P1)": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"],
    "PIPE-2 (P2)": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"],
    "STOPPER (S)": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"],
    "Compensator Flanges (F)": ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"],
    "Companion Flanges (CF)": ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"],
    "Limit Rods (LR)": ["PO", "Material Received", "Inward Insp", "Ready"],
    "MAT. BOLTS, NUT, WASHER SET": ["PO", "Material Received", "Inward Insp", "Ready"],
    "GASKET (G)": ["PO", "Material Received", "Inward Insp", "Ready"],
}

def _by_name(tpl):
    return {p["name"]: p["processes"] for p in tpl}

def test_ej_processes():
    got = _by_name(TEMPLATES["EJ"])
    for name, procs in EJ_EXPECTED.items():
        assert name in got, f"EJ missing part {name!r}"
        assert got[name] == procs, f"EJ {name!r}: {got[name]} != {procs}"

def test_dj_processes():
    got = _by_name(TEMPLATES["DJ"])
    for name, procs in DJ_EXPECTED.items():
        assert name in got, f"DJ missing part {name!r}"
        assert got[name] == procs, f"DJ {name!r}: {got[name]} != {procs}"

def test_assembly_parts_unchanged():
    for key in ("EJ", "DJ"):
        for p in TEMPLATES[key]:
            if "Assembly" in p["name"]:
                assert p["processes"] == ["Assembly", "Ready"], f"{key} {p['name']!r} changed"

if __name__ == "__main__":
    test_ej_processes(); test_dj_processes(); test_assembly_parts_unchanged()
    print("OK: templates match Excel")
