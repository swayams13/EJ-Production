"""Pure status derivation for item-progress steps and final checks.

Canonical status values: 'pending' | 'required' | 'in_process' | 'ready'.
PartProcess steps use pending/in_process/ready. 'required' is used by
final checks that are flagged required but not yet started.
"""

def compute_process_status(completed_qty: int, required_qty: int) -> str:
    if required_qty <= 0:
        return "ready"
    if completed_qty <= 0:
        return "pending"
    if completed_qty >= required_qty:
        return "ready"
    return "in_process"
