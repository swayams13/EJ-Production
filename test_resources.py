import sys
import math
from datetime import date
from backend.services.db_service import SessionLocal, WorkforceMaster
from backend.services.production_service import get_welding_master_latest, calculate_required_resources_for_deadline

# Data from frontend simulation
bellows = [{"size": 5, "qty": 10, "type": "EJ"}, {"size": 5, "qty": 5, "type": "DJ"}]
target_days = 15

# Method 1: simulate_resources
tot_tig, tot_mig, tot_grind = 0, 0, 0
master_data = {(m.size, getattr(m, 'joint_type', 'EJ')): m for m in get_welding_master_latest()}
for b in bellows:
    m = master_data.get((b["size"], b["type"]))
    if m:
        tot_tig += (m.tig_feet or 0) * b["qty"]
        tot_mig += (m.mig_feet or 0) * b["qty"]
        tot_grind += (m.grinding_feet or 0) * b["qty"]

session = SessionLocal()
workforce = session.query(WorkforceMaster).all()
prod = {w.resource_type: w.avg_productivity_per_day for w in workforce}
tig_prod = prod.get("TIG Welder", 180)
mig_prod = prod.get("MIG Welder", 120)
grind_prod = prod.get("Grinder", 80)

req_tig = math.ceil(tot_tig / (tig_prod * target_days)) if tig_prod > 0 else 0
print(f"Simulate -> TIG: {req_tig}, tot_tig: {tot_tig}, tig_prod: {tig_prod}")

