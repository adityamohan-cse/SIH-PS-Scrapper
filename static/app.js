/**
 * Smart India Hackathon 2026 - Problem Statements Tracker & Scraper
 * Strict 1-Minute Live Synchronization & Push Controller
 */

// Application State
const state = {
    activeCategory: 'software', // 'software' | 'hardware' | 'all'
    data: {
        all: [],
        software: [],
        hardware: [],
        counts: {}
    },
    previousCounts: new Map(), // ps_number -> submitted_count for change detection
    sortColumn: 'submitted_count',
    sortDirection: 'asc', // Ascending: Less submissions on top!
    searchQuery: '',
    selectedTheme: '',
    selectedCompetition: '',
    refreshInterval: 60,
    secondsLeft: 60,
    isFetching: false,
    version: 0,
    eventSource: null,
    selectedItem: null,
    lastScrapeDuration: null
};

// DOM Elements Cache
const el = {
    // Stats
    statTotal: document.getElementById('statTotal'),
    statSoftware: document.getElementById('statSoftware'),
    statHardware: document.getElementById('statHardware'),
    statLowComp: document.getElementById('statLowComp'),
    statCapped: document.getElementById('statCapped'),
    tabCountSoftware: document.getElementById('tabCountSoftware'),
    tabCountHardware: document.getElementById('tabCountHardware'),
    tabCountAll: document.getElementById('tabCountAll'),

    // Timer & Status
    lastUpdatedText: document.getElementById('lastUpdatedText'),
    countdownVal: document.getElementById('countdownVal'),
    refreshProgressBar: document.getElementById('refreshProgressBar'),
    btnRefresh: document.getElementById('btnRefresh'),
    refreshIcon: document.getElementById('refreshIcon'),
    intervalSelect: document.getElementById('intervalSelect'),
    streamStatus: document.getElementById('streamStatus'),
    liveIndicator: document.getElementById('liveIndicator'),
    syncClock: document.getElementById('syncClock'),
    liveActivityPill: document.getElementById('liveActivityPill'),
    liveActivityText: document.getElementById('liveActivityText'),

    // Tabs & Toolbar
    tabButtons: document.querySelectorAll('.tab-btn'),
    statCards: document.querySelectorAll('.stat-card'),
    searchInput: document.getElementById('searchInput'),
    clearSearch: document.getElementById('clearSearch'),
    btnSearchOfficial: document.getElementById('btnSearchOfficial'),
    themeFilter: document.getElementById('themeFilter'),
    competitionFilter: document.getElementById('competitionFilter'),
    sortOrder: document.getElementById('sortOrder'),
    btnExportCSV: document.getElementById('btnExportCSV'),

    // Table
    tableBody: document.getElementById('tableBody'),
    tableHeaders: document.querySelectorAll('.sih-table thead th.sortable'),
    showingCountText: document.getElementById('showingCountText'),
    sortTagIndicator: document.getElementById('sortTagIndicator'),
    footerCount: document.getElementById('footerCount'),

    // Modal
    modalBackdrop: document.getElementById('modalBackdrop'),
    modalClose: document.getElementById('modalClose'),
    modalPsNumber: document.getElementById('modalPsNumber'),
    modalCategory: document.getElementById('modalCategory'),
    modalTheme: document.getElementById('modalTheme'),
    modalTitle: document.getElementById('modalTitle'),
    modalOrg: document.getElementById('modalOrg'),
    modalDept: document.getElementById('modalDept'),
    modalCount: document.getElementById('modalCount'),
    modalCountBar: document.getElementById('modalCountBar'),
    modalDeadline: document.getElementById('modalDeadline'),
    modalDescription: document.getElementById('modalDescription'),
    modalLinksContainer: document.getElementById('modalLinksContainer'),
    btnCopyPS: document.getElementById('btnCopyPS'),
    btnOfficialPortal: document.getElementById('btnOfficialPortal'),
    btnOfficialPortalText: document.getElementById('btnOfficialPortalText'),
    btnDirectSIH: document.getElementById('btnDirectSIH'),

    // Toast
    toast: document.getElementById('toast')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    fetchLatestData();
    initLiveStream();
    startClientTicker();
});

