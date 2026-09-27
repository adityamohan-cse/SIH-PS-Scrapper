import os
import io
import csv
import json
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, HTTPException, Response, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse, HTMLResponse
import requests
from scraper import scraper

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
INDEX_HTML = os.path.join(STATIC_DIR, "index.html")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start background scraper thread if running in persistent environment (local)
    scraper.start_background_updater()
    yield

app = FastAPI(title="SIH 2026 Problem Statements Tracker", lifespan=lifespan, redirect_slashes=False)

@app.get("/api/data")
@app.get("/data")
def get_data():
    return scraper.get_data()

@app.get("/api/status")
@app.get("/status")
def get_status():
    data = scraper.get_data(auto_refresh=False)
    return {
        "version": data["version"],
        "is_fetching": data["is_fetching"],
        "is_serverless": data.get("is_serverless", False),
        "last_updated": data["last_updated"],
        "last_updated_time": data["last_updated_time"],
        "seconds_until_next_refresh": data["seconds_until_next_refresh"],
        "refresh_interval": data["refresh_interval"],
        "counts": data["counts"],
        "recent_changes": data["recent_changes"][:5]
    }

@app.get("/api/stream")
@app.get("/stream")
async def live_stream(request: Request):
    # On Vercel Serverless, persistent SSE connections timeout after 10-60s.
    # Return the initial state with serverless flag so client uses proactive auto-sync ticker.
    if os.environ.get("VERCEL"):
        async def serverless_stream():
            initial_data = scraper.get_data(auto_refresh=False)
            init_payload = {
                "type": "init",
                "version": initial_data["version"],
                "timestamp": initial_data["last_updated"],
                "data": initial_data,
                "serverless": True
            }
            yield f"data: {json.dumps(init_payload)}\n\n"

        return StreamingResponse(
            serverless_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            }
        )

    q = scraper.register_subscriber()

    async def event_generator():
        try:
            initial_data = scraper.get_data()
            init_payload = {
                "type": "init",
                "version": initial_data["version"],
                "timestamp": initial_data["last_updated"],
                "data": initial_data
            }
            yield f"data: {json.dumps(init_payload)}\n\n"

            while True:
                if await request.is_disconnected():
                    break

                try:
                    event_data = q.get_nowait()
                    yield f"data: {json.dumps(event_data)}\n\n"
                except Exception:
                    await asyncio.sleep(1)
                    now_data = scraper.get_data(auto_refresh=False)
                    ping_payload = {
                        "type": "tick",
                        "seconds_left": now_data["seconds_until_next_refresh"],
                        "is_fetching": now_data["is_fetching"],
                        "version": now_data["version"]
                    }
                    yield f"data: {json.dumps(ping_payload)}\n\n"

        finally:
            scraper.unregister_subscriber(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@app.post("/api/refresh")
@app.get("/api/refresh")
@app.post("/refresh")
@app.get("/refresh")
def force_refresh():
    success = scraper.scrape()
    data = scraper.get_data(auto_refresh=False)
    return {
        "status": "success" if success else "error",
        "message": "Scrape completed successfully" if success else scraper.error_message,
        "data": data
    }

@app.post("/api/interval")
@app.post("/interval")
def set_interval(seconds: int = Query(..., ge=10, le=3600)):
    scraper.refresh_interval = seconds
    scraper.next_scrape_timestamp = (scraper.last_updated.timestamp() + seconds) if scraper.last_updated else 0
    return {"status": "success", "new_interval": seconds}

@app.get("/api/export/{category}")
@app.get("/export/{category}")
def export_csv(category: str):
    data = scraper.get_data(auto_refresh=False)
    category_lower = category.lower()

    if category_lower == "software":
        items = data["software"]
        filename = "SIH2026_Software_Problem_Statements.csv"
    elif category_lower == "hardware":
        items = data["hardware"]
        filename = "SIH2026_Hardware_Problem_Statements.csv"
    elif category_lower == "all":
        items = data["all"]
        filename = "SIH2026_All_Problem_Statements.csv"
    else:
        raise HTTPException(status_code=400, detail="Invalid category. Use 'software', 'hardware', or 'all'.")

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "S.No.",
        "PS Number",
        "Category",
        "Problem Statement Title",
        "Organization",
        "Theme",
        "Submitted Idea(s) Count",
        "Submitted Count (Numeric)",
        "Max Allowed",
        "Deadline for Idea Submission",
        "Description"
    ])

    for itm in items:
        details = itm.get("details", {})
        desc = details.get("Description", "")
        writer.writerow([
            itm.get("s_no", ""),
            itm.get("ps_number", ""),
            itm.get("category", ""),
            itm.get("title", ""),
            itm.get("organization", ""),
            itm.get("theme", ""),
            itm.get("submitted_count_raw", ""),
            itm.get("submitted_count", 0),
            itm.get("submitted_max", 500),
            itm.get("deadline", ""),
            desc
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/portal", response_class=HTMLResponse)
def official_portal(ps: str = Query("", description="Problem Statement ID/Number to search")):
    html = scraper.raw_html
    if not html:
        try:
            r = requests.get("https://sih.gov.in/sih2026PS", headers={"User-Agent": "Mozilla/5.0"}, verify=False, timeout=15)
            html = r.text
        except Exception as e:
            return HTMLResponse(f"<h3>Error loading official portal: {e}</h3>", status_code=500)

    # Ensure base href points to sih.gov.in so assets load correctly
    base_tag = '<base href="https://sih.gov.in/">'
    if "<head>" in html:
        html = html.replace("<head>", f"<head>\n{base_tag}", 1)
    elif "<HEAD>" in html:
        html = html.replace("<HEAD>", f"<HEAD>\n{base_tag}", 1)

    clean_ps = ps.strip()
    injection = f"""
    <!-- Smart India Hackathon Auto-Search Helper -->
    <style>
        #sih-search-banner {{
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 999999;
            background: linear-gradient(90deg, #1e3a8a, #2563eb);
            color: #ffffff;
            padding: 10px 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            border-bottom: 2px solid #60a5fa;
        }}
        #sih-search-banner .banner-info {{
            font-size: 14px;
            font-weight: 500;
        }}
        #sih-search-banner .banner-ps {{
            background: #ffffff;
            color: #1e3a8a;
            padding: 3px 8px;
            border-radius: 4px;
            font-weight: 700;
            font-family: monospace;
            font-size: 15px;
            margin: 0 5px;
        }}
        #sih-search-banner .banner-actions {{
            display: flex;
            gap: 10px;
            align-items: center;
        }}
        #sih-search-banner .btn-banner {{
            background: rgba(255,255,255,0.2);
            color: #ffffff;
            border: 1px solid rgba(255,255,255,0.4);
            padding: 5px 12px;
            border-radius: 4px;
            font-size: 13px;
            text-decoration: none;
            cursor: pointer;
            transition: all 0.2s;
            font-weight: 600;
        }}
        #sih-search-banner .btn-banner:hover {{
            background: #ffffff;
            color: #1e3a8a;
        }}
        body {{
            padding-top: 48px !important;
        }}
    </style>
    <div id="sih-search-banner">
        <div class="banner-info">
            ⚡ <strong>Official SIH 2026 Portal</strong> &bull; Auto-filtered to: <span class="banner-ps">{clean_ps if clean_ps else "All PS"}</span>
        </div>
        <div class="banner-actions">
            <button class="btn-banner" onclick="filterTargetPS('{clean_ps}')">🔍 Filter Again</button>
            <a href="/" class="btn-banner">⬅ Back to Tracker Dashboard</a>
        </div>
    </div>
    <script>
    function filterTargetPS(targetPS) {{
        if (!targetPS) return;
        var attempts = 0;
        var timer = setInterval(function() {{
            attempts++;
            if (window.jQuery && jQuery.fn.dataTable && jQuery('#dataTablePS').length) {{
                try {{
                    var table = jQuery('#dataTablePS').DataTable();
                    table.search(targetPS).draw();

                    var searchInput = jQuery('#dataTablePS_filter input');
                    if (searchInput.length) {{
                        searchInput.val(targetPS);
                        searchInput.css({{'border': '2px solid #2563eb', 'background-color': '#eff6ff', 'font-weight': 'bold'}});
                    }}

                    clearInterval(timer);
                    console.log('Successfully filtered official SIH DataTable to: ' + targetPS);

                    setTimeout(function() {{
                        var tr = jQuery('#dataTablePS tbody tr:first-child');
                        var link = tr.find('a[data-target]');
                        if (link.length) {{
                            var modalId = link.attr('data-target');
                            if (modalId && jQuery(modalId).length) {{
                                jQuery(modalId).modal('show');
                            }}
                        }}
                    }}, 400);
                }} catch (e) {{
                    console.error('Error applying DataTable search:', e);
                }}
            }}
            if (attempts > 60) clearInterval(timer);
        }}, 150);
    }}

    window.addEventListener('DOMContentLoaded', function() {{
        filterTargetPS('{clean_ps}');
    }});
    window.addEventListener('load', function() {{
        filterTargetPS('{clean_ps}');
    }});
    </script>
    """

    if "</body>" in html:
        html = html.replace("</body>", f"{injection}\n</body>", 1)
    else:
        html = html + injection

    return HTMLResponse(content=html)

# Mount static folder with absolute path
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def read_root():
    if os.path.exists(INDEX_HTML):
        return FileResponse(INDEX_HTML)
    public_index = os.path.join(PUBLIC_DIR, "index.html")
    if os.path.exists(public_index):
        return FileResponse(public_index)
    return HTMLResponse("<h1>SIH Tracker</h1><p>Static files missing</p>", status_code=404)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)
