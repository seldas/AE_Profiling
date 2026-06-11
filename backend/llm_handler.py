import json
import requests
from pydantic import BaseModel, Field
from typing import List, Optional
from config import LLM_PROVIDER, LLM_MODEL, OLLAMA_HOST, OPENAI_API_KEY, OPENAI_API_BASE, GEMINI_API_KEY, GEMINI_MODEL, VLLM_API_BASE, VLLM_API_KEY, VLLM_MODEL

class AdverseEventExtraction(BaseModel):
    ae_term: str = Field(description="Standardized clinical term for the adverse event (e.g., Headache, Nausea, Myocardial Infarction).")
    original_term: str = Field(description="The exact text or phrase as it appeared in the label.")
    severity: str = Field(description="Severity classification. Must be one of: 'Mild', 'Moderate', 'Severe', 'Boxed Warning'. Default to 'Moderate' if not specified.")
    frequency: str = Field(description="Frequency percentage or category (e.g., '12%', '1/100', 'Common', 'Rare', 'Unknown').")
    raw_context: str = Field(description="The exact verbatim sentence or paragraph from the text where this adverse event is mentioned.")
    is_boxed_warning: bool = Field(description="True if this event was extracted from a Boxed Warning or is marked as a critical warning.")

class ExtractionResponse(BaseModel):
    adverse_events: List[AdverseEventExtraction]

SYSTEM_PROMPT = """You are an expert medical AI specializing in pharmacovigilance and drug label analysis.
Your task is to analyze the provided clinical text from a drug Structured Product Label (SPL) and extract structured information about Adverse Events (AEs).

For each adverse event found in the text, extract:
1. ae_term: Standardized clinical term. Standardize the term to align with MedDRA (Medical Dictionary for Regulatory Activities) Preferred Term or Low Level Term nomenclature where possible (e.g., "Dyspnea" instead of "shortness of breath", "Headache" instead of "headaches", "Somnolence" instead of "sleepiness", "Nausea" instead of "feeling sick", "Diarrhoea" instead of "diarrhea", "Vomiting" instead of "vomitings", "Rash" instead of "rashes"). Prefer singular, capitalized, clinical terms.
2. original_term: The exact verbatim phrase used in the text (e.g. "difficulty breathing").
3. severity: Standardized clinical significance/severity level. Select from: "Mild", "Moderate", "Severe", "Boxed Warning". If it's a boxed warning, always label it as "Boxed Warning". If it mentions life-threatening risks, severe reactions, or warnings, label as "Severe". Otherwise, classify based on text cues, defaulting to "Moderate".
4. frequency: Any statistical frequency (e.g., "15%", "1 in 1000") or description (e.g., "common", "infrequent", "rare"). If not mentioned, state "Unknown".
5. raw_context: The exact sentence or paragraph where the adverse event is described. This must be an exact verbatim substring from the input text to maintain auditing integrity.
6. is_boxed_warning: Boolean. Set to true if the adverse event is listed in a Boxed Warning section or explicitly described as a boxed warning.

You must output your response in valid JSON matching this structure:
{
  "adverse_events": [
    {
      "ae_term": "Standardized Term",
      "original_term": "original term in text",
      "severity": "Mild/Moderate/Severe/Boxed Warning",
      "frequency": "12% / Common / Unknown",
      "raw_context": "Exact verbatim sentence from text.",
      "is_boxed_warning": false
    }
  ]
}

If no adverse events are mentioned, return:
{"adverse_events": []}

Do not include any chat formatting, markdown blocks (like ```json), or explanatory text. Return ONLY the raw JSON string."""

def extract_ae_with_ollama(text: str, is_boxed_warning: bool = False) -> List[dict]:
    """
    Call local Ollama instance to extract adverse events.
    """
    url = f"{OLLAMA_HOST}/api/chat"
    
    # Customize prompt based on section type
    prompt = f"Analyze the following drug label section (Is Boxed Warning: {is_boxed_warning}). Extract the adverse events:\n\n{text}"
    
    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt}
        ],
        "options": {
            "temperature": 0.1,  # Low temperature for highly deterministic extraction
        },
        "stream": False,
        "format": "json"  # Forces JSON response
    }
    
    try:
        response = requests.post(url, json=payload, timeout=(3.0, 45.0))
        response.raise_for_status()
        res_data = response.json()
        content = res_data["message"]["content"]
        
        # Parse the JSON content
        parsed = json.loads(content)
        events = parsed.get("adverse_events", [])
        
        # Post-process to ensure fields are present and is_boxed_warning is correct
        for e in events:
            if is_boxed_warning:
                e["is_boxed_warning"] = True
                e["severity"] = "Boxed Warning"
            elif "is_boxed_warning" not in e:
                e["is_boxed_warning"] = False
        return events
    except Exception as e:
        print(f"Ollama extraction error: {e}")
        return []

