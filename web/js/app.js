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
  async dashboard() {
    const content = document.getElementById('content');
    content.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div> Loading dashboard...</div>';

    try {
      const data = await API.get('getDashboard');

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

      const pendingHtml = data.sync.hasPendingSync
        ? '<span class="badge badge-warning">Pending Sync</span>'
        : '';

      content.innerHTML = `
        <div class="stats-grid">
          <div class="stat">
            <div class="stat-label">Last Sync</div>
            <div class="stat-value" style="font-size:16px">${data.sync.lastSync}</div>
            <div class="stat-detail">${data.sync.logEntries} total entries synced ${pendingHtml}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Date Range</div>
            <div class="stat-value" style="font-size:16px">${data.sync.dateRange.start}</div>
            <div class="stat-detail">to ${data.sync.dateRange.end}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Tags</div>
            <div class="stat-value" style="font-size:16px">${data.tags.approved}</div>
            <div class="stat-detail">Synced tag: ${data.tags.synced}</div>
          </div>
          <div class="stat">
            <div class="stat-label">API Budget</div>
            <div class="stat-value" style="font-size:16px">${data.api.budget}/hr</div>
            <div class="stat-detail">Last sync: ${data.api.lastSyncCalls || '—'} calls</div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Mapping Completeness</div>
          <div class="stats-grid">${mappingCards}</div>
        </div>

        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn btn-primary" onclick="App.navigate('sync')">Sync Approved Entries</button>
          <button class="btn" onclick="App.navigate('mappings')">View Mappings</button>
        </div>`;
    } catch (err) {
      content.innerHTML = `<div class="card"><p style="color:var(--danger)">Failed to load dashboard: ${err.message}</p>
        <button class="btn" onclick="Pages.dashboard()">Retry</button></div>`;
    }
  },

  async sync() {
    const content = document.getElementById('content');
    document.getElementById('header-actions').innerHTML = `
      <button class="btn btn-primary" id="sync-btn" onclick="Pages.runSync()">Sync Approved Entries</button>`;

    content.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div> Loading preview...</div>';

    try {
      const data = await API.get('previewApproved');
      if (data.count === 0) {
        content.innerHTML = `
          <div class="card" style="text-align:center;padding:40px">
            <p style="font-size:16px;margin-bottom:8px">No approved entries to sync</p>
            <p style="color:var(--text-secondary)">Tag entries with "${data.dateRange ? '' : 'Approved'}" in Toggl, then come back here.</p>
          </div>`;
        return;
      }

      const rows = data.entries.map(e => `
        <tr>
          <td>${e.date}</td>
          <td>${e.user}</td>
          <td>${e.description || '<em>No description</em>'}</td>
          <td>${formatDuration(e.duration)}</td>
          <td>${(e.tags || []).map(t => `<span class="badge badge-info">${t}</span>`).join(' ')}</td>
        </tr>`).join('');

      content.innerHTML = `
        <div class="card">
          <div class="card-title">${data.count} Entries Ready to Sync</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>User</th><th>Description</th><th>Duration</th><th>Tags</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    } catch (err) {
      content.innerHTML = `<div class="card"><p style="color:var(--danger)">Error: ${err.message}</p></div>`;
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
      // Reload the preview
      Pages.sync();
    } catch (err) {
      Toast.error('Sync failed: ' + err.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Sync Approved Entries';
      }
    }
  },

  async log() {
    const content = document.getElementById('content');
    content.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div> Loading sync log...</div>';

    try {
      const data = await API.get('getSyncLog', { limit: '100' });

      if (data.entries.length === 0) {
        content.innerHTML = '<div class="card"><p>No sync log entries yet.</p></div>';
        return;
      }

      const headers = Object.keys(data.entries[0]);
      const headerRow = headers.map(h => `<th>${h}</th>`).join('');
      const rows = data.entries.map(entry => {
        const cells = headers.map(h => {
          const val = entry[h];
          if (h.toLowerCase().includes('status')) {
            const cls = val === 'Success' ? 'badge-success' : 'badge-danger';
            return `<td><span class="badge ${cls}">${val}</span></td>`;
          }
          return `<td>${val || ''}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
      }).join('');

      content.innerHTML = `
        <div class="card">
          <div class="card-title">Sync Log (${data.total} total, showing latest ${data.entries.length})</div>
          <div class="table-wrap">
            <table>
              <thead><tr>${headerRow}</tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    } catch (err) {
      content.innerHTML = `<div class="card"><p style="color:var(--danger)">Error: ${err.message}</p></div>`;
    }
  },

  // Current mapping tab
  _mappingTab: 'Mappings_Users',

  async mappings() {
    const content = document.getElementById('content');
    const tabs = [
      { key: 'Mappings_Users', label: 'Users' },
      { key: 'Mappings_Clients', label: 'Clients' },
      { key: 'Mappings_Projects', label: 'Projects' },
      { key: 'Mappings_Tasks_Services', label: 'Tasks' }
    ];

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
      const data = await API.get('getMappings', { sheet: Pages._mappingTab });
      const mapping = data.mappings[Pages._mappingTab];

      if (!mapping || mapping.rows.length === 0) {
        document.getElementById('mapping-content').innerHTML =
          '<div class="card"><p>No data in this sheet. Run Refresh Data first.</p></div>';
        return;
      }

      const headers = mapping.headers.filter(h => h !== '_row');
      const headerRow = headers.map(h => `<th>${h}</th>`).join('');

      const rows = mapping.rows.map(row => {
        const matchedCol = headers.find(h => h === 'Matched');
        const isMatched = matchedCol && row[matchedCol] === true;

        // Determine if unmapped — find QBO ID/Name columns
        const qboIdCol = headers.find(h => h.startsWith('QBO') && h.includes('ID'));
        const qboNameCol = headers.find(h => h.startsWith('QBO') && h.includes('Name'));
        const isUnmapped = !isMatched
          && (qboIdCol ? !row[qboIdCol] : true)
          && (qboNameCol ? !row[qboNameCol] : true);

        const rowClass = isMatched ? 'row-matched' : isUnmapped ? 'row-unmapped' : '';

        const cells = headers.map(h => {
          const val = row[h];
          if (h === 'Matched') {
            return `<td><input type="checkbox" ${val ? 'checked' : ''}
              onchange="Pages.updateMappingCell('${Pages._mappingTab}', ${row._row}, '${h}', this.checked)"></td>`;
          }
          return `<td>${val === null || val === undefined || val === '' ? '' : val}</td>`;
        }).join('');

        return `<tr class="${rowClass}">${cells}</tr>`;
      }).join('');

      document.getElementById('mapping-content').innerHTML = `
        <div class="card">
          <div class="card-title">${mapping.rows.length} rows</div>
          <div class="table-wrap">
            <table>
              <thead><tr>${headerRow}</tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    } catch (err) {
      document.getElementById('mapping-content').innerHTML =
        `<div class="card"><p style="color:var(--danger)">Error: ${err.message}</p></div>`;
    }
  },

  async updateMappingCell(sheet, row, col, value) {
    try {
      await API.post('updateMapping', { sheet, row: String(row), col, value: String(value) });
      Toast.success('Updated');
    } catch (err) {
      Toast.error('Update failed: ' + err.message);
    }
  },

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
    } catch (err) {
      Toast.error('Error: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  },

  async settings() {
    const content = document.getElementById('content');
    content.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div> Loading settings...</div>';

    try {
      const config = await API.get('getConfig');

      content.innerHTML = `
        <div class="card">
          <div class="card-title">Date Range</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
            <div class="form-group">
              <label>Start Date</label>
              <input type="date" id="cfg-startDate" value="${config.startDate || ''}">
            </div>
            <div class="form-group">
              <label>End Date</label>
              <input type="date" id="cfg-endDate" value="${config.endDate || ''}">
            </div>
            <div class="form-group">
              <label>Or Last N Days</label>
              <input type="number" id="cfg-importDays" value="${config.importDays}" min="1" max="365">
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Tags</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div class="form-group">
              <label>Approved Tag</label>
              <input type="text" id="cfg-approvedTag" value="${config.approvedTag}">
            </div>
            <div class="form-group">
              <label>Synced Tag</label>
              <input type="text" id="cfg-syncedTag" value="${config.syncedTag}">
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">API & Sync</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div class="form-group">
              <label>Toggl API Budget (calls/hr)</label>
              <input type="number" id="cfg-apiBudget" value="${config.apiBudget}" min="1" max="240">
            </div>
            <div class="form-group">
              <label>Sync Billable Only</label>
              <select id="cfg-billableOnly">
                <option value="FALSE" ${config.syncBillableOnly !== 'TRUE' ? 'selected' : ''}>No</option>
                <option value="TRUE" ${config.syncBillableOnly === 'TRUE' ? 'selected' : ''}>Yes</option>
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div class="form-group">
              <label>Default Service Item ID</label>
              <input type="text" id="cfg-defaultItemId" value="${config.defaultServiceItemId}">
            </div>
            <div class="form-group">
              <label>Default Service Item Name</label>
              <input type="text" id="cfg-defaultItemName" value="${config.defaultServiceItemName}">
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
      { id: 'cfg-startDate', key: 'START_DATE' },
      { id: 'cfg-endDate', key: 'END_DATE' },
      { id: 'cfg-importDays', key: 'IMPORT_DAYS' },
      { id: 'cfg-approvedTag', key: 'APPROVED_TAG' },
      { id: 'cfg-syncedTag', key: 'SYNCED_TAG' },
      { id: 'cfg-apiBudget', key: 'TOGGL_API_BUDGET' },
      { id: 'cfg-billableOnly', key: 'SYNC_BILLABLE_ONLY' },
      { id: 'cfg-defaultItemId', key: 'DEFAULT_SERVICE_ITEM_ID' },
      { id: 'cfg-defaultItemName', key: 'DEFAULT_SERVICE_ITEM_NAME' }
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

// ===========================================================================
// Init
// ===========================================================================

document.addEventListener('DOMContentLoaded', () => App.init());
