/**
 * @fileoverview Mapping lookup for the Toggl -> QBO sync.
 *
 * Post-D2 cutover (2026-08-11): Back Office (backoffice.pltheatrical.com) is
 * the sole source of truth for Toggl<->QBO mappings. This file used to also
 * hold the in-sheet mapping editor machinery (refresh/auto-match/dropdown/
 * highlight/cleanup helpers, the QBO master-list refreshers, and the
 * one-time D2 cutover/dry-run tools). All of that was retired once the
 * Mappings_* tabs were renamed to ZZ_OLD_* and nothing read them anymore —
 * see the D2 cutover notes in CLAUDE.md and spec doc Phase 6.
 *
 * What remains is the one thing the live sync path needs: a single bulk
 * fetch of the mapping tables from Back Office at run start.
 * @author pltheatrical2
 */

// ============================================================================
// MAPPING LOOKUP (Back Office bulk fetch)
// ============================================================================

/**
 * D2 cutover (spec doc Phase 6, Q5/Q8): fetches the complete mapping lookup
 * tables from Back Office in ONE bulk call per run, held in memory for the
 * run rather than looked up per-entry — Apps Script execution limits, and a
 * consistent snapshot so mappings can't change mid-run. GET only; TimeSync
 * must remain structurally unable to write to Back Office.
 *
 * ON FAILURE, ABORTS THE RUN. No partial run, no stale data, no
 * last-known-good cache — proceeding on stale mappings writes TimeActivity
 * records against the wrong QBO customers (money wrong, found at
 * invoicing). A delayed run is recoverable: entries keep their Approved tag
 * and sync next run. See abortRunForMappingFetchFailure.
 *
 * Requires three Script Properties: BACK_OFFICE_CF_ACCESS_CLIENT_ID,
 * BACK_OFFICE_CF_ACCESS_CLIENT_SECRET (Cloudflare Access service token for
 * the path-scoped /api/mappings/all Access app), and BACK_OFFICE_API_KEY
 * (Back Office's second auth layer). BACK_OFFICE_MAPPINGS_URL is optional,
 * defaulting to the production endpoint.
 * @returns {Object} Mappings object with users, clients, projects, tasks
 */
function buildMappingLookups() {
  const url = getBackOfficeMappingsUrl();
  const cfClientId = getBackOfficeCfAccessClientId();
  const cfClientSecret = getBackOfficeCfAccessClientSecret();
  const apiKey = getBackOfficeApiKey();

  if (!cfClientId || !cfClientSecret || !apiKey) {
    return abortRunForMappingFetchFailure(
      'Back Office credentials not configured — set BACK_OFFICE_CF_ACCESS_CLIENT_ID, ' +
      'BACK_OFFICE_CF_ACCESS_CLIENT_SECRET, and BACK_OFFICE_API_KEY in Script Properties'
    );
  }

  const options = {
    method: 'get',
    headers: {
      'CF-Access-Client-Id': cfClientId,
      'CF-Access-Client-Secret': cfClientSecret,
      'X-Api-Key': apiKey
    },
    muteHttpExceptions: true
  };

  let response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (e) {
    return abortRunForMappingFetchFailure(`Back Office mapping fetch threw: ${e.message}`);
  }

  const responseCode = response.getResponseCode();
  if (responseCode !== 200) {
    return abortRunForMappingFetchFailure(
      `Back Office mapping fetch returned ${responseCode}: ${response.getContentText().slice(0, 300)}`
    );
  }

  let mappings;
  try {
    mappings = JSON.parse(response.getContentText());
  } catch (e) {
    return abortRunForMappingFetchFailure(`Back Office mapping response was not valid JSON: ${e.message}`);
  }

  if (!mappings || !mappings.users || !mappings.clients || !mappings.projects || !mappings.tasks) {
    return abortRunForMappingFetchFailure('Back Office mapping response missing an expected key (users/clients/projects/tasks)');
  }

  logMessage(
    `Mapping lookups fetched from Back Office: ${Object.keys(mappings.users).length} users, ` +
    `${Object.keys(mappings.clients).length} clients, ${Object.keys(mappings.projects).length} projects, ` +
    `${Object.keys(mappings.tasks).length} tasks`,
    'INFO'
  );

  return mappings;
}

/**
 * D2 cutover: mapping fetch failures abort the run rather than falling
 * back to a cache or partial data (see buildMappingLookups). Emails Philip
 * directly rather than raising a Back Office notification — TimeSync is
 * GET-only against Back Office by design, so it has no write path to raise
 * one through, and widening the service key to add one would undercut the
 * whole point of D1's key scoping.
 * @param {string} reason
 * @returns {never} always throws
 */
function abortRunForMappingFetchFailure(reason) {
  logMessage(`ABORTING sync: mapping fetch failed — ${reason}`, 'ERROR');
  try {
    MailApp.sendEmail({
      to: 'philip@pltheatrical.com',
      subject: 'TimeSync: sync aborted — Back Office mapping fetch failed',
      body: `The Toggl -> QBO sync aborted before writing anything.\n\n` +
            `Reason: ${reason}\n\n` +
            `No mappings were cached or reused — proceeding on stale data risks writing ` +
            `TimeActivity records against the wrong QBO customers. Approved entries keep their ` +
            `tag and will sync on the next run once this is fixed.\n\n` +
            `Time: ${formatDateTime(new Date())}`
    });
  } catch (mailError) {
    logMessage(`Also failed to send abort email: ${mailError.message}`, 'ERROR');
  }
  throw new Error(`Sync aborted: ${reason}`);
}
