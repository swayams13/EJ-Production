from pydantic import BaseModel
from typing import Optional, List, Literal
from datetime import date as DateType


# --- Vendor ---
class VendorCreate(BaseModel):
    name: str
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    gstin: Optional[str] = None
    payment_terms: Optional[str] = None
    notes: Optional[str] = None

class VendorUpdate(BaseModel):
    name: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    gstin: Optional[str] = None
    payment_terms: Optional[str] = None
    notes: Optional[str] = None

class VendorResponse(BaseModel):
    id: int
    name: str
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    gstin: Optional[str] = None
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    avg_days_late: Optional[float] = 0.0

    class Config:
        from_attributes = True


# --- Warehouse Stock ---
class StockAdjust(BaseModel):
    material_name: str
    size: int
    joint_type: str
    qty_on_hand: Optional[int] = None
    minimum_stock: Optional[int] = None
    reason: Optional[str] = None

class StockResponse(BaseModel):
    id: int
    material_name: str
    size: int
    joint_type: str
    qty_on_hand: int
    reserved_qty: int
    minimum_stock: int

    class Config:
        from_attributes = True


# --- Lead Times ---
class LeadTimeUpdate(BaseModel):
    lead_time_days: int

class LeadTimeResponse(BaseModel):
    id: int
    material_name: str
    lead_time_days: int

    class Config:
        from_attributes = True


# --- PO Line Allocation ---
class AllocationCreate(BaseModel):
    part_id: int
    allocated_qty: int

class AllocationResponse(BaseModel):
    id: int
    part_id: int
    allocated_qty: int
    already_received: int
    project_name: Optional[str] = None
    job_tag: Optional[str] = None

    class Config:
        from_attributes = True


# --- PO Line ---
class POLineCreate(BaseModel):
    material_name: str
    size: int
    joint_type: str
    ordered_qty: int
    unit_price: Optional[float] = None
    allocations: List[AllocationCreate] = []

class POLineResponse(BaseModel):
    id: int
    material_name: str
    size: int
    joint_type: str
    ordered_qty: int
    unit_price: Optional[float] = None
    received_qty: int
    status: str
    allocations: List[AllocationResponse] = []

    class Config:
        from_attributes = True


# --- Purchase Order ---
class POCreate(BaseModel):
    po_number: str
    vendor_id: Optional[int] = None
    po_date: Optional[DateType] = None
    expected_delivery_date: Optional[DateType] = None
    total_value: Optional[float] = None
    notes: Optional[str] = None
    lines: List[POLineCreate] = []

class POStatusUpdate(BaseModel):
    status: Literal["raised", "sent", "cancelled"]
    delay_reason: Optional[str] = None

class POResponse(BaseModel):
    id: int
    po_number: str
    vendor_id: Optional[int] = None
    po_date: Optional[DateType] = None
    expected_delivery_date: Optional[DateType] = None
    status: str
    raised_by: Optional[int] = None
    total_value: Optional[float] = None
    delay_reason: Optional[str] = None
    notes: Optional[str] = None
    lines: List[POLineResponse] = []

    class Config:
        from_attributes = True


# --- Goods Receipt ---
class ReceiptLineCreate(BaseModel):
    po_line_id: int
    qty_received: int

class ReceiptCreate(BaseModel):
    receipt_date: Optional[DateType] = None
    notes: Optional[str] = None
    lines: List[ReceiptLineCreate]

class ReceiptResponse(BaseModel):
    id: int
    purchase_order_id: int
    receipt_date: Optional[DateType] = None
    received_by: Optional[int] = None
    notes: Optional[str] = None
    resolved_holds: int = 0

    class Config:
        from_attributes = True


# --- Delay Reason ---
class DelayReasonCreate(BaseModel):
    part_id: int
    reason: str


# --- Daily Procurement Log ---
class DailyLogCreate(BaseModel):
    part_id: int
    qty_ordered: int = 0
    qty_received: int = 0
