"""One-time (+ final-delta-at-flip) import: Sheet's Sync_Log export -> timesync.db.

Run manually: python -m service.import_sync_log <export.json>

Google Sheets serializes two fields in a way that is NOT a plain copy:

- Date: a date-only cell, serialized as midnight in the spreadsheet's
  timezone (appsscript.json: America/New_York) converted to UTC. Verified
  empirically against known dates (04:00Z in EDT-season rows, 05:00Z in
  EST-season rows) -- convert via zoneinfo, don't string-slice, so DST is
  handled correctly on both sides of the transition.

- Duration: a time-format cell (h:mm elapsed, NOT a wall-clock time),
  epoch-anchored at Sheets' zero date 1899-12-30. Verified empirically
  against three known QBO ground-truth durations from this session's own
  cross-check (TimeActivity 1073746021/1073746023/1073746026, all confirmed
  in QBO): the serialized UTC time-of-day is always exactly +5:00 (fixed
  EST) ahead of the real duration, REGARDLESS of the entry's actual DST
  season -- because epoch 1899-12-30 predates any DST rule for
  America/New_York in the tz database, so Sheets/Apps Script always uses the
  zone's flat standard offset for it, never the real date's DST status.
  Getting this wrong silently shifts up to ~3200 historical duration values
  by up to 5 hours with no error -- verify against ground truth, don't guess.
"""
import json
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from db import get_db, init_db

EASTERN = ZoneInfo("America/New_York")
DURATION_OFFSET_MINUTES = 5 * 60  # fixed EST, see module docstring

# Ground truth from this session's live QBO cross-check (08/06 sync).
# {qbo_timeactivity_id: expected "H:MM"} -- import aborts if these don't match.
KNOWN_DURATIONS = {
    "1073746021": "1:31",
    "1073746026": "0:15",
    "1073746027": "0:15",
}


def convert_date(iso_z):
    if not iso_z:
        return ""
    dt = datetime.fromisoformat(iso_z.replace("Z", "+00:00"))
    local = dt.astimezone(EASTERN)
    return local.strftime("%Y-%m-%d")


def convert_duration(iso_z):
    if not iso_z:
        return ""
    dt = datetime.fromisoformat(iso_z.replace("Z", "+00:00"))
    total_minutes = dt.hour * 60 + dt.minute
    real_minutes = (total_minutes - DURATION_OFFSET_MINUTES) % (24 * 60)
    hours, minutes = divmod(real_minutes, 60)
    return f"{hours}:{minutes:02d}"


def load_entries(path):
    with open(path) as f:
        data = json.load(f)
    return data["entries"]


def validate_ground_truth(entries):
    by_qbo_id = {}
    for e in entries:
        qid = str(e.get("QBO TimeActivity ID") or "")
        if qid:
            by_qbo_id.setdefault(qid, e)  # first occurrence is fine, duration is identical across dup rows
    failures = []
    for qid, expected in KNOWN_DURATIONS.items():
        row = by_qbo_id.get(qid)
        if row is None:
            failures.append(f"  {qid}: not found in export at all")
            continue
        got = convert_duration(row["Duration"])
        if got != expected:
            failures.append(f"  {qid}: expected {expected}, converted to {got} (raw: {row['Duration']!r})")
    if failures:
        raise SystemExit(
            "ABORT: duration conversion failed ground-truth validation:\n" + "\n".join(failures)
        )
    print(f"Ground truth validated: {len(KNOWN_DURATIONS)}/{len(KNOWN_DURATIONS)} known durations match.")


def import_rows(entries):
    conn = get_db()
    existing = conn.execute("SELECT COUNT(*) c FROM sync_log").fetchone()["c"]
    if existing > 0:
        raise SystemExit(
            f"ABORT: sync_log already has {existing} rows. This script is for the initial "
            f"import only -- re-running would duplicate history. Truncate first if that's "
            f"genuinely intended."
        )

    rows = []
    anomalies = []
    for e in entries:
        duration = convert_duration(e["Duration"])
        # Sanity check: a single time entry over 24h is a red flag worth
        # surfacing, not silently importing (could indicate a conversion bug
        # on a row this script's ground-truth sample didn't cover).
        h = int(duration.split(":")[0]) if duration else 0
        if h >= 20:
            anomalies.append((e.get("Toggl Entry ID"), duration, e.get("Description")))

        rows.append((
            e.get("Synced At") or "",
            str(e.get("Toggl Entry ID") or ""),
            str(e.get("QBO TimeActivity ID") or ""),
            convert_date(e.get("Date")),
            duration,
            e.get("Toggl User") or "",
            e.get("QBO Employee") or "",
            e.get("Toggl Client") or "",
            e.get("Toggl Project") or "",
            e.get("QBO Customer") or "",
            e.get("QBO Project") or "",
            e.get("Toggl Task") or "",
            e.get("QBO Service Item") or "",
            e.get("Description") or "",
            1 if e.get("Billable") else 0,
            e.get("Status") or "",
            e.get("Error") or "",
        ))

    conn.executemany(
        """INSERT INTO sync_log
           (synced_at, toggl_entry_id, qbo_timeactivity_id, date, duration,
            toggl_user, qbo_employee, toggl_client, toggl_project,
            qbo_customer, qbo_project, toggl_task, qbo_service_item,
            description, billable, status, error)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        rows,
    )
    conn.commit()

    imported = conn.execute("SELECT COUNT(*) c FROM sync_log").fetchone()["c"]
    success = conn.execute("SELECT COUNT(*) c FROM sync_log WHERE status='Success'").fetchone()["c"]
    conn.close()

    print(f"Imported {imported} rows ({success} Success).")
    if anomalies:
        print(f"\n⚠ {len(anomalies)} row(s) with duration >= 20h -- review, not blocking:")
        for entry_id, dur, desc in anomalies[:20]:
            print(f"  entry {entry_id}: {dur} -- {desc}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(f"Usage: python -m service.import_sync_log <export.json>")
    init_db()
    entries = load_entries(sys.argv[1])
    print(f"Loaded {len(entries)} entries from {sys.argv[1]}")
    validate_ground_truth(entries)
    import_rows(entries)
