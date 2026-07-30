from backend.services.joint_catalog import canonical_weld_tag
from types import SimpleNamespace
from backend.services.production_service import resolve_master_row


def test_canonical_weld_tag_aliases_simple_mf_variants():
    assert canonical_weld_tag("S-EJ-F-1MF-S-L") == "S-EJ-F-S-L"
    assert canonical_weld_tag("S-EJ-F-2MF-S-L") == "S-EJ-F-S-L"


def test_canonical_weld_tag_aliases_universal_mf_variants():
    assert canonical_weld_tag("U-EJ-F-1MF-S-L") == "U-EJ-F-S-L"
    assert canonical_weld_tag("U-EJ-F-2MF-S-L") == "U-EJ-F-S-L"


def test_canonical_weld_tag_aliases_dj_mf_variants():
    assert canonical_weld_tag("DEJ-F-1MF") == "DEJ-F"
    assert canonical_weld_tag("DEJ-F-2MF") == "DEJ-F"


def test_canonical_weld_tag_passes_through_unaliased_tags():
    assert canonical_weld_tag("S-EJ-F") == "S-EJ-F"
    assert canonical_weld_tag("S-EJ-F-S-L") == "S-EJ-F-S-L"
    assert canonical_weld_tag("U-EJ-F-S-L") == "U-EJ-F-S-L"
    assert canonical_weld_tag("DEJ-F") == "DEJ-F"
    # The 2 Weldend variants have no GM data yet - they resolve to
    # themselves, so lookup falls through to the generic fallback.
    assert canonical_weld_tag("S-EJ-W-S-L") == "S-EJ-W-S-L"
    assert canonical_weld_tag("U-EJ-W-S-L") == "U-EJ-W-S-L"


def test_canonical_weld_tag_handles_unknown_tag():
    assert canonical_weld_tag("NOT-A-REAL-TAG") == "NOT-A-REAL-TAG"


def _row(**kwargs):
    return SimpleNamespace(**kwargs)


def test_resolve_master_row_prefers_tag_specific_row():
    lookup = {
        (50, "S-EJ-F-S-L"): _row(id=1, tig_feet=4.81),
        (50, "EJ"): _row(id=2, tig_feet=999.0),
    }
    result = resolve_master_row(lookup, "S-EJ-F-S-L", "EJ", 50)
    assert result.id == 1


def test_resolve_master_row_resolves_mf_alias_to_base_tag_row():
    lookup = {(50, "S-EJ-F-S-L"): _row(id=1, tig_feet=4.81)}
    result = resolve_master_row(lookup, "S-EJ-F-1MF-S-L", "EJ", 50)
    assert result.id == 1


def test_resolve_master_row_falls_back_to_generic_when_no_tag_row():
    lookup = {(125, "EJ"): _row(id=3, tig_feet=1.0)}
    # size 125 has no tag-specific data in any GM file yet
    result = resolve_master_row(lookup, "S-EJ-F-S-L", "EJ", 125)
    assert result.id == 3


def test_resolve_master_row_falls_back_to_generic_for_unresolved_weldend_tag():
    lookup = {(50, "EJ"): _row(id=4, tig_feet=1.0)}
    result = resolve_master_row(lookup, "S-EJ-W-S-L", "EJ", 50)
    assert result.id == 4


def test_resolve_master_row_dj_falls_back_to_ej_same_size_when_no_dj_data():
    lookup = {(50, "EJ"): _row(id=5, tig_feet=6.69)}
    result = resolve_master_row(lookup, None, "DJ", 50)
    assert result.id == 5


def test_resolve_master_row_returns_none_when_nothing_matches():
    assert resolve_master_row({}, "S-EJ-F-S-L", "EJ", 50) is None


if __name__ == "__main__":
    test_canonical_weld_tag_aliases_simple_mf_variants()
    test_canonical_weld_tag_aliases_universal_mf_variants()
    test_canonical_weld_tag_aliases_dj_mf_variants()
    test_canonical_weld_tag_passes_through_unaliased_tags()
    test_canonical_weld_tag_handles_unknown_tag()
    test_resolve_master_row_prefers_tag_specific_row()
    test_resolve_master_row_resolves_mf_alias_to_base_tag_row()
    test_resolve_master_row_falls_back_to_generic_when_no_tag_row()
    test_resolve_master_row_falls_back_to_generic_for_unresolved_weldend_tag()
    test_resolve_master_row_dj_falls_back_to_ej_same_size_when_no_dj_data()
    test_resolve_master_row_returns_none_when_nothing_matches()
    print("OK")
