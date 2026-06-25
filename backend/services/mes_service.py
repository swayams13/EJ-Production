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
                
            line_completion = 0.0
            
            for part in line.parts:
                if not part.processes:
                    continue
                    
                total_process_completion = 0.0
                for proc in part.processes:
                    # process completion is bounded by 1.0 (100%)
                    pct = min(1.0, proc.completed_qty / line_qty)
                    total_process_completion += pct
                    
                avg_part_completion = total_process_completion / len(part.processes)
                
                # Add to line's total based on weight (e.g., avg=0.5, weight=20 => 10 points)
                part_contribution = avg_part_completion * part.weight_percentage
                line_completion += part_contribution
                
            total_line_completion += line_completion
            
        # Average over all production lines
        return min(100.0, total_line_completion / len(lines))
