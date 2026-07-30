"""
One-off seed import for the GM's 4 tag-specific welding-feet reference files
into WeldingMaster's tag-specific rows (tag_no set). Run manually:

    python scripts/import_tag_welding_master.py

Safe to re-run (upsert_tag_welding_master overwrites existing rows for the
same (tag_no, size) rather than duplicating them) - re-run this after the GM
sends a corrected file, or once W-variant files arrive for S-EJ-W-S-L /
U-EJ-W-S-L (add their filenames to DJ_TAG_FILES/EJ_TAG_FILES as appropriate).
"""
import os
import sys

import openpyxl

# Matches the sys.path convention in scripts/send_daily_briefing.py: needed
# so `from backend...` resolves when this file is run directly (its own
# directory, not the repo root, is what Python puts on sys.path[0] then).
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

EJ_TAG_FILES = {
    "S-EJ-F": "Feet - S-EJ-F.xlsx",
    "S-EJ-F-S-L": "Feet - S-EJ-F-S-L.xlsx",
    "U-EJ-F-S-L": "Feet - U-EJ-F-S-L.xlsx",
}
DJ_TAG_FILES = {
    "DEJ-F": "Feet - DEJ-F.xlsx",
}

# Data rows start at 4 in every file; 42 is past the known max (row 41) with
# one row of headroom. Rows are scanned rather than stopped-at-first-blank
# because S-EJ-F-S-L and U-EJ-F-S-L have a blank divider row at 26 before
# data resumes at 1600mm.
_FIRST_DATA_ROW = 4
_LAST_ROW_EXCLUSIVE = 42


def parse_ej_tag_sheet(path):
    """
    Parse an EJ-family tag file (S-EJ-F / S-EJ-F-S-L / U-EJ-F-S-L layout):
    the "Bellows Total welding details" summary block, columns V (Size),
    X (TIG feet), Z (MIG feet), AC (Grinding sq.ft).
    """
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["Sheet1"]
    rows = []
    for r in range(_FIRST_DATA_ROW, _LAST_ROW_EXCLUSIVE):
        size = ws.cell(row=r, column=22).value  # V
        if size is None:
            continue
        rows.append({
            "size": int(size),
            "tig_feet": float(ws.cell(row=r, column=24).value or 0),  # X
            "mig_feet": float(ws.cell(row=r, column=26).value or 0),  # Z
            "grinding_feet": float(ws.cell(row=r, column=29).value or 0),  # AC
        })
    return rows


def parse_dj_tag_sheet(path):
    """
    Parse a DJ-family tag file (DEJ-F layout): main table columns B (Size),
    R (Feet/Size -> mig_feet, DJ has no TIG process), S (Grinding).
    """
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["Sheet1"]
    rows = []
    for r in range(_FIRST_DATA_ROW, _LAST_ROW_EXCLUSIVE):
        size = ws.cell(row=r, column=2).value  # B
        if size is None:
            continue
        rows.append({
            "size": int(size),
            "tig_feet": 0.0,
            "mig_feet": float(ws.cell(row=r, column=18).value or 0),  # R
            "grinding_feet": float(ws.cell(row=r, column=19).value or 0),  # S
        })
    return rows


def import_all_tag_welding_masters():
    from backend.services.production_service import upsert_tag_welding_master

    results = {}
    for tag_no, filename in EJ_TAG_FILES.items():
        rows = parse_ej_tag_sheet(filename)
        for row in rows:
            upsert_tag_welding_master(tag_no, row["size"], row["tig_feet"], row["mig_feet"], row["grinding_feet"])
        results[tag_no] = len(rows)
    for tag_no, filename in DJ_TAG_FILES.items():
        rows = parse_dj_tag_sheet(filename)
        for row in rows:
            upsert_tag_welding_master(tag_no, row["size"], row["tig_feet"], row["mig_feet"], row["grinding_feet"])
        results[tag_no] = len(rows)
    return results


if __name__ == "__main__":
    for tag_no, count in import_all_tag_welding_masters().items():
        print(f"{tag_no}: {count} sizes imported")
