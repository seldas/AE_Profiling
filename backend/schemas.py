from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from datetime import datetime
from uuid import UUID

class DrugIngestRequest(BaseModel):
    spl_id: Optional[str] = None
    set_id: Optional[str] = None
    force_refresh: Optional[bool] = False

class AdverseEventResponse(BaseModel):
    id: int
    ae_term: str
    original_term: Optional[str]
    severity: Optional[str]
    frequency: Optional[str]
    section_code: Optional[str]
    raw_context: Optional[str]
    is_boxed_warning: bool
    meddra_pt_code: Optional[int] = None
    meddra_pt_name: Optional[str] = None
    meddra_soc_name: Optional[str] = None
    meddra_hlt_name: Optional[str] = None
    meddra_hlgt_name: Optional[str] = None
    meddra_all_chains: Optional[List[Dict[str, str | int | None]]] = None
    created_at: datetime

    class Config:
        from_attributes = True

class DrugResponse(BaseModel):
    id: UUID
    spl_id: str
    set_id: str
    drug_name: str
    version: Optional[str]
    published_date: Optional[str]
    status: str
    created_at: datetime

    class Config:
        from_attributes = True

class DrugDetailResponse(DrugResponse):
    raw_sections: Optional[Dict[str, Dict[str, str]]] = None
    adverse_events: List[AdverseEventResponse] = []

    class Config:
        from_attributes = True

class SearchResultItem(BaseModel):
    drug: DrugResponse
    adverse_event: AdverseEventResponse
