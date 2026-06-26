from sqlalchemy.orm import Session
from backend.services.db_service import (
    Project, ProjectProductionLine, Part, PartProcess, ProductionLog
)
from backend.services.templates import TEMPLATES

class MESService:
    
    @staticmethod
    def create_parts_for_production_line(db: Session, line_id: int, req_type: str = "EJ"):
        """
        Creates all parts and processes based on the template for a given project production line.
        """
        line = db.query(ProjectProductionLine).filter(ProjectProductionLine.id == line_id).first()
        if not line:
            return None
            
        template = TEMPLATES.get(req_type)
        if not template:
            return line
            
        for part_data in template:
            new_part = Part(
                production_line_id=line.id,
                name=part_data["name"],
                weight_percentage=part_data["weight"]
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
                
        return line
    
    @staticmethod
    def calculate_project_progress(db: Session, project_id: int):
        """
        Calculates the mathematical completion percentage of a project based on its production lines.
        """
        lines = db.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == project_id).all()
        if not lines:
            return 0.0
            
        total_line_completion = 0.0
        
        for line in lines:
            line_qty = line.quantity
            if line_qty == 0:
                continue
                
            line_fabrication_completion = 0.0
            
            for part in line.parts:
                if not part.processes:
                    continue
                    
                total_process_completion = 0.0
                valid_processes = 0
                for proc in part.processes:
                    name = proc.process_name.lower()
                    if "weld" in name or "grind" in name or "tig" in name or "mig" in name:
                        continue
                        
                    pct = min(1.0, proc.completed_qty / line_qty)
                    total_process_completion += pct
                    valid_processes += 1
                    
                if valid_processes > 0:
                    avg_part_completion = total_process_completion / valid_processes
                else:
                    avg_part_completion = 1.0
                
                part_contribution = avg_part_completion * part.weight_percentage
                line_fabrication_completion += part_contribution
                
            from backend.services.db_service import WeldingLog
            logs = db.query(WeldingLog).filter_by(production_line_id=line.id).all()
            completed_weld = sum(l.feet_done for l in logs)
            target_weld = (line.tig_feet or 0) + (line.mig_feet or 0) + (line.grinding_feet or 0)
            
            welding_pct = min(1.0, completed_weld / target_weld) if target_weld > 0 else 1.0
            
            # Blend: 70% Fabrication, 30% Welding
            line_completion = (line_fabrication_completion * 0.7) + (welding_pct * 30.0)
                
            total_line_completion += line_completion
            
        # Average over all production lines
        return min(100.0, total_line_completion / len(lines))
