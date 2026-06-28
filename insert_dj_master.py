from backend.services.production_service import import_dismantling_joint_master

success, msg = import_dismantling_joint_master()
print(f"Success: {success}")
print(f"Message: {msg}")
