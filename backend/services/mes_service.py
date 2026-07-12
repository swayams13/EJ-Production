import json
from sqlalchemy.orm import Session
from backend.services.db_service import (
    Project, ProjectProductionLine, Part, PartProcess, ProductionLog, JobFinalCheck, AssemblyStep
)
from backend.services.templates import TEMPLATES, route_for, base_weight_for
from backend.services import joint_catalog

class MESService:

    FINAL_CHECK_TYPES = ["testing", "painting", "weight", "marking", "packing"]

    @staticmethod
    def default_final_check_rows(line_id: int):
        defaults = {
            "testing": {"test_method": "Hydro/Pneumatic"},
            "painting": {},
            "weight": {},
            "marking": {"marking_type": "Hard Punch"},
            "packing": {},
        }
        return [
            {"production_line_id": line_id, "check_type": t, "is_required": True, **defaults[t]}
            for t in MESService.FINAL_CHECK_TYPES
        ]

    @staticmethod
    def create_final_checks_for_line(db: Session, line_id: int):
        existing = {c.check_type for c in db.query(JobFinalCheck).filter_by(production_line_id=line_id).all()}
        for row in MESService.default_final_check_rows(line_id):
            if row["check_type"] in existing:
                continue
            db.add(JobFinalCheck(**row))

    @staticmethod
    def create_assembly_steps_for_line(db: Session, line_id: int, tag_no: str = None):
        """Create AssemblyStep rows from the tag's proposed chain. No-op for legacy/untagged lines.
        Idempotent: skips step_no values already present, so it never resets a step marked ready."""
        if not tag_no or not joint_catalog.get_type(tag_no):
            return
        existing = {s.step_no for s in db.query(AssemblyStep).filter_by(production_line_id=line_id).all()}
        for step in joint_catalog.assembly_chain_for(tag_no):
            if step["step_no"] in existing:
                continue
            db.add(AssemblyStep(production_line_id=line_id, step_no=step["step_no"], label=step["label"]))

    @staticmethod
    def final_check_gate(checks):
        """
        Gates project progress on required final checks.
        Returns 1.0 if all required checks are ready or none are required.
        Returns < 1.0 if any required check is outstanding.
        """
        required = [c for c in checks if getattr(c, "is_required", True)]
        if not required:
            return 1.0
        ready = sum(1 for c in required if c.status == "ready")
        if ready == len(required):
            return 1.0
        # ponytail: flat 95% cap until all required checks pass — scaling to 0 when 0 checks done
        # would wipe out all fab+weld progress on first deploy (every new line has 0 checks done).
        return 0.95

    @staticmethod
    def create_parts_for_production_line(db: Session, line_id: int, req_type: str = "EJ",
                                         tag_no: str = None, variable_qtys: dict = None):
        """
        Create the Part + PartProcess rows for a production line.

        Primary path (tag-driven): if the line has a joint tag in the catalog,
        the parts are exactly that tag's BOM components, each with a scaled
        target quantity (qty_per_unit and total_qty = qty_per_unit * line qty).
        Processes come from PROCESS_ROUTES per component. Paint is a line-level
        status (paint_status), not a part.

        Fallback path (legacy): lines with no tag use the old EJ/DJ template so
        pre-existing data keeps working.
        """
        line = db.query(ProjectProductionLine).filter(ProjectProductionLine.id == line_id).first()
        if not line:
            return None

        tag = tag_no or getattr(line, "joint_type_code", None)

        # Resolve the user-entered ("ENTER") component quantities.
        if variable_qtys is None:
            variable_qtys = {}
            raw = getattr(line, "variable_qtys_json", None)
            if raw:
                try:
                    variable_qtys = json.loads(raw) or {}
                except (ValueError, TypeError):
                    variable_qtys = {}

        # -------- tag-driven BOM (data-driven per joint + tag) --------
        if tag and joint_catalog.get_type(tag):
            comps = joint_catalog.resolve_components(tag, line.quantity or 0, variable_qtys)
            base_total = sum(base_weight_for(c["name"]) for c in comps) or 1.0
            for c in comps:
                new_part = Part(
                    production_line_id=line.id,
                    name=c["name"],
                    weight_percentage=base_weight_for(c["name"]) / base_total * 100.0,
                    qty_per_unit=c["per_unit"],
                    total_qty=c["total_qty"],
                )
                db.add(new_part)
                db.flush()
                for process_name in route_for(c["name"]):
                    db.add(PartProcess(part_id=new_part.id, process_name=process_name, completed_qty=0))
            MESService.create_final_checks_for_line(db, line.id)
            MESService.create_assembly_steps_for_line(db, line.id, tag)
            return line

        # -------- legacy fallback template (pre-tag lines only) --------
        return MESService._create_parts_legacy(db, line, req_type)

    @staticmethod
    def _create_parts_legacy(db: Session, line, req_type: str):
        template = TEMPLATES.get(req_type)
        if not template:
            return line

        for part_data in template:
            new_part = Part(
                production_line_id=line.id,
                name=part_data["name"],
                weight_percentage=part_data["weight"],
                qty_per_unit=1.0,
                total_qty=int(line.quantity or 0),
            )
            db.add(new_part)
            db.flush() # Get new_part.id

            for process_name in part_data["processes"]:
                new_process = PartProcess(
                    part_id=new_part.id,
                    process_name=process_name,
                    completed_qty=0
                )
                db.add(new_process)

        MESService.create_final_checks_for_line(db, line.id)
        return line

    @staticmethod
    def sync_part_targets(db: Session, line, variable_qtys: dict = None):
        """
        Re-resolve a tag line's BOM and update existing Part targets in place,
        preserving completed_qty (progress). Used when an existing line's
        quantity or ENTER quantities change. Adds parts for newly-present
        components, removes parts for components no longer in the BOM.
        Legacy lines (no tag) are left untouched.
        """
        tag = getattr(line, "joint_type_code", None)
        if not (tag and joint_catalog.get_type(tag)):
            return

        if variable_qtys is None:
            variable_qtys = {}
            raw = getattr(line, "variable_qtys_json", None)
            if raw:
                try:
                    variable_qtys = json.loads(raw) or {}
                except (ValueError, TypeError):
                    variable_qtys = {}

        comps = joint_catalog.resolve_components(tag, line.quantity or 0, variable_qtys)
        comp_by_name = {c["name"]: c for c in comps}
        base_total = sum(base_weight_for(c["name"]) for c in comps) or 1.0

        existing = {p.name: p for p in line.parts}

        for name, c in comp_by_name.items():
            weight = base_weight_for(name) / base_total * 100.0
            p = existing.get(name)
            if p:
                p.qty_per_unit = c["per_unit"]
                p.total_qty = c["total_qty"]
                p.weight_percentage = weight
                # Never let a preserved completed_qty exceed the new target
                for proc in p.processes:
                    if proc.completed_qty > c["total_qty"]:
                        proc.completed_qty = c["total_qty"]
            else:
                new_part = Part(
                    production_line_id=line.id, name=name,
                    weight_percentage=weight,
                    qty_per_unit=c["per_unit"], total_qty=c["total_qty"],
                )
                db.add(new_part)
                db.flush()
                for pname in route_for(name):
                    db.add(PartProcess(part_id=new_part.id, process_name=pname, completed_qty=0))

        for name, p in existing.items():
            if name not in comp_by_name:
                db.delete(p)

        MESService.create_assembly_steps_for_line(db, line.id, tag)

    @staticmethod
    def calculate_project_progress(db: Session, project_id: int):
        from sqlalchemy.orm import selectinload
        from backend.services.db_service import Part, WeldingLog
        
        lines = db.query(ProjectProductionLine).options(
            selectinload(ProjectProductionLine.parts).selectinload(Part.processes)
        ).filter(ProjectProductionLine.project_id == project_id).all()
        
        if not lines:
            return 0.0
            
        line_ids = [l.id for l in lines]
        logs = db.query(WeldingLog).filter(WeldingLog.production_line_id.in_(line_ids)).all()
        logs_by_line = {}
        for log in logs:
            logs_by_line.setdefault(log.production_line_id, []).append(log)
            
        total_line_completion = 0.0
        
        for line in lines:
            line_qty = line.quantity
            if line_qty == 0:
                continue
                
            line_fabrication_completion = 0.0
            
            for part in line.parts:
                if not part.processes:
                    continue
                    
                # Per-part target: scaled BOM quantity (qty_per_unit * n).
                # Falls back to line_qty for legacy parts written before the
                # tag/BOM system (total_qty defaults to 0 there).
                part_target = getattr(part, "total_qty", 0) or line_qty

                total_process_completion = 0.0
                valid_processes = 0
                for proc in part.processes:
                    name = proc.process_name.lower()
                    if "weld" in name or "grind" in name or "tig" in name or "mig" in name:
                        continue

                    pct = min(1.0, proc.completed_qty / part_target) if part_target else 1.0
                    total_process_completion += pct
                    valid_processes += 1
                    
                if valid_processes > 0:
                    avg_part_completion = total_process_completion / valid_processes
                else:
                    avg_part_completion = 1.0
                
                part_contribution = avg_part_completion * part.weight_percentage
                line_fabrication_completion += part_contribution
                
            line_logs = logs_by_line.get(line.id, [])
            completed_weld = sum(l.feet_done for l in line_logs)
            target_weld = (line.tig_feet or 0) + (line.mig_feet or 0) + (line.grinding_feet or 0)
            
            welding_pct = min(1.0, completed_weld / target_weld) if target_weld > 0 else 1.0

            # Blend: 70% Fabrication, 30% Welding
            line_completion = (line_fabrication_completion * 0.7) + (welding_pct * 30.0)

            # Gate on required final checks
            line_checks = db.query(JobFinalCheck).filter_by(production_line_id=line.id).all()
            line_completion *= MESService.final_check_gate(line_checks)

            total_line_completion += line_completion
            
        # Average over all production lines
        return min(100.0, total_line_completion / len(lines))
