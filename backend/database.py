from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker
from config import DATABASE_URL

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def init_db():
    # Attempt to enable pgvector extension if it's available
    with engine.connect() as conn:
        try:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
            conn.commit()
        except Exception as e:
            print(f"pgvector extension could not be initialized: {e}")
            conn.rollback()
            
        # Migrate schema: Add status column if not exists
        try:
            conn.execute(text("ALTER TABLE drugs ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';"))
            conn.commit()
        except Exception as e:
            print(f"Database migration (status column) failed: {e}")
            conn.rollback()

        # Migrate schema: Add MedDRA columns to adverse_events table if not exists
        try:
            conn.execute(text("ALTER TABLE adverse_events ADD COLUMN IF NOT EXISTS meddra_pt_code INTEGER;"))
            conn.execute(text("ALTER TABLE adverse_events ADD COLUMN IF NOT EXISTS meddra_pt_name VARCHAR(255);"))
            conn.execute(text("ALTER TABLE adverse_events ADD COLUMN IF NOT EXISTS meddra_soc_name VARCHAR(255);"))
            conn.execute(text("ALTER TABLE adverse_events ADD COLUMN IF NOT EXISTS meddra_hlt_name VARCHAR(255);"))
            conn.execute(text("ALTER TABLE adverse_events ADD COLUMN IF NOT EXISTS meddra_hlgt_name VARCHAR(255);"))
            conn.commit()
        except Exception as e:
            print(f"Database migration (MedDRA columns) failed: {e}")
            conn.rollback()
    
    # Create tables
    Base.metadata.create_all(bind=engine)
    
    # Import MedDRA data on startup
    import_meddra_data()
    
    # Automatically map/remap any existing adverse events that lack MedDRA records
    db = SessionLocal()
    try:
        remap_existing_adverse_events(db)
    except Exception as e:
        print(f"Error during startup MedDRA remapping: {e}")
    finally:
        db.close()


