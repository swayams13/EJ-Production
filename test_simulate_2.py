from backend.services.production_service import get_welding_master_latest

def test_latest():
    masters = get_welding_master_latest()
    master_map = {(m.size, getattr(m, 'joint_type', 'EJ') or 'EJ'): m for m in masters}
    print(master_map)
    m600 = master_map.get((600, 'EJ'))
    if m600:
        print("600 EJ:", m600.tig_feet, m600.mig_feet)
    else:
        print("600 EJ not found")

test_latest()
