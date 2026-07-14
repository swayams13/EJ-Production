"""One-shot idempotent backfill: bring pre-existing production lines up to the
enriched templates (Task 1) and give them final-check rows (Task 3).

Additive only — never deletes or renames existing PartProcess rows, so any
progress already logged against them is preserved.
"""
import logging
from backend.services.db_service import ProjectProductionLine, Part, PartProcess
from backend.services.templates import TEMPLATES
from backend.services.mes_service import MESService

logger = logging.getLogger("uvicorn.error")


def backfill_itemwise(SessionLocal):
    db = SessionLocal()
    try:
        added_steps = 0
        lines = db.query(ProjectProductionLine).all()
        for line in lines:
            template = TEMPLATES.get(getattr(line, "joint_type", "EJ") or "EJ")
            if not template:
                continue
            tmpl_by_name = {p["name"]: p["processes"] for p in template}

            for part in line.parts:
                wanted = tmpl_by_name.get(part.name)
                if not wanted:
                    continue
                existing = {proc.process_name for proc in part.processes}
                for pname in wanted:
                    if pname not in existing:
                        db.add(PartProcess(part_id=part.id, process_name=pname, completed_qty=0, status="pending"))
                        added_steps += 1

            MESService.create_final_checks_for_line(db, line.id)
            MESService.create_assembly_steps_for_line(db, line.id, getattr(line, "joint_type_code", None))

        db.commit()
        logger.info("itemwise backfill: added %d missing steps across %d lines", added_steps, len(lines))
    except Exception as e:
        db.rollback()
        logger.warning("itemwise backfill skipped/failed: %s", e)
    finally:
        db.close()
