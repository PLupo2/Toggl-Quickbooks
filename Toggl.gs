/**
 * Toggl.gs - Toggl Track API calls and import logic
 * Supports both API v9 (current user) and Reports API v3 (all workspace users)
 */

// ============================================================================
// API CONFIGURATION
// ============================================================================

const TOGGL_API_V9_BASE = 'https://api.track.toggl.com/api/v9';
const TOGGL_REPORTS_V3_BASE = 'https://api.track.toggl.com/reports/api/v3';

// ============================================================================
// API REQUEST HELPERS
// ============================================================================

/**
 * Makes an authenticated request to Toggl API v9
 * @param {string} endpoint - API endpoint
 * @param {Object} [options] - Request options
 * @returns {Object} Parsed JSON response
 */
function togglApiV9(endpoint, options = {}) {
  const authHeader = getTogglAuthHeader();
  const url = `${TOGGL_API_V9_BASE}${endpoint}`;

  const defaultOptions = {
    method: 'get',
    headers: {
      'Authorization': `Basic ${authHeader}`,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };

  const requestOptions = { ...defaultOptions, ...options };
  if (options.headers) {
    requestOptions.headers = { ...defaultOptions.headers, ...options.headers };
  }

  logMessage(`Toggl API v9: ${requestOptions.method.toUpperCase()} ${endpoint}`, 'INFO');

  const response = UrlFetchApp.fetch(url, requestOptions);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode !== 200) {
    logMessage(`Toggl API Error: ${responseCode} - ${responseBody}`, 'ERROR');
    throw new Error(`Toggl API Error: ${responseCode}`);
  }

  return JSON.parse(responseBody);
}

/**
 * Makes an authenticated request to Toggl Reports API v3
 * @param {string} endpoint - API endpoint
 * @param {Object} payload - Request payload
 * @returns {Object} Parsed JSON response
 */