// Real-Time Server-Sent Events (SSE) Stream
function initLiveStream() {
    // If hosted on Vercel, use smart auto-sync polling to respect serverless function duration
    const isVercelHost = window.location.hostname.includes('vercel.app');

    if (!window.EventSource || isVercelHost) {
        if (el.streamStatus) {
            el.streamStatus.innerHTML = '<span class="stream-dot"></span> LIVE AUTO-SYNC (60s)';
            el.streamStatus.style.borderColor = '#bbf7d0';
            el.streamStatus.style.color = '#15803d';
        }
        fallbackPolling();
        return;
    }

    try {
        if (state.eventSource) {
            state.eventSource.close();
        }

        state.eventSource = new EventSource('/api/stream');

        state.eventSource.onopen = () => {
            if (el.streamStatus) {
                el.streamStatus.innerHTML = '<span class="stream-dot"></span> LIVE CONNECTED';
                el.streamStatus.style.borderColor = '#bbf7d0';
                el.streamStatus.style.color = '#15803d';
            }
        };

        state.eventSource.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data);
                handleStreamMessage(payload);
            } catch (err) {
                console.error('Error parsing stream message:', err);
            }
        };

        let retryCount = 0;
        state.eventSource.onerror = () => {
            retryCount++;
            if (retryCount >= 2) {
                // If stream connection drops twice (e.g. serverless proxy), seamlessly switch to auto-sync
                if (state.eventSource) {
                    state.eventSource.close();
                    state.eventSource = null;
                }
                if (el.streamStatus) {
                    el.streamStatus.innerHTML = '<span class="stream-dot"></span> LIVE AUTO-SYNC (60s)';
                    el.streamStatus.style.borderColor = '#bbf7d0';
                    el.streamStatus.style.color = '#15803d';
                }
                fallbackPolling();
            } else if (el.streamStatus) {
                el.streamStatus.innerHTML = '<span class="stream-dot" style="background:#eab308"></span> RECONNECTING';
                el.streamStatus.style.borderColor = '#fef08a';
                el.streamStatus.style.color = '#a16207';
            }
        };
    } catch (e) {
        console.error('SSE initialization error:', e);
        fallbackPolling();
    }
}

// Handle Real-Time Stream Message from Server
function handleStreamMessage(payload) {
    if (payload.type === 'init') {
        state.version = payload.version;
        applyNewData(payload.data, false);
        if (payload.serverless && el.streamStatus) {
            el.streamStatus.innerHTML = '<span class="stream-dot"></span> LIVE AUTO-SYNC (60s)';
            el.streamStatus.style.borderColor = '#bbf7d0';
            el.streamStatus.style.color = '#15803d';
            fallbackPolling();
        }
    } else if (payload.type === 'tick') {
        state.secondsLeft = payload.seconds_left !== undefined ? payload.seconds_left : state.secondsLeft;
        state.isFetching = payload.is_fetching;
        updateCountdownUI();

        // If version jumped ahead (e.g. forced refresh from another client)
        if (payload.version && payload.version > state.version) {
            fetchLatestData();
        }
    } else if (payload.type === 'update') {
        state.version = payload.version;
        state.lastScrapeDuration = payload.duration;
        const changes = payload.changes || [];
        
        applyNewData(payload.data, true, changes);

        if (changes.length > 0) {
            showToast(`⚡ LIVE UPDATE: ${changes.length} problem statements updated their idea counts!`);
            if (el.liveActivityPill && el.liveActivityText) {
                const first = changes[0];
                el.liveActivityText.textContent = `${first.ps_number} count changed: ${first.old_count} ➜ ${first.new_count}`;
                el.liveActivityPill.classList.remove('hidden');
            }
        } else {
            showToast(`✓ Strict 1-min sync: All 240 statements checked live (in ${payload.duration}s)`);
        }
    }
}