def import_meddra_data():
    import os
    import models
    db = SessionLocal()
    try:
        # Check if tables are empty
        llt_count = db.query(models.MedDraLlt).count()
        hier_count = db.query(models.MedDraHierarchy).count()
        
        if llt_count > 0 and hier_count > 0:
            print("MedDRA data already exists in database. Skipping import.")
            return

        # Paths inside the container
        llt_path = "/data/MedDRA_28_0_ENglish/MedAscii/llt.asc"
        hier_path = "/data/MedDRA_28_0_ENglish/MedAscii/mdhier.asc"

        if not os.path.exists(llt_path) or not os.path.exists(hier_path):
            print(f"MedDRA files not found at {llt_path} or {hier_path}. Skipping auto-import.")
            return

        # 1. Import MedDraHierarchy
        if hier_count == 0:
            print("Importing MedDRA hierarchy...")
            hier_records = []
            with open(hier_path, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    parts = line.strip().split('$')
                    if len(parts) >= 12:
                        pt_code = int(parts[0])
                        pt_name = parts[4]
                        hlt_name = parts[5]
                        hlgt_name = parts[6]
                        soc_name = parts[7]
                        soc_code = int(parts[3]) if parts[3] else None
                        primary_flag = parts[11]

                        # We only import the primary SOC link to ensure uniqueness of pt_code
                        if primary_flag == 'Y':
                            hier_records.append({
                                "pt_code": pt_code,
                                "pt_name": pt_name,
                                "hlt_name": hlt_name,
                                "hlgt_name": hlgt_name,
                                "soc_name": soc_name,
                                "soc_code": soc_code
                            })
            
            # Bulk insert in chunks
            chunk_size = 5000
            for i in range(0, len(hier_records), chunk_size):
                chunk = hier_records[i : i + chunk_size]
                db.execute(models.MedDraHierarchy.__table__.insert(), chunk)
            db.commit()
            print(f"Imported {len(hier_records)} MedDRA hierarchy records.")

        # 2. Import MedDraLlt
        if llt_count == 0:
            print("Importing MedDRA LLTs...")
            llt_records = []
            with open(llt_path, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    parts = line.strip().split('$')
                    if len(parts) >= 3:
                        llt_code = int(parts[0])
                        llt_name = parts[1]
                        pt_code = int(parts[2]) if parts[2] else None
                        
                        llt_records.append({
                            "llt_code": llt_code,
                            "llt_name": llt_name,
                            "pt_code": pt_code
                        })
            
            # Bulk insert in chunks
            chunk_size = 5000
            for i in range(0, len(llt_records), chunk_size):
                chunk = llt_records[i : i + chunk_size]
                db.execute(models.MedDraLlt.__table__.insert(), chunk)
            db.commit()
            print(f"Imported {len(llt_records)} MedDRA LLT records.")

    except Exception as e:
        db.rollback()
        print(f"Error importing MedDRA data: {e}")
    finally:
        db.close()

def map_term_to_meddra(db, term: str) -> list[int]:
    import models
    from sqlalchemy.sql import text
    if not term:
        return []
    
    term_clean = term.strip()
    
    # We will collect unique pt_codes in order of matching priority
    pt_codes = []
    def add_code(code):
        if code and code not in pt_codes:
            pt_codes.append(code)

    def add_codes(codes):
        for code in codes:
            add_code(code)
            if len(pt_codes) >= 10:
                break

    # 1. Try exact match in llt (case-insensitive)
    llt_matches = db.query(models.MedDraLlt).filter(models.MedDraLlt.llt_name.ilike(term_clean)).limit(10).all()
    if llt_matches:
        add_codes([m.pt_code for m in llt_matches])
        if pt_codes: return pt_codes

    # 2. Try exact match in hierarchy (case-insensitive)
    hier_matches = db.query(models.MedDraHierarchy).filter(models.MedDraHierarchy.pt_name.ilike(term_clean)).limit(10).all()
    if hier_matches:
        add_codes([m.pt_code for m in hier_matches])
        if pt_codes: return pt_codes

    # Custom synonym/concept mapping for common non-standard terms
    synonyms = {
        "fetal injury": 10016852,  # Foetal damage
        "foetal injury": 10016852, # Foetal damage
        "fulminant hepatic necrosis": 10019692, # Hepatic necrosis
        "liver necrosis": 10019692, # Hepatic necrosis
        "renal failure neonatal": 10038450, # Renal failure neonatal
    }
    if term_clean.lower() in synonyms:
        return [synonyms[term_clean.lower()]]

    # 3. Clean common prefixes/suffixes and try matching again
    cleaned_term = term_clean.lower()
    
    # Remove adjectives/modifiers
    modifiers = [
        "mild ", "moderate ", "severe ", "acute ", "chronic ", 
        "generalized ", "localized ", "transient ", "accidental ", 
        "history of ", "increased ", "decreased ", "elevated ", "reduced "
    ]
    for mod in modifiers:
        if cleaned_term.startswith(mod):
            cleaned_term = cleaned_term[len(mod):]
        if cleaned_term.endswith(" " + mod.strip()):
            cleaned_term = cleaned_term[:-len(mod.strip())-1]

    # Handle spelling variations (US to GB for MedDRA compatibility)
    spelling_map = {
        "fetal": "foetal",
        "diarrhea": "diarrhoea",
        "edema": "oedema",
        "hematoma": "haematoma",
        "anemia": "anaemia",
        "hemorrhage": "haemorrhage",
        "esophageal": "oesophageal",
        "pediatric": "paediatric",
    }
    for us, gb in spelling_map.items():
        cleaned_term = cleaned_term.replace(us, gb)

    # Handle basic plurals
    if cleaned_term.endswith("ies"):
        cleaned_term = cleaned_term[:-3] + "y"
    elif cleaned_term.endswith("s") and not cleaned_term.endswith("is") and not cleaned_term.endswith("us") and not cleaned_term.endswith("ss"):
        cleaned_term = cleaned_term[:-1]

    cleaned_term = cleaned_term.strip()
    
    if cleaned_term:
        # Try match on cleaned term
        llt_matches = db.query(models.MedDraLlt).filter(models.MedDraLlt.llt_name.ilike(cleaned_term)).limit(10).all()
        if llt_matches:
            add_codes([m.pt_code for m in llt_matches])
            if pt_codes: return pt_codes

        hier_matches = db.query(models.MedDraHierarchy).filter(models.MedDraHierarchy.pt_name.ilike(cleaned_term)).limit(10).all()
        if hier_matches:
            add_codes([m.pt_code for m in hier_matches])
            if pt_codes: return pt_codes

        # 4. Partial substring match:
        # A. Check if the term contains a PT or LLT term (e.g. "fulminant hepatic necrosis" contains "hepatic necrosis")
        hier_matches = db.query(models.MedDraHierarchy).filter(text(":term ILIKE '%' || pt_name || '%'")).params(term=cleaned_term).limit(10).all()
        if hier_matches:
            add_codes([m.pt_code for m in hier_matches])
            if pt_codes: return pt_codes

        llt_matches = db.query(models.MedDraLlt).filter(text(":term ILIKE '%' || llt_name || '%'")).params(term=cleaned_term).limit(10).all()
        if llt_matches:
            add_codes([m.pt_code for m in llt_matches])
            if pt_codes: return pt_codes

        # B. Check if PT or LLT term contains our cleaned term
        hier_matches = db.query(models.MedDraHierarchy).filter(models.MedDraHierarchy.pt_name.ilike(f"%{cleaned_term}%")).limit(10).all()
        if hier_matches:
            add_codes([m.pt_code for m in hier_matches])
            if pt_codes: return pt_codes
            
        llt_matches = db.query(models.MedDraLlt).filter(models.MedDraLlt.llt_name.ilike(f"%{cleaned_term}%")).limit(10).all()
        if llt_matches:
            add_codes([m.pt_code for m in llt_matches])
            if pt_codes: return pt_codes

        # 5. Word token intersection match
        words = [w for w in cleaned_term.split() if len(w) > 2]
        if words:
            query = db.query(models.MedDraHierarchy)
            for w in words:
                query = query.filter(models.MedDraHierarchy.pt_name.ilike(f"%{w}%"))
            hier_matches = query.limit(10).all()
            if hier_matches:
                add_codes([m.pt_code for m in hier_matches])
                if pt_codes: return pt_codes

            query = db.query(models.MedDraLlt)
            for w in words:
                query = query.filter(models.MedDraLlt.llt_name.ilike(f"%{w}%"))
            llt_matches = query.limit(10).all()
            if llt_matches:
                add_codes([m.pt_code for m in llt_matches])
                if pt_codes: return pt_codes

    return pt_codes

def remap_existing_adverse_events(db):
    import models
    unmapped_aes = db.query(models.AdverseEvent).filter(
        (models.AdverseEvent.meddra_pt_code.is_(None)) | (models.AdverseEvent.meddra_pt_name.is_(None))
    ).all()
    if not unmapped_aes:
        print("No unmapped adverse events found in database.")
        return
    print(f"Found {len(unmapped_aes)} unmapped adverse events. Attempting to map to MedDRA...")
    updated_count = 0
    for ae in unmapped_aes:
        pt_code = map_term_to_meddra(db, ae.ae_term)
        if pt_code:
            pt_detail = db.query(models.MedDraHierarchy).filter(models.MedDraHierarchy.pt_code == pt_code).first()
            if pt_detail:
                ae.meddra_pt_code = pt_detail.pt_code
                ae.meddra_pt_name = pt_detail.pt_name
                ae.meddra_soc_name = pt_detail.soc_name
                ae.meddra_hlt_name = pt_detail.hlt_name
                ae.meddra_hlgt_name = pt_detail.hlgt_name
                updated_count += 1
    db.commit()
    print(f"Successfully mapped {updated_count} out of {len(unmapped_aes)} existing adverse events to MedDRA.")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

