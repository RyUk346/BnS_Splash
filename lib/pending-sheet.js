// Durable queue for Google Sheets appends.
//
// The Sheet write used to happen before the guest got a response, which made
// it slow but guaranteed: if it failed, the request failed loudly. Moving it
// off the critical path removed 1-3s of Apps Script cold start from every
// connect — but it also meant a crash, a restart, or a Sheets outage between
// the response and the append would silently lose a signup, and a signup is
// the entire point of the portal.
//
// So the entry is written to disk first (synchronously, microseconds), the
// append is attempted in the background, and the entry is only removed once
// Apps Script has confirmed it. Anything still here is retried — on boot and
// on a timer — so the worst case is a late row, never a missing one.
//
// Holds guest PII, so it lives in the git-ignored data/ directory alongside
// the session state and should be treated like the Sheet itself.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const QUEUE_FILE = path.join(DATA_DIR, "pending-sheet.json");

// Nothing is ever dropped: the requirement is that every signup reaches the
// sheet, so a full queue is a reason to shout, not to discard a lead. These
// thresholds only control logging.
//
// A queued entry is a few hundred bytes, so even a week-long Sheets outage at
// a busy site is single-digit megabytes — far cheaper than a lost customer.
const WARN_QUEUE = 250;   // "something has been broken for a while"
const ALARM_QUEUE = 2000; // "this needs looking at today"

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readQueue() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("pending-sheet.json unreadable:", err.message);
    return [];
  }
}

/** Atomic-ish write: a crash mid-write must not truncate the queue. */
function writeQueue(list) {
  ensureDir();
  const tmp = `${QUEUE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, QUEUE_FILE);
}

/** Queue an entry. Returns the id used to settle it later. */
function enqueue(entry) {
  const list = readQueue();

  if (list.length >= ALARM_QUEUE) {
    console.error(
      `ALARM: ${list.length} signups are waiting to reach the Google Sheet. ` +
        "Check the Apps Script webhook and deployment — nothing is being lost, " +
        "but nothing is being saved either."
    );
  } else if (list.length >= WARN_QUEUE) {
    console.warn(`${list.length} signups queued for the Google Sheet and not yet confirmed.`);
  }

  const id = `${entry.timestamp}|${String(entry.mac || "").toLowerCase()}`;
  // Same key Apps Script uses for the row, so a double-submit within the same
  // millisecond can't queue twice.
  if (!list.some((e) => e.id === id)) {
    list.push({ id, queuedAt: new Date().toISOString(), attempts: 0, entry });
    writeQueue(list);
  }
  return id;
}

/** Remove an entry once Apps Script has confirmed the append. */
function settle(id) {
  if (!id) return;
  const list = readQueue();
  const next = list.filter((e) => e.id !== id);
  if (next.length !== list.length) writeQueue(next);
}

/** Record a failed attempt so retries are visible and bounded. */
function noteFailure(id) {
  if (!id) return;
  const list = readQueue();
  const hit = list.find((e) => e.id === id);
  if (!hit) return;
  hit.attempts = (hit.attempts || 0) + 1;
  hit.lastError = new Date().toISOString();
  writeQueue(list);
}

/** Entries still waiting, oldest first. */
function pending() {
  return readQueue();
}

module.exports = {
  enqueue,
  settle,
  noteFailure,
  pending,
  QUEUE_FILE,
  WARN_QUEUE,
  ALARM_QUEUE,
};