def get_working_gemini_model(api_key: str, configured_model: str) -> str:
    """
    Query Gemini ModelService to find a working model name from the user's API key context.
    Prevents errors if the user configures an inactive, typo, or deprecated model name.
    """
    clean_model = configured_model.replace("models/", "")
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    try:
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            models_data = response.json()
            available_models = [m["name"].replace("models/", "") for m in models_data.get("models", [])]
            
            # 1. Exact match
            if clean_model in available_models:
                return clean_model
                
            # 2. Case-insensitive or partial match
            for m in available_models:
                if clean_model.lower() in m.lower():
                    print(f"Gemini configured model '{configured_model}' not found. Selecting partial match: '{m}'.")
                    return m
                    
            # 3. First available flash model
            flash_models = [m for m in available_models if "flash" in m]
            if flash_models:
                print(f"Gemini configured model '{configured_model}' not found. Selecting first active flash model: '{flash_models[0]}'.")
                return flash_models[0]
                
            # 4. Fallback to any generator model
            gen_models = [m["name"].replace("models/", "") for m in models_data.get("models", [])
                          if "generateContent" in m.get("supportedGenerationMethods", [])]
            if gen_models:
                print(f"Gemini configured model '{configured_model}' not found. Selecting generator model: '{gen_models[0]}'.")
                return gen_models[0]
    except Exception as e:
        print(f"Error listing Gemini models dynamically: {e}")
        
    return clean_model

def extract_ae_with_gemini(text: str, is_boxed_warning: bool = False) -> List[dict]:
    """
    Call Google Gemini API using direct requests.
    """
    api_key = GEMINI_API_KEY
    if not api_key:
        print("Gemini API key is missing. Skipping extraction.")
        return []
    
    # Resolve working model name dynamically
    model = get_working_gemini_model(api_key, GEMINI_MODEL)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    
    prompt = f"{SYSTEM_PROMPT}\n\nAnalyze the following drug label section (Is Boxed Warning: {is_boxed_warning}). Extract the adverse events:\n\n{text}"
    
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1
        }
    }
    
    try:
        response = requests.post(url, json=payload, timeout=60)
        
        # Fallback if the configured model is not found (e.g. gemini-3.5-flash-lite)
        if response.status_code == 404:
            fallback_model = "gemini-1.5-flash"
            print(f"Gemini model '{model}' not found (404). Falling back to '{fallback_model}'.")
            fallback_url = f"https://generativelanguage.googleapis.com/v1beta/models/{fallback_model}:generateContent?key={api_key}"
            response = requests.post(fallback_url, json=payload, timeout=60)
            
        response.raise_for_status()
        res_data = response.json()
        
        # Get content text
        content = res_data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(content)
        events = parsed.get("adverse_events", [])
        
        for e in events:
            if is_boxed_warning:
                e["is_boxed_warning"] = True
                e["severity"] = "Boxed Warning"
            elif "is_boxed_warning" not in e:
                e["is_boxed_warning"] = False
        return events
    except Exception as e:
        print(f"Gemini API extraction error: {e}")
        return []

def extract_ae_with_openai(text: str, is_boxed_warning: bool = False) -> List[dict]:
def extract_ae_with_vllm(text: str, is_boxed_warning: bool = False) -> List[dict]:
    """
    Call vLLM API to extract adverse events.
    """
    api_key = VLLM_API_KEY or "mock-key"
    url = f"{VLLM_API_BASE}/chat/completions" if VLLM_API_BASE else "http://localhost:8000/v1/chat/completions"
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    prompt = f"Analyze the following drug label section (Is Boxed Warning: {is_boxed_warning}). Extract the adverse events:\n\n{text}"
    model = VLLM_MODEL or LLM_MODEL
    
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"}
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=60)
        response.raise_for_status()
        res_data = response.json()
        content = res_data["choices"][0]["message"]["content"]
        
        parsed = json.loads(content)
        events = parsed.get("adverse_events", [])
        
        for e in events:
            if is_boxed_warning:
                e["is_boxed_warning"] = True
                e["severity"] = "Boxed Warning"
            elif "is_boxed_warning" not in e:
                e["is_boxed_warning"] = False
        return events
    except Exception as e:
        print(f"vLLM API extraction error: {e}")
        return []


def is_ollama_online() -> bool:
    """
    Quickly check if the local Ollama instance is active.
    """
    try:
        response = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=1.5)
        return response.status_code == 200
    except Exception:
        return False

def extract_adverse_events(text: str, is_boxed_warning: bool = False, provider_override: str = None) -> List[dict]:
    """
    Primary interface for extracting adverse events from text.
    Dispatches to the configured provider (ollama, gemini, openai, or vllm).
    """
    # Clean up text length to avoid context overflow for very large sections.
    max_chars = 40000
    if len(text) > max_chars:
        print(f"Truncating section text from {len(text)} to {max_chars} characters for LLM.")
        text = text[:max_chars] + "\n... [truncated]"
        
    provider = (provider_override or LLM_PROVIDER).lower()
    
    # Auto-detect fallback:
    # If Ollama is selected but offline, and a Gemini key is available, use Gemini.
    if provider == "ollama" and GEMINI_API_KEY and not is_ollama_online():
        print("Ollama is offline. Automatically falling back to Gemini API.")
        provider = "gemini"
        
    if provider == "gemini":
        return extract_ae_with_gemini(text, is_boxed_warning)
    elif provider == "vllm" or provider == "openai":
        return extract_ae_with_vllm(text, is_boxed_warning)
    else:
        # Fallback to Ollama if no valid provider configured
        print(f"Using Ollama provider ({LLM_MODEL}).")
        return extract_ae_with_ollama(text, is_boxed_warning)
