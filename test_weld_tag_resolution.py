from backend.services.joint_catalog import canonical_weld_tag


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


if __name__ == "__main__":
    test_canonical_weld_tag_aliases_simple_mf_variants()
    test_canonical_weld_tag_aliases_universal_mf_variants()
    test_canonical_weld_tag_aliases_dj_mf_variants()
    test_canonical_weld_tag_passes_through_unaliased_tags()
    test_canonical_weld_tag_handles_unknown_tag()
    print("OK")
