/**
 * WebAPI.gs - REST-like API layer for the Netlify web interface
 *
 * Extends doGet/doPost to serve JSON API requests from the frontend.
 * The Netlify app talks only to this API, which talks to the Google Sheet.
 * All Toggl/QBO auth stays in the Google Sheet — the frontend never touches APIs directly.
 *
 * Authentication: Requests must include an "api_key" parameter matching the
 * WEB_API_KEY value stored in Script Properties.
 */

// ============================================================================
// API ROUTING
// ============================================================================

/**
 * Handles GET requests — extends existing doGet in Auth.gs
 * Routes to API handler when "action" parameter is present, otherwise falls
 * through to the OAuth callback handler.
 *
 * NOTE: Google Apps Script only allows one doGet per project. The existing
 * doGet in Auth.gs is replaced by this one, which calls handleOAuthCallback
 * when needed.
 */
function doGet(e) {
  const params = e.parameter || {};

  // OAuth callback (existing flow)
  if (params.code) {
    return handleOAuthCallback(params);
  }

  // API request
  if (params.action) {
    return handleApiRequest(params);
  }

  // Default landing
  return HtmlService.createHtmlOutput(
    '<html><body><h2>Toggl-QBO Sync</h2><p>API endpoint ready.</p></body></html>'
  );
}

/**
 * Handles POST requests for write operations
 */
