import requests
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup
import re

url = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/eb31e245-c1fa-4c40-8b01-52ab5f7b88aa.xml"
xml_content = requests.get(url).text

NAMESPACES = {'ns': 'urn:hl7-org:v3'}
root = ET.fromstring(xml_content.encode('utf-8'))

for section in root.findall('.//ns:section', NAMESPACES):
    code_elem = section.find('ns:code', NAMESPACES)
    if code_elem is not None and code_elem.get('code') == '34084-4': # Adverse Reactions
        text_elem = section.find('ns:text', NAMESPACES)
        
        raw_xml = ET.tostring(text_elem, encoding='utf-8').decode('utf-8')
        raw_xml = re.sub(r'\s+xmlns="[^"]+"', '', raw_xml, count=1)
        soup = BeautifulSoup(raw_xml, 'xml')
        root_node = soup.find()
        
        # Standardize tags
        for list_tag in root_node.find_all('list'):
            list_tag.name = 'ul'
        for item_tag in root_node.find_all('item'):
            item_tag.name = 'li'
        for para_tag in root_node.find_all('paragraph'):
            para_tag.name = 'p'
        
        html = "".join(str(child) for child in root_node.children)
        print("TABLES IN HTML:", html.count('<table'))
        if html.count('<table') == 0:
            print("No tables! Here is the root_node:")
            print(root_node.prettify()[:1000])