function togglReportsV3(endpoint, payload) {
  const authHeader = getTogglAuthHeader();
  const workspaceId = getOrFetchWorkspaceId();
  const url = `${TOGGL_REPORTS_V3_BASE}/workspace/${workspaceId}${endpoint}`;

  const options = {
    method: 'post',
    headers: {
      'Authorization': `Basic ${authHeader}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  logMessage(`Toggl Reports API: POST ${endpoint}`, 'INFO');

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode !== 200) {
    logMessage(`Toggl Reports API Error: ${responseCode} - ${responseBody}`, 'ERROR');
    throw new Error(`Toggl Reports API Error: ${responseCode}`);
  }

  return JSON.parse(responseBody);
}

// ============================================================================
// TAG OPERATIONS
// ============================================================================

/**
 * Fetches all tags in the workspace
 * @returns {Object[]} Array of tag objects
 */
function fetchTogglTags() {
  const workspaceId = getOrFetchWorkspaceId();
  logMessage('Fetching Toggl tags...', 'INFO');

  try {
    const tags = togglApiV9(`/workspaces/${workspaceId}/tags`);
    logMessage(`Fetched ${tags.length} tags`, 'INFO');
    return tags;
  } catch (error) {
    logMessage(`Error fetching tags: ${error.message}`, 'WARN');
    return [];
  }
}

/**
 * Creates a tag in Toggl if it doesn't exist
 * @param {string} tagName - Name of the tag to create
 * @returns {Object} Created or existing tag object
 */
function ensureTagExists(tagName) {
  const workspaceId = getOrFetchWorkspaceId();
  const existingTags = fetchTogglTags();

  const existing = existingTags.find(t => t.name.toLowerCase() === tagName.toLowerCase());
  if (existing) {
    return existing;
  }

  logMessage(`Creating tag: ${tagName}`, 'INFO');

  try {
    const tag = togglApiV9(`/workspaces/${workspaceId}/tags`, {
      method: 'post',
      payload: JSON.stringify({ name: tagName })
    });
    return tag;
  } catch (error) {
    logMessage(`Error creating tag: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Adds a tag to a time entry
 * @param {number} entryId - Time entry ID
 * @param {string} tagName - Tag name to add
 * @returns {Object} Updated time entry
 */
function addTagToTimeEntry(entryId, tagName) {
  const workspaceId = getOrFetchWorkspaceId();

  // First, get the current entry to see its existing tags
  const entry = togglApiV9(`/me/time_entries/${entryId}`);
  const currentTags = entry.tags || [];

  // Check if tag already exists on entry
  if (currentTags.includes(tagName)) {
    logMessage(`Entry ${entryId} already has tag "${tagName}"`, 'INFO');
    return entry;
  }

  // Add the new tag
  const updatedTags = [...currentTags, tagName];

  logMessage(`Adding tag "${tagName}" to entry ${entryId}`, 'INFO');

  const updated = togglApiV9(`/workspaces/${workspaceId}/time_entries/${entryId}`, {
    method: 'put',
    payload: JSON.stringify({ tags: updatedTags })
  });

  return updated;
}

/**
 * Adds a tag to multiple time entries
 * @param {number[]} entryIds - Array of time entry IDs
 * @param {string} tagName - Tag name to add
 * @returns {Object} Results with success and failure counts
 */
function addTagToMultipleEntries(entryIds, tagName) {
  const workspaceId = getOrFetchWorkspaceId();
  const results = { success: 0, failed: 0, errors: [] };

  // Ensure tag exists first
  ensureTagExists(tagName);

  for (const entryId of entryIds) {
    try {
      addTagToTimeEntry(entryId, tagName);
      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push({ entryId, error: error.message });
      logMessage(`Failed to add tag to entry ${entryId}: ${error.message}`, 'WARN');
    }
    // Small delay to avoid rate limiting
    Utilities.sleep(100);
  }

  return results;
}

// ============================================================================
// WORKSPACE OPERATIONS
// ============================================================================

/**
 * Gets or fetches the workspace ID
 * @returns {string} Workspace ID
 */
function getOrFetchWorkspaceId() {
  let workspaceId = getTogglWorkspaceId();

  if (!workspaceId) {
    const me = togglApiV9('/me');
    if (me.default_workspace_id) {
      workspaceId = String(me.default_workspace_id);
      setScriptProperty('TOGGL_WORKSPACE_ID', workspaceId);
      logMessage(`Auto-detected workspace ID: ${workspaceId}`, 'INFO');
    } else {
      throw new Error('Could not determine Toggl workspace ID');
    }
  }

  return workspaceId;
}

/**
 * Fetches all workspaces for the authenticated user
 * @returns {Object[]} Array of workspace objects
 */
function fetchWorkspaces() {
  return togglApiV9('/workspaces');
}

// ============================================================================
// USER OPERATIONS
// ============================================================================

/**
 * Fetches all users in the workspace
 * @returns {Object[]} Array of user objects
 */
function fetchTogglUsers() {
  const workspaceId = getOrFetchWorkspaceId();
  logMessage('Fetching Toggl workspace users...', 'INFO');

  const users = togglApiV9(`/workspaces/${workspaceId}/users`);
  logMessage(`Fetched ${users.length} users`, 'INFO');

  return users;
}

/**
 * Gets users for mapping sheet
 * @returns {Array[]} Array of [id, name, email] rows
 */
function getUsersForMapping() {
  const users = fetchTogglUsers();
  return users.map(u => [
    u.id,
    u.fullname || u.name || u.email,
    u.email
  ]).sort((a, b) => (a[1] || '').localeCompare(b[1] || ''));
}

// ============================================================================
// CLIENT OPERATIONS
// ============================================================================

/**
 * Fetches all clients in the workspace
 * @returns {Object[]} Array of client objects
 */
function fetchTogglClients() {
  const workspaceId = getOrFetchWorkspaceId();
  logMessage('Fetching Toggl clients...', 'INFO');

  const clients = togglApiV9(`/workspaces/${workspaceId}/clients`);
  logMessage(`Fetched ${clients.length} clients`, 'INFO');

  return clients;
}

/**
 * Gets clients for mapping sheet
 * @returns {Array[]} Array of [id, name] rows
 */
function getClientsForMapping() {
  const clients = fetchTogglClients();
  return clients
    .filter(c => !c.archived)
    .map(c => [c.id, c.name])
    .sort((a, b) => a[1].localeCompare(b[1]));
}

// ============================================================================
// PROJECT OPERATIONS
// ============================================================================

/**
 * Fetches all projects in the workspace
 * @param {boolean} [activeOnly=true] - Only fetch active projects
 * @returns {Object[]} Array of project objects
 */
function fetchTogglProjects(activeOnly = true) {
  const workspaceId = getOrFetchWorkspaceId();
  logMessage('Fetching Toggl projects...', 'INFO');

  let endpoint = `/workspaces/${workspaceId}/projects`;
  if (activeOnly) {
    endpoint += '?active=true';
  }

  const projects = togglApiV9(endpoint);
  logMessage(`Fetched ${projects.length} projects`, 'INFO');

  return projects;
}

/**
 * Gets projects for mapping sheet with client info
 * @returns {Array[]} Array of [id, name, clientName] rows
 */
function getProjectsForMapping() {
  const projects = fetchTogglProjects(true);
  const clients = fetchTogglClients();

  // Build client lookup
  const clientMap = {};
  clients.forEach(c => {
    clientMap[c.id] = c.name;
  });

  return projects.map(p => [
    p.id,
    p.name,
    p.client_id ? clientMap[p.client_id] || '' : ''
  ]).sort((a, b) => a[1].localeCompare(b[1]));
}

// ============================================================================
// TASK OPERATIONS
// ============================================================================

/**
 * Fetches all tasks for a project
 * @param {number} projectId - Project ID
 * @returns {Object[]} Array of task objects
 */
function fetchTogglTasksForProject(projectId) {
  const workspaceId = getOrFetchWorkspaceId();
  return togglApiV9(`/workspaces/${workspaceId}/projects/${projectId}/tasks`);
}

/**
 * Fetches all tasks across all active projects
 * @returns {Object[]} Array of task objects with project context
 */
function fetchAllTogglTasks() {
  logMessage('Fetching all Toggl tasks...', 'INFO');

  const projects = fetchTogglProjects(true); // Only active projects
  const clients = fetchTogglClients();

  // Build lookups
  const clientMap = {};
  clients.forEach(c => {
    clientMap[c.id] = c.name;
  });

  const projectMap = {};
  projects.forEach(p => {
    projectMap[p.id] = {
      name: p.name,
      clientName: p.client_id ? clientMap[p.client_id] || '' : ''
    };
  });

  const allTasks = [];

  for (const project of projects) {
    try {
      const tasks = fetchTogglTasksForProject(project.id);
      tasks.forEach(task => {
        if (task.active !== false) {
          allTasks.push({
            id: task.id,
            name: task.name,
            projectId: project.id,
            projectName: project.name,
            clientName: projectMap[project.id]?.clientName || ''
          });
        }
      });
    } catch (error) {
      logMessage(`Error fetching tasks for project ${project.id}: ${error.message}`, 'WARN');
    }

    // Small delay to avoid rate limiting
    Utilities.sleep(50);
  }

  logMessage(`Fetched ${allTasks.length} tasks across ${projects.length} projects`, 'INFO');
  return allTasks;
}

/**
 * Gets tasks for mapping sheet with project context
 * @returns {Array[]} Array of [taskId, taskName, projectName, clientName] rows
 */
function getTasksForMapping() {
  const tasks = fetchAllTogglTasks();
  return tasks.map(t => [
    t.id,
    t.name,
    t.projectName,
    t.clientName
  ]).sort((a, b) => {
    // Sort by client, then project, then task
    const clientCompare = (a[3] || '').localeCompare(b[3] || '');
    if (clientCompare !== 0) return clientCompare;
    const projectCompare = a[2].localeCompare(b[2]);
    if (projectCompare !== 0) return projectCompare;
    return a[1].localeCompare(b[1]);
  });
}

// ============================================================================
// TIME ENTRY OPERATIONS - API v9 (Current User)
// ============================================================================

/**
 * Fetches time entries for the current user (API v9)
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Object[]} Array of time entry objects
 */
function fetchTimeEntriesCurrentUser(startDate, endDate) {
  logMessage(`Fetching time entries for current user: ${startDate} to ${endDate}`, 'INFO');

  // API v9 expects ISO timestamps
  const startISO = new Date(startDate + 'T00:00:00Z').toISOString();
  const endISO = new Date(endDate + 'T23:59:59Z').toISOString();

  const entries = togglApiV9(`/me/time_entries?start_date=${encodeURIComponent(startISO)}&end_date=${encodeURIComponent(endISO)}`);

  logMessage(`Fetched ${entries.length} time entries for current user`, 'INFO');
  return entries;
}

// ============================================================================
// TIME ENTRY OPERATIONS - Reports API v3 (All Users)
// ============================================================================

/**
 * Fetches detailed time entries for all workspace users (Reports API v3)
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Object[]} Array of time entry objects
 */
function fetchTimeEntriesAllUsers(startDate, endDate) {
  logMessage(`Fetching time entries for all users: ${startDate} to ${endDate}`, 'INFO');

  const allEntries = [];
  let hasMore = true;
  let firstRowNumber = 1;
  const pageSize = 50;

  while (hasMore) {
    const payload = {
      start_date: startDate,
      end_date: endDate,
      // IMPORTANT: Use null for all users, not empty array
      user_ids: null,
      first_row_number: firstRowNumber,
      page_size: pageSize
    };

    const response = togglReportsV3('/search/time_entries', payload);

    if (response && Array.isArray(response)) {
      allEntries.push(...response);
      hasMore = response.length === pageSize;
      firstRowNumber += response.length;
    } else {
      hasMore = false;
    }

    // Rate limiting protection
    Utilities.sleep(100);
  }

  logMessage(`Fetched ${allEntries.length} time entries for all users`, 'INFO');
  return allEntries;
}

// ============================================================================
// IMPORT LOGIC
// ============================================================================

/**
 * Imports time entries from Toggl to the Inbox sheet
 * @param {boolean} [allUsers=true] - Import for all users (Reports API) or just current user
 * @returns {Object} Import results
 */
function importTimeEntries(allUsers = true) {
  logMessage('Starting Toggl time entry import...', 'INFO');

  const ss = getSpreadsheet();

  // Calculate date range
  const importDays = parseInt(getConfigValue('IMPORT_DAYS', CONFIG.DEFAULTS.IMPORT_DAYS), 10);
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - importDays);

  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(endDate);

  showToast(`Importing entries from ${startDateStr} to ${endDateStr}...`);

  // Fetch time entries
  let entries;
  if (allUsers) {
    entries = fetchTimeEntriesAllUsers(startDateStr, endDateStr);
  } else {
    entries = fetchTimeEntriesCurrentUser(startDateStr, endDateStr);
  }

  if (entries.length === 0) {
    showToast('No time entries found for the date range.');
    return { imported: 0, skipped: 0, errors: 0 };
  }

  // Get existing entry IDs to avoid duplicates
  const existingIds = getExistingEntryIds();

  // Build lookup data
  const lookups = buildTogglLookups();

  // Process entries
  const results = processEntriesForImport(entries, existingIds, lookups);

  // Write to Inbox
  if (results.toImport.length > 0) {
    writeToInbox(results.toImport);
  }

  // Update last import date
  setConfigValue('LAST_IMPORT_DATE', formatDateTime(new Date()));

  const message = `Import complete: ${results.toImport.length} imported, ${results.skipped} skipped (duplicates)`;
  logMessage(message, 'INFO');
  showToast(message);

  return {
    imported: results.toImport.length,
    skipped: results.skipped,
    errors: results.errors
  };
}

/**
 * Gets existing entry IDs from Inbox, Queue, and Archive
 * @returns {Set} Set of existing Toggl entry IDs
 */
function getExistingEntryIds() {
  const ss = getSpreadsheet();
  const existingIds = new Set();

  // Check Inbox - Toggl Entry ID is now in column 18 (INBOX_COL.TOGGL_ENTRY_ID)
  const inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);
  if (inboxSheet && inboxSheet.getLastRow() > 1) {
    // Column 18 is Toggl Entry ID in the new layout
    const inboxIds = inboxSheet.getRange(2, 18, inboxSheet.getLastRow() - 1, 1).getValues();
    inboxIds.forEach(row => {
      if (row[0]) existingIds.add(String(row[0]));
    });
  }

  // Check Queue - Toggl Entry ID is still in column 1
  const queueSheet = ss.getSheetByName(CONFIG.SHEETS.QUEUE);
  if (queueSheet && queueSheet.getLastRow() > 1) {
    const queueIds = queueSheet.getRange(2, 1, queueSheet.getLastRow() - 1, 1).getValues();
    queueIds.forEach(row => {
      if (row[0]) existingIds.add(String(row[0]));
    });
  }

  // Check Archive - Toggl Entry ID is still in column 1
  const archiveSheet = ss.getSheetByName(CONFIG.SHEETS.ARCHIVE);
  if (archiveSheet && archiveSheet.getLastRow() > 1) {
    const archiveIds = archiveSheet.getRange(2, 1, archiveSheet.getLastRow() - 1, 1).getValues();
    archiveIds.forEach(row => {
      if (row[0]) existingIds.add(String(row[0]));
    });
  }

  return existingIds;
}

/**
 * Builds lookup maps for Toggl entities
 * @returns {Object} Lookup maps for users, clients, projects, tasks, tags
 */
function buildTogglLookups() {
  const users = fetchTogglUsers();
  const clients = fetchTogglClients();
  const projects = fetchTogglProjects(false); // Include inactive for historical data
  const tags = fetchTogglTags();

  const lookups = {
    users: {},
    clients: {},
    projects: {},
    tasks: {},
    tags: {}
  };

  users.forEach(u => {
    lookups.users[u.id] = u.fullname || u.name || u.email;
  });

  clients.forEach(c => {
    lookups.clients[c.id] = c.name;
  });

  projects.forEach(p => {
    lookups.projects[p.id] = {
      name: p.name,
      clientId: p.client_id,
      clientName: p.client_id ? lookups.clients[p.client_id] : ''
    };
  });

  // Build tag lookup (by ID and by name for flexibility)
  tags.forEach(t => {
    lookups.tags[t.id] = t.name;
    lookups.tags[t.name] = t.name; // Also map name to name for string tags
  });

  // Fetch tasks for each project
  projects.forEach(p => {
    try {
      const tasks = fetchTogglTasksForProject(p.id);
      tasks.forEach(t => {
        lookups.tasks[t.id] = t.name;
      });
    } catch (e) {
      // Ignore errors for individual projects
    }
    Utilities.sleep(25);
  });

  return lookups;
}

/**
 * Processes entries for import, resolving names and checking duplicates
 * @param {Object[]} entries - Raw time entries
 * @param {Set} existingIds - Existing entry IDs
 * @param {Object} lookups - Lookup maps
 * @returns {Object} Processing results
 */
function processEntriesForImport(entries, existingIds, lookups) {
  const toImport = [];
  let skipped = 0;
  let errors = 0;

  for (const entry of entries) {
    // Handle different API response formats
    const entryId = entry.id || entry.time_entry_id;

    // Skip duplicates
    if (existingIds.has(String(entryId))) {
      skipped++;
      continue;
    }

    try {
      const processed = processTimeEntry(entry, lookups);
      toImport.push(processed);
    } catch (error) {
      logMessage(`Error processing entry ${entryId}: ${error.message}`, 'WARN');
      errors++;
    }
  }

  return { toImport, skipped, errors };
}

/**
 * Processes a single time entry into Inbox format
 * @param {Object} entry - Raw time entry
 * @param {Object} lookups - Lookup maps
 * @returns {Object} Processed entry
 */
function processTimeEntry(entry, lookups) {
  // Handle different API formats (v9 vs Reports)
  const entryId = entry.id || entry.time_entry_id;
  const userId = entry.user_id || entry.uid;
  const projectId = entry.project_id || entry.pid;
  const taskId = entry.task_id || entry.tid;

  // Duration handling
  let durationSeconds = entry.duration || entry.seconds || 0;
  if (durationSeconds < 0) {
    // Running timer - calculate from start
    const start = new Date(entry.start);
    durationSeconds = Math.floor((new Date() - start) / 1000);
  }

  // Get project and client info
  const projectInfo = projectId ? lookups.projects[projectId] : null;

  // Resolve tag IDs to tag names
  const rawTags = entry.tags || entry.tag_ids || [];
  const resolvedTags = rawTags.map(tag => {
    // If it's already a string name, use it; otherwise look up the ID
    if (typeof tag === 'string') {
      return tag;
    }
    return lookups.tags[tag] || String(tag);
  });

  // Format start/end times for display (extract just time portion)
  const startTime = entry.start ? formatTimeOnly(entry.start) : '';
  const endTime = entry.stop ? formatTimeOnly(entry.stop) : '';

  return {
    togglEntryId: entryId,
    togglUser: lookups.users[userId] || String(userId),
    togglUserId: userId,
    togglClient: projectInfo?.clientName || '',
    togglClientId: projectInfo?.clientId || '',
    togglProject: projectInfo?.name || '',
    togglProjectId: projectId || '',
    togglTask: taskId ? (lookups.tasks[taskId] || '') : '',
    togglTaskId: taskId || '',
    description: entry.description || '',
    date: formatDate(entry.start),
    durationSeconds: durationSeconds,
    durationFormatted: formatDuration(durationSeconds),
    billable: entry.billable || false,
    startTime: startTime,
    endTime: endTime,
    tags: resolvedTags.join(', '),
    importedAt: formatDateTime(new Date())
  };
}

/**
 * Formats an ISO timestamp to just the time portion (HH:MM)
 * @param {string} isoTimestamp - ISO timestamp
 * @returns {string} Formatted time (HH:MM)
 */
function formatTimeOnly(isoTimestamp) {
  if (!isoTimestamp) return '';
  try {
    const date = new Date(isoTimestamp);
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'HH:mm');
  } catch (e) {
    return '';
  }
}

