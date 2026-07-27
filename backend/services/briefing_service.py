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


def on_time_pct(projects, today):
    """
    projects: iterable of objects with .status and .committed_dispatch_date.
    Returns the rounded percentage of Active, dated projects whose
    committed_dispatch_date is today or later. 100 if there are none
    (nothing to be late on).
    """
    active_with_date = [p for p in projects if p.status == "Active" and p.committed_dispatch_date]
    if not active_with_date:
        return 100
    on_time = sum(1 for p in active_with_date if p.committed_dispatch_date >= today)
    return round(on_time / len(active_with_date) * 100)


def build_leaderboard(yesterday_counts, week_counts, users_by_id):
    """
    yesterday_counts, week_counts: dict[int user_id, int count].
    users_by_id: dict[int user_id, object with .full_name and .role].
    Returns list sorted by entries_7d descending:
      {user_id, full_name, role, entries_yesterday, entries_7d}
    """
    all_ids = set(yesterday_counts) | set(week_counts)
    rows = []
    for uid in all_ids:
        u = users_by_id.get(uid)
        rows.append({
            "user_id": uid,
            "full_name": (u.full_name if u and u.full_name else f"User #{uid}"),
            "role": u.role if u else "—",
            "entries_yesterday": yesterday_counts.get(uid, 0),
            "entries_7d": week_counts.get(uid, 0),
        })
    rows.sort(key=lambda r: r["entries_7d"], reverse=True)
    return rows


_MANAGEMENT_ENV_ROLES = {
    "DEV_USER": "Developer",
    "GM_USER": "GM",
    "PM_USER": "Production Manager",
    "CEO_USER": "CEO",
    "MD_USER": "MD",
}


def resolve_role(username, known_role, env_values):
    """
    username: the actor's username, or None.
    known_role: role from a matching DB User row, or None when no such row
      exists — true for the management logins (GM/PM/CEO/MD/Developer) that
      only ever exist as environment variables, never as a `users` table row
      (see AuditLog.username for the same, established workaround).
    env_values: dict of {env_var_name: os.getenv(env_var_name)} for
      DEV_USER/GM_USER/PM_USER/CEO_USER/MD_USER — the caller resolves
      os.getenv() so this function stays pure and testable.
    Returns known_role if set, else the role whose env var value equals
    username, else None.
    """
    if known_role:
        return known_role
    if not username:
        return None
    for env_key, role in _MANAGEMENT_ENV_ROLES.items():
        if username == env_values.get(env_key):
            return role
    return None


def resolve_and_rank_activity(raw_events, users_by_id, users_by_username, limit=50, env_values=None):
    """
    raw_events: list of dicts with 'timestamp' (datetime), 'action' (str),
      'detail' (str), 'project_ref' (str|None), and either 'user_id' (int|None)
      or 'username' (str|None) identifying the actor.
    users_by_id / users_by_username: dict of id/username -> object with
      .full_name and .role.
    env_values: optional dict for resolve_role's env-var fallback (see above);
      defaults to {} (no env-var role resolution) if omitted.
    Returns newest-first list capped at `limit`:
      {timestamp: iso str, actor_name, actor_role, action, detail, project_ref}
    """
    env_values = env_values or {}
    resolved = []
    for e in raw_events:
        user = None
        if e.get("user_id") is not None:
            user = users_by_id.get(e["user_id"])
        if user is None and e.get("username"):
            user = users_by_username.get(e["username"])
        actor_name = user.full_name if (user and user.full_name) else (e.get("username") or "Unknown")
        actor_role = resolve_role(e.get("username"), user.role if user else None, env_values) or "—"
        resolved.append({
            "timestamp": e["timestamp"],
            "actor_name": actor_name,
            "actor_role": actor_role,
            "action": e["action"],
            "detail": e["detail"],
            "project_ref": e.get("project_ref"),
        })
    resolved.sort(key=lambda r: r["timestamp"], reverse=True)
    top = resolved[:limit]
    for r in top:
        r["timestamp"] = r["timestamp"].isoformat()
    return top


def summarize_material_risk(rows, top_n=5):
    """
    rows: iterable of objects with .status ("red"|"amber"|"green"), .net_gap (int),
      .material_name, .size, .joint_type, and .projects (iterable of objects with
      .id and .name) — the MaterialRow list from
      backend.app.dashboard.router._compute_material_rows.
    "Blocked" = touching at least one red-status spec (net_gap > 0, a hard
    shortfall). Amber (stock below minimum but no hard gap yet) doesn't count.
    Returns {"projects_blocked": int, "top_risks": [...]} — the top_n red
    specs sorted by net_gap descending.
    """
    red_rows = [r for r in rows if r.status == "red"]
    blocked_project_ids = {p.id for r in red_rows for p in r.projects}
    top = sorted(red_rows, key=lambda r: r.net_gap, reverse=True)[:top_n]
    return {
        "projects_blocked": len(blocked_project_ids),
        "top_risks": [
            {
                "material_name": r.material_name,
                "size": r.size,
                "joint_type": r.joint_type,
                "net_gap": r.net_gap,
                "projects": [p.name for p in r.projects],
            }
            for r in top
        ],
    }
