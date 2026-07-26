import os
import logging
import threading
import urllib.request
import urllib.error
import json

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
SMTP_FROM = os.getenv("SMTP_FROM", "EJ Tracker <onboarding@resend.dev>")

# Legacy SMTP vars — kept so test-email endpoint can still read them for diagnostics
SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASS = os.getenv("SMTP_PASS")


def send_system_email(to, subject: str, body: str) -> None:
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — skipping email to %s", to)
        return
    recipients = [to] if isinstance(to, str) else to
    payload = json.dumps({
        "from": SMTP_FROM,
        "to": recipients,
        "subject": subject,
        "text": body,
    }).encode()
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            logger.info("Email sent to %s via Resend (status %s)", recipients, resp.status)
    except urllib.error.HTTPError as e:
        logger.error("Resend API error %s for %s: %s", e.code, recipients, e.read().decode())
    except Exception as e:
        logger.error("Failed to send email to %s: %s", recipients, e)


def send_system_email_async(to, subject: str, body: str) -> None:
    """Fire-and-forget: API responds immediately, email sends in background."""
    threading.Thread(
        target=send_system_email, args=(to, subject, body), daemon=True
    ).start()
