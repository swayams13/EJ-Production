from pydantic import BaseModel, Field

class WorkforceUpdate(BaseModel):
    productivity: float = Field(ge=0)

class PoolUpdate(BaseModel):
    total_tig_welders: int = Field(ge=0)
    total_mig_welders: int = Field(ge=0)
    total_grinders: int = Field(ge=0)

class WeldingSizeCreate(BaseModel):
    size: int
    tig_feet: float = Field(ge=0)
    mig_feet: float = Field(ge=0)
    grinding_feet: float = Field(ge=0)
    joint_type: str
    tag_no: str | None = None
