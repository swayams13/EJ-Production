from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from backend.services.db_service import get_db, RawMaterialInventory, Project, ProjectProductionLine
from backend.app.auth.rbac import require_roles
from backend.app.inventory.schemas import InventoryItemCreate, InventoryItemUpdate, InventoryItemResponse, ShortageResponse

router = APIRouter(prefix="/api/v1/inventory", tags=["Inventory"])

@router.get("", response_model=List[InventoryItemResponse])
def get_inventory(db: Session = Depends(get_db)):
    return db.query(RawMaterialInventory).all()

@router.post("", response_model=InventoryItemResponse)
def add_inventory_item(item: InventoryItemCreate, db: Session = Depends(get_db)):
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
def update_inventory_item(item_id: int, updates: InventoryItemUpdate, db: Session = Depends(get_db)):
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
def delete_inventory_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(RawMaterialInventory).filter_by(id=item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    db.delete(item)
    db.commit()
    return {"success": True, "message": "Item deleted"}

@router.get("/shortages", response_model=List[ShortageResponse])
def get_material_shortages(db: Session = Depends(get_db)):
    active_projects = db.query(Project).filter(Project.status == "Active").all()
    inventory = db.query(RawMaterialInventory).all()
    
    stock_map = {}
    for inv in inventory:
        stock_map[(inv.material_name.lower(), inv.size, inv.joint_type)] = inv.current_stock
        
    shortages = []
    
    for project in active_projects:
        for line in project.production_lines:
            req_qty = line.quantity
            current_stock = stock_map.get(("bellows", line.size, line.joint_type), 0)
            
            if req_qty > current_stock:
                shortages.append(ShortageResponse(
                    project_id=project.id,
                    project_code=project.quotation_no,
                    material_name="Bellows",
                    size=line.size,
                    joint_type=line.joint_type,
                    required_qty=req_qty,
                    current_stock=current_stock,
                    deficit=req_qty - current_stock
                ))
                
    return shortages