// Apply newly fetched data to state & DOM
function applyNewData(serverData, isUpdate = false, changes = []) {
    if (!serverData) return;

    // Detect changes if not provided by server
    const changedPsSet = new Set();
    if (changes && changes.length > 0) {
        changes.forEach(c => changedPsSet.add(c.ps_number));
    }

    // Check against previous counts in memory
    const all = serverData.all || [];
    all.forEach(item => {
        const ps = item.ps_number;
        const currentCount = item.submitted_count || 0;
        if (state.previousCounts.has(ps)) {
            const old = state.previousCounts.get(ps);
            if (old !== currentCount) {
                changedPsSet.add(ps);
            }
        }
        state.previousCounts.set(ps, currentCount);
    });

    state.data = serverData;
    state.refreshInterval = serverData.refresh_interval || 60;
    const sec = serverData.seconds_until_next_refresh;
    if (typeof sec === 'number' && sec > 0 && sec <= state.refreshInterval) {
        state.secondsLeft = sec;
    } else {
        state.secondsLeft = state.refreshInterval || 60;
    }

    updateStats(serverData);
    populateThemeOptions();
    renderTable(changedPsSet);

    if (serverData.last_updated_time) {
        const durText = state.lastScrapeDuration ? ` (${state.lastScrapeDuration}s)` : '';
        el.lastUpdatedText.textContent = `Last updated: ${serverData.last_updated_time}${durText}`;
    }

    if (el.syncClock) {
        el.syncClock.textContent = `Strict 60s Sync: Active`;
    }

    updateCountdownUI();
}

let pollingIntervalId = null;
// Client Fallback Polling (if SSE drops or on Vercel)
function fallbackPolling() {
    if (pollingIntervalId) return;
    pollingIntervalId = setInterval(async () => {
        try {
            let resp = await fetch('/status');
            if (!resp.ok) {
                resp = await fetch('/api/status');
            }
            if (resp.ok) {
                const status = await resp.json();
                if (status.version > state.version) {
                    await fetchLatestData();
                } else if (status.seconds_until_next_refresh !== undefined) {
                    const sec = status.seconds_until_next_refresh;
                    if (typeof sec === 'number' && sec > 0 && sec <= state.refreshInterval) {
                        state.secondsLeft = sec;
                    } else {
                        state.secondsLeft = state.refreshInterval || 60;
                    }
                    updateCountdownUI();
                }
            }
        } catch (e) {
            console.error('Fallback poll error:', e);
        }
    }, 5000);
}

// Manual Fetch Helper
async function fetchLatestData() {
    try {
        let resp = await fetch('/data');
        if (!resp.ok) {
            resp = await fetch('/api/data');
        }
        if (resp.ok) {
            const json = await resp.json();
            state.version = json.version;
            applyNewData(json, true);
        } else {
            console.error('Fetch data failed with HTTP status:', resp.status);
        }
    } catch (e) {
        console.error('Fetch data error:', e);
    }
}

// Client Ticker for smooth countdown between ticks
function startClientTicker() {
    setInterval(() => {
        if (!state.isFetching) {
            if (state.secondsLeft > 0) {
                state.secondsLeft -= 1;
                updateCountdownUI();
            } else {
                // Countdown reached 0: automatically perform live scrape from SIH portal!
                state.secondsLeft = state.refreshInterval || 60;
                updateCountdownUI();
                forceRefresh();
            }
        }
    }, 1000);
}

// Update Header Countdown Display
function updateCountdownUI() {
    if (state.isFetching) {
        el.countdownVal.innerHTML = '<span class="pulse-dot"></span> Scraping SIH...';
        el.refreshProgressBar.style.width = '100%';
        el.refreshProgressBar.style.background = 'linear-gradient(90deg, #f59e0b, #ef4444)';
        return;
    }

    el.refreshProgressBar.style.background = 'linear-gradient(90deg, #3b82f6, #10b981)';
    el.countdownVal.textContent = `${state.secondsLeft}s`;
    const pct = Math.max(0, Math.min(100, (state.secondsLeft / state.refreshInterval) * 100));
    el.refreshProgressBar.style.width = `${pct}%`;
}

