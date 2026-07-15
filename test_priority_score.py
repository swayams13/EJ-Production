"""Self-check: priority score engine logic (no DB needed)."""
from types import SimpleNamespace
from datetime import date, timedelta

# Inline the scoring function to test without DB
def _get_effective_priority(project):
    if getattr(project, 'priority', None):
        return project.priority
    if not project.target_date:
        return "P3"
    days = (project.target_date - date.today()).days
    if days <= 21:
        return "P1"
    if days <= 60:
        return "P2"
    return "P3"

def compute_score(
    priority, is_active, days_to_target, days_to_dispatch,
    days_overdue, pct_complete, remaining_feet_ratio,
    order_value, avg_order_value, total_joints,
    advance_pct, is_repeat_client, avg_vendor_days_late,
    fully_covered_by_stock, on_non_material_hold
):
    if on_non_material_hold:
        return -9999
    if fully_covered_by_stock:
        return -9999

    tier = {"P1": 1000, "P2": 600, "P3": 300}.get(priority, 300)
    active_bonus = 200 if is_active else 0
    deadline_u = max(0, 30 - days_to_target) * 5
    dispatch_u = max(0, 20 - days_to_dispatch) * 6 if days_to_dispatch is not None else 0
    overdue = days_overdue * 15
    completion = pct_complete * 30
    feet = remaining_feet_ratio * 20
    value = (order_value / avg_order_value * 20) if avg_order_value else 0
    qty = (1 / total_joints * 100) if total_joints else 0
    advance = advance_pct * 0.15
    repeat = 50 if is_repeat_client else 0
    vendor = avg_vendor_days_late * -8
    return tier + active_bonus + deadline_u + dispatch_u + overdue + completion + feet + value + qty + advance + repeat + vendor

# Test 1: held project scores -9999
s = compute_score("P1", True, 5, None, 2, 0.5, 0.5, 100000, 100000, 10, 0, False, 0, False, True)
assert s == -9999, f"Expected -9999, got {s}"

# Test 2: stock-covered scores -9999
s = compute_score("P1", True, 5, None, 2, 0.5, 0.5, 100000, 100000, 10, 0, False, 0, True, False)
assert s == -9999, f"Expected -9999, got {s}"

# Test 3: P1 active beats P2 active with same deadline
p1 = compute_score("P1", True, 10, None, 0, 0.5, 0.5, 100000, 100000, 10, 0, False, 0, False, False)
p2 = compute_score("P2", True, 10, None, 0, 0.5, 0.5, 100000, 100000, 10, 0, False, 0, False, False)
assert p1 > p2, f"P1 {p1} should beat P2 {p2}"

# Test 4: overdue item scores higher than on-time same priority
overdue = compute_score("P2", True, 0, None, 3, 0.5, 0.5, 100000, 100000, 10, 0, False, 0, False, False)
ontime  = compute_score("P2", True, 10, None, 0, 0.5, 0.5, 100000, 100000, 10, 0, False, 0, False, False)
assert overdue > ontime, f"Overdue {overdue} should beat on-time {ontime}"

# Test 5: effective priority auto-compute
p = SimpleNamespace(priority=None, target_date=date.today() + timedelta(days=10))
assert _get_effective_priority(p) == "P1"
p2 = SimpleNamespace(priority=None, target_date=date.today() + timedelta(days=45))
assert _get_effective_priority(p2) == "P2"
p3 = SimpleNamespace(priority="P1", target_date=date.today() + timedelta(days=90))
assert _get_effective_priority(p3) == "P1"  # explicit override beats computed P3

print("All priority score tests passed.")
