"""
WebSocket router for real-time dashboard updates.

Provides three WebSocket endpoints that mirror the existing HTTP dashboard
and production endpoints, pushing fresh data to connected clients every
2-3 seconds so the frontend can drop its HTTP polling loops.

Endpoints
---------
/ws/dashboard/status          – Progress Dashboard  (mirrors GET /api/v1/dashboard/status)
/ws/dashboard/wip             – WIP Tracking Center (mirrors GET /api/v1/dashboard/wip)
/ws/production/parts/{req_id} – Visual Tracking     (mirrors GET /api/v1/production/parts/{req_id})
"""

import asyncio
import json
import logging
from typing import Dict, List

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.services.db_service import (
    SessionLocal,
    Project,
    ProjectProductionLine,
    PartProcess,
)
from backend.services.production_service import get_company_capacity_status

logger = logging.getLogger(__name__)

router = APIRouter(tags=["WebSocket"])

# ---------------------------------------------------------------------------
# Connection Manager
# ---------------------------------------------------------------------------

class ConnectionManager:
    """Tracks all active WebSocket connections, keyed by an arbitrary channel."""

    def __init__(self) -> None:
        # channel -> list of active WebSocket connections
        self._connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, channel: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(channel, []).append(websocket)
        logger.info("WebSocket connected: channel=%s total=%d", channel, len(self._connections[channel]))

    def disconnect(self, channel: str, websocket: WebSocket) -> None:
        channel_conns = self._connections.get(channel, [])
        if websocket in channel_conns:
            channel_conns.remove(websocket)
        logger.info("WebSocket disconnected: channel=%s remaining=%d", channel, len(channel_conns))

    async def send_json(self, channel: str, websocket: WebSocket, payload: dict) -> None:
        """Send a JSON payload to a single connection, catching stale-socket errors."""
        try:
            await websocket.send_text(json.dumps(payload))
        except Exception as exc:
            logger.debug("Failed to send to %s: %s", channel, exc)
            self.disconnect(channel, websocket)


manager = ConnectionManager()

# ---------------------------------------------------------------------------
# Data-fetching helpers (synchronous, run in a thread-pool via asyncio)
# ---------------------------------------------------------------------------

def _fetch_status_data(target_days: int = 15) -> dict:
    """Return the same payload as GET /api/v1/dashboard/status."""
    status = get_company_capacity_status(target_days)
    return {"success": True, "message": "Status retrieved", "data": status}


def _fetch_wip_data() -> dict:
    """Return the same payload as GET /api/v1/dashboard/wip."""
    from backend.services.mes_service import MESService

    db = SessionLocal()
    try:
        active_projects = db.query(Project).filter(Project.status != "Completed").all()

        wip_data = {
            "Fabrication Shop": {"required": 0, "completed": 0},
            "Assembly Shop":    {"required": 0, "completed": 0},
            "Bellows Shop":     {"required": 0, "completed": 0},
            "Machining Shop":   {"required": 0, "completed": 0},
        }

        for p in active_projects:
            lines = db.query(ProjectProductionLine).filter_by(project_id=p.id).all()
            for line in lines:
                wip_data["Bellows Shop"]["required"] += line.quantity

            progress = MESService.calculate_project_progress(db, p.id)
            if progress > 0:
                for line in lines:
                    wip_data["Bellows Shop"]["completed"] += line.quantity * (progress / 100)

        for shop in wip_data:
            wip_data[shop]["required"] = round(wip_data[shop]["required"], 1)
            wip_data[shop]["completed"] = round(wip_data[shop]["completed"], 1)

        return {"success": True, "message": "WIP dashboard retrieved", "data": wip_data}
    finally:
        db.close()


def _fetch_parts_data(req_id: int) -> dict:
    """Return the same payload as GET /api/v1/production/parts/{req_id}."""
    db = SessionLocal()
    try:
        line = db.query(ProjectProductionLine).filter_by(id=req_id).first()
        if not line:
            return {"success": False, "message": "Requirement not found", "data": None}

        parts_data = []
        for part in line.parts:
            proc_data = [
                {
                    "id": proc.id,
                    "process_name": proc.process_name,
                    "completed_qty": proc.completed_qty,
                }
                for proc in part.processes
            ]
            parts_data.append(
                {
                    "id": part.id,
                    "name": part.name,
                    "weight_percentage": part.weight_percentage,
                    "processes": proc_data,
                }
            )

        return {
            "success": True,
            "data": {
                "requirement_id": line.id,
                "total_qty": line.quantity,
                "parts": parts_data,
            },
        }
    finally:
        db.close()


# ---------------------------------------------------------------------------
# WebSocket endpoints
# ---------------------------------------------------------------------------

REFRESH_INTERVAL = 2  # seconds between data pushes


@router.websocket("/ws/dashboard/status")
async def ws_dashboard_status(websocket: WebSocket):
    """
    Real-time Progress Dashboard feed.

    Sends the same JSON structure as GET /api/v1/dashboard/status every
    REFRESH_INTERVAL seconds.  Accepts an optional query parameter
    ``target_days`` (default 15) to match the HTTP endpoint behaviour.
    """
    channel = "dashboard:status"
    await manager.connect(channel, websocket)

    # Read optional query param
    target_days: int = 15
    try:
        raw = websocket.query_params.get("target_days", "15")
        target_days = int(raw)
    except (ValueError, AttributeError):
        target_days = 15

    try:
        while True:
            payload = await asyncio.get_event_loop().run_in_executor(
                None, _fetch_status_data, target_days
            )
            await manager.send_json(channel, websocket, payload)
            await asyncio.sleep(REFRESH_INTERVAL)
    except WebSocketDisconnect:
        manager.disconnect(channel, websocket)
    except Exception as exc:
        logger.error("ws_dashboard_status error: %s", exc)
        manager.disconnect(channel, websocket)


@router.websocket("/ws/dashboard/wip")
async def ws_dashboard_wip(websocket: WebSocket):
    """
    Real-time WIP Tracking Center feed.

    Sends the same JSON structure as GET /api/v1/dashboard/wip every
    REFRESH_INTERVAL seconds.
    """
    channel = "dashboard:wip"
    await manager.connect(channel, websocket)

    try:
        while True:
            payload = await asyncio.get_event_loop().run_in_executor(
                None, _fetch_wip_data
            )
            await manager.send_json(channel, websocket, payload)
            await asyncio.sleep(REFRESH_INTERVAL)
    except WebSocketDisconnect:
        manager.disconnect(channel, websocket)
    except Exception as exc:
        logger.error("ws_dashboard_wip error: %s", exc)
        manager.disconnect(channel, websocket)


@router.websocket("/ws/production/parts/{req_id}")
async def ws_production_parts(websocket: WebSocket, req_id: int):
    """
    Real-time Visual Tracking feed for a single production-line requirement.

    Sends the same JSON structure as GET /api/v1/production/parts/{req_id}
    every REFRESH_INTERVAL seconds.  The path parameter ``req_id`` maps
    directly to the ``requirementId`` used by the frontend.
    """
    channel = f"production:parts:{req_id}"
    await manager.connect(channel, websocket)

    try:
        while True:
            payload = await asyncio.get_event_loop().run_in_executor(
                None, _fetch_parts_data, req_id
            )
            await manager.send_json(channel, websocket, payload)
            await asyncio.sleep(REFRESH_INTERVAL)
    except WebSocketDisconnect:
        manager.disconnect(channel, websocket)
    except Exception as exc:
        logger.error("ws_production_parts error (req_id=%d): %s", req_id, exc)
        manager.disconnect(channel, websocket)
