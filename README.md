# Smart India Hackathon (SIH) 2026 Problem Statements Tracker & Scraper

Live automated web scraper and interactive tracker for **[sih.gov.in/sih2026PS](https://sih.gov.in/sih2026PS)**.

## ✨ Features

- **All-in-One Page View**: Scrapes and renders all **240 Problem Statements** into a single unified dashboard.
- **Categorized Tabs**:
  - **💻 Software (182 Ideas)**
  - **⚙️ Hardware (58 Ideas)**
  - **🌐 All Categories (240 Ideas)**
- **Ascending Submission Sort (Default)**:
  - Less submitted ideas appear at the **top** (`14/500`, `17/500`, etc.) to easily identify **low-competition** problem statements.
  - High submission statements (`500/500`) appear at the bottom.
- **Real-Time Live Auto-Refresh**:
  - Scrapes and refreshes data periodically (every 1 min, 2 min, or custom interval).
  - Live countdown timer, progress bar, and instant manual "↻ Refresh Now" button.
- **Interactive Detail Modal**:
  - Click any Problem Statement Title to see full **Background**, **Description**, **Expected Solutions**, **Department**, and external links.
- **CSV Data Export**:
  - One-click export for Software or Hardware statements to CSV for offline analysis.

---

## ⚡ How Scraping Works on Vercel (Serverless Architecture)

On Vercel, traditional infinite background threads (`while True: sleep(60)`) get frozen because serverless functions only run during active HTTP requests. 

This project is architected with a **triple-layer system** so it continues scraping the exact same way after deployment:

1. **Pre-Bundled Seed Snapshot (`data_cache.json`)**:
   - The application bundles all 240 problem statements and full details.
   - When a serverless container spins up (cold start), it loads in **<50ms** without keeping users waiting or failing if the government portal has high traffic.

2. **On-Demand Stale-While-Revalidate (SWR) Scraping**:
   - Whenever `/api/data` or `/api/status` is hit, the server checks if the last scrape is older than 60 seconds.
   - If stale, it performs a live scrape against `https://sih.gov.in/sih2026PS`, detects idea count changes, and updates the in-memory cache + `/tmp/data_cache.json`.

3. **Active Client-Side Auto-Ticker**:
   - When a user keeps the dashboard open, the 60-second countdown ticker counts down in real-time.
   - As soon as the countdown reaches `0s`, the frontend automatically calls the server, triggering a live scrape from SIH and updating the table with a toast alert.

4. **Instant Manual "↻ Refresh Now" Button**:
   - Sends a `POST /api/refresh` request that triggers an immediate scrape of `https://sih.gov.in/sih2026PS` on demand.

---

## 🚀 How to Deploy on Vercel

### Option 1: Deploy via GitHub (Recommended)

1. **Initialize Git & Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Deploy SIH 2026 Tracker to Vercel"
   git branch -M main
   # Create a repository on GitHub, then link it:
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```

2. **Import into Vercel**:
   - Go to [vercel.com](https://vercel.com) and log in.
   - Click **"Add New..."** -> **"Project"**.
   - Select your GitHub repository.
   - Keep default settings (**Framework Preset: Other**).
   - Click **"Deploy"**!

### Option 2: Deploy via Vercel CLI

1. Install the Vercel CLI:
   ```bash
   npm install -g vercel
   ```
2. Run deployment in the project root:
   ```bash
   vercel
   ```
3. Follow the prompts (accept default settings). Once verified, deploy to production:
   ```bash
   vercel --prod
   ```

---

## 💻 How to Run Locally

1. Double-click `start.bat` or run:
   ```bash
   python server.py
   ```
2. Open your browser at:
   ```
   http://127.0.0.1:8000
   ```