/**
 * Writes processed entries to the Inbox sheet
 * Uses the new column order:
 * 1: Date, 2: Start Time, 3: End Time, 4: Duration
 * 5: Toggl User, 6: QBO Employee
 * 7: Toggl Client, 8: Toggl Project, 9: QBO Customer, 10: QBO Project
 * 11: Toggl Task, 12: QBO Service Item
 * 13: Description, 14: Billable, 15: Tags, 16: Status, 17: Approved
 * 18: Toggl Entry ID, 19: Validation Errors, 20: Imported At, 21: Notes
 * @param {Object[]} entries - Processed entries
 */
function writeToInbox(entries) {
  const ss = getSpreadsheet();
  const inboxSheet = getOrCreateSheet(CONFIG.SHEETS.INBOX, CONFIG.COLUMNS.INBOX);

  const rows = entries.map(e => [
    e.date,                    // 1: Date
    e.startTime,               // 2: Start Time
    e.endTime,                 // 3: End Time
    e.durationFormatted,       // 4: Duration (h:mm format)
    e.togglUser,               // 5: Toggl User
    '',                        // 6: QBO Employee - to be mapped
    e.togglClient,             // 7: Toggl Client
    e.togglProject,            // 8: Toggl Project
    '',                        // 9: QBO Customer - to be mapped
    '',                        // 10: QBO Project - to be mapped
    e.togglTask,               // 11: Toggl Task
    '',                        // 12: QBO Service Item - to be mapped
    e.description,             // 13: Description
    e.billable,                // 14: Billable
    e.tags,                    // 15: Tags
    'Pending Review',          // 16: Status
    'Pending',                 // 17: Approved (dropdown value)
    e.togglEntryId,            // 18: Toggl Entry ID
    '',                        // 19: Validation Errors
    e.importedAt,              // 20: Imported At
    ''                         // 21: Notes
  ]);

  if (rows.length > 0) {
    const lastRow = inboxSheet.getLastRow();
    inboxSheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);

    // Apply formatting to new rows
    const inboxSheetRef = ss.getSheetByName(CONFIG.SHEETS.INBOX);
    if (inboxSheetRef) {
      // Wire dropdowns and apply formatting for new entries
      wireInboxDropdowns();
    }
  }
}

