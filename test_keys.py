import sys
from backend.services.db_service import SessionLocal
from backend.services.production_service import get_welding_master_latest

master_data = {(m.size, getattr(m, 'joint_type', 'EJ')): m for m in get_welding_master_latest()}
print(f"Keys: {list(master_data.keys())[:5]}")
print(f"5 == 5.0? {5 == 5.0}")

