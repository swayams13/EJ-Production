from unittest.mock import MagicMock
def test_create_notification_adds_to_db():
    from backend.services.notification_service import create_notification
    db = MagicMock()
    create_notification(db, "GM", "completion_request", "New request", "PM submitted", "/projects", 1)
    assert db.add.called
    assert db.commit.called
    added = db.add.call_args[0][0]
    assert added.for_role == "GM"
    assert added.event_type == "completion_request"
    assert added.project_id == 1
if __name__ == "__main__":
    test_create_notification_adds_to_db()
    print("OK")
