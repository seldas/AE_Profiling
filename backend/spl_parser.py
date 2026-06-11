import requests
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup
import re

# HL7 Namespace mapping
NAMESPACES = {'ns': 'urn:hl7-org:v3'}

# LOINC codes for drug labeling sections
SECTION_MAPPING = {
    "34066-1": "Boxed Warning",
    "34084-4": "Adverse Reactions",
    "43685-7": "Warnings and Precautions",
    "34071-1": "Warnings",
    "34070-3": "Precautions",
    "90374-0": "Postmarketing Experience"
}

def fetch_spl_by_set_id(set_id: str) -> str:
    """
    Fetch the latest spl XML for a given set_id directly from DailyMed.
    """
    return fetch_spl_by_spl_id(set_id)

def fetch_spl_by_spl_id(spl_id: str) -> str:
    """
    Fetch raw SPL XML from DailyMed by its specific spl_id.
    """
    url = f"https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{spl_id}.xml"
    response = requests.get(url, timeout=15)
    response.raise_for_status()
    return response.text

def parse_xml_to_html(element: ET.Element) -> str:
    """
    Helper to convert an XML element's children into clean, readable HTML.
    This preserves lists, tables, and paragraphs for the frontend UI.
    """
    # Convert element to string, strip namespace tags
    raw_xml = ET.tostring(element, encoding='utf-8').decode('utf-8')
    # Remove xmlns declaration so it doesn't mess up parsing
    raw_xml = re.sub(r'\s+xmlns(?::\w+)="[^"]+"', '', raw_xml)
    raw_xml = re.sub(r'\s+xmlns="[^"]+"', '', raw_xml)
    
    # Strip namespace prefixes from all tags (e.g. <ns0:table> -> <table>)
    raw_xml = re.sub(r'<(/?)[a-zA-Z0-9_-]+:', r'<\1', raw_xml)
    
    # Use BeautifulSoup to clean and structure
    soup = BeautifulSoup(raw_xml, 'xml')
    # The actual content is inside the root node (usually <text>)
    root_node = soup.find()
    if not root_node:
        return ""
        
    # Standardize tags: <list> to <ul>, <item> to <li>, etc.
    # DailyMed SPL XML uses HL7 v3 tags: <list>, <item>, <paragraph>, <tableLink>
    for list_tag in root_node.find_all('list'):
        list_tag.name = 'ul'
    for item_tag in root_node.find_all('item'):
        item_tag.name = 'li'
    for para_tag in root_node.find_all('paragraph'):
        para_tag.name = 'p'
    
    # If the root element is a section, extract only <title> and <text> nodes in document order
    # to avoid rendering unwanted structural tags like <id>, <code>, <component>.
    if root_node.name == 'section':
        html_parts = []
        for node in root_node.find_all(['title', 'text']):
            if node.name == 'title':
                html_parts.append(f"<h4>{node.get_text(strip=True)}</h4>")
            else:
                html_parts.append("".join(str(child) for child in node.children))
        return "\n".join(html_parts)

    # Return inner HTML of the text element
    return "".join(str(child) for child in root_node.children)

def clean_text_for_llm(html_content: str) -> str:
    """
    Convert the parsed HTML section content to clean plain text for LLM ingestion.
    Preserves basic formatting like newlines for lists and table boundaries.
    """
    soup = BeautifulSoup(html_content, 'html.parser')
    
    # Format list items with bullets
    for li in soup.find_all('li'):
        li.insert_before('\n- ')
        
    # Format table cells with tabs/pipes
    for tr in soup.find_all('tr'):
        tr.insert_after('\n')
    for td in soup.find_all('td'):
        td.insert_after(' | ')
    for th in soup.find_all('th'):
        th.insert_after(' | ')
        
    # Get clean text
    text = soup.get_text()
    
    # Clean up double newlines
    text = re.sub(r'\n\s*\n', '\n\n', text)
    return text.strip()

def parse_spl_xml(xml_content: str):
    """
    Parse DailyMed SPL XML.
    Returns metadata and dictionary of extracted sections:
    {
      "metadata": {
        "spl_id": "...",
        "set_id": "...",
        "drug_name": "...",
        "version": "...",
        "published_date": "..."
      },
      "sections": {
        "34084-4": { "title": "Adverse Reactions", "html": "...", "text": "..." },
        ...
      }
    }
    """
    # Parse the XML string
    root = ET.fromstring(xml_content.encode('utf-8'))
    
    # 1. Parse Metadata
    # spl_id is document/id @root
    id_elem = root.find('ns:id', NAMESPACES)
    spl_id = id_elem.get('root') if id_elem is not None else None
    
    # set_id is document/setId @root
    set_id_elem = root.find('ns:setId', NAMESPACES)
    set_id = set_id_elem.get('root') if set_id_elem is not None else None
    
    # version is document/versionNumber @value
    version_elem = root.find('ns:versionNumber', NAMESPACES)
    version = version_elem.get('value') if version_elem is not None else "1"
    
    # effectiveTime (published date) is document/effectiveTime @value
    time_elem = root.find('ns:effectiveTime', NAMESPACES)
    published_date = time_elem.get('value') if time_elem is not None else ""
    
    # Drug Name from title
    title_elem = root.find('ns:title', NAMESPACES)
    title_text = ""
    if title_elem is not None:
        title_text = "".join(title_elem.itertext()).strip()
    if not title_text:
        title_text = "Unknown Drug"
    
    # Clean title (e.g. "Ibuprofen tablet" or similar)
    drug_name = title_text.split('\n')[0].strip()
    
    # 2. Extract sections
    sections = {}
    
    # Find all <section> elements anywhere in the tree
    for section in root.findall('.//ns:section', NAMESPACES):
        code_elem = section.find('ns:code', NAMESPACES)
        if code_elem is not None:
            code = code_elem.get('code')
            if code in SECTION_MAPPING:
                section_title_elem = section.find('ns:title', NAMESPACES)
                section_title = section_title_elem.text.strip() if section_title_elem is not None else SECTION_MAPPING[code]
                
                # Some target sections (like Adverse Reactions) might not have direct text,
                # but instead contain sub-sections that have the text.
                # Passing the entire section allows us to aggregate all nested titles and text.
                html_content = parse_xml_to_html(section)
                if not html_content.strip():
                    continue
                
                plain_text = clean_text_for_llm(html_content)
                
                # Store both HTML (for UI) and plain text (for LLM)
                sections[code] = {
                    "title": section_title,
                    "html": html_content,
                    "text": plain_text
                }
    
    return {
        "metadata": {
            "spl_id": spl_id,
            "set_id": set_id,
            "drug_name": drug_name,
            "version": version,
            "published_date": published_date
        },
        "sections": sections
    }

def search_dailymed_drugs(drug_name: str) -> list:
    """
    Search DailyMed's REST API for SPL documents matching the drug_name.
    """
    url = f"https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name={requests.utils.quote(drug_name)}&pagesize=20"
    try:
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        data = response.json()
        
        results = []
        for item in data.get("data", []):
            results.append({
                "set_id": item.get("setid"),
                "spl_id": item.get("spl_version"),
                "title": item.get("title"),
                "published_date": item.get("published_date")
            })
        return results
    except Exception as e:
        print(f"Error searching DailyMed API: {e}")
        return []

