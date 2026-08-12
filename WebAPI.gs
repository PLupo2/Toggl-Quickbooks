/**
 * @fileoverview Web app endpoint (doGet/doPost) serving as a REST-like API layer between the static web UI and the Google Sheet backend.
 * @author pltheatrical2
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
 * Validates the origin secret from the request (Phase 2, Cloudflare Access
 * migration). This is the real auth boundary: it's stamped by the Cloudflare
 * Worker from a server-side env var and never reaches the browser, so a
 * direct hit on this ANYONE_ANONYMOUS deployment — bypassing the Worker and
 * Cloudflare Access entirely — gets rejected even if the caller somehow has
 * the (lower-stakes) WEB_API_KEY.
 *
 * NOTE: Apps Script's doGet/doPost event object exposes no request-header
 * API (no e.headers) — there is no way for this script to read an actual
 * HTTP header. The Worker therefore sends the shared secret as a normal
 * request param (origin_secret), not a literal X-PLT-Origin header, even
 * though the Worker's own code labels the env var the same way the spec
 * does. Same property (server-side-only secret, two ends), different wire
 * format, because the alternative doesn't exist on this runtime.
 */
function validateOrigin(params) {
  const storedSecret = getScriptProperty('WORKER_SECRET');
  if (!storedSecret) {
    return false; // Not configured yet — fail closed, not open
  }
  return params.origin_secret === storedSecret;
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
  // Primary gate (Phase 2): only the Cloudflare Worker knows this secret,
  // and it only sends it after Cloudflare Access has verified the caller's
  // @pltheatrical.com identity. This is what makes it safe to be
  // ANYONE_ANONYMOUS-reachable — a direct hit without the Worker in front
  // has no way to produce this value.
  if (!validateOrigin(params)) {
    return jsonResponse({ error: 'Unauthorized: request did not come through the Access-gated proxy' }, 401);
  }
  // Secondary/legacy check — kept for defense in depth, not load-bearing.
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
      case 'getSyncJobStatus':
        return jsonResponse(apiGetSyncJobStatus());
      case 'getSyncLog':
        return jsonResponse(apiGetSyncLog(parseInt(params.limit) || 50));
      case 'getConfig':
        return jsonResponse(apiGetConfig());
      case 'getConnectionStatus':
        return jsonResponse(apiGetConnectionStatus());
      case 'getProjectPendingEntries':
        return jsonResponse(apiGetProjectPendingEntries(params.projectId));

      // ---- WRITE operations (POST) ----
      // Restored in Phase 2: reachable only through the Access-gated
      // Cloudflare Worker (see validateOrigin above). The 2026-07-13 410
      // response was the emergency fix for the WEB_API_KEY-in-browser-JS
      // flaw; this is the real fix, not a reversion of it.
      case 'syncApproved':
        // D5: starts a job and returns immediately — see startAsyncSyncJob
        // in Toggl.gs. Does not run the sync inline anymore; poll
        // getSyncJobStatus for progress/completion.
        if (!isPost) return jsonResponse({ error: 'Use POST for this action' }, 405);
        return jsonResponse(apiSyncApproved(params));
      case 'previewApproved':
        return jsonResponse(apiPreviewApproved(params));
      case 'recomputeDisagreement':
        if (!isPost) return jsonResponse({ error: 'Use POST for this action' }, 405);
        return jsonResponse(apiRecomputeDisagreement());
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

  // Pending sync
  const hasPending = hasPendingSync();
  const syncStatus = getConfigValue('SYNC_STATUS', '');

  // API usage from last sync
  const lastSyncCalls = getConfigValue('LAST_SYNC_API_CALLS', '');

  // D1(b) + dashboard-speed fix: this used to call getTagLogDisagreementCount()
  // here, live, on every page load — measured 2026-08-05 at 8-10s for
  // getDashboard vs 1-6s elsewhere, ~4 Toggl round trips and ~4 of a 220
  // budget spent before the page could even render. It's now computed once
  // per sync run (syncApprovedEntries / syncApprovedEntriesWithState, which
  // already have the entries/tags in hand) and persisted; this just reads
  // that snapshot. Zero Toggl calls. A snapshot that's never been computed
  // (fresh install, or no sync yet since this shipped) is reported as
  // skipped, not faked as zero — see loadDisagreementSnapshot's contract.
  const snapshot = loadDisagreementSnapshot();
  const disagreement = snapshot
    ? {
        count: snapshot.count,
        missingTag: snapshot.missingTag,
        missingLog: snapshot.missingLog,
        checked: snapshot.checked,
        skipped: false,
        reason: null,
        computedAt: snapshot.computedAt
      }
    : {
        count: 0,
        missingTag: 0,
        missingLog: 0,
        checked: 0,
        skipped: true,
        reason: 'Not yet computed — run a sync, or use the Recompute action',
        computedAt: null
      };

  return {
    sync: {
      lastSync,
      logEntries: syncLogCount,
      dateRange: { start: dateRange.startDate, end: dateRange.endDate },
      hasPendingSync: hasPending,
      syncStatus
    },
    api: {
      lastSyncCalls,
      budget: getConfigValue('TOGGL_API_BUDGET', '180')
    },
    tags: {
      approved: getApprovedTagName(),
      synced: getSyncedTagName(),
      disagreement: {
        count: disagreement.count,
        missingTag: disagreement.missingTag,   // Sync_Log Success, but Toggl entry isn't tagged Synced
        missingLog: disagreement.missingLog,   // Tagged Synced, but Sync_Log has no Success row
        checked: disagreement.checked,
        skipped: disagreement.skipped,
        reason: disagreement.reason,
        computedAt: disagreement.computedAt,   // never trust count without checking this is non-null
        warning: !disagreement.skipped && disagreement.count > 0
          ? `${disagreement.count} entries disagree between Sync_Log and the Toggl "${getSyncedTagName()}" tag — see missingTag/missingLog.`
          : null
      }
    }
  };
}

