from backend.services.progress_status import compute_process_status

def test_none_done_is_pending():
    assert compute_process_status(0, 5) == "pending"

def test_partial_is_in_process():
    assert compute_process_status(2, 5) == "in_process"

def test_all_done_is_ready():
    assert compute_process_status(5, 5) == "ready"

def test_over_done_is_ready():
    assert compute_process_status(7, 5) == "ready"

def test_zero_required_is_ready():
    # A step with no required quantity is considered satisfied (matches calc's valid_processes==0 -> 1.0 behavior)
    assert compute_process_status(0, 0) == "ready"

if __name__ == "__main__":
    for f in [test_none_done_is_pending, test_partial_is_in_process, test_all_done_is_ready,
              test_over_done_is_ready, test_zero_required_is_ready]:
        f()
    print("OK: compute_process_status")
