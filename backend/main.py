from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, Query
from fastapi.responses import StreamingResponse
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from contextlib import asynccontextmanager
import asyncio
import json

from database import init_db, get_db, SessionLocal
import models, schemas, spl_parser, llm_handler

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB (enable extensions, create tables)
    init_db()
    yield

app = FastAPI(
    title="AEProfile API",
    description="Backend API for drug Structured Product Labeling (SPL) parsing and Adverse Event extraction using localized LLMs.",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For docker and local development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
def health_check():
    return {"status": "healthy"}

@app.get("/api/dailymed/search")
def search_dailymed(q: str = Query(..., description="The drug name to search in DailyMed")):
    """
    Query DailyMed's REST API for matching drug labeling files.
    """
    if not q.strip():
        return []
    return spl_parser.search_dailymed_drugs(q.strip())

@app.post("/api/ingest", response_model=schemas.DrugDetailResponse)

def ingest_drug(payload: schemas.DrugIngestRequest, db: Session = Depends(get_db)):
    """
    Ingest a drug SPL by set_id or spl_id.
    Downloads the XML from DailyMed, parses metadata and sections,
    runs LLM extraction on target sections, and stores results in Postgres.
    """
    if not payload.set_id and not payload.spl_id:
        raise HTTPException(status_code=400, detail="Must provide either set_id or spl_id")

    # Step 1: Fetch XML content
    raw_xml = ""
    try:
        if payload.spl_id:
            raw_xml = spl_parser.fetch_spl_by_spl_id(payload.spl_id)
        else:
            raw_xml = spl_parser.fetch_spl_by_set_id(payload.set_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Failed to fetch drug label from DailyMed: {str(e)}")

    # Step 2: Parse the XML
    try:
        parsed_data = spl_parser.parse_spl_xml(raw_xml)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse SPL XML structure: {str(e)}")

    metadata = parsed_data["metadata"]
    sections = parsed_data["sections"]
    
    # Step 3: Check database for existing record
    existing_drug = db.query(models.Drug).filter(models.Drug.spl_id == metadata["spl_id"]).first()
    if existing_drug and not payload.force_refresh:
        # Load and return existing record with adverse events
        db.refresh(existing_drug)
        return existing_drug

    # If force refreshing, delete existing drug record to overwrite it (cascades to adverse events)
    if existing_drug and payload.force_refresh:
        db.delete(existing_drug)
        db.commit()

    # Step 4: Create drug record
    # Format raw sections for database storage: { "LOINC_CODE": { "title": "...", "html": "..." } }
    sections_db_store = {
        code: {
            "title": data["title"],
            "html": data["html"]
        } for code, data in sections.items()
    }
    
    db_drug = models.Drug(
        spl_id=metadata["spl_id"],
        set_id=metadata["set_id"],
        drug_name=metadata["drug_name"],
        version=metadata["version"],
        published_date=metadata["published_date"],
        raw_sections=sections_db_store
    )
    
    db.add(db_drug)
    db.commit()
    db.refresh(db_drug)

    # Set initial status as pending (AI not yet run)
    db_drug.status = "pending"
    db.add(db_drug)
    db.commit()
    db.refresh(db_drug)
    
    return db_drug

@app.get("/api/drugs", response_model=List[schemas.DrugResponse])
def get_drugs(
    q: Optional[str] = Query(None, description="Search drug by name"),
    db: Session = Depends(get_db)
):
    query = db.query(models.Drug)
    if q:
        query = query.filter(models.Drug.drug_name.ilike(f"%{q}%"))
    return query.order_by(models.Drug.drug_name).all()

@app.get("/api/drugs/{id_or_spl_id}", response_model=schemas.DrugDetailResponse)
def get_drug_detail(id_or_spl_id: str, db: Session = Depends(get_db)):
    # Check if id_or_spl_id is UUID or spl_id
    query = db.query(models.Drug)
    
    # Try looking up by spl_id first
    drug = query.filter(models.Drug.spl_id == id_or_spl_id).first()
    if not drug:
        # Try looking up by set_id
        drug = query.filter(models.Drug.set_id == id_or_spl_id).first()
    if not drug:
        # Try looking up by primary key ID (UUID)
        try:
            drug = query.filter(models.Drug.id == id_or_spl_id).first()
        except Exception:
            pass
            
    if not drug:
        raise HTTPException(status_code=404, detail="Drug not found")
        
    return drug

@app.get("/api/search", response_model=List[schemas.SearchResultItem])
def search_adverse_events(
    q: str = Query(..., description="The Adverse Event term to search for (e.g., headache, rash)"),
    severity: Optional[str] = Query(None, description="Filter by severity level"),
    db: Session = Depends(get_db)
):
    """
    Search adverse events by term and return matching drug profiles along with the raw contexts.
    """
    query = db.query(models.AdverseEvent).join(models.Drug)
    
    # Filter by AE term (case insensitive partial match)
    query = query.filter(
        or_(
            models.AdverseEvent.ae_term.ilike(f"%{q}%"),
            models.AdverseEvent.original_term.ilike(f"%{q}%")
        )
    )
    
    if severity:
        query = query.filter(models.AdverseEvent.severity.ilike(severity))
        
    results = query.all()
    
    search_results = []
    for ae in results:
        search_results.append({
            "drug": ae.drug,
            "adverse_event": ae
        })
        
    return search_results

@app.get("/api/drugs/{id_or_spl_id}/extract")
def extract_adverse_events_stream(id_or_spl_id: str, provider: Optional[str] = None):
    """
    Stream adverse events extraction progress for a drug.
    """
    db = SessionLocal()
    try:
        import uuid
        is_uuid = False
        try:
            uuid.UUID(id_or_spl_id)
            is_uuid = True
        except ValueError:
            pass

        # Resolve the drug safely
        query = db.query(models.Drug)
        drug = None
        if is_uuid:
            drug = query.filter(models.Drug.id == id_or_spl_id).first()
        if not drug:
            drug = query.filter(models.Drug.spl_id == id_or_spl_id).first()
        if not drug:
            drug = query.filter(models.Drug.set_id == id_or_spl_id).first()

        if not drug:
            raise HTTPException(status_code=404, detail="Drug not found")
            
        # Direct status update query
        db.query(models.Drug).filter(models.Drug.id == drug.id).update({"status": "extracting"})
        db.commit()
    except Exception as e:
        db.close()
        raise e
    db.close()

    async def event_generator():
        db = SessionLocal()
        try:
            import uuid
            is_uuid = False
            try:
                uuid.UUID(id_or_spl_id)
                is_uuid = True
            except ValueError:
                pass

            query = db.query(models.Drug)
            drug = None
            if is_uuid:
                drug = query.filter(models.Drug.id == id_or_spl_id).first()
            if not drug:
                drug = query.filter(models.Drug.spl_id == id_or_spl_id).first()
            if not drug:
                drug = query.filter(models.Drug.set_id == id_or_spl_id).first()

            if not drug:
                yield f"data: {json.dumps({'status': 'failed', 'message': 'Drug not found during extraction'})}\n\n"
                return

            # Clean up existing adverse events for the drug prior to rewriting
            db.query(models.AdverseEvent).filter(models.AdverseEvent.drug_id == drug.id).delete()
            db.commit()

            raw_sections = drug.raw_sections or {}
            target_codes = ["34066-1", "34084-4", "43685-7", "34071-1", "34070-3", "90374-0"]
            
            # Count target sections we will actually process so we can give progress estimation
            valid_sections = []
            for code in target_codes:
                if code in raw_sections:
                    section_data = raw_sections[code]
                    html_content = section_data.get("html", "")
                    if html_content.strip():
                        valid_sections.append(code)

            if not valid_sections:
                drug.status = "completed"
                db.commit()
                yield f"data: {json.dumps({'status': 'completed', 'message': 'No adverse event sections found to analyze.'})}\n\n"
                return

            for code in valid_sections:
                section_data = raw_sections[code]
                html_content = section_data.get("html", "")
                title = section_data.get("title", spl_parser.SECTION_MAPPING.get(code, "Unknown Section"))
                
                clean_text = spl_parser.clean_text_for_llm(html_content)
                if not clean_text.strip():
                    continue

                is_boxed_warning = (code == "34066-1")

                yield f"data: {json.dumps({'status': 'processing', 'section_code': code, 'section_title': title, 'message': f'Analyzing {title}...'})}\n\n"
                await asyncio.sleep(0.1)

                try:
                    events = await run_in_threadpool(llm_handler.extract_adverse_events, clean_text, is_boxed_warning, provider)
                except Exception as ex:
                    print(f"LLM extraction failed for section {title}: {ex}")
                    events = []
                    yield f"data: {json.dumps({'status': 'section_failed', 'section_code': code, 'section_title': title, 'message': f'Failed to analyze {title}: {str(ex)}'})}\n\n"
                    continue

                new_aes = []
                for event in events:
                    ae_term = event.get("ae_term", "").strip()
                    meddra_pt_code = None
                    meddra_pt_name = None
                    meddra_soc_name = None
                    meddra_hlt_name = None
                    meddra_hlgt_name = None

                    if ae_term:
                        from database import map_term_to_meddra
                        target_pt_code = map_term_to_meddra(db, ae_term)
                        
                        if target_pt_code:
                            pt_detail = db.query(models.MedDraHierarchy).filter(models.MedDraHierarchy.pt_code == target_pt_code).first()
                            if pt_detail:
                                meddra_pt_code = pt_detail.pt_code
                                meddra_pt_name = pt_detail.pt_name
                                meddra_soc_name = pt_detail.soc_name
                                meddra_hlt_name = pt_detail.hlt_name
                                meddra_hlgt_name = pt_detail.hlgt_name

                    ae = models.AdverseEvent(
                        drug_id=drug.id,
                        ae_term=ae_term or event.get("ae_term", ""),
                        original_term=event.get("original_term", ""),
                        severity=event.get("severity", "Moderate"),
                        frequency=event.get("frequency", "Unknown"),
                        section_code=code,
                        raw_context=event.get("raw_context", ""),
                        is_boxed_warning=is_boxed_warning,
                        meddra_pt_code=meddra_pt_code,
                        meddra_pt_name=meddra_pt_name,
                        meddra_soc_name=meddra_soc_name,
                        meddra_hlt_name=meddra_hlt_name,
                        meddra_hlgt_name=meddra_hlgt_name
                    )
                    db.add(ae)
                    new_aes.append(ae)

                db.commit()

                yield f"data: {json.dumps({'status': 'section_done', 'section_code': code, 'section_title': title, 'count': len(new_aes)})}\n\n"
                await asyncio.sleep(0.1)

            # Direct status update query
            db.query(models.Drug).filter(models.Drug.id == drug.id).update({"status": "completed"})
            db.commit()
            yield f"data: {json.dumps({'status': 'completed', 'message': 'Extraction completed successfully!'})}\n\n"

        except Exception as e:
            try:
                # Need a new session context to update on failure if outer/inner session died
                fail_db = SessionLocal()
                import uuid
                is_uuid = False
                try:
                    uuid.UUID(id_or_spl_id)
                    is_uuid = True
                except ValueError:
                    pass

                query = fail_db.query(models.Drug)
                drug = None
                if is_uuid:
                    drug = query.filter(models.Drug.id == id_or_spl_id).first()
                if not drug:
                    drug = query.filter(models.Drug.spl_id == id_or_spl_id).first()
                if not drug:
                    drug = query.filter(models.Drug.set_id == id_or_spl_id).first()

                if drug:
                    fail_db.query(models.Drug).filter(models.Drug.id == drug.id).update({"status": "failed"})
                    fail_db.commit()
                fail_db.close()
            except Exception:
                pass
            yield f"data: {json.dumps({'status': 'failed', 'message': f'Extraction failed: {str(e)}'})}\n\n"
        finally:
            db.close()

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.delete("/api/drugs/{id}")
def delete_drug(id: str, db: Session = Depends(get_db)):
    drug = db.query(models.Drug).filter(
        or_(
            models.Drug.id == id,
            models.Drug.spl_id == id
        )
    ).first()
    
    if not drug:
        raise HTTPException(status_code=404, detail="Drug not found")
        
    db.delete(drug)
    db.commit()
    return {"message": "Drug profile deleted successfully"}