function doPost(e) {
  try {
    const params = e.parameter || {};
    const body = e.postData ? JSON.parse(e.postData.contents) : {};
    const merged = { ...params, ...body };

    if (!merged.action) {
      return jsonResponse({ error: 'Missing action parameter' }, 400);
    }

    return handleApiRequest(merged, true);
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

// ============================================================================
// AUTH & RESPONSE HELPERS
// ============================================================================

/**
 * Validates the API key from the request
 */
function validateApiKey(params) {
  const storedKey = getScriptProperty('WEB_API_KEY');
  if (!storedKey) {
    return false; // No key configured — API disabled
  }
  return params.api_key === storedKey;
}

/**
 * Returns a JSON ContentService response with CORS headers
 */
function jsonResponse(data, statusCode = 200) {
  // ContentService doesn't support setting status codes directly,
  // so we embed status in the response body
  const payload = {
    status: statusCode,
    ...data
  };
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// REQUEST ROUTER
// ============================================================================

/**
 * Routes API requests to the appropriate handler
 * @param {Object} params - Request parameters (merged from URL params + body)
 * @param {boolean} isPost - Whether this is a POST request
 */
function handleApiRequest(params, isPost = false) {
  // Validate API key
  if (!validateApiKey(params)) {
    return jsonResponse({ error: 'Unauthorized: invalid or missing api_key' }, 401);
  }

  const action = params.action;

  try {
    switch (action) {
      // ---- READ operations (GET) ----
      case 'getDashboard':
        return jsonResponse(apiGetDashboard());
      case 'getSyncStatus':
        return jsonResponse(apiGetSyncStatus());
      case 'getMappings':
        return jsonResponse(apiGetMappings(params.sheet));
      case 'getSyncLog':
        return jsonResponse(apiGetSyncLog(parseInt(params.limit) || 50));
      case 'getConfig':
        return jsonResponse(apiGetConfig());
      case 'getConnectionStatus':
        return jsonResponse(apiGetConnectionStatus());
      case 'getQBOMasterOptions':
        return jsonResponse(apiGetQBOMasterOptions());

      // ---- WRITE operations (POST) ----
      case 'syncApproved':
        if (!isPost) return jsonResponse({ error: 'Use POST for this action' }, 405);
        return jsonResponse(apiSyncApproved());
      case 'previewApproved':
        return jsonResponse(apiPreviewApproved(params));
      case 'refreshTogglMappings':
        if (!isPost) return jsonResponse({ error: 'Use POST for this action' }, 405);
        return jsonResponse(apiRefreshTogglMappings());
      case 'refreshQBOMasterLists':
        if (!isPost) return jsonResponse({ error: 'Use POST for this action' }, 405);
        return jsonResponse(apiRefreshQBOMasterLists());
      case 'wireDropdowns':
        if (!isPost) return jsonResponse({ error: 'Use POST for this action' }, 405);
        return jsonResponse(apiWireDropdowns());
      case 'updateMapping':
        if (!isPost) return jsonResponse({ error: 'Use POST for this action' }, 405);
        return jsonResponse(apiUpdateMapping(params));
      case 'setConfig':
        if (!isPost) return jsonResponse({ error: 'Use POST for this action' }, 405);
        return jsonResponse(apiSetConfig(params.key, params.value));

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 404);
    }
  } catch (error) {
    logMessage(`WebAPI error [${action}]: ${error.message}`, 'ERROR');
    return jsonResponse({ error: error.message }, 500);
  }
}

// ============================================================================
// API HANDLERS — READ
// ============================================================================

/**
 * Dashboard: combined overview of sync status, mapping completeness, API usage
 */
function apiGetDashboard() {
  const ss = getSpreadsheet();

  // Sync status
  const lastSync = getConfigValue('LAST_SYNC_DATE', 'Never');
  const syncLogSheet = ss.getSheetByName(CONFIG.SHEETS.SYNC_LOG);
  const syncLogCount = syncLogSheet ? Math.max(0, syncLogSheet.getLastRow() - 1) : 0;
  const dateRange = getImportDateRange();

  // Mapping completeness
  const mappingStats = {};
  const mappingSheets = {
    users: { sheet: CONFIG.SHEETS.MAPPINGS_USERS, idCol: 4 },
    clients: { sheet: CONFIG.SHEETS.MAPPINGS_CLIENTS, idCol: 3 },
    projects: { sheet: CONFIG.SHEETS.MAPPINGS_PROJECTS, idCol: 5 },
    tasks: { sheet: CONFIG.SHEETS.MAPPINGS_TASKS, idCol: 5 }
  };

  for (const [key, cfg] of Object.entries(mappingSheets)) {
    const sheet = ss.getSheetByName(cfg.sheet);
    if (sheet && sheet.getLastRow() > 1) {
      const rows = sheet.getLastRow() - 1;
      const ids = sheet.getRange(2, cfg.idCol, rows, 1).getValues();
      const mapped = ids.filter(r => r[0] !== '' && r[0] !== null).length;
      mappingStats[key] = { total: rows, mapped, unmapped: rows - mapped };
    } else {
      mappingStats[key] = { total: 0, mapped: 0, unmapped: 0 };
    }
  }

  // Pending sync
  const hasPending = hasPendingSync();
  const syncStatus = getConfigValue('SYNC_STATUS', '');

  // API usage from last sync
  const lastSyncCalls = getConfigValue('LAST_SYNC_API_CALLS', '');

  return {
    sync: {
      lastSync,
      logEntries: syncLogCount,
      dateRange: { start: dateRange.startDate, end: dateRange.endDate },
      hasPendingSync: hasPending,
      syncStatus
    },
    mappings: mappingStats,
    api: {
      lastSyncCalls,
      budget: getConfigValue('TOGGL_API_BUDGET', '180')
    },
    tags: {
      approved: getApprovedTagName(),
      synced: getSyncedTagName()
    }
  };
}

/**
 * Detailed sync status (matches showSyncStatus dialog content)
 */
function apiGetSyncStatus() {
  const apiStats = getApiUsageStats();
  const state = loadSyncState();

  return {
    lastSync: getConfigValue('LAST_SYNC_DATE', 'Never'),
    dateRange: getImportDateRange(),
    tags: {
      approved: getApprovedTagName(),
      synced: getSyncedTagName()
    },
    api: {
      workspaceCalls: apiStats.workspaceCalls,
      budget: apiStats.budget,
      remaining: apiStats.remaining,
      lastSyncCalls: getConfigValue('LAST_SYNC_API_CALLS', '')
    },
    pendingSync: state ? {
      pendingEntries: state.pendingEntryIds?.length || 0,
      syncedEntries: state.syncedEntryIds?.length || 0,
      pausedAt: state.pausedAt || null
    } : null
  };
}

/**
 * Returns mapping data for a specific sheet
 */
function apiGetMappings(sheetName) {
  const validSheets = [
    CONFIG.SHEETS.MAPPINGS_USERS,
    CONFIG.SHEETS.MAPPINGS_CLIENTS,
    CONFIG.SHEETS.MAPPINGS_PROJECTS,
    CONFIG.SHEETS.MAPPINGS_TASKS
  ];

  if (!sheetName || !validSheets.includes(sheetName)) {
    // Return all mappings summary
    const all = {};
    for (const name of validSheets) {
      all[name] = getMappingSheetData(name);
    }
    return { mappings: all };
  }

  return { mappings: { [sheetName]: getMappingSheetData(sheetName) } };
}

/**
 * Reads mapping sheet data into a structured format
 */
function getMappingSheetData(sheetName) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet || sheet.getLastRow() <= 1) {
    return { headers: [], rows: [] };
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const rows = data.map((row, idx) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    obj._row = idx + 2; // 1-indexed row number in sheet
    return obj;
  });

  return { headers, rows };
}