/**
 * On-demand recompute (D1(b) UI button) — the only remaining path that
 * fetches live from Toggl on request rather than reading the sync-run
 * snapshot. Same budget guard and skipped/reason shape as before; also
 * persists the result so the next getDashboard read reflects it.
 */
function apiRecomputeDisagreement() {
  const result = getTagLogDisagreementCount();
  if (result.skipped) {
    // Budget-guarded or errored — nothing to persist, report as-is so the
    // UI can show why (e.g. "API budget too low"), not a stale success.
    return { ...result, computedAt: null };
  }
  return saveDisagreementSnapshot(result);
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
    // QBO_ENV lives in Script Properties (getQBOEnvironment is the authority,
    // read by Auth.gs + getQBOBaseURL) — NOT the Config sheet. Read it from
    // the real store so the Settings dropdown reflects the environment the
    // sync actually uses.
    qboEnv: getQBOEnvironment()
  };
}

// ============================================================================
// API HANDLERS — WRITE
// ============================================================================

/**
 * Starts an async sync job and returns immediately (D5). Does not run the
 * sync inline — Cloudflare abandons the edge request at ~100s while Apps
 * Script keeps going, which used to present a successful long run to the
 * browser as a failed one. Poll getSyncJobStatus for progress/completion.
 * @param {Object} params - May include forceEntryIds (D4 per-entry override):
 *   an array (JSON POST body) or comma-separated string of Toggl Entry IDs
 *   to force-write even if Sync_Log already shows Status='Success' for them.
 *   No global bypass — only entries explicitly named here skip the guard.
 */
function apiSyncApproved(params) {
  params = params || {};
  const job = startAsyncSyncJob({ forceEntryIds: params.forceEntryIds });

  return {
    message: job.alreadyRunning
      ? 'A sync is already in progress — polling the existing job.'
      : 'Sync started',
    jobId: job.jobId,
    status: job.status,
    alreadyRunning: job.alreadyRunning
  };
}

/**
 * D5: status polling endpoint. Reads persisted state only (SYNC_JOB_META,
 * plus SYNC_PENDING_STATE for in-flight detail while paused) — never
 * browser state, so progress survives the operator navigating away and a
 * page reload can resume polling an already-running job.
 * @returns {{status: string, jobId: string|null, ...}}
 */
