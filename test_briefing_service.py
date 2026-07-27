from types import SimpleNamespace
from datetime import date, datetime, timedelta
from backend.services.briefing_service import summarize_production, on_time_pct, build_leaderboard, resolve_and_rank_activity, resolve_role


def _row(d, process_type, feet, entries):
    return SimpleNamespace(date=d, process_type=process_type, feet=feet, entries=entries)


def test_summarize_production_buckets_yesterday_and_week():
    today = date(2026, 7, 27)
    yesterday = today - timedelta(days=1)
    two_days_ago = today - timedelta(days=2)
    rows = [
        _row(yesterday, "TIG", 100.0, 2),
        _row(yesterday, "MIG", 50.0, 1),
        _row(two_days_ago, "Grinding", 30.0, 1),
    ]
    result = summarize_production(rows, today)
    assert result["yesterday"]["tig_feet"] == 100.0
    assert result["yesterday"]["mig_feet"] == 50.0
    assert result["yesterday"]["total_feet"] == 150.0
    assert result["yesterday"]["entries"] == 3
    assert result["last_7d"]["grinding_feet"] == 30.0
    assert result["last_7d"]["total_feet"] == 180.0
    assert len(result["trend_14d"]) == 2


def test_summarize_production_ignores_unknown_process_type():
    today = date(2026, 7, 27)
    rows = [_row(today - timedelta(days=1), "Unknown", 10.0, 1)]
    result = summarize_production(rows, today)
    assert result["yesterday"]["total_feet"] == 0.0


def test_on_time_pct_all_on_time():
    today = date(2026, 7, 27)
    projects = [
        SimpleNamespace(status="Active", committed_dispatch_date=today + timedelta(days=5)),
        SimpleNamespace(status="Completed", committed_dispatch_date=today - timedelta(days=5)),
    ]
    assert on_time_pct(projects, today) == 100


def test_on_time_pct_mixed():
    today = date(2026, 7, 27)
    projects = [
        SimpleNamespace(status="Active", committed_dispatch_date=today + timedelta(days=5)),
        SimpleNamespace(status="Active", committed_dispatch_date=today - timedelta(days=5)),
    ]
    assert on_time_pct(projects, today) == 50


def test_on_time_pct_no_active_projects_returns_100():
    assert on_time_pct([], date(2026, 7, 27)) == 100


def test_build_leaderboard_sorts_by_week_desc():
    users = {1: SimpleNamespace(full_name="Alice", role="Supervisor"), 2: SimpleNamespace(full_name="Bob", role="Supervisor")}
    result = build_leaderboard({1: 2}, {1: 10, 2: 15}, users)
    assert result[0]["full_name"] == "Bob"
    assert result[0]["entries_7d"] == 15
    assert result[1]["entries_yesterday"] == 2


def test_build_leaderboard_unknown_user_falls_back_to_id():
    result = build_leaderboard({}, {99: 5}, {})
    assert result[0]["full_name"] == "User #99"
    assert result[0]["role"] == "—"


def test_resolve_and_rank_activity_sorts_and_caps():
    users_by_id = {1: SimpleNamespace(full_name="Alice", role="Supervisor")}
    events = [
        {"timestamp": datetime(2026, 7, 27, 9, 0), "user_id": 1, "action": "Update", "detail": "d1", "project_ref": None},
        {"timestamp": datetime(2026, 7, 27, 10, 0), "user_id": 1, "action": "Update", "detail": "d2", "project_ref": None},
    ]
    result = resolve_and_rank_activity(events, users_by_id, {}, limit=1)
    assert len(result) == 1
    assert result[0]["detail"] == "d2"
    assert result[0]["actor_name"] == "Alice"


def test_resolve_and_rank_activity_falls_back_to_username():
    events = [{"timestamp": datetime(2026, 7, 27, 9, 0), "username": "pm_user", "action": "Completion requested", "detail": "d", "project_ref": "Q1"}]
    result = resolve_and_rank_activity(events, {}, {}, limit=10)
    assert result[0]["actor_name"] == "pm_user"
    assert result[0]["actor_role"] == "—"


def test_resolve_role_prefers_known_role():
    env_values = {"PM_USER": "someone_else"}
    assert resolve_role("pm_user", "Production Manager", env_values) == "Production Manager"


def test_resolve_role_falls_back_to_env_var_match():
    env_values = {"DEV_USER": "dev1", "GM_USER": "gm1", "PM_USER": "pm1", "CEO_USER": "ceo1", "MD_USER": "md1"}
    assert resolve_role("pm1", None, env_values) == "Production Manager"
    assert resolve_role("gm1", None, env_values) == "GM"


def test_resolve_role_no_match_returns_none():
    env_values = {"PM_USER": "pm1"}
    assert resolve_role("nobody", None, env_values) is None
    assert resolve_role(None, None, env_values) is None


if __name__ == "__main__":
    test_summarize_production_buckets_yesterday_and_week()
    test_summarize_production_ignores_unknown_process_type()
    test_on_time_pct_all_on_time()
    test_on_time_pct_mixed()
    test_on_time_pct_no_active_projects_returns_100()
    test_build_leaderboard_sorts_by_week_desc()
    test_build_leaderboard_unknown_user_falls_back_to_id()
    test_resolve_and_rank_activity_sorts_and_caps()
    test_resolve_and_rank_activity_falls_back_to_username()
    test_resolve_role_prefers_known_role()
    test_resolve_role_falls_back_to_env_var_match()
    test_resolve_role_no_match_returns_none()
    print("OK")