/**
 * Returns recent sync log entries
 */
function apiGetSyncLog(limit) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.SYNC_LOG);

  if (!sheet || sheet.getLastRow() <= 1) {
    return { entries: [], total: 0 };
  }

  const lastRow = sheet.getLastRow();
  const total = lastRow - 1;
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  // Get the most recent entries (from bottom)
  const startRow = Math.max(2, lastRow - limit + 1);
  const numRows = lastRow - startRow + 1;
  const data = sheet.getRange(startRow, 1, numRows, lastCol).getValues();

  const entries = data.map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  }).reverse(); // Most recent first

  return { entries, total };
}

/**
 * Returns current config settings
 */
function apiGetConfig() {
  return {
    startDate: getConfigValue('START_DATE', ''),
    endDate: getConfigValue('END_DATE', ''),
    importDays: getConfigValue('IMPORT_DAYS', CONFIG.DEFAULTS.IMPORT_DAYS),
    approvedTag: getApprovedTagName(),
    syncedTag: getSyncedTagName(),
    apiBudget: getConfigValue('TOGGL_API_BUDGET', '180'),
    syncBillableOnly: getConfigValue('SYNC_BILLABLE_ONLY', 'FALSE'),
    batchSize: getConfigValue('BATCH_SIZE', CONFIG.DEFAULTS.BATCH_SIZE || '50'),
    defaultServiceItemId: getConfigValue('DEFAULT_SERVICE_ITEM_ID', ''),
    defaultServiceItemName: getConfigValue('DEFAULT_SERVICE_ITEM_NAME', ''),
    qboEnv: getConfigValue('QBO_ENV', 'production')
  };
}

// ============================================================================
// API HANDLERS — WRITE
// ============================================================================

/**
 * Triggers sync of approved entries
 */
function apiSyncApproved() {
  syncApprovedEntries();
  return {
    message: 'Sync completed',
    lastSync: getConfigValue('LAST_SYNC_DATE', ''),
    apiCalls: getConfigValue('LAST_SYNC_API_CALLS', '')
  };
}

/**
 * Preview approved entries (returns data without syncing)
 */
function apiPreviewApproved(params) {
  params = params || {};

  // Use provided dates if available, otherwise fall back to saved config
  // Dates must be strings in YYYY-MM-DD format (same as getImportDateRange returns)
  let dateRange;
  if (params.startDate && params.endDate) {
    // Keep as strings - the Toggl API expects YYYY-MM-DD format
    dateRange = {
      startDate: params.startDate,
      endDate: params.endDate
    };
  } else {
    dateRange = getImportDateRange();
  }

  const approvedTag = getApprovedTagName();
  const syncedTag = getSyncedTagName();

  // Fetch entries from Toggl
  const allEntries = fetchTimeEntriesAllUsers(dateRange.startDate, dateRange.endDate);

  // Get tag lookups
  const tags = fetchTogglTags();
  const tagMap = {};
  tags.forEach(t => { tagMap[t.id] = t.name; });

  const approvedTagId = Object.keys(tagMap).find(id => tagMap[id] === approvedTag);
  const syncedTagId = Object.keys(tagMap).find(id => tagMap[id] === syncedTag);

  // Filter to approved but not synced
  const approvedEntries = allEntries.filter(entry => {
    const entryTagIds = entry.tag_ids || [];
    const hasApproved = approvedTagId && entryTagIds.includes(Number(approvedTagId));
    const hasSynced = syncedTagId && entryTagIds.includes(Number(syncedTagId));
    return hasApproved && !hasSynced;
  });

  // Build user lookup
  const users = fetchTogglUsers();
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u.name || u.fullname || u.email; });

  // Build project lookup
  const projects = fetchTogglProjects();
  const projectMap = {};
  projects.forEach(p => { projectMap[p.id] = p.name; });

  // Build task lookup
  const tasks = fetchTogglTasks();
  const taskMap = {};
  tasks.forEach(t => { taskMap[t.id] = t.name; });

  const entries = approvedEntries.map(entry => ({
    id: entry.id,
    description: entry.description || '',
    user: userMap[entry.user_id] || entry.user_id,
    project: projectMap[entry.project_id] || '',
    task: taskMap[entry.task_id] || '',
    duration: extractDurationSeconds(entry),  // Use helper for all API formats
    date: entry.start ? entry.start.substring(0, 10) : '',
    tags: (entry.tag_ids || []).map(id => tagMap[id] || id)
  }));

  return {
    count: entries.length,
    dateRange,
    approvedTag,
    syncedTag,
    entries
  };
}

