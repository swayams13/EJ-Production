from unittest.mock import patch, MagicMock
import os
os.environ.setdefault("SMTP_HOST", "smtp.office365.com")
os.environ.setdefault("SMTP_PORT", "587")
os.environ.setdefault("SMTP_USER", "test@org.com")
os.environ.setdefault("SMTP_PASS", "secret")
from backend.services.email_service import send_system_email
def test_sends_email_via_smtp():
    with patch("smtplib.SMTP") as mock_smtp_cls:
        mock_server = MagicMock()
        mock_smtp_cls.return_value.__enter__ = lambda s: mock_server
        mock_smtp_cls.return_value.__exit__ = MagicMock(return_value=False)
        send_system_email("gm@org.com", "[EJ Tracker] Test", "Hello GM")
        assert mock_server.sendmail.called
def test_skips_when_no_creds():
    import backend.services.email_service as svc
    orig = svc.SMTP_HOST
    svc.SMTP_HOST = None
    send_system_email("gm@org.com", "subject", "body")
    svc.SMTP_HOST = orig
if __name__ == "__main__":
    test_sends_email_via_smtp()
    test_skips_when_no_creds()
    print("OK")
