from datetime import timedelta

_PROCESS_KEY = {"TIG": "tig_feet", "MIG": "mig_feet", "Grinding": "grinding_feet"}


def _empty_bucket():
    return {"tig_feet": 0.0, "mig_feet": 0.0, "grinding_feet": 0.0, "total_feet": 0.0, "entries": 0}


def summarize_production(rows, today):
    """
    rows: iterable of objects with .date, .process_type ("TIG"|"MIG"|"Grinding"),
          .feet (float), .entries (int) — one row per (date, process_type),
          already grouped/summed by the caller's DB query, spanning the last 14 days.
    Returns {"yesterday": bucket, "last_7d": bucket, "trend_14d": [day, ...]} where
    bucket = {tig_feet, mig_feet, grinding_feet, total_feet, entries}.
    "last_7d" covers the 7 completed days ending yesterday (today is still in progress).
    """
    yesterday = today - timedelta(days=1)
    week_start = today - timedelta(days=7)

    y_bucket = _empty_bucket()
    w_bucket = _empty_bucket()
    by_date = {}

    for r in rows:
        key = _PROCESS_KEY.get(r.process_type)
        if key is None:
            continue
        feet = r.feet or 0.0
        day_entry = by_date.setdefault(r.date, {"date": r.date, "tig_feet": 0.0, "mig_feet": 0.0, "grinding_feet": 0.0})
        day_entry[key] += feet

        if r.date == yesterday:
            y_bucket[key] += feet
            y_bucket["total_feet"] += feet
            y_bucket["entries"] += r.entries or 0
        if week_start <= r.date < today:
            w_bucket[key] += feet
            w_bucket["total_feet"] += feet
            w_bucket["entries"] += r.entries or 0

    for bucket in (y_bucket, w_bucket):
        for k in ("tig_feet", "mig_feet", "grinding_feet", "total_feet"):
            bucket[k] = round(bucket[k], 1)

    trend_14d = [{**by_date[d], "date": d.isoformat()} for d in sorted(by_date.keys())]

    return {"yesterday": y_bucket, "last_7d": w_bucket, "trend_14d": trend_14d}
