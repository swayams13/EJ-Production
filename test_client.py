import os
os.environ["DATABASE_URL"] = "sqlite:///./test.db"
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

# Bypass auth by mocking the dependency
from backend.app.auth.rbac import require_roles
def override_require_roles(allowed_roles):
    def check_role():
        return {"id": 1, "role": "Supervisor"}
    return check_role

app.dependency_overrides[require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"])] = lambda: {"id": 1, "role": "Supervisor"}

response = client.get("/api/v1/scheduler/assignments?target_date=2026-06-27")
print("STATUS:", response.status_code)
print("JSON:", response.json())