function apiGetSyncJobStatus() {
  const meta = getSyncJobMeta();
  if (!meta) {
    return { status: 'idle', jobId: null };
  }

  const pendingDetail = meta.status === 'paused' ? loadSyncState() : null;

  return {
    jobId: meta.jobId,
    status: meta.status, // running | paused | completed | failed
    startedAt: meta.startedAt,
    completedAt: meta.completedAt || null,
    synced: meta.totalSynced || 0,
    failed: meta.totalFailed || 0,
    alreadySynced: meta.totalAlreadySynced || 0,
    taggingFailed: meta.totalTaggingFailed || 0,
    error: meta.error || null,
    pending: pendingDetail ? {
      pendingEntries: pendingDetail.pendingEntryIds?.length || 0,
      pausedAt: pendingDetail.pausedAt || null
    } : null
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

  // D1: Approved-tag alone. D2: split by the Sync_Log guard, not the Synced
  // tag, so a stale/missing tag can't hide an already-synced entry from
  // this count (or, worse, present it as one still needing to be written).
  const approvedEntries = allEntries.filter(entry => {
    const entryTagIds = entry.tag_ids || [];
    return approvedTagId && entryTagIds.includes(Number(approvedTagId));
  });

  const alreadySyncedMap = buildAlreadySyncedMap();
  const toSyncEntries = approvedEntries.filter(entry => !alreadySyncedMap.has(String(entry.id)));
  const alreadySyncedCount = approvedEntries.length - toSyncEntries.length;

  // Build user lookup
  const users = fetchTogglUsers();
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u.name || u.fullname || u.email; });

  // Build project lookup
  const projects = fetchTogglProjects();
  const projectMap = {};
  projects.forEach(p => { projectMap[p.id] = p.name; });

  // Build task lookup (from mapping sheet - zero API calls)
  const taskMappings = getTasksFromMappingSheet();
  const taskMap = {};
  taskMappings.forEach(t => {
    if (t.togglTaskId) {
      taskMap[t.togglTaskId] = t.togglTaskName;
    }
  });

  // entries/count stay scoped to "will actually be written" (unchanged
  // contract — the frontend's Sync button reads count directly). The new
  // approvedCount/alreadySyncedCount fields are additive, matching D2's
  // "60 approved, 22 already synced, 38 will be written" split.
  const entries = toSyncEntries.map(entry => ({
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
    approvedCount: approvedEntries.length,
    alreadySyncedCount,
    dateRange,
    approvedTag,
    syncedTag,
    entries
  };
}

/**
 * Sets a config value
 */
function apiSetConfig(key, value) {
  // QBO_ENV is a Script Property (getQBOEnvironment reads it there), not a
  // Config-sheet cell — route it to the authoritative store, and validate
  // it, so the Settings toggle actually switches environments instead of
  // writing a Config-sheet value nothing consumes.
  if (key === 'QBO_ENV') {
    const env = String(value).toLowerCase();
    if (env !== 'production' && env !== 'sandbox') {
      throw new Error(`Invalid QBO_ENV: ${value} (must be 'production' or 'sandbox')`);
    }
    setScriptProperty('QBO_ENV', env);
    return { message: 'Config QBO_ENV updated', key, value: env };
  }

  // Config-sheet settings the dashboard is allowed to write. BATCH_SIZE is
  // included so the Settings "Save" doesn't throw partway through the loop
  // (it posts every field; a disallowed key aborts the whole save and
  // silently drops the fields after it).
  const allowedKeys = [
    'START_DATE', 'END_DATE', 'IMPORT_DAYS', 'APPROVED_TAG', 'SYNCED_TAG',
    'TOGGL_API_BUDGET', 'SYNC_BILLABLE_ONLY', 'BATCH_SIZE',
    'DEFAULT_SERVICE_ITEM_ID', 'DEFAULT_SERVICE_ITEM_NAME'
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
 * Returns pending (unsynced) time entries for a specific Toggl project.
 * Used to warn users before archiving a project that still has unsynced time.
 * @param {string} projectId - Toggl project ID to check
 * @returns {Object} Pending entry count and details
 */
function apiGetProjectPendingEntries(projectId) {
  if (!projectId) {
    return { error: 'Missing projectId parameter', count: 0, entries: [] };
  }

  const dateRange = getImportDateRange();
  const approvedTag = getApprovedTagName();

  // Fetch entries from Toggl
  const allEntries = fetchTimeEntriesAllUsers(dateRange.startDate, dateRange.endDate);

  // Get tag lookups
  const tags = fetchTogglTags();
  const tagMap = {};
  tags.forEach(t => { tagMap[t.id] = t.name; });

  const approvedTagId = Object.keys(tagMap).find(id => tagMap[id] === approvedTag);

  // Not part of the 6-item guard scope, but the same D1 staleness problem
  // applies here: this warns before archiving a project, so a stale Synced
  // tag would falsely flag an already-synced project as having pending
  // work. Same fix as the sync/preview paths: Sync_Log guard, not the tag.
  const alreadySyncedMap = buildAlreadySyncedMap();

  // Filter to entries for this project that are approved and not already synced
  const pendingEntries = allEntries.filter(entry => {
    if (String(entry.project_id) !== String(projectId)) {
      return false;
    }
    const entryTagIds = entry.tag_ids || [];
    const hasApproved = approvedTagId && entryTagIds.includes(Number(approvedTagId));
    return hasApproved && !alreadySyncedMap.has(String(entry.id));
  });

  // Build user lookup for entry details
  const users = fetchTogglUsers();
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u.name || u.fullname || u.email; });

  const entries = pendingEntries.map(entry => ({
    id: entry.id,
    description: entry.description || '',
    user: userMap[entry.user_id] || entry.user_id,
    duration: extractDurationSeconds(entry),
    date: entry.start ? entry.start.substring(0, 10) : ''
  }));

  return {
    projectId,
    count: entries.length,
    entries,
    message: entries.length > 0
      ? `This project has ${entries.length} pending entries that haven't been synced yet.`
      : 'No pending entries for this project.'
  };
}