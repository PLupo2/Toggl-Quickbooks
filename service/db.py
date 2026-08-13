"""SQLite schema and connection helper. Phase 3 (R2): timesync.db is the one
home for Sync_Log and Config -- replaces the Google Sheet entirely.
"""
import os
import sqlite3

DB_PATH = os.environ.get("DB_PATH", "/data/timesync.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    synced_at TEXT,
    toggl_entry_id TEXT,
    qbo_timeactivity_id TEXT,
    date TEXT,
    duration TEXT,
    toggl_user TEXT,
    qbo_employee TEXT,
    toggl_client TEXT,
    toggl_project TEXT,
    qbo_customer TEXT,
    qbo_project TEXT,
    toggl_task TEXT,
    qbo_service_item TEXT,
    description TEXT,
    billable INTEGER,
    status TEXT,
    error TEXT
);

-- Index for buildAlreadySyncedMap()'s equivalent: the idempotency guard reads
-- every Success row and needs to find the latest one per toggl_entry_id fast.
CREATE INDEX IF NOT EXISTS idx_sync_log_entry_status ON sync_log(toggl_entry_id, status);

CREATE TABLE IF NOT EXISTS sync_job (
    job_id TEXT PRIMARY KEY,
    status TEXT,              -- running | paused | completed | failed
    started_at TEXT,
    completed_at TEXT,
    total_synced INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0,
    total_already_synced INTEGER DEFAULT 0,
    total_tagging_failed INTEGER DEFAULT 0,
    total_entries INTEGER DEFAULT 0,  -- entries this job's walk covers (post already-synced filter)
    error TEXT,
    force_entry_ids TEXT       -- JSON array, D4 per-entry override
);

-- Single-row table: the persisted disagreement snapshot (D1(b)).
CREATE TABLE IF NOT EXISTS disagreement_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    count INTEGER, missing_tag INTEGER, missing_log INTEGER, checked INTEGER,
    computed_at TEXT
);

-- Single-row table: cached connection status (R1 -- no live Toggl/QBO round
-- trip per dashboard load).
CREATE TABLE IF NOT EXISTS connection_status_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    qbo_connected INTEGER, qbo_realm_id TEXT,
    toggl_connected INTEGER, toggl_workspace_id TEXT,
    computed_at TEXT
);
"""

# Mirrors CONFIG.DEFAULTS + the Config sheet's default rows (Menu.gs
# createConfigSheet), minus QBO_ENV -- the sandbox toggle is retired (R3,
# Core vends production only).
DEFAULT_SETTINGS = {
    "START_DATE": "",
    "END_DATE": "",
    "IMPORT_DAYS": "30",
    "BATCH_SIZE": "50",
    "LAST_SYNC_DATE": "",
    "SYNC_BILLABLE_ONLY": "FALSE",
    "APPROVED_TAG": "Approved",
    "SYNCED_TAG": "Synced",
    "DEFAULT_SERVICE_ITEM_ID": "",
    "DEFAULT_SERVICE_ITEM_NAME": "",
    "TOGGL_API_BUDGET": "180",
    "LAST_SYNC_API_CALLS": "",
    "SYNC_STATUS": "",
}


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db()
    conn.executescript(SCHEMA)
    # CREATE TABLE IF NOT EXISTS doesn't add columns to an already-existing
    # table -- the live sync_job table predates total_entries, so it needs an
    # explicit migration rather than relying on the schema above.
    existing_cols = {row["name"] for row in conn.execute("PRAGMA table_info(sync_job)")}
    if "total_entries" not in existing_cols:
        conn.execute("ALTER TABLE sync_job ADD COLUMN total_entries INTEGER DEFAULT 0")
    # Seed defaults without overwriting anything already set (same contract
    # as syncMissingConfigKeys: additive only).
    existing = {row["key"] for row in conn.execute("SELECT key FROM settings")}
    missing = [(k, v) for k, v in DEFAULT_SETTINGS.items() if k not in existing]
    if missing:
        conn.executemany("INSERT INTO settings (key, value) VALUES (?, ?)", missing)
    conn.commit()
    conn.close()


def get_setting(key, default=None):
    conn = get_db()
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    conn.close()
    if row is None or row["value"] in (None, ""):
        return default
    return row["value"]


def set_setting(key, value):
    conn = get_db()
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, str(value)),
    )
    conn.commit()
    conn.close()
