from scripts.import_tag_welding_master import parse_ej_tag_sheet, parse_dj_tag_sheet


def test_parse_ej_tag_sheet_s_ej_f_size_50():
    rows = parse_ej_tag_sheet("Feet - S-EJ-F.xlsx")
    row = next(r for r in rows if r["size"] == 50)
    assert abs(row["tig_feet"] - 5.299025096128609) < 1e-6
    assert row["mig_feet"] == 0
    assert abs(row["grinding_feet"] - 0.016595765503808865) < 1e-6


def test_parse_ej_tag_sheet_s_ej_f_stops_at_1500():
    rows = parse_ej_tag_sheet("Feet - S-EJ-F.xlsx")
    sizes = sorted(r["size"] for r in rows)
    assert sizes[-1] == 1500
    assert len(sizes) == 22


def test_parse_ej_tag_sheet_s_ej_f_s_l_size_50():
    rows = parse_ej_tag_sheet("Feet - S-EJ-F-S-L.xlsx")
    row = next(r for r in rows if r["size"] == 50)
    assert abs(row["tig_feet"] - 4.806899111876641) < 1e-6
    assert abs(row["mig_feet"] - 5.114360670603674) < 1e-6
    assert abs(row["grinding_feet"] - 0.5601070857535493) < 1e-6


def test_parse_ej_tag_sheet_s_ej_f_s_l_covers_full_range_past_blank_divider_row():
    # Row 26 is a blank divider row in this file, before data resumes at
    # 1600mm - the parser must not treat it as end-of-data.
    rows = parse_ej_tag_sheet("Feet - S-EJ-F-S-L.xlsx")
    sizes = sorted(r["size"] for r in rows)
    assert sizes[-1] == 3000
    assert len(sizes) == 37
    row_1600 = next(r for r in rows if r["size"] == 1600)
    assert abs(row_1600["tig_feet"] - 56.115016192913394) < 1e-6
    assert abs(row_1600["mig_feet"] - 75.67632080314962) < 1e-6
    assert abs(row_1600["grinding_feet"] - 18.501897996613142) < 1e-6


def test_parse_ej_tag_sheet_u_ej_f_s_l_size_50():
    rows = parse_ej_tag_sheet("Feet - U-EJ-F-S-L.xlsx")
    row = next(r for r in rows if r["size"] == 50)
    assert abs(row["tig_feet"] - 9.613798223753282) < 1e-6
    assert abs(row["mig_feet"] - 5.114360670603674) < 1e-6
    assert abs(row["grinding_feet"] - 1.5558530159820814) < 1e-6


def test_parse_ej_tag_sheet_u_ej_f_s_l_covers_full_range():
    rows = parse_ej_tag_sheet("Feet - U-EJ-F-S-L.xlsx")
    sizes = sorted(r["size"] for r in rows)
    assert sizes[-1] == 3000
    assert len(sizes) == 37


def test_parse_dj_tag_sheet_dej_f_size_50():
    rows = parse_dj_tag_sheet("Feet - DEJ-F.xlsx")
    row = next(r for r in rows if r["size"] == 50)
    assert row["tig_feet"] == 0
    assert abs(row["mig_feet"] - 5.029527496062993) < 1e-6
    assert abs(row["grinding_feet"] - 0.95221605349723) < 1e-6


def test_parse_dj_tag_sheet_dej_f_covers_full_range():
    rows = parse_dj_tag_sheet("Feet - DEJ-F.xlsx")
    sizes = sorted(r["size"] for r in rows)
    assert sizes[-1] == 3000
    assert len(sizes) == 37


if __name__ == "__main__":
    test_parse_ej_tag_sheet_s_ej_f_size_50()
    test_parse_ej_tag_sheet_s_ej_f_stops_at_1500()
    test_parse_ej_tag_sheet_s_ej_f_s_l_size_50()
    test_parse_ej_tag_sheet_s_ej_f_s_l_covers_full_range_past_blank_divider_row()
    test_parse_ej_tag_sheet_u_ej_f_s_l_size_50()
    test_parse_ej_tag_sheet_u_ej_f_s_l_covers_full_range()
    test_parse_dj_tag_sheet_dej_f_size_50()
    test_parse_dj_tag_sheet_dej_f_covers_full_range()
    print("OK")
