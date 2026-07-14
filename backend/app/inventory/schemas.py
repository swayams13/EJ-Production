from pydantic import BaseModel
from typing import Optional

class InventoryItemBase(BaseModel):
    material_name: str
    size: int
    joint_type: str
    current_stock: int
    minimum_required_stock: int

class InventoryItemCreate(InventoryItemBase):
    pass

class InventoryItemUpdate(BaseModel):
    current_stock: Optional[int] = None
    minimum_required_stock: Optional[int] = None

class InventoryItemResponse(InventoryItemBase):
    id: int

    class Config:
        from_attributes = True

class ShortageResponse(BaseModel):
    project_id: int
    project_code: str
    material_name: str
    component_name: Optional[str] = None
    joint_category: Optional[str] = None
    size: int
    joint_type: str
    required_qty: int
    current_stock: int
    deficit: int
