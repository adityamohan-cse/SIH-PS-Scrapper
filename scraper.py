import time
import os
import re
import json
import threading
from datetime import datetime
import requests
from bs4 import BeautifulSoup
import urllib3
import queue

urllib3.disable_warnings()

SIH_URL = "https://sih.gov.in/sih2026PS"
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://sih.gov.in/',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
}

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(BASE_DIR, "data_cache.json")
TMP_CACHE_FILE = "/tmp/data_cache.json" if os.path.exists("/tmp") else CACHE_FILE


class SIHScraper:
    def __init__(self, refresh_interval_seconds=60):
        self.refresh_interval = refresh_interval_seconds
        self.last_updated = None
        self.is_fetching = False
        self.error_message = None
        self.raw_html = None
        self.all_data = []
        self.software_data = []
        self.hardware_data = []
        self.prev_counts = {}
        self.recent_changes = []
        self.version = 0
        self.next_scrape_timestamp = time.time() + self.refresh_interval
        self._lock = threading.Lock()
        self._timer_thread = None
        self._running = False
        self._subscribers = []

        # Load pre-bundled cache on initialization so cold starts are instant
        self._load_cache()

    def _load_cache(self):
        """Load cached data from /tmp (lambda writable) or bundled project file"""
        target_path = TMP_CACHE_FILE if os.path.exists(TMP_CACHE_FILE) else CACHE_FILE
        if not os.path.exists(target_path):
            return

        try:
            with open(target_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            self.all_data = data.get("all", [])
            self.software_data = data.get("software", [])
            self.hardware_data = data.get("hardware", [])
            self.recent_changes = data.get("recent_changes", [])
            self.version = data.get("version", 1)

            # Set last_updated to current runtime time to eliminate UTC/IST timezone discrepancies
            self.last_updated = datetime.now()

            for item in self.all_data:
                ps = item.get("ps_number")
                cnt = item.get("submitted_count", 0)
                if ps:
                    self.prev_counts[ps] = cnt

            print(f"Loaded {len(self.all_data)} items from cache: {target_path}")
        except Exception as e:
            print(f"Warning: Failed to load cache from {target_path}: {e}")

    def _save_cache(self, data_dict):
        """Persist latest scraped data to /tmp or project root cache"""
        paths_to_try = [TMP_CACHE_FILE]
        if CACHE_FILE not in paths_to_try:
            paths_to_try.append(CACHE_FILE)

        for p in paths_to_try:
            try:
                os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True)
                with open(p, "w", encoding="utf-8") as f:
                    json.dump(data_dict, f, indent=2)
            except Exception:
                pass

    def register_subscriber(self):
        q = queue.Queue(maxsize=100)
        with self._lock:
            self._subscribers.append(q)
        return q

    def unregister_subscriber(self, q):
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def _broadcast(self, event_data):
        with self._lock:
            dead_queues = []
            for q in self._subscribers:
                try:
                    q.put_nowait(event_data)
                except queue.Full:
                    dead_queues.append(q)
            for dq in dead_queues:
                if dq in self._subscribers:
                    self._subscribers.remove(dq)

    def scrape(self):
        with self._lock:
            if self.is_fetching:
                return False
            self.is_fetching = True
            self.error_message = None

        t0 = time.time()
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Live scrape starting from {SIH_URL}...")
        try:
            session = requests.Session()
            session.headers.update(HEADERS)
            resp = session.get(SIH_URL, verify=False, timeout=12)
            resp.raise_for_status()

            raw_content = resp.text
            soup = BeautifulSoup(raw_content, 'html.parser')
            table = soup.find('table', {'id': 'dataTablePS'})
            if not table:
                raise ValueError("Could not find table with id 'dataTablePS'")

            tbody = table.find('tbody')
            if not tbody:
                raise ValueError("Could not find tbody in dataTablePS")

            rows = tbody.find_all('tr', recursive=False)
            parsed_items = []
            detected_changes = []

            for tr in rows:
                tds = tr.find_all('td', recursive=False)
                if len(tds) < 8:
                    continue

                s_no_text = tds[0].get_text(strip=True)
                try:
                    s_no = int(s_no_text)
                except ValueError:
                    s_no = s_no_text

                org = tds[1].get_text(separator=' ', strip=True)

                # Title & Modal
                title_td = tds[2]
                title_a = title_td.find('a')
                title = title_a.get_text(strip=True) if title_a else title_td.get_text(separator=' ', strip=True)

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

                # Parse submission count
                sub_current = 0
                sub_max = 500
                match = re.search(r'(\d+)\s*/\s*(\d+)', sub_count_raw)
                if match:
                    sub_current = int(match.group(1))
                    sub_max = int(match.group(2))
                elif sub_count_raw.isdigit():
                    sub_current = int(sub_count_raw)

                # Detect changes in submitted counts
                if ps_number in self.prev_counts:
                    old_c = self.prev_counts[ps_number]
                    if old_c != sub_current:
                        diff = sub_current - old_c
                        change_entry = {
                            "ps_number": ps_number,
                            "title": title[:60],
                            "category": category,
                            "old_count": old_c,
                            "new_count": sub_current,
                            "diff": diff,
                            "time": datetime.now().strftime("%H:%M:%S")
                        }
                        detected_changes.append(change_entry)

                item = {
                    "s_no": s_no,
                    "organization": org,
                    "title": title,
                    "category": category,
                    "ps_number": ps_number,
                    "submitted_count_raw": sub_count_raw,
                    "submitted_count": sub_current,
                    "submitted_max": sub_max,
                    "submission_percentage": round((sub_current / sub_max) * 100, 1) if sub_max > 0 else 0,
                    "theme": theme,
                    "deadline": deadline,
                    "details": details
                }
                parsed_items.append(item)

            software = [x for x in parsed_items if x['category'].lower() == 'software']
            hardware = [x for x in parsed_items if x['category'].lower() == 'hardware']

            # Sort ascending by submitted count by default (less submissions on top)
            parsed_items.sort(key=lambda x: (x['submitted_count'], x['ps_number']))
            software.sort(key=lambda x: (x['submitted_count'], x['ps_number']))
            hardware.sort(key=lambda x: (x['submitted_count'], x['ps_number']))

            now = datetime.now()
            duration = round(time.time() - t0, 2)

            with self._lock:
                self.all_data = parsed_items
                self.software_data = software
                self.hardware_data = hardware
                self.raw_html = raw_content
                self.last_updated = now
                self.version += 1
                self.is_fetching = False
                self.next_scrape_timestamp = time.time() + self.refresh_interval
                # Update prev_counts
                for itm in parsed_items:
                    self.prev_counts[itm['ps_number']] = itm['submitted_count']

                if detected_changes:
                    print(f"[{now.strftime('%H:%M:%S')}] Detected {len(detected_changes)} changes in submissions!")
                    for ch in detected_changes:
                        print(f"   -> {ch['ps_number']}: {ch['old_count']} -> {ch['new_count']} ({ch['diff']:+d})")
                    self.recent_changes = (detected_changes + self.recent_changes)[:30]

            log_msg = f"[{now.strftime('%H:%M:%S')}] Live scrape #{self.version} completed in {duration}s! (Total: {len(parsed_items)}, Software: {len(software)}, Hardware: {len(hardware)})"
            print(log_msg)

            # Persist fresh data to cache file
            fresh_data = self.get_data(auto_refresh=False)
            self._save_cache(fresh_data)

            # Broadcast live push event to SSE subscribers if any
            event_payload = {
                "type": "update",
                "version": self.version,
                "timestamp": now.strftime("%Y-%m-%d %H:%M:%S"),
                "duration": duration,
                "changes": detected_changes,
                "next_in_seconds": self.refresh_interval,
                "data": fresh_data
            }
            self._broadcast(event_payload)
            return True
        except Exception as e:
            with self._lock:
                self.is_fetching = False
                self.error_message = str(e)
                self.next_scrape_timestamp = time.time() + 10  # Retry soon on error
            print(f"Scrape error (retaining cached data): {e}")
            return False

    def start_background_updater(self):
        # In Vercel serverless environments, background threads get frozen when request terminates.
        # Instead, Vercel relies on on-demand SWR auto-refresh.
        if os.environ.get("VERCEL"):
            print("Vercel environment detected: Serverless on-demand & SWR scraping active.")
            return

        if self._running:
            return
        self._running = True

        def loop():
            # Initial scrape if empty
            if not self.all_data:
                self.scrape()
            while self._running:
                now_ts = time.time()
                wait_sec = self.next_scrape_timestamp - now_ts
                if wait_sec <= 0:
                    self.scrape()
                else:
                    time.sleep(min(1.0, wait_sec))

        self._timer_thread = threading.Thread(target=loop, daemon=True)
        self._timer_thread.start()

    def get_data(self, auto_refresh=True):
        now_ts = time.time()

        # In serverless environments, scrape on-demand when stale
        if auto_refresh and not self.is_fetching:
            is_stale = False
            with self._lock:
                if not self.all_data:
                    is_stale = True
                elif self.last_updated is None:
                    is_stale = True
                elif (now_ts - self.last_updated.timestamp()) >= self.refresh_interval:
                    is_stale = True

            if is_stale:
                # Trigger live scrape so fresh data is returned directly
                self.scrape()

        with self._lock:
            seconds_remaining = self.refresh_interval
            if self.last_updated:
                elapsed = now_ts - self.last_updated.timestamp()
                if 0 <= elapsed <= self.refresh_interval:
                    seconds_remaining = max(0, int(self.refresh_interval - elapsed))
                else:
                    seconds_remaining = self.refresh_interval
            seconds_remaining = max(0, min(self.refresh_interval, seconds_remaining))

            return {
                "status": "success" if not self.error_message else "error",
                "version": self.version,
                "error": self.error_message,
                "is_fetching": self.is_fetching,
                "is_serverless": bool(os.environ.get("VERCEL")),
                "last_updated": self.last_updated.strftime("%Y-%m-%d %H:%M:%S") if self.last_updated else None,
                "last_updated_time": self.last_updated.strftime("%H:%M:%S") if self.last_updated else None,
                "refresh_interval": self.refresh_interval,
                "seconds_until_next_refresh": seconds_remaining,
                "counts": {
                    "total": len(self.all_data),
                    "software": len(self.software_data),
                    "hardware": len(self.hardware_data),
                    "capped_500": sum(1 for x in self.all_data if x['submitted_count'] >= 500),
                    "open": sum(1 for x in self.all_data if x['submitted_count'] < 500),
                    "low_competition": sum(1 for x in self.all_data if x['submitted_count'] <= 50),
                    "medium_competition": sum(1 for x in self.all_data if 50 < x['submitted_count'] <= 200),
                    "high_competition": sum(1 for x in self.all_data if x['submitted_count'] > 200)
                },
                "recent_changes": self.recent_changes,
                "software": self.software_data,
                "hardware": self.hardware_data,
                "all": self.all_data
            }


scraper = SIHScraper(refresh_interval_seconds=60)
