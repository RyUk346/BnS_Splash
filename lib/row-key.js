// Unique, strictly increasing ISO timestamps for Sheet row keys.
//
// `new Date().toISOString()` has millisecond precision, so two guests who
// submit in the same millisecond get the same string. That matters because the
// timestamp IS the row key: the session poller finds a row by it, Cleanup.gs
// sorts by it, and — critically — the delivery queue confirms a row landed by
// asking the Sheet which timestamps are present. With two entries sharing one
// timestamp, the first row to land would mark BOTH as confirmed, and the
// second signup would be dropped without ever being written.
//
// Two devices submitting inside the same millisecond is unlikely on any given
// day and near-certain across months at six busy sites, so the key is made
// genuinely unique instead. The format is unchanged (plain ISO 8601), so the
// Sheet, the poller and the cleanup script all carry on as before.

let lastMs = 0;

/**
 * An ISO timestamp that is never returned twice by this process.
 *
 * If the clock hasn't advanced since the last call, the next millisecond is
 * used instead. Drift is self-correcting: as soon as real time catches up,
 * timestamps track the clock again. Worst case under sustained load the key
 * runs a few milliseconds ahead of the wall clock, which nothing depends on.
 */
function nextRowKey(now = Date.now()) {
  const ms = now > lastMs ? now : lastMs + 1;
  lastMs = ms;
  return new Date(ms).toISOString();
}

/** Test hook — resets the monotonic counter. */
function _reset() {
  lastMs = 0;
}

module.exports = { nextRowKey, _reset };