// ============================================================================
// IMPORT MENU FUNCTIONS
// ============================================================================

/**
 * Imports time entries for all workspace users
 */
function importAllUsersEntries() {
  try {
    importTimeEntries(true);
  } catch (error) {
    showAlert(`Import failed: ${error.message}`, 'Error');
    logMessage(`Import error: ${error.message}`, 'ERROR');
  }
}

/**
 * Imports time entries for current user only
 */
function importCurrentUserEntries() {
  try {
    importTimeEntries(false);
  } catch (error) {
    showAlert(`Import failed: ${error.message}`, 'Error');
    logMessage(`Import error: ${error.message}`, 'ERROR');
  }
}

// ============================================================================
// TAG-BASED SYNC WORKFLOW
// ============================================================================

/**
 * Main sync function: Fetches Toggl entries with "Approved" tag (but not "Synced"),
 * syncs them to QBO, then adds "Synced" tag back to Toggl.
 * @returns {Object} Sync results
 */
function syncApprovedEntries() {
  logMessage('Starting sync of approved entries...', 'INFO');
  showToast('Syncing approved entries to QuickBooks...');

  const approvedTag = getApprovedTagName();
  const syncedTag = getSyncedTagName();

  // Get date range from config
  const dateRange = getImportDateRange();
  logMessage(`Date range: ${dateRange.startDate} to ${dateRange.endDate}`, 'INFO');

  // Fetch all time entries in date range
  const allEntries = fetchTimeEntriesAllUsers(dateRange.startDate, dateRange.endDate);
  logMessage(`Fetched ${allEntries.length} total entries`, 'INFO');

  // Filter for entries with Approved tag but NOT Synced tag
  const entriesToSync = allEntries.filter(entry => {
    const tags = entry.tags || [];
    const hasApproved = tags.some(t => t.toLowerCase() === approvedTag.toLowerCase());
    const hasSynced = tags.some(t => t.toLowerCase() === syncedTag.toLowerCase());
    return hasApproved && !hasSynced;
  });

  logMessage(`Found ${entriesToSync.length} entries with "${approvedTag}" tag (without "${syncedTag}")`, 'INFO');

  if (entriesToSync.length === 0) {
    showToast(`No entries found with "${approvedTag}" tag to sync.`);
    return { synced: 0, failed: 0, skipped: 0 };
  }

  // Build lookups for Toggl data
  const togglLookups = buildTogglLookups();

  // Build mapping lookups for QBO resolution
  const mappings = buildMappingLookups();

  // Process each entry
  const results = {
    synced: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    syncedEntryIds: []
  };

  for (const entry of entriesToSync) {
    try {
      const processed = processTimeEntry(entry, togglLookups);
      const syncResult = syncSingleEntry(processed, mappings);

      if (syncResult.success) {
        results.synced++;
        results.syncedEntryIds.push(processed.togglEntryId);

        // Log to Sync_Log sheet
        logSyncResult(processed, syncResult.qboId, 'Success', '');
      } else {
        results.failed++;
        results.errors.push({ entryId: processed.togglEntryId, error: syncResult.error });

        // Log failure to Sync_Log sheet
        logSyncResult(processed, '', 'Failed', syncResult.error);
      }
    } catch (error) {
      const entryId = entry.id || entry.time_entry_id;
      results.failed++;
      results.errors.push({ entryId, error: error.message });
      logMessage(`Error processing entry ${entryId}: ${error.message}`, 'ERROR');
    }

    // Rate limiting
    Utilities.sleep(100);
  }

  // Add "Synced" tag to successfully synced entries
  if (results.syncedEntryIds.length > 0) {
    logMessage(`Adding "${syncedTag}" tag to ${results.syncedEntryIds.length} entries...`, 'INFO');
    const tagResults = addTagToMultipleEntries(results.syncedEntryIds, syncedTag);
    logMessage(`Tagged ${tagResults.success} entries, ${tagResults.failed} failed`, 'INFO');
  }

  // Update last sync date
  setConfigValue('LAST_SYNC_DATE', formatDateTime(new Date()));

  const message = `Sync complete: ${results.synced} synced, ${results.failed} failed`;
  logMessage(message, 'INFO');
  showAlert(message, 'Sync Complete');

  return results;
}

