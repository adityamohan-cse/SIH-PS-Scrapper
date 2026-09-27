import requests
from bs4 import BeautifulSoup
import urllib3
import re
import time

urllib3.disable_warnings()

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}

t0 = time.time()
resp = requests.get('https://sih.gov.in/sih2026PS', headers=headers, verify=False, timeout=30)
t_fetch = time.time() - t0
print(f"Fetch completed in {t_fetch:.2f}s, size: {len(resp.content)} bytes")

soup = BeautifulSoup(resp.content, 'html.parser')
table = soup.find('table', {'id': 'dataTablePS'})
tbody = table.find('tbody')
rows = tbody.find_all('tr', recursive=False)
print(f"Total rows found: {len(rows)}")

items = []
software_items = []
hardware_items = []

for idx, tr in enumerate(rows):
    tds = tr.find_all('td', recursive=False)
    if len(tds) < 8:
        continue
    
    s_no = tds[0].get_text(strip=True)
    org = tds[1].get_text(separator=' ', strip=True)
    
    # Title td contains link and modal
    title_td = tds[2]
    # The title link is usually an <a> tag
    title_link = title_td.find('a')
    title = title_link.get_text(strip=True) if title_link else title_td.get_text(separator=' ', strip=True)
    
    # Parse modal details if available
    modal = title_td.find('div', {'class': 'modal'})
    details = {}
    if modal:
        modal_table = modal.find('table')
        if modal_table:
            for m_tr in modal_table.find_all('tr'):
                m_th = m_tr.find('th')
                m_td = m_tr.find('td')
                if m_th and m_td:
                    key = m_th.get_text(strip=True)
                    val = m_td.get_text(separator='\n', strip=True)
                    details[key] = val
    
    category = tds[3].get_text(strip=True)
    ps_number = tds[4].get_text(strip=True)
    sub_count_raw = tds[5].get_text(strip=True)
    theme = tds[6].get_text(strip=True)
    deadline = tds[7].get_text(strip=True)
    
    # Parse submitted count numbers: e.g. "332/500" -> current=332, max=500
    sub_current = 0
    sub_max = 500
    match = re.search(r'(\d+)\s*/\s*(\d+)', sub_count_raw)
    if match:
        sub_current = int(match.group(1))
        sub_max = int(match.group(2))
    elif sub_count_raw.isdigit():
        sub_current = int(sub_count_raw)
        
    item = {
        "s_no": s_no,
        "organization": org,
        "title": title,
        "category": category,
        "ps_number": ps_number,
        "submitted_count_raw": sub_count_raw,
        "submitted_count": sub_current,
        "submitted_max": sub_max,
        "theme": theme,
        "deadline": deadline,
        "details": details
    }
    items.append(item)
    if category.lower() == 'software':
        software_items.append(item)
    elif category.lower() == 'hardware':
        hardware_items.append(item)

print(f"Parsed total: {len(items)}, Software: {len(software_items)}, Hardware: {len(hardware_items)}")

# Test ascending sort by submitted count
sorted_sw = sorted(software_items, key=lambda x: (x['submitted_count'], x['ps_number']))
print("Lowest submitted software PS:")
for x in sorted_sw[:5]:
    print(f"  {x['ps_number']} ({x['submitted_count_raw']}): {x['title'][:50]} | Theme: {x['theme']}")

print("Highest submitted software PS:")
for x in sorted_sw[-3:]:
    print(f"  {x['ps_number']} ({x['submitted_count_raw']}): {x['title'][:50]}")