/**
 * Refreshes Toggl mapping sheets
 */
function apiRefreshTogglMappings() {
  refreshTogglMappings();
  return { message: 'Toggl mappings refreshed' };
}

/**
 * Refreshes QBO master lists
 */
function apiRefreshQBOMasterLists() {
  refreshQBOMasterLists();
  return { message: 'QBO master lists refreshed' };
}

/**
 * Wires dropdowns on mapping sheets
 */
function apiWireDropdowns() {
  wireAllDropdowns();
  return { message: 'Dropdowns wired' };
}

/**
 * Updates a single mapping cell
 * Params: sheet (sheet name), row (row number), col (column name or number), value
 */
function apiUpdateMapping(params) {
  const { sheet: sheetName, row, col, value } = params;

  const validSheets = [
    CONFIG.SHEETS.MAPPINGS_USERS,
    CONFIG.SHEETS.MAPPINGS_CLIENTS,
    CONFIG.SHEETS.MAPPINGS_PROJECTS,
    CONFIG.SHEETS.MAPPINGS_TASKS
  ];

  if (!validSheets.includes(sheetName)) {
    throw new Error(`Invalid sheet: ${sheetName}`);
  }

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);

  const rowNum = parseInt(row);
  let colNum = parseInt(col);

  // If col is a string (header name), find the column number
  if (isNaN(colNum)) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    colNum = headers.indexOf(col) + 1;
    if (colNum === 0) throw new Error(`Column not found: ${col}`);
  }

  sheet.getRange(rowNum, colNum).setValue(value === 'true' ? true : value === 'false' ? false : value);

  return { message: `Updated ${sheetName} row ${rowNum} col ${colNum}` };
}

/**
 * Sets a config value
 */
function apiSetConfig(key, value) {
  const allowedKeys = [
    'START_DATE', 'END_DATE', 'IMPORT_DAYS', 'APPROVED_TAG', 'SYNCED_TAG',
    'TOGGL_API_BUDGET', 'SYNC_BILLABLE_ONLY', 'DEFAULT_SERVICE_ITEM_ID',
    'DEFAULT_SERVICE_ITEM_NAME'
  ];

  if (!allowedKeys.includes(key)) {
    throw new Error(`Config key not allowed: ${key}`);
  }

  setConfigValue(key, value);
  return { message: `Config ${key} updated`, key, value };
}

// ============================================================================
// API HANDLERS — CONNECTION & MASTER DATA
// ============================================================================

/**
 * Returns connection status for QBO and Toggl
 */
function apiGetConnectionStatus() {
  let qboConnected = false;
  let qboRealm = null;
  let togglConnected = false;
  let togglWorkspace = null;

  // Check QBO connection
  try {
    qboConnected = isConnectedToQBO();
    if (qboConnected) {
      qboRealm = getQBORealm() || null;
    }
  } catch (e) {
    qboConnected = false;
  }

  // Check Toggl connection
  try {
    togglConnected = validateTogglConnection();
    if (togglConnected) {
      togglWorkspace = getTogglWorkspaceId() || null;
    }
  } catch (e) {
    togglConnected = false;
  }

  return {
    qbo: {
      connected: qboConnected,
      realmId: qboRealm
    },
    toggl: {
      connected: togglConnected,
      workspaceId: togglWorkspace
    }
  };
}

/**
 * Returns QBO master list options for dropdown selectors
 */
function apiGetQBOMasterOptions() {
  const ss = getSpreadsheet();

  const getOptions = (sheetName, idCol, nameCol) => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() <= 1) {
      return [];
    }
    const lastRow = sheet.getLastRow();
    const data = sheet.getRange(2, 1, lastRow - 1, Math.max(idCol, nameCol)).getValues();
    return data
      .filter(row => row[idCol - 1] && row[nameCol - 1])
      .map(row => ({
        id: String(row[idCol - 1]),
        name: String(row[nameCol - 1])
      }));
  };

  return {
    employees: getOptions(CONFIG.SHEETS.QBO_EMPLOYEES, 1, 2),   // ID col 1, Name col 2
    customers: getOptions(CONFIG.SHEETS.QBO_CUSTOMERS, 1, 2),   // ID col 1, Name col 2
    projects: getOptions(CONFIG.SHEETS.QBO_PROJECTS, 1, 2),     // ID col 1, Name col 2
    serviceItems: getOptions(CONFIG.SHEETS.QBO_ITEMS, 1, 2)     // ID col 1, Name col 2
  };
}
