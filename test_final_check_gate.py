from backend.services.mes_service import MESService

class C:
    def __init__(self, is_required, status):
        self.is_required = is_required; self.status = status

def test_no_required_checks_full():
    assert MESService.final_check_gate([C(False, "pending")]) == 1.0

def test_all_required_ready_full():
    assert MESService.final_check_gate([C(True, "ready"), C(True, "ready")]) == 1.0

def test_outstanding_required_caps_below_one():
    assert MESService.final_check_gate([C(True, "ready"), C(True, "pending")]) < 1.0

def test_empty_full():
    assert MESService.final_check_gate([]) == 1.0

if __name__ == "__main__":
    for f in [test_no_required_checks_full, test_all_required_ready_full,
              test_outstanding_required_caps_below_one, test_empty_full]:
        f()
    print("OK: final_check_gate")
