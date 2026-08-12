/**
 * app.js — Main application logic for Toggl-QBO Sync web interface
 */

const App = {
  currentPage: 'dashboard',
  renderToken: 0,

  init() {
    // No setup/connect flow — Cloudflare Access has already authenticated
    // the caller before this page loads, and the API base is a fixed
    // relative path handled by the Worker. See api.js.
    API.init();
    this.showApp();
    this.navigate('dashboard');
  },

  // ===========================================================================
  // App Shell
  // ===========================================================================

  showApp() {
    document.getElementById('app').innerHTML = `
      <div class="app">
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-header">
            <div class="brand-logo">
              <img src="logo.svg" alt="PL Theatrical TimeSync">
            </div>
            <div class="subtitle">Toggl → QBO Dashboard</div>
          </div>
          <nav class="sidebar-nav">
            <div class="nav-section">Sync</div>
            <button class="nav-item" data-page="dashboard" onclick="App.navigate('dashboard')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              Dashboard
            </button>
            <button class="nav-item" data-page="sync" onclick="App.navigate('sync')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              Sync Entries
            </button>
            <button class="nav-item" data-page="log" onclick="App.navigate('log')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              Sync Log
            </button>
            <div class="nav-section">Data</div>
            <button class="nav-item" data-page="mappings" onclick="App.navigate('mappings')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              Mappings
            </button>
            <div class="nav-section">Config</div>
            <button class="nav-item" data-page="settings" onclick="App.navigate('settings')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Settings
            </button>
          </nav>
          <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:10px">
            <div class="theme-toggle">
              <button class="theme-toggle-btn" data-theme-choice="light" onclick="ThemeManager.set('light')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                Light
              </button>
              <button class="theme-toggle-btn" data-theme-choice="system" onclick="ThemeManager.set('system')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                System
              </button>
              <button class="theme-toggle-btn" data-theme-choice="dark" onclick="ThemeManager.set('dark')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                Dark
              </button>
            </div>
            <div style="display:flex;gap:8px">
              <a class="btn btn-sm" style="flex:1;justify-content:center" href="/cdn-cgi/access/logout">
                Sign out
              </a>
            </div>
          </div>
        </aside>
        <div class="main">
          <header class="header">
            <h2 id="page-title">Dashboard</h2>
            <div class="header-actions" id="header-actions"></div>
          </header>
          <div class="content" id="content"></div>
        </div>
      </div>
      <div class="toast-container" id="toast-container"></div>`;

    // Sync theme toggle active state with current preference
    const saved = localStorage.getItem(ThemeManager.STORAGE_KEY) || 'system';
    ThemeManager.apply(saved);
  },

  // ===========================================================================
  // Navigation
  // ===========================================================================

  navigate(page) {
    this.currentPage = page;
    // Bump the render token so any in-flight page load from the page we are
    // leaving knows it is stale and must not write to #content. Without this,
    // a slow Dashboard fetch lands after the user has already switched to
    // Sync Entries and silently replaces it.
    this.renderToken = (this.renderToken || 0) + 1;

    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    const titles = {
      dashboard: 'Dashboard',
      sync: 'Sync Entries',
      log: 'Sync Log',
      mappings: 'Mappings',
      settings: 'Settings'
    };
    document.getElementById('page-title').textContent = titles[page] || page;
    document.getElementById('header-actions').innerHTML = '';

    // Render page
    const render = {
      dashboard: () => Pages.dashboard(),
      sync: () => Pages.sync(),
      log: () => Pages.log(),
      mappings: () => Pages.mappings(),
      settings: () => Pages.settings()
    };

    (render[page] || render.dashboard)();
  }
};

// ===========================================================================
// Pages
// ===========================================================================

