from pydantic import BaseModel

class WorkforceUpdate(BaseModel):
    productivity: float

class PoolUpdate(BaseModel):
    total_tig_welders: int
    total_mig_welders: int
    total_grinders: int
