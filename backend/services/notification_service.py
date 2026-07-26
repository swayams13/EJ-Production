import logging
from sqlalchemy.orm import Session
from backend.services.db_service import Notification

logger = logging.getLogger(__name__)


def create_notification(
    db: Session,
    for_role: str,
    event_type: str,
    title: str,
    body: str,
    link: str,
    project_id: int = None,
) -> None:
    notif = Notification(
        for_role=for_role,
        event_type=event_type,
        title=title,
        body=body,
        link=link,
        project_id=project_id,
    )
    db.add(notif)
    db.commit()
    logger.info("Notification created for role=%s event=%s", for_role, event_type)
