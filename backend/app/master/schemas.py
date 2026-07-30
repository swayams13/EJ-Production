from pydantic import BaseModel

class WorkforceUpdate(BaseModel):
    productivity: float

class PoolUpdate(BaseModel):
    total_tig_welders: int
    total_mig_welders: int
    total_grinders: int

class WeldingSizeCreate(BaseModel):
    size: int
    tig_feet: float
    mig_feet: float
    grinding_feet: float
    joint_type: str
    tag_no: str | None = None
