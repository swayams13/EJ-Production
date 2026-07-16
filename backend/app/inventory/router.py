from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from backend.services.db_service import get_db, RawMaterialInventory, WarehouseStock, Project, ProjectProductionLine
from backend.app.auth.rbac import require_roles, SUPERVISORS, MANAGEMENT
from backend.app.inventory.schemas import InventoryItemCreate, InventoryItemUpdate, InventoryItemResponse, ShortageResponse

router = APIRouter(prefix="/api/v1/inventory", tags=["Inventory"])

@router.get("", response_model=List[InventoryItemResponse])
def get_inventory(db: Session = Depends(get_db), current_user: dict = Depends(require_roles(SUPERVISORS))):
    return db.query(RawMaterialInventory).all()

@router.post("", response_model=InventoryItemResponse)
def add_inventory_item(item: InventoryItemCreate, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(MANAGEMENT))):
    # Check if item exists
    existing = db.query(RawMaterialInventory).filter_by(
        material_name=item.material_name,
        size=item.size,
        joint_type=item.joint_type
    ).first()
    
    if existing:
        existing.current_stock += item.current_stock
        existing.minimum_required_stock = item.minimum_required_stock
        db.commit()
        db.refresh(existing)
        return existing
        
    new_item = RawMaterialInventory(**item.model_dump())
    db.add(new_item)
    db.commit()
    db.refresh(new_item)
    return new_item

@router.put("/{item_id}", response_model=InventoryItemResponse)
def update_inventory_item(item_id: int, updates: InventoryItemUpdate, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(MANAGEMENT))):
    item = db.query(RawMaterialInventory).filter_by(id=item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
        
    if updates.current_stock is not None:
        item.current_stock = updates.current_stock
    if updates.minimum_required_stock is not None:
        item.minimum_required_stock = updates.minimum_required_stock
        
    db.commit()
    db.refresh(item)
    return item

@router.delete("/{item_id}")
def delete_inventory_item(item_id: int, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(MANAGEMENT))):
    item = db.query(RawMaterialInventory).filter_by(id=item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    db.delete(item)
    db.commit()
    return {"success": True, "message": "Item deleted"}

@router.get("/shortages", response_model=List[ShortageResponse])
def get_material_shortages(db: Session = Depends(get_db), current_user: dict = Depends(require_roles(SUPERVISORS))):
    # Include Active, Hold, and Planning projects - only Completed projects have
    # no material demand left. Previously this only checked status == "Active",
    # so Hold/Planning projects' material needs never surfaced as shortages.
    relevant_projects = db.query(Project).filter(
        (Project.status != "Completed") | (Project.status == None)
    ).all()
    # Use WarehouseStock (procurement system) as the single source of truth.
    # available_qty = qty_on_hand - reserved_qty (same as procurement_service._available_stock)
    stock_map = {}
    for ws in db.query(WarehouseStock).all():
        stock_map[(ws.material_name, ws.size, ws.joint_type)] = max(0, ws.qty_on_hand - ws.reserved_qty)

    shortages = []

    for project in relevant_projects:
        try:
            for line in project.production_lines:
                try:
                    for part in line.parts:
                        required = getattr(part, 'total_qty', 0)
                        if not required:
                            continue
                        key = (part.name, line.size, line.joint_type)
                        if key not in stock_map:
                            continue
                        current = stock_map[key]
                        if required > current:
                            shortages.append(ShortageResponse(
                                project_id=project.id,
                                project_code=project.quotation_no,
                                material_name=part.name,
                                component_name=part.name,
                                size=line.size,
                                joint_type=line.joint_type,
                                joint_category=getattr(line, 'joint_category', None),
                                required_qty=required,
                                current_stock=current,
                                deficit=required - current
                            ))
                except Exception:
                    continue
        except Exception:
            continue

    return shortages
