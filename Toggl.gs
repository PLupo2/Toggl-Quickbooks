/**
 * @fileoverview Toggl Track API client and import logic, supporting time entry retrieval, tag management, and API rate limit tracking.
 * @author pltheatrical2
 */

// ============================================================================
// API RATE LIMITING & CACHING
// ============================================================================

/**
 * In-memory cache for Toggl data within a single execution.
 * Prevents redundant API calls for users, clients, projects, tags, tasks.
 */
const TOGGL_CACHE = {
  users: null,
  clients: null,
  projects: null,
  projectsIncludingArchived: null,
  tags: null,
  tasks: {},  // Keyed by projectId
  allTasks: null,  // All tasks from mapping sheet
  workspaceId: null
};

/**
 * API call counter for rate limiting awareness.
 * Tracks calls made during current execution.
 */
const API_COUNTER = {
  workspaceCalls: 0,
  profileCalls: 0,
  startTime: Date.now()
};

// Default budget (can be overridden in Config)
const DEFAULT_API_BUDGET = 180;  // Conservative limit, leaving buffer for other tools

/**
 * Gets the API call budget from config or default
 * @returns {number} Maximum workspace API calls allowed per execution
 */
function getApiBudget() {
  return parseInt(getConfigValue('TOGGL_API_BUDGET', DEFAULT_API_BUDGET), 10);
}

/**
 * Checks if we're approaching the API limit
 * @param {number} [callsNeeded=1] - Number of calls about to be made
 * @returns {boolean} True if we should stop to avoid hitting limit
 */
function isApproachingApiLimit(callsNeeded = 1) {
  const budget = getApiBudget();
  return (API_COUNTER.workspaceCalls + callsNeeded) > budget;
}

/**
 * Increments the API call counter
 * @param {string} [type='workspace'] - 'workspace' or 'profile'
 */
function incrementApiCounter(type = 'workspace') {
  if (type === 'profile') {
    API_COUNTER.profileCalls++;
  } else {
    API_COUNTER.workspaceCalls++;
  }
}

/**
 * Gets current API usage stats
 * @returns {Object} Current call counts and budget
 */
function getApiUsageStats() {
  const budget = getApiBudget();
  const elapsed = Math.round((Date.now() - API_COUNTER.startTime) / 1000);
  return {
    workspaceCalls: API_COUNTER.workspaceCalls,
    profileCalls: API_COUNTER.profileCalls,
    budget: budget,
    remaining: budget - API_COUNTER.workspaceCalls,
    elapsedSeconds: elapsed
  };
}

/**
 * Shows API usage in a dialog (callable from menu)
 */
function showApiUsage() {
  const stats = getApiUsageStats();

  // Also try to get persisted stats from last sync
  const lastSyncCalls = getConfigValue('LAST_SYNC_API_CALLS', '');
  const lastSyncTime = getConfigValue('LAST_SYNC_DATE', '');

  let message = `Current Execution:\n`;
  message += `  Workspace API calls: ${stats.workspaceCalls} / ${stats.budget}\n`;
  message += `  Profile API calls: ${stats.profileCalls} / 30\n`;
  message += `  Remaining budget: ${stats.remaining}\n`;
  message += `  Elapsed: ${stats.elapsedSeconds}s\n\n`;

  if (lastSyncCalls) {
    message += `Last Sync Operation:\n`;
    message += `  API calls used: ${lastSyncCalls}\n`;
    message += `  Time: ${lastSyncTime}\n`;
  }

  message += `\nNote: Toggl rate limit is 240 workspace requests/hour.\n`;
  message += `Budget is set conservatively to leave room for other tools.\n`;
  message += `Adjust TOGGL_API_BUDGET in Config to change.`;

  showAlert(message, 'Toggl API Usage');
}

/**
 * Clears the in-memory cache (useful for testing or forced refresh)
 */
function clearTogglCache() {
  TOGGL_CACHE.users = null;
  TOGGL_CACHE.clients = null;
  TOGGL_CACHE.projects = null;
  TOGGL_CACHE.projectsIncludingArchived = null;
  TOGGL_CACHE.tags = null;
  TOGGL_CACHE.tasks = {};
  TOGGL_CACHE.allTasks = null;
  TOGGL_CACHE.workspaceId = null;
  logMessage('Toggl cache cleared', 'INFO');
}

/**
 * Diagnostic function to verify Toggl.gs is loaded correctly
 * Run this from Apps Script to test if functions are available
 */
function testTogglFunctions() {
  const functions = [
    'getUsersForMapping',
    'getClientsForMapping',
    'getProjectsForMapping',
    'getTasksForMapping',
    'fetchTogglUsers',
    'fetchTogglClients',
    'fetchTogglProjects'
  ];

  let message = 'Toggl.gs Function Check:\n\n';

  for (const fn of functions) {
    const exists = typeof this[fn] === 'function';
    message += `${fn}: ${exists ? '✓ OK' : '✗ MISSING'}\n`;
  }

  SpreadsheetApp.getUi().alert('Function Check', message, SpreadsheetApp.getUi().ButtonSet.OK);
  return message;
}

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
 * @param {Object} [options.skipBudgetCheck] - Skip budget check for critical calls
 * @returns {Object} Parsed JSON response
 */
function togglApiV9(endpoint, options = {}) {
  // Check API budget before making call (unless explicitly skipped)
  if (!options.skipBudgetCheck && isApproachingApiLimit()) {
    const stats = getApiUsageStats();
    throw new Error(`API budget exhausted (${stats.workspaceCalls}/${stats.budget} calls). ` +
      `Wait for rate limit reset or increase TOGGL_API_BUDGET in Config.`);
  }

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

  // Track API call - profile endpoints use /me, workspace endpoints don't
  const isProfileCall = endpoint.startsWith('/me');
  incrementApiCounter(isProfileCall ? 'profile' : 'workspace');

  logMessage(`Toggl API v9: ${requestOptions.method.toUpperCase()} ${endpoint} [calls: ${API_COUNTER.workspaceCalls}]`, 'INFO');

  const response = UrlFetchApp.fetch(url, requestOptions);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode === 429) {
    logMessage(`Toggl API rate limited! Consider reducing operations.`, 'ERROR');
    throw new Error(`Toggl API rate limited (429). Wait for limit reset.`);
  }

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
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.skipBudgetCheck] - Skip budget check for critical calls
 * @returns {Object} Parsed JSON response
 */
