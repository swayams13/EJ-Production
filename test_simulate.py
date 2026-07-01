import math
import asyncio
from sqlalchemy.orm import Session
from backend.services.db_service import SessionLocal, WeldingMaster, WorkforceMaster

def test_simulate():
    session = SessionLocal()
    masters = session.query(WeldingMaster).filter(WeldingMaster.size.in_([600, 1000])).all()
        
    workforce = session.query(WorkforceMaster).all()
    prod = {w.resource_type: w.avg_productivity_per_day for w in workforce}
    print("Productivity Data:", prod)

    # Let's simulate size 600 EJ (qty 10), and size 1000 DJ (qty 5), target days 7
    bellows = [
        {"size": 600, "type": "EJ", "qty": 10},
        {"size": 1000, "type": "DJ", "qty": 5} # DJ doesn't exist in our DB currently but let's test EJ only
    ]
    
    tot_tig, tot_mig, tot_grind = 0, 0, 0
    master_map = {(m.size, getattr(m, 'joint_type', 'EJ') or 'EJ'): m for m in masters}
    
    for b in bellows:
        m = master_map.get((b["size"], b["type"]))
        if m:
            tot_tig += (m.tig_feet or 0) * b["qty"]
            tot_mig += (m.mig_feet or 0) * b["qty"]
            tot_grind += (m.grinding_feet or 0) * b["qty"]
            
    tig_prod = prod.get("TIG Welder", 180.0)
    mig_prod = prod.get("MIG Welder", 120.0)
    grind_prod = prod.get("Grinder", 80.0)
    
    target_days = 7
    
    req_tig = math.ceil(tot_tig / (target_days * tig_prod)) if tig_prod > 0 else 0
    req_mig = math.ceil(tot_mig / (target_days * mig_prod)) if mig_prod > 0 else 0
    req_grind = math.ceil(tot_grind / (target_days * grind_prod)) if grind_prod > 0 else 0
    
    print("\nSimulation Result:")
    print(f"Total TIG feet: {tot_tig}, Required TIG Welders for {target_days} days: {req_tig}")
    print(f"Total MIG feet: {tot_mig}, Required MIG Welders for {target_days} days: {req_mig}")
    print(f"Total Grind feet: {tot_grind}, Required Grinders for {target_days} days: {req_grind}")

test_simulate()
