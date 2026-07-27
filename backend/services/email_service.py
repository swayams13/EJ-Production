import os
import logging
import threading
import urllib.request
import urllib.error
import json

logger = logging.getLogger(__name__)

BREVO_API_KEY = os.getenv("BREVO_API_KEY", "")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "EJ Tracker")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", "preciseengineersai@gmail.com")

# Legacy vars kept for diagnostics only
SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASS = os.getenv("SMTP_PASS")
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
SMTP_FROM = os.getenv("SMTP_FROM", "")


def send_system_email(to, subject: str, body: str) -> None:
    if not BREVO_API_KEY:
        logger.warning("BREVO_API_KEY not set — skipping email to %s", to)
        return
    recipients = [to] if isinstance(to, str) else to
    payload = json.dumps({
        "sender": {"name": SMTP_FROM_NAME, "email": SMTP_FROM_EMAIL},
        "to": [{"email": r} for r in recipients],
        "subject": subject,
        "textContent": body,
    }).encode()
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=payload,
        headers={
            "api-key": BREVO_API_KEY,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            logger.info("Email sent to %s via Brevo (status %s)", recipients, resp.status)
    except urllib.error.HTTPError as e:
        logger.error("Brevo API error %s for %s: %s", e.code, recipients, e.read().decode())
    except Exception as e:
        logger.error("Failed to send email to %s: %s", recipients, e)


def send_system_email_async(to, subject: str, body: str) -> None:
    """Fire-and-forget: API responds immediately, email sends in background."""
    threading.Thread(
        target=send_system_email, args=(to, subject, body), daemon=True
    ).start()
