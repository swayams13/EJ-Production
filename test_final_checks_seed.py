from backend.services.mes_service import MESService

def test_four_check_types():
    assert MESService.FINAL_CHECK_TYPES == ["testing", "painting", "weight", "marking"]

def test_default_rows_builder():
    rows = MESService.default_final_check_rows(line_id=42)
    assert len(rows) == 4
    assert {r["check_type"] for r in rows} == {"testing", "painting", "weight", "marking"}
    assert all(r["production_line_id"] == 42 for r in rows)
    assert all(r["is_required"] is True for r in rows)
    testing = next(r for r in rows if r["check_type"] == "testing")
    assert testing["test_method"] == "Hydro/Pneumatic"
    marking = next(r for r in rows if r["check_type"] == "marking")
    assert marking["marking_type"] == "Hard Punch"

if __name__ == "__main__":
    test_four_check_types(); test_default_rows_builder()
    print("OK: final check seed")
