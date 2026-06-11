import uuid
from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from database import Base

class Drug(Base):
    __tablename__ = "drugs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    spl_id = Column(String(255), unique=True, nullable=False, index=True)
    set_id = Column(String(255), nullable=False, index=True)
    drug_name = Column(String(255), nullable=False, index=True)
    version = Column(String(50), nullable=True)
    published_date = Column(String(50), nullable=True)
    
    # Store sections text: { "34084-4": "...", "43685-7": "..." }
    raw_sections = Column(JSONB, nullable=True)
    status = Column(String(50), default="pending", nullable=False)
    
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    
    # Relationship to adverse events
    adverse_events = relationship("AdverseEvent", back_populates="drug", cascade="all, delete-orphan")

class AdverseEvent(Base):
    __tablename__ = "adverse_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    drug_id = Column(UUID(as_uuid=True), ForeignKey("drugs.id", ondelete="CASCADE"), nullable=False)
    
    ae_term = Column(String(255), nullable=False, index=True)
    original_term = Column(String(255), nullable=True)
    severity = Column(String(50), nullable=True)  # Mild, Moderate, Severe, Boxed Warning
    frequency = Column(String(100), nullable=True)  # Common, Rare, percentage etc.
    section_code = Column(String(50), nullable=True)  # LOINC code
    raw_context = Column(Text, nullable=True)  # Sentence or paragraph containing AE
    is_boxed_warning = Column(Boolean, default=False, nullable=False)
    
    # MedDRA standardized classifications
    meddra_pt_code = Column(Integer, nullable=True, index=True)
    meddra_pt_name = Column(String(255), nullable=True, index=True)
    meddra_soc_name = Column(String(255), nullable=True, index=True)
    meddra_hlt_name = Column(String(255), nullable=True, index=True)
    meddra_hlgt_name = Column(String(255), nullable=True, index=True)
    
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    drug = relationship("Drug", back_populates="adverse_events")

class MedDraLlt(Base):
    __tablename__ = "meddra_llt"

    llt_code = Column(Integer, primary_key=True)
    llt_name = Column(String(255), nullable=False, index=True)
    pt_code = Column(Integer, nullable=False, index=True)

class MedDraHierarchy(Base):
    __tablename__ = "meddra_hierarchy"

    pt_code = Column(Integer, primary_key=True)
    pt_name = Column(String(255), nullable=False, index=True)
    hlt_name = Column(String(255), nullable=True)
    hlgt_name = Column(String(255), nullable=True)
    soc_name = Column(String(255), nullable=True, index=True)
    soc_code = Column(Integer, nullable=True)
