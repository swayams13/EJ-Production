from types import SimpleNamespace
from datetime import date, datetime, timedelta
from backend.services.briefing_service import summarize_production


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


if __name__ == "__main__":
    test_summarize_production_buckets_yesterday_and_week()
    test_summarize_production_ignores_unknown_process_type()
    print("OK")