/**
 * Syncs a single processed entry to QBO
 * @param {Object} entry - Processed time entry
 * @param {Object} mappings - QBO mapping lookups
 * @returns {Object} Result with success status and qboId or error
 */
function syncSingleEntry(entry, mappings) {
  // Resolve QBO mappings
  const qboEmployee = mappings.users[entry.togglUserId];
  const qboProject = mappings.projects[entry.togglProjectId];
  const qboClient = mappings.clients[entry.togglClientId];
  const qboTask = mappings.tasks[entry.togglTaskId];

  // Validate required mappings
  if (!qboEmployee) {
    return { success: false, error: `No QBO employee mapping for Toggl user: ${entry.togglUser}` };
  }

  // Customer comes from Mappings_Clients (via client ID)
  // Note: Projects no longer have customer mapping - they only map to sub-customers
  const customerId = qboClient?.qboCustomerId;
  if (!customerId) {
    return { success: false, error: `No QBO customer mapping for client: ${entry.togglClient || '(no client)'}` };
  }

  // Project (sub-customer) is optional - from Mappings_Projects
  // If set, the sub-customer ID will be used instead of the customer ID for the TimeActivity
  const projectId = qboProject?.qboProjectId || '';

  // Service item from task mapping (required)
  const serviceItemId = qboTask?.qboServiceItemId;
  if (!serviceItemId) {
    return { success: false, error: `No QBO service item mapping for task: ${entry.togglTask || '(no task)'}` };
  }

  // Build time data for QBO
  // Note: If projectId is set (sub-customer), it takes precedence in createTimeActivity
  const timeData = {
    togglEntryId: entry.togglEntryId,
    employeeId: qboEmployee.qboEmployeeId,
    customerId: customerId,            // Top-level customer from Mappings_Clients
    projectId: projectId,              // Sub-customer from Mappings_Projects (optional)
    serviceItemId: serviceItemId,
    date: entry.date,
    hours: entry.durationSeconds / 3600,  // Convert seconds to hours
    description: entry.description,
    billable: entry.billable
  };

  try {
    const activity = createTimeActivity(timeData);
    return { success: true, qboId: activity.Id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Logs a sync result to the Sync_Log sheet
 * @param {Object} entry - Processed entry
 * @param {string} qboId - QBO TimeActivity ID (empty if failed)
 * @param {string} status - Success or Failed
 * @param {string} error - Error message (empty if success)
 */
function logSyncResult(entry, qboId, status, error) {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(CONFIG.SHEETS.SYNC_LOG, CONFIG.COLUMNS.SYNC_LOG);

  const row = [
    formatDateTime(new Date()),  // Synced At
    entry.togglEntryId,          // Toggl Entry ID
    qboId,                       // QBO TimeActivity ID
    entry.date,                  // Date
    entry.durationFormatted,     // Duration
    entry.togglUser,             // Toggl User
    '',                          // QBO Employee (could resolve name)
    entry.togglClient,           // Toggl Client
    entry.togglProject,          // Toggl Project
    '',                          // QBO Customer
    '',                          // QBO Project
    entry.togglTask,             // Toggl Task
    '',                          // QBO Service Item
    entry.description,           // Description
    entry.billable,              // Billable
    status,                      // Status
    error                        // Error
  ];

  sheet.appendRow(row);
}

/**
 * Preview function: Shows entries that would be synced (have Approved but not Synced tag)
 */
function previewApprovedEntries() {
  const approvedTag = getApprovedTagName();
  const syncedTag = getSyncedTagName();
  const dateRange = getImportDateRange();

  showToast('Fetching entries to preview...');

  const allEntries = fetchTimeEntriesAllUsers(dateRange.startDate, dateRange.endDate);

  const entriesToSync = allEntries.filter(entry => {
    const tags = entry.tags || [];
    const hasApproved = tags.some(t => t.toLowerCase() === approvedTag.toLowerCase());
    const hasSynced = tags.some(t => t.toLowerCase() === syncedTag.toLowerCase());
    return hasApproved && !hasSynced;
  });

  if (entriesToSync.length === 0) {
    showAlert(
      `No entries found with "${approvedTag}" tag (and without "${syncedTag}" tag) in the date range ${dateRange.startDate} to ${dateRange.endDate}.\n\n` +
      `To sync entries:\n` +
      `1. In Toggl Track, add the "${approvedTag}" tag to time entries you want to sync\n` +
      `2. Run "Sync Approved Entries" again`,
      'No Entries to Sync'
    );
    return;
  }

  // Build summary
  const togglLookups = buildTogglLookups();
  let summary = `Found ${entriesToSync.length} entries to sync:\n\n`;

  const maxPreview = 10;
  entriesToSync.slice(0, maxPreview).forEach(entry => {
    const userId = entry.user_id || entry.uid;
    const userName = togglLookups.users[userId] || 'Unknown';
    const projectId = entry.project_id || entry.pid;
    const projectName = projectId ? togglLookups.projects[projectId]?.name || 'Unknown' : '(no project)';
    const duration = formatDuration(entry.duration || entry.seconds || 0);
    const date = formatDate(entry.start);

    summary += `• ${date} - ${userName} - ${projectName} (${duration})\n`;
  });

  if (entriesToSync.length > maxPreview) {
    summary += `\n... and ${entriesToSync.length - maxPreview} more entries`;
  }

  summary += `\n\nClick OK to proceed with sync, or Cancel to abort.`;

  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('Preview: Entries to Sync', summary, ui.ButtonSet.OK_CANCEL);

  if (response === ui.Button.OK) {
    syncApprovedEntries();
  }
}