// Event Listeners
function initEventListeners() {
    // Tab switching
    el.tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const cat = btn.getAttribute('data-category');
            switchCategory(cat);
        });
    });

    // Stat card clicks switch category
    el.statCards.forEach(card => {
        const cat = card.getAttribute('data-tab');
        if (cat) {
            card.addEventListener('click', () => switchCategory(cat));
        }
    });

    // Low competition shortcut card
    const cardLowComp = document.getElementById('cardLowComp');
    if (cardLowComp) {
        cardLowComp.addEventListener('click', () => {
            el.competitionFilter.value = 'golden';
            state.selectedCompetition = 'golden';
            renderTable();
        });
    }

    // Search input
    el.searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.trim().toLowerCase();
        const hasQuery = Boolean(state.searchQuery);
        el.clearSearch.classList.toggle('hidden', !hasQuery);
        
        if (el.btnSearchOfficial) {
            el.btnSearchOfficial.classList.toggle('hidden', !hasQuery);
            el.searchInput.parentElement.classList.toggle('has-query', hasQuery);
            if (hasQuery) {
                const display = state.searchQuery.length > 14 ? state.searchQuery.slice(0, 12) + '...' : state.searchQuery;
                el.btnSearchOfficial.innerHTML = `<span>Search "${escapeHtml(display.toUpperCase())}" on Official SIH ↗</span>`;
            }
        }
        renderTable();
    });

    if (el.btnSearchOfficial) {
        el.btnSearchOfficial.addEventListener('click', () => {
            if (state.searchQuery) {
                const targetUrl = `/portal?ps=${encodeURIComponent(state.searchQuery)}`;
                window.open(targetUrl, '_blank');
                navigator.clipboard.writeText(state.searchQuery).catch(() => {});
                showToast(`Opening Official SIH portal filtered for "${state.searchQuery.toUpperCase()}"!`);
            }
        });
    }

    el.clearSearch.addEventListener('click', () => {
        el.searchInput.value = '';
        state.searchQuery = '';
        el.clearSearch.classList.add('hidden');
        if (el.btnSearchOfficial) {
            el.btnSearchOfficial.classList.add('hidden');
            el.searchInput.parentElement.classList.remove('has-query');
        }
        renderTable();
    });

    // Theme filter
    el.themeFilter.addEventListener('change', (e) => {
        state.selectedTheme = e.target.value;
        renderTable();
    });

    // Competition filter
    el.competitionFilter.addEventListener('change', (e) => {
        state.selectedCompetition = e.target.value;
        renderTable();
    });

    // Sort order select
    el.sortOrder.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'sub_asc') {
            state.sortColumn = 'submitted_count';
            state.sortDirection = 'asc';
        } else if (val === 'sub_desc') {
            state.sortColumn = 'submitted_count';
            state.sortDirection = 'desc';
        } else if (val === 'ps_asc') {
            state.sortColumn = 'ps_number';
            state.sortDirection = 'asc';
        } else if (val === 'ps_desc') {
            state.sortColumn = 'ps_number';
            state.sortDirection = 'desc';
        } else if (val === 'title_asc') {
            state.sortColumn = 'title';
            state.sortDirection = 'asc';
        } else if (val === 'org_asc') {
            state.sortColumn = 'organization';
            state.sortDirection = 'asc';
        }
        updateSortHeaderIndicators();
        renderTable();
    });

    // Table header click-to-sort
    el.tableHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const col = th.getAttribute('data-sort');
            if (state.sortColumn === col) {
                state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                state.sortColumn = col;
                state.sortDirection = 'asc';
            }
            syncSortSelectWithState();
            updateSortHeaderIndicators();
            renderTable();
        });
    });

    // Manual Refresh button
    el.btnRefresh.addEventListener('click', forceRefresh);

    // Auto-refresh interval change
    el.intervalSelect.addEventListener('change', (e) => {
        const seconds = parseInt(e.target.value, 10);
        state.refreshInterval = seconds;
        state.secondsLeft = seconds;
        if (seconds > 0) {
            fetch(`/api/interval?seconds=${seconds}`, { method: 'POST' }).catch(() => {});
            showToast(`Strict interval set to ${seconds >= 60 ? (seconds/60) + ' min' : seconds + 's'}`);
        } else {
            showToast('Auto-refresh paused');
        }
    });

    // Export CSV
    el.btnExportCSV.addEventListener('click', () => {
        const cat = state.activeCategory;
        window.location.href = `/export/${cat}`;
        showToast(`Exporting ${cat.toUpperCase()} Problem Statements as CSV...`);
    });

    // Modal close events
    el.modalClose.addEventListener('click', closeModal);
    el.modalBackdrop.addEventListener('click', (e) => {
        if (e.target === el.modalBackdrop) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    // Copy PS Number button
    el.btnCopyPS.addEventListener('click', () => {
        if (state.selectedItem) {
            navigator.clipboard.writeText(state.selectedItem.ps_number).then(() => {
                showToast(`Copied ${state.selectedItem.ps_number} to clipboard!`);
            });
        }
    });
}

function switchCategory(category) {
    state.activeCategory = category;

    el.tabButtons.forEach(btn => {
        const match = btn.getAttribute('data-category') === category;
        btn.classList.toggle('active', match);
    });

    el.statCards.forEach(card => {
        const cat = card.getAttribute('data-tab');
        card.classList.toggle('active-card', cat === category);
    });

    renderTable();
}

// Force immediate scrape
async function forceRefresh() {
    if (state.isFetching) return;
    state.isFetching = true;

    el.refreshIcon.classList.add('rotating');
    el.btnRefresh.disabled = true;
    showToast('Strict scrape initiated: Contacting sih.gov.in now...');

    try {
        let resp = await fetch('/refresh', { method: 'POST' });
        if (!resp.ok) {
            resp = await fetch('/api/refresh', { method: 'POST' });
        }
        const res = await resp.json();
        if (res.data) {
            applyNewData(res.data, true);
            showToast('✓ Real-time update complete: Latest counts synced!');
        }
    } catch (err) {
        console.error('Refresh error:', err);
        showToast('Refresh failed. Portal may be slow.');
    } finally {
        state.isFetching = false;
        el.refreshIcon.classList.remove('rotating');
        el.btnRefresh.disabled = false;
        state.secondsLeft = state.refreshInterval;
        updateCountdownUI();
    }
}

// Update Header Metric Counters
function updateStats(data) {
    const counts = data.counts || {};
    el.statTotal.textContent = counts.total || 240;
    el.statSoftware.textContent = counts.software || 182;
    el.statHardware.textContent = counts.hardware || 58;

    el.tabCountSoftware.textContent = counts.software || 182;
    el.tabCountHardware.textContent = counts.hardware || 58;
    el.tabCountAll.textContent = counts.total || 240;

    if (counts.low_competition !== undefined) {
        el.statLowComp.textContent = counts.low_competition;
    }
    if (counts.capped_500 !== undefined) {
        el.statCapped.textContent = counts.capped_500;
    }
}

// Populate Theme Filter Dropdown dynamically
function populateThemeOptions() {
    const currentVal = el.themeFilter.value;
    const allItems = state.data.all || [];
    const themes = new Set();
    allItems.forEach(i => {
        if (i.theme && i.theme.trim()) themes.add(i.theme.trim());
    });

    const sortedThemes = Array.from(themes).sort();
    let html = '<option value="">All Themes</option>';
    sortedThemes.forEach(t => {
        const selected = t === currentVal ? 'selected' : '';
        html += `<option value="${escapeHtml(t)}" ${selected}>${escapeHtml(t)}</option>`;
    });
    el.themeFilter.innerHTML = html;
}

// Filter, Sort, and Render Table
function renderTable(changedPsSet = new Set()) {
    let list = [];
    if (state.activeCategory === 'software') {
        list = [...(state.data.software || [])];
    } else if (state.activeCategory === 'hardware') {
        list = [...(state.data.hardware || [])];
    } else {
        list = [...(state.data.all || [])];
    }

    const totalInCat = list.length;

    // Apply Search Filter
    if (state.searchQuery) {
        const q = state.searchQuery;
        list = list.filter(item => {
            return (
                (item.ps_number && item.ps_number.toLowerCase().includes(q)) ||
                (item.title && item.title.toLowerCase().includes(q)) ||
                (item.organization && item.organization.toLowerCase().includes(q)) ||
                (item.theme && item.theme.toLowerCase().includes(q)) ||
                (item.category && item.category.toLowerCase().includes(q))
            );
        });
    }

    // Apply Theme Filter
    if (state.selectedTheme) {
        list = list.filter(item => item.theme === state.selectedTheme);
    }

    // Apply Competition Tier Filter
    if (state.selectedCompetition) {
        list = list.filter(item => {
            const count = item.submitted_count || 0;
            switch (state.selectedCompetition) {
                case 'golden': return count <= 50;
                case 'low': return count > 50 && count <= 150;
                case 'moderate': return count > 150 && count <= 350;
                case 'high': return count > 350 && count < 500;
                case 'open': return count < 500;
                case 'capped': return count >= 500;
                default: return true;
            }
        });
    }

    // Apply Sorting (Ascending less submissions on top by default)
    list.sort((a, b) => {
        let valA = a[state.sortColumn];
        let valB = b[state.sortColumn];

        if (state.sortColumn === 'submitted_count') {
            valA = a.submitted_count !== undefined ? a.submitted_count : 0;
            valB = b.submitted_count !== undefined ? b.submitted_count : 0;
            if (valA !== valB) {
                return state.sortDirection === 'asc' ? valA - valB : valB - valA;
            }
            return a.ps_number.localeCompare(b.ps_number);
        }

        if (state.sortColumn === 's_no') {
            const numA = parseInt(valA, 10) || 0;
            const numB = parseInt(valB, 10) || 0;
            return state.sortDirection === 'asc' ? numA - numB : numB - numA;
        }

        valA = (valA || '').toString().toLowerCase();
        valB = (valB || '').toString().toLowerCase();
        const cmp = valA.localeCompare(valB);
        return state.sortDirection === 'asc' ? cmp : -cmp;
    });

    const catLabel = state.activeCategory === 'software' ? 'Software' : (state.activeCategory === 'hardware' ? 'Hardware' : 'Total');
    el.showingCountText.textContent = `Showing ${list.length} of ${totalInCat} ${catLabel} Problem Statements`;
    el.footerCount.textContent = `All ${list.length} displayed on 1 page (Sorted: ${state.sortDirection === 'asc' ? 'Lowest' : 'Highest'} Submissions on top)`;

    if (list.length === 0) {
        el.tableBody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 3rem 1rem; color: #64748b;">
                    <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
                    <p style="font-weight: 600; font-size: 1rem; color: #1e293b;">No Problem Statements match your criteria</p>
                    <p style="font-size: 0.82rem;">Try adjusting search terms or clear filters</p>
                </td>
            </tr>
        `;
        return;
    }

    let rowsHtml = '';
    list.forEach((item, index) => {
        const count = item.submitted_count || 0;
        const max = item.submitted_max || 500;
        const pct = Math.min(100, Math.round((count / max) * 100));
        const isChanged = changedPsSet.has(item.ps_number);

        let tierClass = 'tier-mid';
        let badgeHtml = '';

        if (count <= 50) {
            tierClass = 'tier-low';
            badgeHtml = `<span class="comp-badge badge-golden">🔥 Low Comp</span>`;
        } else if (count <= 200) {
            tierClass = 'tier-mid';
        } else if (count < 500) {
            tierClass = 'tier-high';
        } else {
            tierClass = 'tier-full';
            badgeHtml = `<span class="comp-badge badge-capped">🔒 Full</span>`;
        }

        const catClass = (item.category || '').toLowerCase().includes('hardware') ? 'hardware' : 'software';
        const flashClass = isChanged ? 'count-flash' : '';
        const diffBadge = isChanged ? '<span class="count-badge-diff">UPDATED</span>' : '';

        rowsHtml += `
            <tr data-ps="${escapeHtml(item.ps_number)}">
                <td class="td-sno">${item.s_no}</td>
                <td class="td-org">${escapeHtml(item.organization)}</td>
                <td class="td-title">
                    <a href="javascript:void(0)" class="title-link" onclick="openModal('${escapeHtml(item.ps_number)}')">
                        ${escapeHtml(item.title)}
                    </a>
                </td>
                <td class="td-category">
                    <span class="badge-cat ${catClass}">${escapeHtml(item.category)}</span>
                </td>
                <td class="td-ps">
                    <a href="/portal?ps=${escapeHtml(item.ps_number)}" target="_blank" rel="noopener" class="ps-pill" title="Click to view and search ${escapeHtml(item.ps_number)} on Official SIH Portal">
                        ${escapeHtml(item.ps_number)} ↗
                    </a>
                </td>
                <td class="td-sub ${tierClass} ${flashClass}">
                    <div class="sub-box">
                        <span class="sub-ratio">${item.submitted_count_raw || (count + '/' + max)} ${diffBadge}</span>
                        <div class="sub-progress-bar">
                            <div class="sub-progress-fill" style="width: ${pct}%"></div>
                        </div>
                        ${badgeHtml}
                    </div>
                </td>
                <td class="td-theme">
                    <span class="theme-pill">${escapeHtml(item.theme || 'N/A')}</span>
                </td>
                <td class="td-deadline">${escapeHtml(item.deadline || '30 September 2026')}</td>
            </tr>
        `;
    });

    el.tableBody.innerHTML = rowsHtml;
}

// Update Active Sort Indicator in Table Header
function updateSortHeaderIndicators() {
    el.tableHeaders.forEach(th => {
        const col = th.getAttribute('data-sort');
        const isCurrent = col === state.sortColumn;
        th.classList.toggle('active-sort', isCurrent);

        const upArrow = th.querySelector('.arrow-up');
        const downArrow = th.querySelector('.arrow-down');
        if (upArrow && downArrow) {
            upArrow.classList.toggle('active', isCurrent && state.sortDirection === 'asc');
            downArrow.classList.toggle('active', isCurrent && state.sortDirection === 'desc');
        }
    });

    if (state.sortColumn === 'submitted_count') {
        el.sortTagIndicator.textContent = state.sortDirection === 'asc' 
            ? '🔥 Sorted: Lowest Submissions on top (Recommended)' 
            : '📈 Sorted: Highest Submissions on top';
    } else {
        el.sortTagIndicator.textContent = `Sorted by ${state.sortColumn.toUpperCase()} (${state.sortDirection.toUpperCase()})`;
    }
}

function syncSortSelectWithState() {
    if (state.sortColumn === 'submitted_count') {
        el.sortOrder.value = state.sortDirection === 'asc' ? 'sub_asc' : 'sub_desc';
    } else if (state.sortColumn === 'ps_number') {
        el.sortOrder.value = state.sortDirection === 'asc' ? 'ps_asc' : 'ps_desc';
    } else if (state.sortColumn === 'title') {
        el.sortOrder.value = 'title_asc';
    } else if (state.sortColumn === 'organization') {
        el.sortOrder.value = 'org_asc';
    }
}

// Open Detail Modal
window.openModal = function(psNumber) {
    const all = state.data.all || [];
    const item = all.find(x => x.ps_number === psNumber);
    if (!item) return;

    state.selectedItem = item;

    el.modalPsNumber.textContent = item.ps_number;
    el.modalCategory.textContent = item.category;
    el.modalTheme.textContent = item.theme || 'General';
    el.modalTitle.textContent = item.title;
    el.modalOrg.textContent = item.organization;

    const details = item.details || {};
    el.modalDept.textContent = details['Department'] || item.organization;
    el.modalCount.textContent = item.submitted_count_raw || `${item.submitted_count}/500`;
    el.modalDeadline.textContent = item.deadline || '30 September 2026';

    const pct = Math.min(100, Math.round(((item.submitted_count || 0) / (item.submitted_max || 500)) * 100));
    el.modalCountBar.style.width = `${pct}%`;

    // Render Full Description
    const desc = details['Description'] || details['Problem Statement Details'] || 'No additional description provided in portal.';
    el.modalDescription.textContent = desc;

    // Render External Links
    let linksHtml = '';
    if (details['Youtube Link'] && details['Youtube Link'].trim()) {
        linksHtml += `<a href="${escapeHtml(details['Youtube Link'])}" target="_blank" rel="noopener" class="btn btn-outline">▶ Watch Video</a>`;
    }
    if (details['Dataset Link'] && details['Dataset Link'].trim()) {
        linksHtml += `<a href="${escapeHtml(details['Dataset Link'])}" target="_blank" rel="noopener" class="btn btn-outline">📊 View Dataset</a>`;
    }
    el.modalLinksContainer.innerHTML = linksHtml;

    // Set Official Portal buttons to search this specific PS
    if (el.btnOfficialPortal) {
        el.btnOfficialPortal.href = `/portal?ps=${encodeURIComponent(item.ps_number)}`;
        if (el.btnOfficialPortalText) {
            el.btnOfficialPortalText.textContent = `Open Official SIH (Search ${item.ps_number}) ↗`;
        }
        el.btnOfficialPortal.onclick = () => {
            navigator.clipboard.writeText(item.ps_number).catch(() => {});
            showToast(`Opening Official SIH portal with ${item.ps_number} auto-searched...`);
        };
    }

    if (el.btnDirectSIH) {
        el.btnDirectSIH.onclick = () => {
            navigator.clipboard.writeText(item.ps_number).then(() => {
                showToast(`Copied ${item.ps_number} to clipboard! Paste it into the search box on SIH.`);
            });
        };
    }

    el.modalBackdrop.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
};

function closeModal() {
    el.modalBackdrop.classList.add('hidden');
    document.body.style.overflow = '';
}

// Utility: Show Toast
function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove('hidden');
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => {
        el.toast.classList.add('hidden');
    }, 3500);
}

// Escape HTML for XSS prevention
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
