import os
import logging
import smtplib
import threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

logger = logging.getLogger(__name__)

SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASS = os.getenv("SMTP_PASS")
SMTP_TIMEOUT = 10  # seconds — prevents indefinite block on bad SMTP config


def send_system_email(to, subject: str, body: str) -> None:
    if not SMTP_HOST or not SMTP_USER or not SMTP_PASS:
        logger.warning("SMTP not configured — skipping email to %s", to)
        return
    recipients = [to] if isinstance(to, str) else to
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = SMTP_USER
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(body, "plain"))
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, recipients, msg.as_string())
        logger.info("Email sent to %s: %s", recipients, subject)
    except Exception as e:
        logger.error("Failed to send email to %s: %s", recipients, e)


def send_system_email_async(to, subject: str, body: str) -> None:
    """Fire-and-forget: API responds immediately, email sends in background."""
    threading.Thread(
        target=send_system_email, args=(to, subject, body), daemon=True
    ).start()
