import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.services.db_service import SessionLocal
from backend.app.dashboard.router import get_executive_briefing_data
from backend.services.briefing_service import format_briefing_email
from backend.services.email_service import send_system_email


def main():
    recipients = [e for e in (os.getenv("CEO_EMAIL"), os.getenv("MD_EMAIL")) if e]
    if not recipients:
        print("No CEO_EMAIL/MD_EMAIL configured — nothing to send", file=sys.stderr)
        sys.exit(1)  # fail loud: an unattended daily job should show as a failed Railway run, not a silent no-op

    db = SessionLocal()
    try:
        data = get_executive_briefing_data(db)
    finally:
        db.close()

    body = format_briefing_email(data)
    subject = f"EJ Tracker — Morning Briefing — {data['today']}"
    send_system_email(recipients, subject, body)
    print(f"Sent morning briefing to {recipients}")


if __name__ == "__main__":
    main()