const Pages = {
  /**
   * Guarded write to #content. Returns false if the render is stale --
   * i.e. the user navigated to a different page while this page's data
   * was still loading. Without this a slow Dashboard fetch lands after
   * the user has switched to Sync Entries and silently replaces it.
   */
  _write(token, html) {
    if (App.renderToken !== token) return false;
    const el = document.getElementById('content');
    if (!el) return false;
    el.innerHTML = html;
    return true;
  },

  _stale(token) {
    return App.renderToken !== token;
  },

  // ---------------------------------------------------------------------------
  // Dashboard — Status only (no sync actions)
  // ---------------------------------------------------------------------------
  // Progressive rendering: paint the shell (4 cards, each with its own
  // spinner) synchronously, then let each section's fetch fill in
  // independently. getConnectionStatus and getDashboard are two separate
  // round trips with different, sometimes-slow costs (live QBO/Toggl
  // connectivity checks vs sheet reads) — no reason a slow one should
  // delay painting the other's data, or block the whole page on a spinner.
  async dashboard() {
    const _rt = App.renderToken;
    const content = document.getElementById('content');

    content.innerHTML = `
      <div class="card" id="dash-connection">${Pages._sectionLoading()}</div>
      <div class="card" id="dash-sync-status">${Pages._sectionLoading()}</div>
      <div class="card" id="dash-disagreement">${Pages._sectionLoading()}</div>`;

    Pages._loadConnectionStatus(_rt);
    Pages._loadDashboardData(_rt);
  },

  _sectionLoading() {
    return '<div style="text-align:center;padding:24px"><div class="spinner"></div></div>';
  },

  _sectionError(label, err, retryFn) {
    return `<div class="card-title">${label}</div>
      <p style="color:var(--danger)">Failed to load: ${err.message}</p>
      ${retryFn ? `<button class="btn btn-sm" onclick="${retryFn}">Retry</button>` : ''}`;
  },

  async _loadConnectionStatus(_rt) {
    const el = document.getElementById('dash-connection');
    try {
      const connStatus = await API.get('getConnectionStatus');
      if (Pages._stale(_rt) || !el) return;

      const qboBadge = connStatus.qbo.connected
        ? `<span class="badge badge-success">Connected</span>`
        : `<span class="badge badge-danger">Disconnected</span>`;
      const togglBadge = connStatus.toggl.connected
        ? `<span class="badge badge-success">Connected</span>`
        : `<span class="badge badge-danger">Disconnected</span>`;

      el.innerHTML = `
        <div class="card-title">Connection Status</div>
        <div class="stats-grid" style="grid-template-columns: 1fr 1fr">
          <div class="stat">
            <div class="stat-label">QuickBooks Online</div>
            <div style="margin-top:4px">${qboBadge}</div>
            <div class="stat-detail">${connStatus.qbo.realmId ? 'Realm: ' + connStatus.qbo.realmId : ''}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Toggl Track</div>
            <div style="margin-top:4px">${togglBadge}</div>
            <div class="stat-detail">${connStatus.toggl.workspaceId ? 'Workspace: ' + connStatus.toggl.workspaceId : ''}</div>
          </div>
        </div>`;
    } catch (err) {
      if (Pages._stale(_rt) || !el) return;
      el.innerHTML = Pages._sectionError('Connection Status', err, "Pages._loadConnectionStatus(App.renderToken)");
    }
  },

  // Note: previewApproved is NOT called here to avoid hitting the Toggl
  // Reports API on every dashboard load. Pending count is shown on the
  // Sync Entries page instead. getDashboard itself is a sheet-only read as
  // of the 2026-08 speed fix — the disagreement count it returns is a
  // persisted snapshot from the last sync run, not computed live here.
  async _loadDashboardData(_rt) {
    const elSync = document.getElementById('dash-sync-status');
    const elDisagreement = document.getElementById('dash-disagreement');

    try {
      const data = await API.get('getDashboard');
      if (Pages._stale(_rt)) return;

      if (elSync) elSync.innerHTML = Pages._renderSyncStatusCard(data);
      if (elDisagreement) elDisagreement.innerHTML = Pages._renderDisagreementCard(data.tags.disagreement);
    } catch (err) {
      if (Pages._stale(_rt)) return;
      const retry = "Pages._loadDashboardData(App.renderToken)";
      if (elSync) elSync.innerHTML = Pages._sectionError('Sync Status', err, retry);
      if (elDisagreement) elDisagreement.innerHTML = Pages._sectionError('Tag/Log Disagreement', err, retry);
    }
  },

  _renderSyncStatusCard(data) {
    const pendingHtml = data.sync.hasPendingSync
      ? '<span class="badge badge-warning">Paused</span>'
      : '';
    const used = parseInt(data.api.lastSyncCalls) || 0;
    const budget = parseInt(data.api.budget) || 180;
    const pct = budget > 0 ? Math.round((used / budget) * 100) : 0;
    const barClass = pct >= 90 ? 'progress-bar-danger' : pct >= 60 ? 'progress-bar-warning' : 'progress-bar-success';

    return `
      <div class="card-title">Sync Status</div>
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-label">Last Sync</div>
          <div class="stat-value" style="font-size:16px">${formatDateTime(data.sync.lastSync)}</div>
          <div class="stat-detail">${data.sync.logEntries.toLocaleString()} entries synced ${pendingHtml}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Date Range</div>
          <div class="stat-value" style="font-size:14px">${data.sync.dateRange.start || '—'} to ${data.sync.dateRange.end || '—'}</div>
          <div class="stat-detail">Go to Sync Entries to preview</div>
        </div>
        <div class="stat">
          <div class="stat-label">API Budget</div>
          <div class="stat-value" style="font-size:16px">${data.api.lastSyncCalls || 0}/${data.api.budget}</div>
          <div class="progress"><div class="progress-bar ${barClass}" style="width:${pct}%"></div></div>
          <div class="stat-detail">${data.api.lastSyncCalls ? 'Last sync used ' + data.api.lastSyncCalls + ' of ' + data.api.budget + ' calls/hr' : 'No sync data yet'}</div>
        </div>
      </div>`;
  },

  // D1(b) dashboard card. The count is a snapshot computed during the last
  // sync run (see Toggl.gs computeDisagreementFromEntries), not live —
  // computedAt is always shown so a stale number is never mistaken for a
  // fresh one. Recompute triggers a real Toggl fetch on demand.
  _renderDisagreementCard(disagreement) {
    if (!disagreement) {
      return `<div class="card-title">Tag/Log Disagreement</div><p style="color:var(--text-secondary)">Unavailable</p>`;
    }

    const computedText = disagreement.computedAt
      ? `as of ${formatDateTime(disagreement.computedAt)}`
      : 'never computed';

    const statusLine = disagreement.skipped
      ? `<p style="color:var(--text-secondary)">Not available — ${disagreement.reason || 'skipped'}</p>`
      : disagreement.count > 0
        ? `<p style="color:var(--warning)">⚠ ${disagreement.count} entries disagree (${disagreement.missingTag} missing tag, ${disagreement.missingLog} missing log) — ${disagreement.checked} checked</p>`
        : `<p style="color:var(--success)">No disagreement — ${disagreement.checked} checked</p>`;

    return `
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>Tag/Log Disagreement</span>
        <button class="btn btn-sm" id="recompute-disagreement-btn" onclick="Pages.recomputeDisagreement()">Recompute</button>
      </div>
      ${statusLine}
      <div class="stat-detail">Computed ${computedText}. Updates automatically after each sync run.</div>`;
  },

  async recomputeDisagreement() {
    const btn = document.getElementById('recompute-disagreement-btn');
    const el = document.getElementById('dash-disagreement');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div>';
    }

    try {
      const result = await API.post('recomputeDisagreement');
      if (el) el.innerHTML = Pages._renderDisagreementCard(result);
    } catch (err) {
      Toast.error('Recompute failed: ' + err.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Recompute';
      }
    }
  },

  // ---------------------------------------------------------------------------
  // Sync Entries — Main sync workflow with date range
  // ---------------------------------------------------------------------------
  _syncConfig: null,
  _syncPreview: null,

  // Progressive rendering: paint the shell immediately, then Step 1 (date
  // range, from getConfig) and Step 2 (preview + job status) fill in
  // independently — Step 2 needs both previewApproved (the slower of the
  // two, a live Toggl fetch) and getSyncJobStatus together, but neither
  // blocks Step 1 from appearing as soon as getConfig resolves.
  async sync() {
    const _rt = App.renderToken;
    const content = document.getElementById('content');

    content.innerHTML = `
      <div class="info-box">
        <strong>How it works:</strong> Select a date range and click Preview to see approved entries in Toggl,
        review them, then click Sync to create time entries in QuickBooks.
      </div>
      <div id="sync-job-banner-slot"></div>
      <div class="card" id="sync-step1">${Pages._sectionLoading()}</div>
      <div class="card" id="sync-step2">${Pages._sectionLoading()}</div>`;

    Pages._loadSyncStep1(_rt);
    Pages._loadSyncStep2(_rt);
  },

  async _loadSyncStep1(_rt) {
    const el = document.getElementById('sync-step1');
    try {
      const config = await API.get('getConfig');
      Pages._syncConfig = config;
      if (Pages._stale(_rt) || !el) return;
      el.innerHTML = Pages._renderStep1(config);

      if (typeof flatpickr !== 'undefined') {
        flatpickr('#sync-startDate', { dateFormat: 'Y-m-d', locale: { firstDayOfWeek: 1 } });
        flatpickr('#sync-endDate', { dateFormat: 'Y-m-d', locale: { firstDayOfWeek: 1 } });
      }
    } catch (err) {
      if (Pages._stale(_rt) || !el) return;
      el.innerHTML = Pages._sectionError('Step 1: Select Date Range', err, "Pages._loadSyncStep1(App.renderToken)");
    }
  },

  async _loadSyncStep2(_rt) {
    const el = document.getElementById('sync-step2');
    try {
      // D5: if a job is already active (e.g. the operator navigated away
      // mid-sync and came back), resume showing/polling it instead of the
      // normal idle state. Reads persisted server state, not anything held
      // in this tab — a page reload picks the same job back up.
      const [preview, jobStatus] = await Promise.all([
        API.get('previewApproved'),
        API.get('getSyncJobStatus')
      ]);
      Pages._syncPreview = preview;
      if (Pages._stale(_rt) || !el) return;

      Pages._renderJobBanner(jobStatus);
      el.innerHTML = Pages._renderStep2(preview, jobStatus);

      if (jobStatus.status === 'running' || jobStatus.status === 'paused') {
        Pages._pollSyncJob(jobStatus.jobId); // not awaited — runs in the background
      }
    } catch (err) {
      if (Pages._stale(_rt) || !el) return;
      el.innerHTML = Pages._sectionError('Step 2: Review & Sync', err, "Pages._loadSyncStep2(App.renderToken)");
    }
  },

  _renderJobBanner(jobStatus) {
    const slot = document.getElementById('sync-job-banner-slot');
    if (!slot) return;
    // D5: sync now runs as a background job (Cloudflare abandons long-running
    // requests around ~100s, which used to present a successful sync as a
    // failed one). This banner reflects persisted server state, so it's
    // accurate even right after a page reload mid-sync.
    const jobActive = jobStatus && (jobStatus.status === 'running' || jobStatus.status === 'paused');
    slot.innerHTML = jobActive ? `
      <div class="info-box" id="sync-job-banner" style="border-color:var(--success)">
        <div class="spinner" style="display:inline-block;vertical-align:middle;margin-right:8px"></div>
        <span id="sync-job-banner-text">Sync in progress...</span>
      </div>` : '';
  },

  _renderStep1(config) {
    return `
      <div class="card-title">Step 1: Select Date Range</div>
      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:16px;align-items:end">
        <div class="form-group" style="margin-bottom:0">
          <label>Start Date</label>
          <input type="date" id="sync-startDate" value="${config.startDate || ''}">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label>End Date</label>
          <input type="date" id="sync-endDate" value="${config.endDate || ''}">
        </div>
        <button class="btn btn-primary" id="preview-btn" onclick="Pages.refreshPreview()">
          Preview Entries
        </button>
      </div>`;
  },

  _renderStep2(preview, jobStatus) {
    const jobActive = jobStatus && (jobStatus.status === 'running' || jobStatus.status === 'paused');

    let previewHtml = '';
    if (preview.count === 0) {
      previewHtml = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <p class="empty-state-text">No approved entries found in this date range</p>
          <p style="color:var(--text-secondary);font-size:13px;margin-top:8px">
            Tag entries with "<strong>${preview.approvedTag}</strong>" in Toggl, then click Preview.
          </p>
        </div>`;
    } else {
      const rows = preview.entries.map(e => `
        <tr>
          <td>${e.date}</td>
          <td>${e.user}</td>
          <td>${e.project || '<em>—</em>'}</td>
          <td>${e.task || '<em>—</em>'}</td>
          <td>${e.description || '<em>No description</em>'}</td>
          <td>${formatDuration(e.duration)}</td>
        </tr>`).join('');

      previewHtml = `
        <div class="table-wrap" style="max-height:350px;overflow-y:auto">
          <table>
            <thead><tr><th>Date</th><th>User</th><th>Project</th><th>Task</th><th>Description</th><th>Duration</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }

    return `
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>Step 2: Review & Sync ${preview.count > 0 ? `(${preview.count} entries)` : ''}</span>
        ${preview.count > 0 ? `
          <button class="btn btn-success" id="sync-btn" ${jobActive ? 'disabled' : ''} onclick="Pages.runSync()">
            ${jobActive ? '<div class="spinner"></div> Syncing...' : `Sync ${preview.count} Entries to QuickBooks`}
          </button>
        ` : ''}
      </div>
      ${previewHtml}`;
  },

  async refreshPreview() {
    const btn = document.getElementById('preview-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Loading...';
    }

    try {
      const startDate = document.getElementById('sync-startDate').value;
      const endDate = document.getElementById('sync-endDate').value;

      if (!startDate || !endDate) {
        Toast.error('Please select both start and end dates');
        return;
      }

      // Fetch preview with form dates (not saved dates). Also re-check job
      // status — a job could have been started from another tab/session
      // since this page loaded; without this the banner would incorrectly
      // disappear on a manual preview refresh while a sync is running.
      const [preview, jobStatus] = await Promise.all([
        API.get('previewApproved', { startDate, endDate }),
        API.get('getSyncJobStatus')
      ]);
      Pages._syncPreview = preview;
      Pages._syncConfig.startDate = startDate;
      Pages._syncConfig.endDate = endDate;

      // Render results immediately (don't wait for save)
      Pages._renderJobBanner(jobStatus);
      const el = document.getElementById('sync-step2');
      if (el) el.innerHTML = Pages._renderStep2(preview, jobStatus);
      Toast.success(`Found ${preview.count} approved entries`);

      // Save dates in background (non-blocking)
      API.post('setConfig', { key: 'START_DATE', value: startDate }).catch(() => {});
      API.post('setConfig', { key: 'END_DATE', value: endDate }).catch(() => {});
    } catch (err) {
      Toast.error('Preview failed: ' + err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Preview Entries';
      }
    }
  },

  async runSync() {
    // Restored in Phase 2. The dashboard is behind Cloudflare Access and all
    // /api traffic is proxied by a Worker that injects the credentials
    // server-side, so no secret is exposed to the browser. Apps Script
    // independently validates origin_secret before executing any write.
    //
    // D5: syncApproved now starts a job and returns immediately instead of
    // running the sync inline — Cloudflare abandons requests around ~100s,
    // which used to present a successful long sync as a failed one to the
    // browser. This just starts the job; _pollSyncJob drives the UI from here.
    const btn = document.getElementById('sync-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Starting sync...';
    }

    try {
      const start = await API.post('syncApproved');
      if (start.alreadyRunning) {
        Toast.success('A sync was already in progress — resuming status.');
      }
      Pages._pollSyncJob(start.jobId); // not awaited — updates the DOM as it goes
    } catch (err) {
      Toast.error('Sync failed to start: ' + err.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Sync Now';
      }
    }
  },

  _setSyncProgressText(text) {
    const bannerText = document.getElementById('sync-job-banner-text');
    const btn = document.getElementById('sync-btn');
    if (bannerText) bannerText.textContent = text;
    if (btn) btn.innerHTML = `<div class="spinner"></div> ${text}`;
  },

  /**
   * Polls getSyncJobStatus until the job reaches a terminal state (D5).
   * Reused by runSync() (right after starting) and sync() (on page load,
   * if a job is already active). Reads persisted server state only — holds
   * nothing of its own beyond the renderToken staleness check, so a page
   * reload mid-sync picks the same job back up via sync() rather than
   * losing track of it. A poll failure is handled quietly (reconnecting
   * state, escalates only after sustained failure) — see the comment
   * inside the loop for why.
   */
  async _pollSyncJob(jobId) {
    const _rt = App.renderToken;
    const POLL_INTERVAL_MS = 3000;
    // A poll failure (network blip, or Apps Script's intermittent
    // googleusercontent 404 window — corrected 2026-08-05: that window is
    // sustained, tens of seconds, not a one-off) does NOT mean the sync
    // failed. Job state is persisted server-side; this is only a read
    // hiccup. Stay quiet and keep polling; escalate to a visible error
    // only if failures are sustained, not on the first miss.
    const ESCALATE_AFTER_MS = 120000; // ~2 minutes
    let firstFailureAt = null;

    while (true) {
      if (Pages._stale(_rt)) return; // user navigated away — stop polling

      let status;
      try {
        status = await API.get('getSyncJobStatus');
        firstFailureAt = null; // recovered
      } catch (err) {
        if (!firstFailureAt) firstFailureAt = Date.now();
        const failingForMs = Date.now() - firstFailureAt;

        if (failingForMs >= ESCALATE_AFTER_MS) {
          Toast.error(`Lost track of sync status for ${Math.round(failingForMs / 1000)}s: ${err.message}. The sync itself may still be running — check back shortly or reload.`);
          return;
        }

        Pages._setSyncProgressText('Reconnecting to check sync status…');
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }

      if (Pages._stale(_rt)) return;
      if (status.jobId !== jobId) return; // a different job took over — not our concern

      if (status.status === 'completed') {
        Toast.success(`Sync completed: ${status.synced} synced, ${status.failed} failed, ${status.alreadySynced} already synced`);
        if (status.taggingFailed > 0) {
          // QBO write already succeeded — this is a review-surface staleness
          // warning, not a sync failure, but it must not be a silent WARN
          // buried in a log no one reads (that's exactly how this bug hid).
          Toast.error(`⚠ ${status.taggingFailed} entries synced but failed to tag "Synced" in Toggl — review view will be stale until retried.`);
        }
        Pages.sync(); // Reload preview, clears the in-progress banner
        return;
      }

      if (status.status === 'failed') {
        Toast.error('Sync failed: ' + (status.error || 'Unknown error'));
        Pages.sync();
        return;
      }

      const progress = status.pending
        ? `${status.synced} synced, ${status.pending.pendingEntries} pending — paused for rate limit, resumes automatically`
        : `${status.synced} synced so far...`;
      Pages._setSyncProgressText(progress);

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  },

  // ---------------------------------------------------------------------------
  // Sync Log — Grouped by sync job
  // ---------------------------------------------------------------------------
  _logExpanded: {},

  async log() {
    const _rt = App.renderToken;
    const content = document.getElementById('content');
    content.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div> Loading sync log...</div>';

    try {
      const data = await API.get('getSyncLog', { limit: '200' });

      if (data.entries.length === 0) {
        if (Pages._stale(_rt)) return;
        content.innerHTML = '<div class="card"><p>No sync log entries yet.</p></div>';
        return;
      }

      // Group entries by sync job (truncate timestamp to minute)
      const groups = {};
      data.entries.forEach(entry => {
        const syncedAt = entry['Synced At'];
        // Truncate to minute for grouping
        const key = typeof syncedAt === 'string' ? syncedAt.substring(0, 16) : String(syncedAt).substring(0, 16);
        if (!groups[key]) groups[key] = [];
        groups[key].push(entry);
      });

      // Render grouped log
      const groupKeys = Object.keys(groups).sort().reverse(); // Most recent first
      const groupsHtml = groupKeys.map(key => {
        const entries = groups[key];
        const successCount = entries.filter(e => e['Status'] === 'Success').length;
        const failCount = entries.length - successCount;
        const isExpanded = Pages._logExpanded[key];

        const statusBadge = failCount > 0
          ? `<span class="badge badge-success">${successCount}</span> <span class="badge badge-danger">${failCount}</span>`
          : `<span class="badge badge-success">${successCount}</span>`;

        const entriesHtml = entries.map(e => {
          const statusClass = e['Status'] === 'Success' ? 'badge-success' : 'badge-danger';
          // Format date - handle ISO strings and show just the date portion
          const entryDate = formatLogDate(e['Date']);
          // Duration - handle spreadsheet date serialization (1899-12-30 epoch) or formatted strings
          const duration = formatLogDuration(e['Duration']);
          return `
            <tr>
              <td>${entryDate}</td>
              <td>${e['Toggl User'] || ''}</td>
              <td>${e['Toggl Project'] || '<em>—</em>'}</td>
              <td>${e['Toggl Task'] || '<em>—</em>'}</td>
              <td>${e['Description'] || ''}</td>
              <td>${duration}</td>
              <td><span class="badge ${statusClass}">${e['Status']}</span></td>
              <td style="color:var(--danger);font-size:12px">${e['Error'] || ''}</td>
            </tr>`;
        }).join('');

        return `
          <div class="log-group ${isExpanded ? 'expanded' : ''}">
            <div class="log-group-header" onclick="Pages.toggleLogGroup('${key}')">
              <span class="log-group-toggle">\u25B6</span>
              <span class="log-group-time">${formatSyncTime(key)}</span>
              <span class="log-group-count">${entries.length} entries</span>
              <span class="log-group-status">${statusBadge}</span>
            </div>
            <div class="log-group-content" style="display:${isExpanded ? 'block' : 'none'}">
              <table>
                <thead><tr><th>Date</th><th>User</th><th>Project</th><th>Task</th><th>Description</th><th>Duration</th><th>Status</th><th>Error</th></tr></thead>
                <tbody>${entriesHtml}</tbody>
              </table>
            </div>
          </div>`;
      }).join('');

      if (Pages._stale(_rt)) return;
      content.innerHTML = `
        <div class="card">
          <div class="card-title">${data.total} Total Entries in ${groupKeys.length} Sync Jobs</div>
          ${groupsHtml}
        </div>`;
    } catch (err) {
      if (Pages._stale(_rt)) return;
      content.innerHTML = `<div class="card"><p style="color:var(--danger)">Error: ${err.message}</p></div>`;
    }
  },

  toggleLogGroup(key) {
    Pages._logExpanded[key] = !Pages._logExpanded[key];
    const isExpanded = Pages._logExpanded[key];

    // Find the group element by its header's onclick attribute
    const headers = document.querySelectorAll('.log-group-header');
    for (const header of headers) {
      if (header.getAttribute('onclick')?.includes(key)) {
        const group = header.parentElement;
        const content = group.querySelector('.log-group-content');
        const toggle = group.querySelector('.log-group-toggle');

        // Toggle expanded state
        group.classList.toggle('expanded', isExpanded);
        content.style.display = isExpanded ? 'block' : 'none';

        break;
      }
    }
  },

  // ---------------------------------------------------------------------------
  // Mappings — retired from this dashboard (Phase 6 Q6). Back Office's
  // Mappings section is now the sole editing surface; keeping a second
  // editor here writing to the ZZ_OLD_ sheets would recreate the two-homes
  // problem this phase exists to end. Nav entry kept (not deleted) so
  // anyone who goes looking for it finds a pointer, not a dead end.
  // ---------------------------------------------------------------------------
  async mappings() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="card" style="text-align:center;padding:40px">
        <div class="card-title">Mappings moved to Back Office</div>
        <p style="color:var(--text-secondary);margin-bottom:16px">
          Editing Users, Clients, Projects, and Tasks mappings now happens in Back Office,
          not here.
        </p>
        <a class="btn btn-primary" href="https://backoffice.pltheatrical.com" target="_blank" rel="noopener">
          Open Back Office
        </a>
      </div>`;
  },

  // ---------------------------------------------------------------------------
  // Settings — Full configuration options
  // ---------------------------------------------------------------------------
  async settings() {
    const _rt = App.renderToken;
    const content = document.getElementById('content');
    content.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div> Loading settings...</div>';

    try {
      const config = await API.get('getConfig');

      content.innerHTML = `
        <div class="card">
          <div class="card-title">Sync Behavior</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div class="form-group">
              <label>Sync Billable Only</label>
              <select id="cfg-billableOnly">
                <option value="FALSE" ${config.syncBillableOnly !== 'TRUE' ? 'selected' : ''}>No — sync all entries</option>
                <option value="TRUE" ${config.syncBillableOnly === 'TRUE' ? 'selected' : ''}>Yes — only billable</option>
              </select>
              <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">
                If Yes, non-billable entries are skipped during sync.
              </div>
            </div>
            <div class="form-group">
              <label>Batch Size</label>
              <input type="number" id="cfg-batchSize" value="${config.batchSize || '50'}" min="10" max="200">
              <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">
                Number of entries to process per sync batch.
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Toggl Tag Names</div>
          <p style="color:var(--text-secondary);margin-bottom:16px;font-size:13px">
            Tags used to track sync status. Create these tags in Toggl first.
          </p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div class="form-group">
              <label>Approved Tag</label>
              <input type="text" id="cfg-approvedTag" value="${config.approvedTag || 'Approved'}">
              <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">
                Tag to mark entries ready for sync.
              </div>
            </div>
            <div class="form-group">
              <label>Synced Tag</label>
              <input type="text" id="cfg-syncedTag" value="${config.syncedTag || 'Synced'}">
              <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">
                Tag added to entries after successful sync.
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Default Service Item</div>
          <p style="color:var(--text-secondary);margin-bottom:16px;font-size:13px">
            Used for time entries without a mapped Toggl task.
          </p>
          <div style="display:grid;grid-template-columns:1fr 2fr;gap:16px">
            <div class="form-group">
              <label>QBO Service Item ID</label>
              <input type="text" id="cfg-defaultItemId" value="${config.defaultServiceItemId || ''}">
            </div>
            <div class="form-group">
              <label>QBO Service Item Name</label>
              <input type="text" id="cfg-defaultItemName" value="${config.defaultServiceItemName || ''}">
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">API Settings</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div class="form-group">
              <label>Toggl API Budget (calls/hr)</label>
              <input type="number" id="cfg-apiBudget" value="${config.apiBudget || '180'}" min="1" max="240">
              <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">
                Toggl limit is 240/hr. Lower values leave room for other tools.
              </div>
            </div>
            <div class="form-group">
              <label>QuickBooks Environment</label>
              <select id="cfg-qboEnv">
                <option value="production" ${config.qboEnv !== 'sandbox' ? 'selected' : ''}>Production</option>
                <option value="sandbox" ${config.qboEnv === 'sandbox' ? 'selected' : ''}>Sandbox (testing)</option>
              </select>
              <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">
                Use Sandbox for testing with developer accounts.
              </div>
            </div>
          </div>
        </div>

        <button class="btn btn-primary" onclick="Pages.saveSettings()">Save Settings</button>`;
    } catch (err) {
      content.innerHTML = `<div class="card"><p style="color:var(--danger)">Error: ${err.message}</p></div>`;
    }
  },

  async saveSettings() {
    const fields = [
      { id: 'cfg-billableOnly', key: 'SYNC_BILLABLE_ONLY' },
      { id: 'cfg-batchSize', key: 'BATCH_SIZE' },
      { id: 'cfg-approvedTag', key: 'APPROVED_TAG' },
      { id: 'cfg-syncedTag', key: 'SYNCED_TAG' },
      { id: 'cfg-defaultItemId', key: 'DEFAULT_SERVICE_ITEM_ID' },
      { id: 'cfg-defaultItemName', key: 'DEFAULT_SERVICE_ITEM_NAME' },
      { id: 'cfg-apiBudget', key: 'TOGGL_API_BUDGET' },
      { id: 'cfg-qboEnv', key: 'QBO_ENV' }
    ];

    try {
      for (const field of fields) {
        const el = document.getElementById(field.id);
        if (el) {
          await API.post('setConfig', { key: field.key, value: el.value });
        }
      }
      Toast.success('Settings saved!');
    } catch (err) {
      Toast.error('Save failed: ' + err.message);
    }
  }
};

// ===========================================================================
// Toast notifications
// ===========================================================================

const Toast = {
  show(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },
  success(msg) { this.show(msg, 'success'); },
  error(msg) { this.show(msg, 'error'); },
  info(msg) { this.show(msg, 'info'); }
};

// ===========================================================================
// Utilities
// ===========================================================================

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function formatDateTime(isoString) {
  if (!isoString || isoString === 'Never') return 'Never';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }) + ' at ' + d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit'
    });
  } catch (e) {
    return isoString;
  }
}

function formatDateTimeET(isoString) {
  if (!isoString || isoString === 'Never') return 'Never';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric', year: 'numeric'
    }) + ' at ' + d.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric', minute: '2-digit'
    });
  } catch (e) {
    return isoString;
  }
}

/**
 * Format sync log date - just show readable date without time
 * Handles ISO strings like "2026-02-13T05:00:00.000Z"
 */
function formatLogDate(dateStr) {
  if (!dateStr) return '';
  try {
    // If it's an ISO string, extract just the date part
    if (typeof dateStr === 'string' && dateStr.includes('T')) {
      const datePart = dateStr.split('T')[0]; // "2026-02-13"
      return datePart;
    }
    // If it's already a simple date string, return as-is
    return String(dateStr);
  } catch (e) {
    return String(dateStr);
  }
}

/**
 * Format duration from sync log
 * Handles Google Sheets date serialization (1899-12-30 epoch issue)
 * where duration "0:44" becomes "1899-12-30T00:44:00.000Z"
 */
function formatLogDuration(durationVal) {
  if (!durationVal) return '0:00';

  const str = String(durationVal);

  // Handle spreadsheet date serialization (1899-12-30 is the epoch)
  if (str.includes('1899-12-30') || str.includes('1899-12-31')) {
    try {
      // Extract time portion from ISO string like "1899-12-30T05:44:00.000Z"
      const match = str.match(/T(\d{2}):(\d{2})/);
      if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        return `${hours}:${String(minutes).padStart(2, '0')}`;
      }
    } catch (e) {}
  }

  // Handle if it's already formatted like "1:30" or "0:45"
  if (/^\d+:\d{2}$/.test(str)) {
    return str;
  }

  // Handle if it's a number (seconds)
  if (typeof durationVal === 'number') {
    return formatDuration(durationVal);
  }

  return str;
}

/**
 * Format sync timestamp for group header
 * Google Sheets API returns timestamps in UTC (with Z suffix), but the grouping
 * key truncates to 16 chars losing the Z. We need to treat these as UTC and
 * convert to Eastern time.
 */
function formatSyncTime(timestamp) {
  if (!timestamp) return 'Unknown time';

  try {
    let str = String(timestamp);

    // If it looks like an ISO timestamp (has T), treat as UTC
    // The grouping key truncates "2026-02-16T18:14:05.000Z" to "2026-02-16T18:14"
    // We need to add Z back so JavaScript parses it as UTC, not local time
    if (str.includes('T') && !str.endsWith('Z')) {
      str = str + ':00Z'; // Add seconds and Z for proper UTC parsing
    }

    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
        month: 'short', day: 'numeric', year: 'numeric'
      }) + ' at ' + d.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric', minute: '2-digit'
      });
    }

    return str;
  } catch (e) {
    return String(timestamp);
  }
}

// ===========================================================================
// Theme Manager — Light / Dark / System toggle
// ===========================================================================

const ThemeManager = {
  STORAGE_KEY: 'tqs_theme',

  init() {
    const saved = localStorage.getItem(this.STORAGE_KEY) || 'system';
    this.apply(saved);
  },

  set(mode) {
    localStorage.setItem(this.STORAGE_KEY, mode);
    this.apply(mode);
  },

  apply(mode) {
    const root = document.documentElement;

    if (mode === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else if (mode === 'light') {
      root.setAttribute('data-theme', 'light');
    } else {
      // System preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }

    // Update toggle button active states
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.themeChoice === mode);
    });
  }
};

// Listen for system preference changes (only applies when mode is 'system')
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const saved = localStorage.getItem(ThemeManager.STORAGE_KEY) || 'system';
  if (saved === 'system') ThemeManager.apply('system');
});

// Initialize theme as early as possible
ThemeManager.init();

// ===========================================================================
// Init — triggered by the inline DOMContentLoaded listener in index.html
// ===========================================================================
