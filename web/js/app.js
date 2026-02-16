/**
 * app.js — Main application logic for Toggl-QBO Sync web interface
 */

const App = {
  currentPage: 'dashboard',

  init() {
    API.init();

    if (!API.isConfigured()) {
      this.showSetup();
      return;
    }

    this.showApp();
    this.navigate('dashboard');
  },

  // ===========================================================================
  // Setup / Connection
  // ===========================================================================

  showSetup() {
    document.getElementById('app').innerHTML = `
      <div class="setup-screen">
        <div class="setup-card">
          <h1>Toggl-QBO Sync</h1>
          <p>Connect to your Google Sheet to get started. You'll need the deployed
             Web App URL and your API key.</p>
          <input type="url" id="setup-url" placeholder="Google Apps Script Web App URL"
                 value="${API.baseUrl}">
          <input type="text" id="setup-key" placeholder="API Key (WEB_API_KEY from Script Properties)"
                 value="${API.apiKey}">
          <button class="btn btn-primary" style="width:100%;justify-content:center"
                  onclick="App.connect()">Connect</button>
          <p style="margin-top:16px;font-size:12px;color:var(--text-secondary)">
            The API key is set in your Google Apps Script project under
            Script Properties as <code>WEB_API_KEY</code>.
          </p>
        </div>
      </div>`;
  },

  async connect() {
    const url = document.getElementById('setup-url').value.trim();
    const key = document.getElementById('setup-key').value.trim();

    if (!url || !key) {
      Toast.error('Please enter both the Web App URL and API key.');
      return;
    }

    API.configure(url, key);

    try {
      // Test the connection
      await API.get('getDashboard');
      Toast.success('Connected successfully!');
      this.showApp();
      this.navigate('dashboard');
    } catch (err) {
      API.disconnect();
      Toast.error('Connection failed: ' + err.message);
      this.showSetup();
    }
  },

  // ===========================================================================
  // App Shell
  // ===========================================================================

  showApp() {
    document.getElementById('app').innerHTML = `
      <div class="app">
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-header">
            <h1>Toggl-QBO Sync</h1>
            <div class="subtitle">Time Entry Sync Dashboard</div>
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
            <button class="nav-item" data-page="refresh" onclick="App.navigate('refresh')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              Refresh Data
            </button>
            <div class="nav-section">Config</div>
            <button class="nav-item" data-page="settings" onclick="App.navigate('settings')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Settings
            </button>
          </nav>
          <div style="padding:12px 20px;border-top:1px solid var(--border)">
            <button class="btn btn-sm" style="width:100%;justify-content:center" onclick="App.disconnectConfirm()">
              Disconnect
            </button>
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
  },

  disconnectConfirm() {
    if (confirm('Disconnect from the Google Sheet? You can reconnect later.')) {
      API.disconnect();
      this.showSetup();
    }
  },

  // ===========================================================================
  // Navigation
  // ===========================================================================

  navigate(page) {
    this.currentPage = page;

    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    const titles = {
      dashboard: 'Dashboard',
      sync: 'Sync Entries',
      log: 'Sync Log',
      mappings: 'Mappings',
      refresh: 'Refresh Data',
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
      refresh: () => Pages.refresh(),
      settings: () => Pages.settings()
    };

    (render[page] || render.dashboard)();
  }
};

// ===========================================================================
// Pages
// ===========================================================================

const Pages = {
  // ---------------------------------------------------------------------------
  // Dashboard — Status only (no sync actions)
  // ---------------------------------------------------------------------------
  async dashboard() {
    const content = document.getElementById('content');
    content.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div> Loading dashboard...</div>';

    try {
      // Fetch dashboard data and connection status in parallel
      const [data, connStatus, preview] = await Promise.all([
        API.get('getDashboard'),
        API.get('getConnectionStatus'),
        API.get('previewApproved')
      ]);

      // Connection status badges
      const qboBadge = connStatus.qbo.connected
        ? `<span class="badge badge-success">Connected</span>`
        : `<span class="badge badge-danger">Disconnected</span>`;
      const togglBadge = connStatus.toggl.connected
        ? `<span class="badge badge-success">Connected</span>`
        : `<span class="badge badge-danger">Disconnected</span>`;

      // Mapping completeness cards
      const mappingCards = Object.entries(data.mappings).map(([key, m]) => {
        const pct = m.total > 0 ? Math.round((m.mapped / m.total) * 100) : 0;
        const barClass = pct === 100 ? 'progress-bar-success' : pct >= 50 ? 'progress-bar-warning' : 'progress-bar-danger';
        return `
          <div class="stat">
            <div class="stat-label">${key.charAt(0).toUpperCase() + key.slice(1)}</div>
            <div class="stat-value">${m.mapped}/${m.total}</div>
            <div class="progress"><div class="progress-bar ${barClass}" style="width:${pct}%"></div></div>
            <div class="stat-detail">${m.unmapped > 0 ? `${m.unmapped} unmapped` : 'All mapped'}</div>
          </div>`;
      }).join('');

      // Pending sync badge
      const pendingHtml = data.sync.hasPendingSync
        ? '<span class="badge badge-warning">Paused</span>'
        : '';

      content.innerHTML = `
        <div class="card">
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
          </div>
        </div>

        <div class="card">
          <div class="card-title">Sync Status</div>
          <div class="stats-grid">
            <div class="stat">
              <div class="stat-label">Last Sync</div>
              <div class="stat-value" style="font-size:16px">${formatDateTime(data.sync.lastSync)}</div>
              <div class="stat-detail">${data.sync.logEntries.toLocaleString()} entries synced ${pendingHtml}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Pending</div>
              <div class="stat-value" style="font-size:24px;color:${preview.count > 0 ? 'var(--warning)' : 'var(--success)'}">${preview.count}</div>
              <div class="stat-detail">approved entries ready to sync</div>
            </div>
            <div class="stat">
              <div class="stat-label">API Budget</div>
              <div class="stat-value" style="font-size:16px">${data.api.budget}/hr</div>
              <div class="stat-detail">Last sync: ${data.api.lastSyncCalls || '—'} calls</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Mapping Completeness</div>
          <div class="stats-grid">${mappingCards}</div>
        </div>`;
    } catch (err) {
      content.innerHTML = `<div class="card"><p style="color:var(--danger)">Failed to load dashboard: ${err.message}</p>
        <button class="btn" onclick="Pages.dashboard()">Retry</button></div>`;
    }
  },

  // ---------------------------------------------------------------------------
  // Sync Entries — Main sync workflow with date range
  // ---------------------------------------------------------------------------
  _syncConfig: null,
  _syncPreview: null,

  async sync() {
    const content = document.getElementById('content');
    content.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div> Loading...</div>';

    try {
      // Fetch config first
      const config = await API.get('getConfig');
      Pages._syncConfig = config;

      // Initial preview with saved dates
      const preview = await API.get('previewApproved');
      Pages._syncPreview = preview;

      Pages._renderSyncPage(config, preview);
    } catch (err) {
      content.innerHTML = `<div class="card"><p style="color:var(--danger)">Error: ${err.message}</p>
        <button class="btn" onclick="Pages.sync()">Retry</button></div>`;
    }
  },

  _renderSyncPage(config, preview) {
    const content = document.getElementById('content');

    // Build preview table
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

    content.innerHTML = `
      <div class="info-box">
        <strong>How it works:</strong> Select a date range and click Preview to see entries tagged "${preview.approvedTag}" in Toggl.
        Review them, then click Sync to create time entries in QuickBooks and tag them as "${preview.syncedTag}" in Toggl.
      </div>

      <div class="card">
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
        </div>
      </div>

      <div class="card">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>Step 2: Review & Sync ${preview.count > 0 ? `(${preview.count} entries)` : ''}</span>
          ${preview.count > 0 ? `
            <button class="btn btn-success" id="sync-btn" onclick="Pages.runSync()">
              Sync ${preview.count} Entries to QuickBooks
            </button>
          ` : ''}
        </div>
        ${previewHtml}
      </div>`;
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

      // Fetch preview with form dates (not saved dates)
      const preview = await API.get('previewApproved', { startDate, endDate });
      Pages._syncPreview = preview;
      Pages._syncConfig.startDate = startDate;
      Pages._syncConfig.endDate = endDate;

      // Render results immediately (don't wait for save)
      Pages._renderSyncPage(Pages._syncConfig, preview);
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
    const btn = document.getElementById('sync-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Syncing...';
    }

    try {
      const result = await API.post('syncApproved');
      Toast.success(result.message || 'Sync completed!');
      Pages.sync(); // Reload preview
    } catch (err) {
      Toast.error('Sync failed: ' + err.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Sync Now';
      }
    }
  },

  // ---------------------------------------------------------------------------
  // Sync Log — Grouped by sync job
  // ---------------------------------------------------------------------------
  _logExpanded: {},

  async log() {
    const content = document.getElementById('content');
    content.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div> Loading sync log...</div>';

    try {
      const data = await API.get('getSyncLog', { limit: '200' });

      if (data.entries.length === 0) {
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
          // Duration may be stored as seconds or as formatted string - handle both
          const duration = typeof e['Duration'] === 'number' ? formatDuration(e['Duration']) : (e['Duration'] || '');
          return `
            <tr>
              <td>${e['Date'] || ''}</td>
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
              <span class="log-group-toggle">${isExpanded ? '▼' : '▶'}</span>
              <span class="log-group-time">${formatDateTimeET(key)}</span>
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

      content.innerHTML = `
        <div class="card">
          <div class="card-title">${data.total} Total Entries in ${groupKeys.length} Sync Jobs</div>
          ${groupsHtml}
        </div>`;
    } catch (err) {
      content.innerHTML = `<div class="card"><p style="color:var(--danger)">Error: ${err.message}</p></div>`;
    }
  },

  toggleLogGroup(key) {
    Pages._logExpanded[key] = !Pages._logExpanded[key];
    Pages.log();
  },

  // ---------------------------------------------------------------------------
  // Mappings — Split into sections with dropdown selectors
  // ---------------------------------------------------------------------------
  _mappingTab: 'Mappings_Users',
  _qboOptions: null,

  async mappings() {
    const content = document.getElementById('content');
    const tabs = [
      { key: 'Mappings_Users', label: 'Users', qboType: 'employees', qboIdCol: 'QBO Employee ID', qboNameCol: 'QBO Employee Name' },
      { key: 'Mappings_Clients', label: 'Clients', qboType: 'customers', qboIdCol: 'QBO Customer ID', qboNameCol: 'QBO Customer Name' },
      { key: 'Mappings_Projects', label: 'Projects', qboType: 'projects', qboIdCol: 'QBO Project ID', qboNameCol: 'QBO Project Name' },
      { key: 'Mappings_Tasks_Services', label: 'Tasks', qboType: 'serviceItems', qboIdCol: 'QBO Service Item ID', qboNameCol: 'QBO Service Item Name' }
    ];

    const currentTab = tabs.find(t => t.key === Pages._mappingTab) || tabs[0];

    const tabHtml = tabs.map(t =>
      `<button class="tab ${t.key === Pages._mappingTab ? 'active' : ''}"
              onclick="Pages._mappingTab='${t.key}';Pages.mappings()">${t.label}</button>`
    ).join('');

    content.innerHTML = `
      <div class="tabs">${tabHtml}</div>
      <div id="mapping-content" style="position:relative">
        <div style="text-align:center;padding:40px"><div class="spinner"></div> Loading...</div>
      </div>`;

    try {
      // Fetch mapping data and QBO options
      const [mappingData, qboOptions] = await Promise.all([
        API.get('getMappings', { sheet: Pages._mappingTab }),
        Pages._qboOptions ? Promise.resolve(Pages._qboOptions) : API.get('getQBOMasterOptions')
      ]);

      Pages._qboOptions = qboOptions;
      const mapping = mappingData.mappings[Pages._mappingTab];

      if (!mapping || mapping.rows.length === 0) {
        document.getElementById('mapping-content').innerHTML =
          '<div class="card"><p>No data in this sheet. Run Refresh Data first.</p></div>';
        return;
      }

      // Split into unmapped and mapped
      const unmapped = [];
      const mapped = [];

      mapping.rows.forEach(row => {
        const hasQboId = row[currentTab.qboIdCol];
        const hasQboName = row[currentTab.qboNameCol];
        const isMatched = row['Matched'] === true;

        if (hasQboId || hasQboName || isMatched) {
          mapped.push(row);
        } else {
          unmapped.push(row);
        }
      });

      // Get dropdown options for this tab
      const options = qboOptions[currentTab.qboType] || [];

      // Render sections
      const renderSection = (rows, title, sectionClass) => {
        if (rows.length === 0) return '';

        const headers = mapping.headers.filter(h => h !== '_row' && h !== 'Last Updated');
        const rowsHtml = rows.map(row => {
          const isMatched = row['Matched'] === true;
          const rowClass = isMatched ? 'row-matched' : '';
          const currentVal = row[currentTab.qboNameCol] || '';

          const cells = headers.map(h => {
            const val = row[h];

            // Matched checkbox
            if (h === 'Matched') {
              return `<td><input type="checkbox" ${val ? 'checked' : ''}
                onchange="Pages.updateMappingCell('${Pages._mappingTab}', ${row._row}, '${h}', this.checked)"></td>`;
            }

            // QBO Name column — always show dropdown for editing
            if (h === currentTab.qboNameCol) {
              const optionsHtml = options.map(opt =>
                `<option value="${opt.name}" ${opt.name === currentVal ? 'selected' : ''}>${opt.name}</option>`
              ).join('');
              return `<td>
                <select class="mapping-select" onchange="Pages.selectQboMapping('${Pages._mappingTab}', ${row._row}, '${currentTab.qboIdCol}', '${currentTab.qboNameCol}', this.value)">
                  <option value="">-- Select --</option>
                  ${optionsHtml}
                </select>
              </td>`;
            }

            // Regular cell
            return `<td>${val === null || val === undefined || val === '' ? '' : val}</td>`;
          }).join('');

          return `<tr class="${rowClass}">${cells}</tr>`;
        }).join('');

        const headerRow = headers.map(h => `<th>${h}</th>`).join('');

        return `
          <div class="mapping-section">
            <div class="mapping-section-header ${sectionClass}">${title} <span class="mapping-section-count">${rows.length}</span></div>
            <div class="table-wrap">
              <table>
                <thead><tr>${headerRow}</tr></thead>
                <tbody>${rowsHtml}</tbody>
              </table>
            </div>
          </div>`;
      };

      const unmappedHtml = renderSection(unmapped, '⚠ Needs Mapping', 'unmapped');
      const mappedHtml = renderSection(mapped, '✓ Mapped', 'mapped');

      document.getElementById('mapping-content').innerHTML = unmappedHtml + mappedHtml;
    } catch (err) {
      document.getElementById('mapping-content').innerHTML =
        `<div class="card"><p style="color:var(--danger)">Error: ${err.message}</p></div>`;
    }
  },

  async selectQboMapping(sheet, row, idCol, nameCol, selectedName) {
    if (!selectedName) return;

    // Find the ID for the selected name
    const currentTab = Pages._mappingTab;
    const tabs = {
      'Mappings_Users': 'employees',
      'Mappings_Clients': 'customers',
      'Mappings_Projects': 'projects',
      'Mappings_Tasks_Services': 'serviceItems'
    };
    const qboType = tabs[currentTab];
    const options = Pages._qboOptions?.[qboType] || [];
    const selected = options.find(o => o.name === selectedName);

    try {
      // Update both ID and Name columns
      if (selected) {
        await API.post('updateMapping', { sheet, row: String(row), col: idCol, value: selected.id });
      }
      await API.post('updateMapping', { sheet, row: String(row), col: nameCol, value: selectedName });
      Toast.success('Mapping updated');
      Pages.mappings(); // Refresh to move to mapped section
    } catch (err) {
      Toast.error('Update failed: ' + err.message);
    }
  },

  async updateMappingCell(sheet, row, col, value) {
    try {
      await API.post('updateMapping', { sheet, row: String(row), col, value: String(value) });
      Toast.success('Updated');
      Pages.mappings(); // Refresh
    } catch (err) {
      Toast.error('Update failed: ' + err.message);
    }
  },

  // ---------------------------------------------------------------------------
  // Refresh Data
  // ---------------------------------------------------------------------------
  async refresh() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="stats-grid">
        <div class="card" style="text-align:center">
          <div class="card-title">Toggl Mappings</div>
          <p style="color:var(--text-secondary);margin-bottom:16px">
            Refresh Users, Clients, Projects, and Tasks from Toggl
          </p>
          <button class="btn btn-primary" id="refresh-toggl" onclick="Pages.runRefresh('refreshTogglMappings', 'refresh-toggl')">
            Refresh Toggl Mappings
          </button>
        </div>
        <div class="card" style="text-align:center">
          <div class="card-title">QBO Master Lists</div>
          <p style="color:var(--text-secondary);margin-bottom:16px">
            Refresh Customers, Employees, Items, and Projects from QuickBooks
          </p>
          <button class="btn btn-primary" id="refresh-qbo" onclick="Pages.runRefresh('refreshQBOMasterLists', 'refresh-qbo')">
            Refresh QBO Master Lists
          </button>
        </div>
      </div>
      <div class="card" style="text-align:center">
        <div class="card-title">Wire Dropdowns</div>
        <p style="color:var(--text-secondary);margin-bottom:16px">
          Re-create data validation dropdowns on all mapping sheets from the master lists
        </p>
        <button class="btn" id="refresh-wire" onclick="Pages.runRefresh('wireDropdowns', 'refresh-wire')">
          Wire Dropdowns
        </button>
      </div>`;
  },

  async runRefresh(action, btnId) {
    const btn = document.getElementById(btnId);
    const label = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner"></div> Running...`;

    try {
      const result = await API.post(action);
      Toast.success(result.message || 'Done!');
      // Clear cached QBO options so they get refreshed
      if (action === 'refreshQBOMasterLists') {
        Pages._qboOptions = null;
      }
    } catch (err) {
      Toast.error('Error: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  },

  // ---------------------------------------------------------------------------
  // Settings — Full configuration options
  // ---------------------------------------------------------------------------
  async settings() {
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

// ===========================================================================
// Init
// ===========================================================================

document.addEventListener('DOMContentLoaded', () => App.init());