function togglReportsV3(endpoint, payload, options = {}) {
  // Check API budget before making call
  if (!options.skipBudgetCheck && isApproachingApiLimit()) {
    const stats = getApiUsageStats();
    throw new Error(`API budget exhausted (${stats.workspaceCalls}/${stats.budget} calls). ` +
      `Wait for rate limit reset or increase TOGGL_API_BUDGET in Config.`);
  }

  const authHeader = getTogglAuthHeader();
  const workspaceId = getOrFetchWorkspaceId();
  const url = `${TOGGL_REPORTS_V3_BASE}/workspace/${workspaceId}${endpoint}`;

  const requestOptions = {
    method: 'post',
    headers: {
      'Authorization': `Basic ${authHeader}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // Track API call (Reports API = workspace calls)
  incrementApiCounter('workspace');

  logMessage(`Toggl Reports API: POST ${endpoint} [calls: ${API_COUNTER.workspaceCalls}]`, 'INFO');

  const response = UrlFetchApp.fetch(url, requestOptions);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode === 429) {
    logMessage(`Toggl Reports API rate limited!`, 'ERROR');
    throw new Error(`Toggl Reports API rate limited (429). Wait for limit reset.`);
  }

  if (responseCode !== 200) {
    logMessage(`Toggl Reports API Error: ${responseCode} - ${responseBody}`, 'ERROR');
    // Include the actual error message from Toggl for debugging
    let errorDetail = responseBody;
    try {
      const errorJson = JSON.parse(responseBody);
      errorDetail = errorJson.message || errorJson.error || responseBody;
    } catch (e) {
      // Use raw response if not JSON
    }
    throw new Error(`Toggl Reports API Error: ${responseCode} - ${errorDetail}`);
  }

  return JSON.parse(responseBody);
}

// ============================================================================
// DURATION HELPERS
// ============================================================================

/**
 * Extracts duration in seconds from a time entry object
 * Handles multiple API formats:
 * - Track API v9: 'duration' in seconds
 * - Reports API v3: 'seconds' in seconds
 * - Reports API v2 (legacy): 'dur' in milliseconds
 * @param {Object} entry - Time entry object from any Toggl API
 * @returns {number} Duration in seconds
 */
function extractDurationSeconds(entry) {
  if (!entry) return 0;

  // Check for 'seconds' field first (Reports API v3)
  if (typeof entry.seconds === 'number' && entry.seconds >= 0) {
    return entry.seconds;
  }

  // Check for 'duration' field (Track API v9) - in seconds
  if (typeof entry.duration === 'number') {
    // Running timers have negative duration (negative Unix start time)
    if (entry.duration < 0 && entry.start) {
      const start = new Date(entry.start);
      return Math.floor((new Date() - start) / 1000);
    }
    return entry.duration;
  }

  // Check for 'dur' field (Reports API v2 legacy) - in milliseconds
  if (typeof entry.dur === 'number' && entry.dur > 0) {
    return Math.floor(entry.dur / 1000);
  }

  // Try to calculate from start/stop if available
  if (entry.start && entry.stop) {
    const start = new Date(entry.start);
    const stop = new Date(entry.stop);
    const diffMs = stop - start;
    if (diffMs > 0) {
      return Math.floor(diffMs / 1000);
    }
  }

  return 0;
}

// ============================================================================
// TAG OPERATIONS
// ============================================================================

/**
 * Fetches all tags in the workspace (with caching)
 * @param {boolean} [forceRefresh=false] - Force API call even if cached
 * @returns {Object[]} Array of tag objects
 */
function fetchTogglTags(forceRefresh = false) {
  // Return cached if available
  if (!forceRefresh && TOGGL_CACHE.tags !== null) {
    logMessage(`Using cached tags (${TOGGL_CACHE.tags.length} tags)`, 'INFO');
    return TOGGL_CACHE.tags;
  }

  const workspaceId = getOrFetchWorkspaceId();
  logMessage('Fetching Toggl tags...', 'INFO');

  try {
    const tags = togglApiV9(`/workspaces/${workspaceId}/tags`);
    TOGGL_CACHE.tags = tags;  // Cache the result
    logMessage(`Fetched ${tags.length} tags`, 'INFO');
    return tags;
  } catch (error) {
    logMessage(`Error fetching tags: ${error.message}`, 'WARN');
    return TOGGL_CACHE.tags || [];  // Return cache if available, else empty
  }
}

/**
 * Creates a tag in Toggl if it doesn't exist (uses cache)
 * @param {string} tagName - Name of the tag to create
 * @returns {Object} Created or existing tag object
 */
function ensureTagExists(tagName) {
  const workspaceId = getOrFetchWorkspaceId();
  const existingTags = fetchTogglTags();  // Uses cache if available

  const existing = existingTags.find(t => t.name.toLowerCase() === tagName.toLowerCase());
  if (existing) {
    logMessage(`Tag "${tagName}" already exists`, 'INFO');
    return existing;
  }

  logMessage(`Creating tag: ${tagName}`, 'INFO');

  try {
    const tag = togglApiV9(`/workspaces/${workspaceId}/tags`, {
      method: 'post',
      payload: JSON.stringify({ name: tagName })
    });

    // Update cache with new tag
    if (TOGGL_CACHE.tags) {
      TOGGL_CACHE.tags.push(tag);
    }

    return tag;
  } catch (error) {
    logMessage(`Error creating tag: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Adds a tag to a time entry
 * Uses workspace endpoint with tag_action:'add' to work with any user's entries
 * @param {number} entryId - Time entry ID
 * @param {string} tagName - Tag name to add
 * @returns {Object} Updated time entry
 */
function addTagToTimeEntry(entryId, tagName) {
  const workspaceId = getOrFetchWorkspaceId();

  logMessage(`Adding tag "${tagName}" to entry ${entryId}`, 'INFO');

  // Use workspace endpoint with tag_action:'add' to append tag without knowing existing tags
  // This works for any user's entries in the workspace (not just current user)
  const updated = togglApiV9(`/workspaces/${workspaceId}/time_entries/${entryId}`, {
    method: 'put',
    payload: JSON.stringify({
      tags: [tagName],
      tag_action: 'add'
    })
  });

  return updated;
}

/**
 * Adds a tag to multiple time entries using batch API.
 * Uses Toggl's bulk PATCH endpoint to tag up to 100 entries per API call.
 * @param {number[]} entryIds - Array of time entry IDs
 * @param {string} tagName - Tag name to add
 * @returns {Object} Results with success and failure counts
 */
function addTagToMultipleEntries(entryIds, tagName) {
  const workspaceId = getOrFetchWorkspaceId();
  const results = { success: 0, failed: 0, errors: [], apiCalls: 0 };

  if (!entryIds || entryIds.length === 0) {
    return results;
  }

  // Ensure tag exists first (1 API call if tag needs to be created, 0 if cached)
  ensureTagExists(tagName);

  // Toggl bulk endpoint supports up to ~100 IDs per request
  const BATCH_SIZE = 100;

  for (let i = 0; i < entryIds.length; i += BATCH_SIZE) {
    const batch = entryIds.slice(i, i + BATCH_SIZE);
    const idsString = batch.join(',');

    try {
      // Use bulk PATCH endpoint: /workspaces/{id}/time_entries/{id1,id2,id3,...}
      const endpoint = `/workspaces/${workspaceId}/time_entries/${idsString}`;

      togglApiV9(endpoint, {
        method: 'patch',
        payload: JSON.stringify({
          tags: [tagName],
          tag_action: 'add'
        })
      });

      results.success += batch.length;
      results.apiCalls++;
      logMessage(`Batch tagged ${batch.length} entries (batch ${Math.floor(i/BATCH_SIZE) + 1})`, 'INFO');

    } catch (error) {
      // If batch fails, fall back to individual tagging for this batch
      logMessage(`Batch tagging failed, falling back to individual: ${error.message}`, 'WARN');

      for (const entryId of batch) {
        try {
          addTagToTimeEntry(entryId, tagName);
          results.success++;
          results.apiCalls++;
        } catch (innerError) {
          results.failed++;
          results.errors.push({ entryId, error: innerError.message });
          logMessage(`Failed to add tag to entry ${entryId}: ${innerError.message}`, 'WARN');
        }
        Utilities.sleep(100);
      }
    }

    // Small delay between batches
    if (i + BATCH_SIZE < entryIds.length) {
      Utilities.sleep(200);
    }
  }

  logMessage(`Tagging complete: ${results.success} succeeded, ${results.failed} failed, ${results.apiCalls} API calls`, 'INFO');
  return results;
}

// ============================================================================
// WORKSPACE OPERATIONS
// ============================================================================

/**
 * Gets or fetches the workspace ID (with caching)
 * @returns {string} Workspace ID
 */
function getOrFetchWorkspaceId() {
  // Check in-memory cache first
  if (TOGGL_CACHE.workspaceId) {
    return TOGGL_CACHE.workspaceId;
  }

  // Then check script properties
  let workspaceId = getTogglWorkspaceId();

  if (!workspaceId) {
    // Skip budget check for this critical call
    const me = togglApiV9('/me', { skipBudgetCheck: true });
    if (me.default_workspace_id) {
      workspaceId = String(me.default_workspace_id);
      setScriptProperty('TOGGL_WORKSPACE_ID', workspaceId);
      logMessage(`Auto-detected workspace ID: ${workspaceId}`, 'INFO');
    } else {
      throw new Error('Could not determine Toggl workspace ID');
    }
  }

  TOGGL_CACHE.workspaceId = workspaceId;
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
 * Fetches all users in the workspace (with caching)
 * @param {boolean} [activeOnly=true] - Only return active users
 * @param {boolean} [forceRefresh=false] - Force API call even if cached
 * @returns {Object[]} Array of user objects
 */
function fetchTogglUsers(activeOnly = true, forceRefresh = false) {
  // Return cached if available
  if (!forceRefresh && TOGGL_CACHE.users !== null) {
    const filteredUsers = activeOnly
      ? TOGGL_CACHE.users.filter(u => !u.inactive && u.active !== false)
      : TOGGL_CACHE.users;
    logMessage(`Using cached users (${filteredUsers.length} users)`, 'INFO');
    return filteredUsers;
  }

  const workspaceId = getOrFetchWorkspaceId();
  logMessage('Fetching Toggl workspace users...', 'INFO');

  const users = togglApiV9(`/workspaces/${workspaceId}/users`);
  TOGGL_CACHE.users = users;  // Cache all users

  // Filter to active users only if requested
  // Toggl API: inactive field is true for deactivated users
  const filteredUsers = activeOnly
    ? users.filter(u => !u.inactive && u.active !== false)
    : users;

  logMessage(`Fetched ${filteredUsers.length} active users (${users.length} total)`, 'INFO');

  return filteredUsers;
}

/**
 * Gets users for mapping sheet (active users only)
 * @returns {Array[]} Array of [id, name, email] rows
 */
function getUsersForMapping() {
  const users = fetchTogglUsers(true); // Only active users
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
 * Fetches all clients in the workspace (with caching)
 * @param {boolean} [forceRefresh=false] - Force API call even if cached
 * @returns {Object[]} Array of client objects
 */
function fetchTogglClients(forceRefresh = false) {
  // Return cached if available
  if (!forceRefresh && TOGGL_CACHE.clients !== null) {
    logMessage(`Using cached clients (${TOGGL_CACHE.clients.length} clients)`, 'INFO');
    return TOGGL_CACHE.clients;
  }

  const workspaceId = getOrFetchWorkspaceId();
  logMessage('Fetching Toggl clients...', 'INFO');

  const clients = togglApiV9(`/workspaces/${workspaceId}/clients`);
  TOGGL_CACHE.clients = clients;  // Cache the result
  logMessage(`Fetched ${clients.length} clients`, 'INFO');

  return clients;
}

/**
 * Gets clients for mapping sheet with creation date
 * @returns {Array[]} Array of [id, name, createdAt] rows sorted by creation date (newest first)
 */
function getClientsForMapping() {
  const clients = fetchTogglClients();
  return clients
    .filter(c => !c.archived)
    .map(c => [c.id, c.name, c.at || c.created_at || ''])
    .sort((a, b) => {
      // Sort by creation date descending (newest first)
      if (a[2] && b[2]) {
        return new Date(b[2]) - new Date(a[2]);
      }
      // If no date, sort alphabetically
      return a[1].localeCompare(b[1]);
    });
}

// ============================================================================
// PROJECT OPERATIONS
// ============================================================================

/**
 * Fetches all projects in the workspace (with caching)
 * @param {boolean} [activeOnly=true] - Only fetch active projects
 * @param {boolean} [forceRefresh=false] - Force API call even if cached
 * @returns {Object[]} Array of project objects
 */
function fetchTogglProjects(activeOnly = true, forceRefresh = false) {
  const workspaceId = getOrFetchWorkspaceId();

  // Check cache based on what we're requesting
  if (!forceRefresh) {
    if (activeOnly && TOGGL_CACHE.projects !== null) {
      logMessage(`Using cached active projects (${TOGGL_CACHE.projects.length} projects)`, 'INFO');
      return TOGGL_CACHE.projects;
    }
    if (!activeOnly && TOGGL_CACHE.projectsIncludingArchived !== null) {
      logMessage(`Using cached all projects (${TOGGL_CACHE.projectsIncludingArchived.length} projects)`, 'INFO');
      return TOGGL_CACHE.projectsIncludingArchived;
    }
  }

  logMessage('Fetching Toggl projects...', 'INFO');

  if (activeOnly) {
    // Only active projects
    const endpoint = `/workspaces/${workspaceId}/projects?active=true`;
    const projects = togglApiV9(endpoint);
    TOGGL_CACHE.projects = projects;  // Cache active projects
    logMessage(`Fetched ${projects.length} active projects`, 'INFO');
    return projects;
  } else {
    // Fetch BOTH active and archived projects
    // Toggl API requires separate calls for active=true and active=false

    // Use cached active projects if available to save an API call
    let activeProjects;
    if (TOGGL_CACHE.projects !== null) {
      activeProjects = TOGGL_CACHE.projects;
      logMessage(`Using cached active projects`, 'INFO');
    } else {
      const activeEndpoint = `/workspaces/${workspaceId}/projects?active=true`;
      activeProjects = togglApiV9(activeEndpoint);
      TOGGL_CACHE.projects = activeProjects;
    }

    // Try to fetch archived projects (requires paid Toggl plan)
    let archivedProjects = [];
    try {
      const archivedEndpoint = `/workspaces/${workspaceId}/projects?active=false`;
      archivedProjects = togglApiV9(archivedEndpoint);
    } catch (e) {
      // 402 = Payment Required - archived projects need paid plan
      if (e.message.includes('402')) {
        logMessage('Archived projects require paid Toggl plan - using active projects only', 'WARN');
      } else if (e.message.includes('budget exhausted')) {
        logMessage('API budget exhausted fetching archived projects - using active only', 'WARN');
      } else {
        logMessage(`Could not fetch archived projects: ${e.message}`, 'WARN');
      }
    }

    const allProjects = [...activeProjects, ...archivedProjects];
    TOGGL_CACHE.projectsIncludingArchived = allProjects;  // Cache all projects
    logMessage(`Fetched ${allProjects.length} projects (${activeProjects.length} active, ${archivedProjects.length} archived)`, 'INFO');
    return allProjects;
  }
}

/**
 * Gets projects for mapping sheet with client info and creation date
 * @returns {Array[]} Array of [id, name, clientName, clientId, createdAt] rows sorted by creation date (newest first)
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
    p.client_id ? clientMap[p.client_id] || '' : '',
    p.client_id || '',
    p.at || p.created_at || ''
  ]).sort((a, b) => {
    // Sort by creation date descending (newest first)
    if (a[4] && b[4]) {
      return new Date(b[4]) - new Date(a[4]);
    }
    // If no date, sort alphabetically
    return a[1].localeCompare(b[1]);
  });
}

// ============================================================================
// TASK OPERATIONS
// ============================================================================

/**
 * Fetches all tasks for a project (with caching)
 * @param {number} projectId - Project ID
 * @param {boolean} [forceRefresh=false] - Force API call even if cached
 * @returns {Object[]} Array of task objects
 */
function fetchTogglTasksForProject(projectId, forceRefresh = false) {
  // Check cache first
  if (!forceRefresh && TOGGL_CACHE.tasks[projectId] !== undefined) {
    return TOGGL_CACHE.tasks[projectId];
  }

  const workspaceId = getOrFetchWorkspaceId();
  const tasks = togglApiV9(`/workspaces/${workspaceId}/projects/${projectId}/tasks`);
  TOGGL_CACHE.tasks[projectId] = tasks;  // Cache the result
  return tasks;
}

/**
 * Fetches all tasks across all active projects
 * @returns {Object[]} Array of task objects with project context
 */
function fetchAllTogglTasks() {
  logMessage('Fetching all Toggl tasks...', 'INFO');

  const projects = fetchTogglProjects(true); // Only active projects
  const clients = fetchTogglClients();

  // Budget check: fetching tasks requires 1 API call per project
  if (isApproachingApiLimit(projects.length)) {
    logMessage(`fetchAllTogglTasks: need ${projects.length} calls but only ${getApiBudget() - API_COUNTER.workspaceCalls} remaining. Using mapping sheet instead.`, 'WARN');
    // Fall back to mapping sheet data instead of making expensive API calls
    const sheetTasks = getTasksFromMappingSheet();
    return sheetTasks.map(t => ({
      id: t.togglTaskId,
      name: t.togglTaskName,
      projectId: null,
      projectName: t.projectName || '',
      clientName: t.clientName || ''
    }));
  }

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
 * The Reports API returns grouped rows where each row may contain multiple time_entries.
 * This function flattens them into individual entries for easier processing.
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Object[]} Array of flattened time entry objects
 */
function fetchTimeEntriesAllUsers(startDate, endDate) {
  logMessage(`Fetching time entries for all users: ${startDate} to ${endDate}`, 'INFO');

  const allRows = [];
  let hasMore = true;
  let firstRowNumber = 1;
  const pageSize = 50;

  while (hasMore) {
    // Don't include user_ids at all to get all users
    // The API interprets omitted user_ids as "all users"
    const payload = {
      start_date: startDate,
      end_date: endDate,
      first_row_number: firstRowNumber,
      page_size: pageSize
    };

    const response = togglReportsV3('/search/time_entries', payload);

    if (response && Array.isArray(response)) {
      allRows.push(...response);
      hasMore = response.length === pageSize;
      firstRowNumber += response.length;
    } else {
      hasMore = false;
    }

    // Rate limiting protection
    Utilities.sleep(100);
  }

  // Flatten grouped entries: Reports API v3 returns rows with nested time_entries array
  // Each row contains: user_id, project_id, task_id, tag_ids, description, billable, time_entries[]
  // Each time_entry contains: id, start, stop, seconds (or duration), at
  const flattenedEntries = [];

  for (const row of allRows) {
    // Check if this row has nested time_entries (grouped format)
    if (row.time_entries && Array.isArray(row.time_entries)) {
      // Flatten: create one entry per time_entry, copying row-level fields
      for (const te of row.time_entries) {
        // Extract duration - Reports API v3 may use 'seconds', v2 used 'dur' (milliseconds)
        // Track API v9 uses 'duration' (seconds)
        const durationSeconds = extractDurationSeconds(te);

        flattenedEntries.push({
          // From the individual time entry
          id: te.id,
          start: te.start,
          stop: te.stop,
          seconds: durationSeconds,
          at: te.at,
          // From the row (shared across grouped entries)
          user_id: row.user_id,
          project_id: row.project_id,
          task_id: row.task_id,
          tag_ids: row.tag_ids || [],
          description: row.description || '',
          billable: row.billable || false
        });
      }
    } else {
      // Already flat format (or v9 API format) - use as-is
      // Normalize duration to 'seconds' field for consistency
      if (!row.seconds && (row.duration || row.dur)) {
        row.seconds = extractDurationSeconds(row);
      }
      flattenedEntries.push(row);
    }
  }

  logMessage(`Fetched ${allRows.length} rows, flattened to ${flattenedEntries.length} individual time entries`, 'INFO');
  return flattenedEntries;
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
 * Builds lookup maps for Toggl entities.
 * Uses caching and can optionally read tasks from the mapping sheet to save API calls.
 * @param {Object} [options] - Options
 * @param {boolean} [options.useSheetForTasks=true] - Read tasks from Mappings_Tasks sheet instead of API
 * @returns {Object} Lookup maps for users, clients, projects, tasks, tags
 */
function buildTogglLookups(options = {}) {
  const useSheetForTasks = options.useSheetForTasks !== false;  // Default true

  // These will use cache if available (no extra API calls on repeated use)
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

  // Get tasks - either from mapping sheet (0 API calls) or from API (P calls)
  if (useSheetForTasks) {
    // Read tasks from the Mappings_Tasks_Services sheet - saves P API calls!
    const taskMappings = getTasksFromMappingSheet();
    taskMappings.forEach(t => {
      if (t.togglTaskId) {
        lookups.tasks[t.togglTaskId] = t.togglTaskName;
      }
    });
    logMessage(`Loaded ${taskMappings.length} tasks from mapping sheet (0 API calls)`, 'INFO');
  } else {
    // Fetch tasks from API for each project (expensive - P API calls)
    logMessage(`Fetching tasks from API for ${projects.length} projects...`, 'INFO');
    projects.forEach(p => {
      try {
        const tasks = fetchTogglTasksForProject(p.id);
        tasks.forEach(t => {
          lookups.tasks[t.id] = t.name;
        });
      } catch (e) {
        // Ignore errors for individual projects (could be budget exhausted)
        if (e.message.includes('budget exhausted')) {
          logMessage('API budget exhausted while fetching tasks', 'WARN');
          return; // Stop the loop
        }
      }
      Utilities.sleep(25);
    });
  }

  return lookups;
}

/**
 * Reads task data from the Mappings_Tasks_Services sheet.
 * Used as an alternative to fetching from API to save API calls.
 * @returns {Object[]} Array of {togglTaskId, togglTaskName, projectName, clientName}
 */
function getTasksFromMappingSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_TASKS);

  if (!sheet || sheet.getLastRow() <= 1) {
    return [];
  }

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();

  return data
    .filter(row => row[0])  // Has Toggl Task ID
    .map(row => ({
      togglTaskId: row[0],
      togglTaskName: row[1] || '',
      projectName: row[2] || '',
      clientName: row[3] || ''
    }));
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

  // Duration handling - use helper that handles multiple API formats
  const durationSeconds = extractDurationSeconds(entry);

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
 *
 * Features:
 * - Uses in-memory cache to reduce API calls
 * - Reads tasks from mapping sheet instead of API
 * - Uses batch tagging (1 API call per 100 entries)
 * - Can pause and auto-resume if API budget is exhausted
 *
 * @param {Object} [options] - Optional settings
 * @param {boolean} [options.fromWebApi] - If true, skip UI prompts (for web API calls)
 * @returns {Object} Sync results
 */
function syncApprovedEntries(options = {}) {
  logMessage('Starting sync of approved entries...', 'INFO');
  logMessage(`API budget: ${getApiBudget()} calls`, 'INFO');

  // Check for pending sync and offer to resume
  if (hasPendingSync()) {
    if (options.fromWebApi) {
      // From web API: auto-clear pending state and start fresh
      logMessage('Pending sync found, starting fresh (web API mode)', 'INFO');
      clearSyncState();
    } else {
      // From spreadsheet UI: prompt user
      try {
        const ui = SpreadsheetApp.getUi();
        const response = ui.alert(
          'Pending Sync Found',
          'There is a pending sync operation that was paused.\n\n' +
          'Would you like to resume it?\n' +
          '(Click No to start a fresh sync)',
          ui.ButtonSet.YES_NO
        );

        if (response === ui.Button.YES) {
          resumePendingSync();
          return;
        } else {
          clearSyncState();
        }
      } catch (e) {
        // UI not available, start fresh
        logMessage('UI not available, starting fresh sync', 'INFO');
        clearSyncState();
      }
    }
  }

  showToast('Syncing approved entries to QuickBooks...');

  const approvedTag = getApprovedTagName();
  const syncedTag = getSyncedTagName();

  // Get date range from config
  const dateRange = getImportDateRange();
  logMessage(`Date range: ${dateRange.startDate} to ${dateRange.endDate}`, 'INFO');

  // Build tag lookup to convert tag IDs to names (uses cache)
  const tags = fetchTogglTags();
  const tagLookup = {};
  tags.forEach(t => {
    tagLookup[t.id] = t.name;
  });

  // Fetch all time entries in date range
  const allEntries = fetchTimeEntriesAllUsers(dateRange.startDate, dateRange.endDate);
  logMessage(`Fetched ${allEntries.length} total entries`, 'INFO');

  // D1: candidate selection is Approved-tag alone. The Synced tag is no
  // longer an exclusion filter here — an entry that's actually already
  // synced now gets caught (and reported) by the Sync_Log guard below,
  // not silently dropped from the candidate list by a tag that may be
  // stale, missing, or (per D4) deliberately not the reason to skip.
  const entriesToSync = allEntries.filter(entry => {
    const entryTags = resolveEntryTags(entry, tagLookup);
    return entryTags.some(t => t.toLowerCase() === approvedTag.toLowerCase());
  });

  logMessage(`Found ${entriesToSync.length} entries with "${approvedTag}" tag`, 'INFO');

  if (entriesToSync.length === 0) {
    const stats = getApiUsageStats();
    showToast(`No entries found with "${approvedTag}" tag to sync. (Used ${stats.workspaceCalls} API calls)`);
    return { synced: 0, failed: 0, alreadySynced: 0 };
  }

  // Build lookups for Toggl data (uses cache, reads tasks from sheet)
  const togglLookups = buildTogglLookups({ useSheetForTasks: true });

  // Build mapping lookups for QBO resolution
  const mappings = buildMappingLookups();

  // D2: rebuilt at sync start, never inherited from a preview. Updated
  // in-memory below as the run writes, so this run cannot double-write
  // against its own output.
  const alreadySyncedMap = buildAlreadySyncedMap();
  const forceEntryIds = parseForceEntryIds(options.forceEntryIds);
  if (forceEntryIds.size > 0) {
    logMessage(`Override requested for ${forceEntryIds.size} entries: ${Array.from(forceEntryIds).join(', ')}`, 'WARN');
  }

  // Process each entry
  const results = {
    synced: 0,
    failed: 0,
    alreadySynced: 0,
    errors: [],
    syncedEntryIds: []
  };

  const pendingEntryIds = [];
  const untaggedSyncedIds = []; // synced-but-not-yet-tagged (D1a: flushed incrementally, not just at the end)

  for (const entry of entriesToSync) {
    const entryId = entry.id || entry.time_entry_id;

    try {
      const processed = processTimeEntry(entry, togglLookups);
      const existing = alreadySyncedMap.get(String(processed.togglEntryId));
      const isOverride = forceEntryIds.has(String(processed.togglEntryId));

      // D3: a detected duplicate skips that one entry and is reported, never
      // halts the run. This check is local (Sync_Log already loaded above)
      // and happens before any Toggl/QBO call, so a skip costs nothing
      // against the API budget.
      if (existing && !isOverride) {
        results.alreadySynced++;
        logSyncResult(processed, existing.qboId || '', 'Already synced', '');
        continue;
      }

      if (isOverride) {
        // existing may be undefined here — an override is valid even for an
        // entry that was never actually a duplicate (operator being
        // defensive); only mention a prior record if one actually exists.
        const priorNote = existing ? ` (previous Success record: QBO TimeActivity ${existing.qboId})` : ' (no prior Success record found — not actually a duplicate)';
        logMessage(`OVERRIDE: forcing re-sync of entry ${processed.togglEntryId}${priorNote}`, 'WARN');
      }

      // Budget check only applies here — an already-synced skip above never
      // reaches a Toggl or QBO call, so it shouldn't count against the
      // reserve that gates real writes.
      if (isApproachingApiLimit(5)) {
        pendingEntryIds.push(entryId);
        logMessage(`API budget low, deferring entry ${entryId}`, 'WARN');
        continue;
      }

      const syncResult = syncSingleEntry(processed, mappings);

      if (syncResult.success) {
        results.synced++;
        results.syncedEntryIds.push(processed.togglEntryId);
        untaggedSyncedIds.push(processed.togglEntryId);
        alreadySyncedMap.set(String(processed.togglEntryId), { qboId: syncResult.qboId }); // D2: in-memory update

        logSyncResult(
          processed, syncResult.qboId, 'Success',
          isOverride ? `Override: forced re-sync${existing ? ` (previous QBO TimeActivity ${existing.qboId})` : ''}` : ''
        );

        // D1(a): incremental tag flush — don't wait for the whole run to finish.
        maybeFlushSyncedTags(untaggedSyncedIds, syncedTag, false);
      } else {
        results.failed++;
        results.errors.push({ entryId: processed.togglEntryId, error: syncResult.error });
        logSyncResult(processed, '', 'Failed', syncResult.error);
      }
    } catch (error) {
      // Check if it's a budget exhaustion error
      if (error.message.includes('budget exhausted') || error.message.includes('rate limited')) {
        pendingEntryIds.push(entryId);
        logMessage(`API limit reached, deferring entry ${entryId}`, 'WARN');
      } else {
        results.failed++;
        results.errors.push({ entryId, error: error.message });
        logMessage(`Error processing entry ${entryId}: ${error.message}`, 'ERROR');
      }
    }

    // Delay between QBO calls to avoid bandwidth quota
    Utilities.sleep(250);
  }

  // Check if we need to pause and resume later
  if (pendingEntryIds.length > 0) {
    // D1(a): tag before this path returns — this used to be the exact gap
    // that let a paused run leave real syncs untagged indefinitely.
    maybeFlushSyncedTags(untaggedSyncedIds, syncedTag, true);

    const state = {
      pendingEntryIds,
      syncedEntryIds: results.syncedEntryIds,
      totalSynced: results.synced,
      totalFailed: results.failed,
      totalAlreadySynced: results.alreadySynced,
      pausedAt: formatDateTime(new Date())
    };
    saveSyncState(state);
    scheduleResume(65);

    const stats = getApiUsageStats();
    setConfigValue('LAST_SYNC_API_CALLS', stats.workspaceCalls);

    const message = `Sync paused: ${results.synced} synced, ${results.failed} failed, ` +
      `${results.alreadySynced} already synced, ${pendingEntryIds.length} pending.\n\n` +
      `Will auto-resume in ~65 minutes when rate limit resets.\n` +
      `API calls used: ${stats.workspaceCalls}`;
    logMessage(message, 'INFO');
    if (!options.fromWebApi) {
      showAlert(message, 'Sync Paused');
    }

    return results;
  }

  // All entries processed - flush any remaining untagged synced entries
  maybeFlushSyncedTags(untaggedSyncedIds, syncedTag, true);

  // Save API usage stats
  const stats = getApiUsageStats();
  setConfigValue('LAST_SYNC_API_CALLS', stats.workspaceCalls);
  setConfigValue('LAST_SYNC_DATE', formatDateTime(new Date()));

  const message = `Sync complete: ${results.synced} synced, ${results.failed} failed, ` +
    `${results.alreadySynced} already synced\n` +
    `API calls used: ${stats.workspaceCalls} / ${stats.budget}`;
  logMessage(message, 'INFO');
  if (!options.fromWebApi) {
    showAlert(message, 'Sync Complete');
  }

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

  // Service item from task mapping, or fall back to default
  let serviceItemId = qboTask?.qboServiceItemId;

  // If no task mapping, use default service item from config
  if (!serviceItemId) {
    const defaultServiceItemId = getConfigValue('DEFAULT_SERVICE_ITEM_ID', '');
    if (defaultServiceItemId) {
      serviceItemId = defaultServiceItemId;
      logMessage(`Using default service item for entry without task: ${entry.togglEntryId}`, 'INFO');
    } else {
      return {
        success: false,
        error: `No QBO service item mapping for task: ${entry.togglTask || '(no task)'}. ` +
               `Set DEFAULT_SERVICE_ITEM_ID in Config sheet to use a default.`
      };
    }
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
    description: `${entry.togglUser}: ${entry.description || ''}`.trim(),
    billable: entry.billable
  };

  try {
    const activity = createTimeActivity(timeData);
    return { success: true, qboId: activity.Id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// IDEMPOTENCY GUARD (2026-08-05 design, spec doc "IDEMPOTENCY GUARD +
// ASYNC SYNC" section, D1-D4 — D5 async is a separate, later delivery)
// ============================================================================

/**
 * D1: Sync_Log is the sole authority for "already synced." The Toggl
 * 'Synced' tag is no longer consulted as a guard — it is retained purely as
 * Philip's Toggl Reports review surface (see maybeFlushSyncedTags and
 * getTagLogDisagreementCount for the reliability half of that decision).
 *
 * D2: callers must rebuild this at sync start (never inherit a preview's
 * snapshot) and update it in-memory as the run writes, so a single run
 * cannot double-write against its own output.
 *
 * @returns {Map<string, {qboId: string}>} Toggl Entry ID (string) -> last known QBO TimeActivity ID
 */
function buildAlreadySyncedMap() {
  const map = new Map();
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.SYNC_LOG);
  if (!sheet || sheet.getLastRow() <= 1) return map;

  const headers = CONFIG.COLUMNS.SYNC_LOG;
  const entryIdCol = headers.indexOf('Toggl Entry ID');
  const qboIdCol = headers.indexOf('QBO TimeActivity ID');
  const statusCol = headers.indexOf('Status');

  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  data.forEach(row => {
    if (row[statusCol] === 'Success') {
      const entryId = row[entryIdCol];
      if (entryId !== '' && entryId !== null && entryId !== undefined) {
        map.set(String(entryId), { qboId: row[qboIdCol] });
      }
    }
  });

  return map;
}

/**
 * D4: normalizes a per-entry override list into a Set of string Toggl Entry
 * IDs. No global bypass flag exists — this is the only escape hatch, and it
 * is per-entry and logged (see the override branch in the sync loops).
 * Accepts a real array (JSON POST body) or a comma-separated string (form
 * field / query param), since doPost's e.parameter values are always
 * strings but its parsed JSON body can carry a real array.
 * @param {Array|string|undefined} raw
 * @returns {Set<string>}
 */
function parseForceEntryIds(raw) {
  if (!raw) return new Set();
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  return new Set(list.map(id => String(id).trim()).filter(id => id !== ''));
}

/**
 * D1(a): tagging must be reliable now that it's informational-only — a
 * missed tag can no longer cause a double-write, but it can mislead Philip's
 * review. Flushes the queue via the 100-id bulk endpoint either once it's
 * accumulated a full batch (incremental, during the run) or unconditionally
 * when force=true (used at every early-return point, not just the terminal
 * batch). Mutates untaggedIds in place (drains what it sends).
 * @param {Array<string|number>} untaggedIds - synced-but-not-yet-tagged Toggl Entry IDs, mutated in place
 * @param {string} syncedTag
 * @param {boolean} force - flush even if under 100
 */
function maybeFlushSyncedTags(untaggedIds, syncedTag, force) {
  if (untaggedIds.length === 0) return;
  if (!force && untaggedIds.length < 100) return;

  const batch = untaggedIds.splice(0, untaggedIds.length);
  logMessage(`Tagging ${batch.length} entries with "${syncedTag}"...`, 'INFO');
  const tagResults = addTagToMultipleEntries(batch, syncedTag);
  logMessage(`Tagged ${tagResults.success} entries with ${tagResults.apiCalls} API calls`, 'INFO');
}

/**
 * D1(b): surfaces divergence between Sync_Log (the guard, source of truth)
 * and the Toggl 'Synced' tag (Philip's review surface) — silent divergence
 * between the two is exactly how the 2026-05-27 to 2026-08-05 duplication
 * went unseen. Scoped to the configured import date range, same as every
 * other Toggl-fetching feature in this app (not an all-time scan).
 *
 * Costs one Toggl Reports fetch (same shape/cost as previewApproved) — not
 * free, so this only runs if the budget can absorb it, and never throws:
 * a failed or skipped check degrades the dashboard's disagreement count to
 * "unavailable," it never breaks the dashboard load itself.
 *
 * @returns {{count: number, missingTag: number, missingLog: number, checked: number, skipped: boolean, reason: string|null}}
 */
function getTagLogDisagreementCount() {
  if (isApproachingApiLimit(5)) {
    return { count: 0, missingTag: 0, missingLog: 0, checked: 0, skipped: true, reason: 'API budget too low to check this execution' };
  }

  try {
    const syncedTag = getSyncedTagName();
    const dateRange = getImportDateRange();

    const tags = fetchTogglTags();
    const tagLookup = {};
    tags.forEach(t => { tagLookup[t.id] = t.name; });

    const allEntries = fetchTimeEntriesAllUsers(dateRange.startDate, dateRange.endDate);
    const alreadySyncedMap = buildAlreadySyncedMap();

    let missingTag = 0; // Sync_Log says Success, Toggl entry isn't tagged Synced (the reliability gap D1a targets)
    let missingLog = 0; // Toggl entry tagged Synced, but Sync_Log has no Success row for it

    allEntries.forEach(entry => {
      const entryId = String(entry.id || entry.time_entry_id);
      const entryTags = resolveEntryTags(entry, tagLookup);
      const hasSyncedTag = entryTags.some(t => t.toLowerCase() === syncedTag.toLowerCase());
      const hasLogSuccess = alreadySyncedMap.has(entryId);

      if (hasLogSuccess && !hasSyncedTag) missingTag++;
      if (hasSyncedTag && !hasLogSuccess) missingLog++;
    });

    return {
      count: missingTag + missingLog,
      missingTag,
      missingLog,
      checked: allEntries.length,
      skipped: false,
      reason: null
    };
  } catch (e) {
    logMessage(`Tag/log disagreement check failed: ${e.message}`, 'WARN');
    return { count: 0, missingTag: 0, missingLog: 0, checked: 0, skipped: true, reason: e.message };
  }
}

/**
 * Logs a sync result to the Sync_Log sheet
 * @param {Object} entry - Processed entry
 * @param {string} qboId - QBO TimeActivity ID (empty if failed, or the prior run's ID for an 'Already synced' skip)
 * @param {string} status - 'Success', 'Failed', or 'Already synced' (D3 — distinct from both)
 * @param {string} error - Error message, or an override annotation for a forced re-sync (empty otherwise)
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
 * Resolves tag names from an entry (handles both tag_ids and tags fields)
 * @param {Object} entry - Time entry from Toggl API
 * @param {Object} tagLookup - Tag ID -> name lookup map
 * @returns {string[]} Array of tag names
 */
function resolveEntryTags(entry, tagLookup) {
  // Reports API uses tag_ids (array of IDs), v9 API uses tags (array of names)
  const rawTags = entry.tag_ids || entry.tags || [];

  return rawTags.map(tag => {
    if (typeof tag === 'number') {
      // It's a tag ID, look it up
      return tagLookup[tag] || String(tag);
    } else if (typeof tag === 'string') {
      // It's already a tag name
      return tag;
    }
    return String(tag);
  });
}

/**
 * Preview function: Shows entries that would be synced (have Approved but not Synced tag)
 */
function previewApprovedEntries() {
  const approvedTag = getApprovedTagName();
  const syncedTag = getSyncedTagName();
  const dateRange = getImportDateRange();

  showToast('Fetching entries to preview...');

  // Build tag lookup to convert tag IDs to names
  const tags = fetchTogglTags();
  const tagLookup = {};
  tags.forEach(t => {
    tagLookup[t.id] = t.name;
  });

  const allEntries = fetchTimeEntriesAllUsers(dateRange.startDate, dateRange.endDate);

  logMessage(`Fetched ${allEntries.length} total entries, checking for "${approvedTag}" tag...`, 'INFO');

  // D1: Approved-tag alone — the Synced tag no longer excludes an entry from
  // the candidate list. D2: split the candidates by the Sync_Log guard so
  // the operator sees the already-synced count before committing.
  const approvedEntries = allEntries.filter(entry => {
    const entryTags = resolveEntryTags(entry, tagLookup);
    return entryTags.some(t => t.toLowerCase() === approvedTag.toLowerCase());
  });

  if (approvedEntries.length === 0) {
    // Debug: show what tags were found in first few entries
    let debugInfo = '';
    if (allEntries.length > 0) {
      const sampleEntries = allEntries.slice(0, 3);
      debugInfo = '\n\nDebug - Sample entry tags found:\n';
      sampleEntries.forEach((e, i) => {
        const tags = resolveEntryTags(e, tagLookup);
        debugInfo += `Entry ${i+1}: [${tags.join(', ')}]\n`;
      });
    }

    showAlert(
      `No entries found with "${approvedTag}" tag in the date range ${dateRange.startDate} to ${dateRange.endDate}.\n\n` +
      `Found ${allEntries.length} total entries in this date range.\n\n` +
      `To sync entries:\n` +
      `1. In Toggl Track, add the "${approvedTag}" tag to time entries you want to sync\n` +
      `2. Run "Sync Approved Entries" again` +
      debugInfo,
      'No Entries to Sync'
    );
    return;
  }

  const alreadySyncedMap = buildAlreadySyncedMap();
  const entriesToSync = approvedEntries.filter(entry => {
    const entryId = entry.id || entry.time_entry_id;
    return !alreadySyncedMap.has(String(entryId));
  });
  const alreadySyncedCount = approvedEntries.length - entriesToSync.length;

  if (entriesToSync.length === 0) {
    showAlert(
      `${approvedEntries.length} entries have the "${approvedTag}" tag, but all ${alreadySyncedCount} are already synced ` +
      `(Sync_Log has a Success record for each). Nothing to sync.\n\n` +
      `Date range: ${dateRange.startDate} to ${dateRange.endDate}`,
      'No Entries to Sync'
    );
    return;
  }

  // Build summary
  const togglLookups = buildTogglLookups();
  let summary = `${approvedEntries.length} approved, ${alreadySyncedCount} already synced, ${entriesToSync.length} will be written:\n\n`;

  const maxPreview = 10;
  entriesToSync.slice(0, maxPreview).forEach(entry => {
    const userId = entry.user_id || entry.uid;
    const userName = togglLookups.users[userId] || 'Unknown';
    const projectId = entry.project_id || entry.pid;
    const projectName = projectId ? togglLookups.projects[projectId]?.name || 'Unknown' : '(no project)';
    const durationSecs = extractDurationSeconds(entry);
    const duration = formatDuration(durationSecs);
    const date = entry.start ? formatDate(entry.start) : '(no date)';

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

// ============================================================================
// SYNC PAUSE/RESUME INFRASTRUCTURE
// ============================================================================

/**
 * Saves sync state for later resumption.
 * Called when API budget is exhausted mid-sync.
 * @param {Object} state - State to save
 */
function saveSyncState(state) {
  const stateJson = JSON.stringify(state);
  setScriptProperty('SYNC_PENDING_STATE', stateJson);
  setConfigValue('SYNC_STATUS', 'Paused - waiting for rate limit reset');
  logMessage(`Saved sync state: ${state.pendingEntryIds.length} entries pending, ${state.syncedEntryIds.length} synced`, 'INFO');
}

/**
 * Loads saved sync state.
 * @returns {Object|null} Saved state or null if none
 */
function loadSyncState() {
  const stateJson = getScriptProperty('SYNC_PENDING_STATE');
  if (!stateJson) return null;

  try {
    return JSON.parse(stateJson);
  } catch (e) {
    logMessage(`Error parsing sync state: ${e.message}`, 'WARN');
    return null;
  }
}

/**
 * Clears saved sync state.
 */
function clearSyncState() {
  deleteScriptProperty('SYNC_PENDING_STATE');
  setConfigValue('SYNC_STATUS', '');
  logMessage('Cleared sync state', 'INFO');
}

/**
 * Checks if there's a pending sync to resume.
 * @returns {boolean} True if there's a pending sync
 */
function hasPendingSync() {
  return !!getScriptProperty('SYNC_PENDING_STATE');
}

/**
 * Shows sync status including any pending operations.
 */
function showSyncState() {
  const state = loadSyncState();
  const apiStats = getApiUsageStats();

  let message = `API Usage (this execution):\n`;
  message += `  Workspace calls: ${apiStats.workspaceCalls} / ${apiStats.budget}\n`;
  message += `  Remaining: ${apiStats.remaining}\n\n`;

  if (state) {
    message += `Pending Sync Operation:\n`;
    message += `  Entries to sync: ${state.pendingEntryIds?.length || 0}\n`;
    message += `  Already synced: ${state.syncedEntryIds?.length || 0}\n`;
    message += `  Paused at: ${state.pausedAt || 'Unknown'}\n\n`;
    message += `Run "Resume Pending Sync" to continue when rate limit resets.`;
  } else {
    message += `No pending sync operations.`;
  }

  showAlert(message, 'Sync State');
}

/**
 * Creates a time-based trigger to resume sync after rate limit reset.
 * @param {number} [delayMinutes=65] - Minutes until trigger fires (default 65 for hourly reset + buffer)
 */
function scheduleResume(delayMinutes = 65) {
  // Remove any existing resume triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'resumePendingSync') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create new trigger
  const triggerTime = new Date(Date.now() + delayMinutes * 60 * 1000);
  ScriptApp.newTrigger('resumePendingSync')
    .timeBased()
    .at(triggerTime)
    .create();

  logMessage(`Scheduled resume for ${triggerTime.toLocaleString()} (${delayMinutes} minutes)`, 'INFO');
  showToast(`Sync paused. Will auto-resume in ${delayMinutes} minutes.`);
}

/**
 * Resumes a pending sync operation.
 * Can be called manually or by a time-based trigger.
 */
function resumePendingSync() {
  const state = loadSyncState();

  if (!state) {
    logMessage('No pending sync to resume', 'INFO');
    showToast('No pending sync to resume.');
    return;
  }

  logMessage(`Resuming sync: ${state.pendingEntryIds?.length || 0} entries pending`, 'INFO');
  showToast('Resuming sync operation...');

  try {
    // Continue syncing the pending entries
    const result = syncApprovedEntriesWithState(state);

    if (result.completed) {
      clearSyncState();

      // D5: only touch job-meta if this pause was a tracked web job (a
      // Sheet-menu-initiated pause has no corresponding SYNC_JOB_META) —
      // this may be resuming across one or several prior pause cycles.
      const meta = getSyncJobMeta();
      if (meta && meta.status === 'paused') {
        saveSyncJobMeta({
          ...meta,
          status: 'completed',
          completedAt: formatDateTime(new Date()),
          totalSynced: result.totalSynced,
          totalFailed: result.totalFailed,
          totalAlreadySynced: result.totalAlreadySynced
        });
      }

      showAlert(
        `Sync resumed and completed!\n\n` +
        `Total synced: ${result.totalSynced}\n` +
        `Failed: ${result.totalFailed}\n` +
        `API calls used: ${API_COUNTER.workspaceCalls}`,
        'Sync Complete'
      );
    }
    // If not completed, syncApprovedEntriesWithState will have saved state and scheduled another resume
  } catch (error) {
    logMessage(`Error resuming sync: ${error.message}`, 'ERROR');

    const meta = getSyncJobMeta();
    if (meta && meta.status === 'paused') {
      saveSyncJobMeta({ ...meta, status: 'failed', completedAt: formatDateTime(new Date()), error: error.message });
    }

    showAlert(`Error resuming sync: ${error.message}`, 'Resume Error');
  }
}

/**
 * Cancels a pending sync and clears the state.
 */
function cancelPendingSync() {
  if (!hasPendingSync()) {
    showToast('No pending sync to cancel.');
    return;
  }

  // Remove resume triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'resumePendingSync') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // D5: only touch job-meta if this pause was a tracked web job (a
  // Sheet-menu-initiated pause has no corresponding SYNC_JOB_META).
  const meta = getSyncJobMeta();
  if (meta && meta.status === 'paused') {
    saveSyncJobMeta({ ...meta, status: 'failed', completedAt: formatDateTime(new Date()), error: 'Cancelled by operator' });
  }

  clearSyncState();
  showToast('Pending sync cancelled.');
}

// ============================================================================
// ASYNC SYNC (D5, spec doc "IDEMPOTENCY GUARD + ASYNC SYNC" section)
// ============================================================================
//
// Cloudflare abandons the edge request at ~100s while Apps Script keeps
// running, so a long syncApproved call presents to the browser as a failed
// (524) request even when the run actually succeeded -- the direct cause
// of every duplication episode in this system's history. The fix: the web
// path no longer runs the sync inline. It starts a job (a one-off trigger,
// firing almost immediately, detached from the HTTP request) and returns a
// jobId right away; the frontend polls for status.
//
// This builds on the EXISTING pause/resume machinery (saveSyncState /
// loadSyncState / scheduleResume / resumePendingSync, all unmodified in
// their own core logic below) -- syncApprovedEntries still owns
// budget-exhaustion pausing exactly as Delivery 1 built it. SYNC_JOB_META
// is a separate, parallel property that only tracks the higher-level "is a
// web-initiated job running, paused, completed, or failed" question across
// that whole lifecycle, so polling has something authoritative to read
// regardless of how many pause/resume cycles the underlying run goes
// through. It intentionally does not replace or restructure
// SYNC_PENDING_STATE.

/**
 * @returns {Object|null} Current job metadata, or null if none exists.
 */
function getSyncJobMeta() {
  const json = getScriptProperty('SYNC_JOB_META');
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch (e) {
    logMessage(`Error parsing sync job meta: ${e.message}`, 'WARN');
    return null;
  }
}

function saveSyncJobMeta(meta) {
  setScriptProperty('SYNC_JOB_META', JSON.stringify(meta));
}

/**
 * D5: entry point for the web path. Starts a job and returns immediately —
 * the actual sync work happens in runScheduledSyncJob, fired by a one-off
 * trigger, detached from this call's HTTP request/response.
 *
 * D1+D5 interaction: if a job is already running or paused, a retry (e.g.
 * from a browser that gave up on the original request after ~100s) is
 * handed the SAME jobId rather than starting a duplicate — harmless by
 * construction, since Sync_Log is the guard regardless of how many times
 * this is called.
 *
 * @param {Object} options - May include forceEntryIds (D4), carried
 *   through to the triggered run. Deliberately NOT threaded through a
 *   pause/resume cycle — see syncApprovedEntriesWithState's own note on
 *   why overrides don't persist across a paused multi-hour operation.
 * @returns {{jobId: string, status: string, alreadyRunning: boolean}}
 */
function startAsyncSyncJob(options = {}) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw new Error('Could not acquire the sync lock (another request is starting a job right now) — try again in a moment.');
  }

  try {
    const existing = getSyncJobMeta();
    if (existing && (existing.status === 'running' || existing.status === 'paused')) {
      logMessage(`Job ${existing.jobId} already ${existing.status} — handing back the existing job instead of starting a new one`, 'INFO');
      return { jobId: existing.jobId, status: existing.status, alreadyRunning: true };
    }

    const jobId = Utilities.getUuid();
    const meta = {
      jobId,
      status: 'running',
      startedAt: formatDateTime(new Date()),
      completedAt: null,
      totalSynced: 0,
      totalFailed: 0,
      totalAlreadySynced: 0,
      error: null,
      // Script Properties are strings — a plain array survives the JSON round-trip fine.
      forceEntryIds: Array.from(parseForceEntryIds(options.forceEntryIds))
    };
    saveSyncJobMeta(meta);

    // Fire almost immediately, but as a genuinely separate execution — this
    // is what gets the actual sync work out from behind Cloudflare's edge
    // timeout.
    ScriptApp.newTrigger('runScheduledSyncJob').timeBased().after(1000).create();

    logMessage(`Started async sync job ${jobId}`, 'INFO');
    return { jobId, status: 'running', alreadyRunning: false };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Trigger handler for the initial async kick-off (D5). Runs detached from
 * any HTTP request — Apps Script trigger executions aren't subject to
 * Cloudflare's edge timeout since there's no HTTP response waiting on them.
 * Delegates to the unmodified syncApprovedEntries; all budget-pause/resume
 * behavior is exactly what Delivery 1 already built. This function's only
 * job is to translate that into SYNC_JOB_META so polling has something to
 * read.
 */
function runScheduledSyncJob() {
  // Self-cleanup: this is a one-off trigger, remove it so it can't fire twice.
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'runScheduledSyncJob') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  const meta = getSyncJobMeta();
  if (!meta) {
    logMessage('runScheduledSyncJob fired with no job metadata — nothing to do', 'WARN');
    return;
  }

  try {
    const result = syncApprovedEntries({ fromWebApi: true, forceEntryIds: meta.forceEntryIds });

    if (hasPendingSync()) {
      // Budget-exhausted mid-run: syncApprovedEntries already called
      // saveSyncState + scheduleResume itself (unmodified Delivery 1
      // behavior). Record that this job is now paused; resumePendingSync
      // carries the job-meta update forward to completion from here.
      saveSyncJobMeta({
        ...meta, status: 'paused',
        totalSynced: result.synced, totalFailed: result.failed, totalAlreadySynced: result.alreadySynced
      });
      logMessage(`Async sync job ${meta.jobId} paused (rate limit) — will resume automatically`, 'INFO');
    } else {
      saveSyncJobMeta({
        ...meta,
        status: 'completed',
        completedAt: formatDateTime(new Date()),
        totalSynced: result.synced,
        totalFailed: result.failed,
        totalAlreadySynced: result.alreadySynced
      });
      logMessage(`Async sync job ${meta.jobId} completed: ${result.synced} synced, ${result.failed} failed, ${result.alreadySynced} already synced`, 'INFO');
    }
  } catch (error) {
    logMessage(`Async sync job ${meta.jobId} failed: ${error.message}`, 'ERROR');
    saveSyncJobMeta({ ...meta, status: 'failed', completedAt: formatDateTime(new Date()), error: error.message });
  }
}

/**
 * Internal sync function that works with saved state for pause/resume.
 * @param {Object} [existingState] - Existing state to resume from
 * @returns {Object} Result with completed status and counts
 */
function syncApprovedEntriesWithState(existingState = null) {
  const approvedTag = getApprovedTagName();
  const syncedTag = getSyncedTagName();

  // D2: rebuilt at sync start on BOTH a fresh start and every resume — a
  // resume can follow the original fetch by 65+ minutes, cascading across
  // multiple pauses, which is exactly the "separated by minutes" scenario
  // D2 calls out. Overrides (D4) are intentionally NOT threaded through
  // this path: they're a deliberate, immediate operator action, not
  // something that should persist across a paused multi-hour operation.
  const alreadySyncedMap = buildAlreadySyncedMap();

  let pendingEntryIds, syncedEntryIds, totalSynced, totalFailed, totalAlreadySynced;

  if (existingState) {
    // Resume from saved state
    pendingEntryIds = existingState.pendingEntryIds || [];
    syncedEntryIds = existingState.syncedEntryIds || [];
    totalSynced = existingState.totalSynced || 0;
    totalFailed = existingState.totalFailed || 0;
    totalAlreadySynced = existingState.totalAlreadySynced || 0;
    logMessage(`Resuming with ${pendingEntryIds.length} pending entries`, 'INFO');
  } else {
    // Fresh sync - fetch entries
    const dateRange = getImportDateRange();
    const tags = fetchTogglTags();
    const tagLookup = {};
    tags.forEach(t => { tagLookup[t.id] = t.name; });

    const allEntries = fetchTimeEntriesAllUsers(dateRange.startDate, dateRange.endDate);

    // D1: Approved-tag alone — see syncApprovedEntries for why the Synced
    // tag is no longer an exclusion filter here.
    const entriesToSync = allEntries.filter(entry => {
      const entryTags = resolveEntryTags(entry, tagLookup);
      return entryTags.some(t => t.toLowerCase() === approvedTag.toLowerCase());
    });

    pendingEntryIds = entriesToSync.map(e => e.id || e.time_entry_id);
    syncedEntryIds = [];
    totalSynced = 0;
    totalFailed = 0;
    totalAlreadySynced = 0;
  }

  // Untagged-so-far queue for THIS invocation only (D1a). Deliberately not
  // part of persisted state: every return point below flushes it before
  // returning, so nothing crosses a pause/resume boundary untagged.
  const untaggedSyncedIds = [];

  if (pendingEntryIds.length === 0) {
    // Nothing to sync, but may need to tag already-synced entries left over
    // from a prior version of this function (defensive backstop for state
    // saved before this fix shipped — new runs never leave syncedEntryIds
    // untagged since every return path below flushes as it goes).
    if (syncedEntryIds.length > 0) {
      addTagToMultipleEntries(syncedEntryIds, syncedTag);
    }
    return { completed: true, totalSynced, totalFailed, totalAlreadySynced };
  }

  // Build lookups (uses cache, minimal API calls)
  const togglLookups = buildTogglLookups();
  const mappings = buildMappingLookups();

  // Refetch the actual entry data for pending IDs
  // (We only saved IDs in state, not full entry data)
  const dateRange = getImportDateRange();
  const allEntries = fetchTimeEntriesAllUsers(dateRange.startDate, dateRange.endDate);
  const entryMap = {};
  allEntries.forEach(e => {
    const id = e.id || e.time_entry_id;
    entryMap[id] = e;
  });

  // Process entries until budget exhausted or done
  const newPendingIds = [];

  for (const entryId of pendingEntryIds) {
    const entry = entryMap[entryId];
    if (!entry) {
      logMessage(`Entry ${entryId} not found in current fetch, skipping`, 'WARN');
      continue;
    }

    try {
      const processed = processTimeEntry(entry, togglLookups);
      const existing = alreadySyncedMap.get(String(processed.togglEntryId));

      // D3: skip and report, never halt. Local check, no budget check needed.
      if (existing) {
        totalAlreadySynced++;
        logSyncResult(processed, existing.qboId || '', 'Already synced', '');
        continue;
      }

      // Check budget only for entries that will actually attempt a write.
      if (isApproachingApiLimit(5)) {  // Reserve some calls for cleanup
        newPendingIds.push(entryId);
        continue;
      }

      const syncResult = syncSingleEntry(processed, mappings);

      if (syncResult.success) {
        totalSynced++;
        syncedEntryIds.push(entryId);
        untaggedSyncedIds.push(entryId);
        alreadySyncedMap.set(String(processed.togglEntryId), { qboId: syncResult.qboId }); // D2: in-memory update
        logSyncResult(processed, syncResult.qboId, 'Success', '');

        // D1(a): incremental flush, not just at the end.
        maybeFlushSyncedTags(untaggedSyncedIds, syncedTag, false);
      } else {
        totalFailed++;
        logSyncResult(processed, '', 'Failed', syncResult.error);
      }
    } catch (error) {
      totalFailed++;
      logMessage(`Error syncing entry ${entryId}: ${error.message}`, 'ERROR');
    }

    // Delay between QBO calls to avoid bandwidth quota
    Utilities.sleep(250);
  }

  // newPendingIds is already complete and correct by construction: every
  // entryId in pendingEntryIds hit exactly one path above — resolved
  // (not-found / already-synced / success / failed, none of which push
  // here) or explicitly deferred (budget, which does). The previous
  // position-based backfill here assumed only a contiguous budget-deferred
  // tail could be unresolved, which the D3 duplicate-skip path (a `continue`
  // that isn't a budget defer) breaks whenever a duplicate lands after a
  // budget cutoff — it would wrongly re-queue an already-resolved entry.

  if (newPendingIds.length > 0) {
    // D1(a): tag before this pause-again path returns.
    maybeFlushSyncedTags(untaggedSyncedIds, syncedTag, true);

    // Save state and schedule resume
    const state = {
      pendingEntryIds: newPendingIds,
      syncedEntryIds,
      totalSynced,
      totalFailed,
      totalAlreadySynced,
      pausedAt: formatDateTime(new Date())
    };
    saveSyncState(state);
    scheduleResume(65);  // Resume in 65 minutes

    const stats = getApiUsageStats();
    setConfigValue('LAST_SYNC_API_CALLS', stats.workspaceCalls);

    return { completed: false, totalSynced, totalFailed, totalAlreadySynced, pending: newPendingIds.length };
  }

  // All entries processed - flush any remaining untagged synced entries
  maybeFlushSyncedTags(untaggedSyncedIds, syncedTag, true);

  // Save API usage stats
  const stats = getApiUsageStats();
  setConfigValue('LAST_SYNC_API_CALLS', stats.workspaceCalls);
  setConfigValue('LAST_SYNC_DATE', formatDateTime(new Date()));

  return { completed: true, totalSynced, totalFailed, totalAlreadySynced };
}