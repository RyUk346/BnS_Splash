/**
 * HyperGlow Guest WiFi — one-off data cleanup
 *
 * NON-DESTRUCTIVE. Reads the live signup sheet (first tab) and writes two
 * new tabs, leaving the original completely untouched:
 *
 *   Clean    — the tidied dataset
 *   Removed  — every row that was dropped, with the reason, so you can
 *              review the decisions rather than trust them
 *
 * HOW TO RUN
 *   1. Extensions → Apps Script
 *   2. Add this file (or paste it alongside Code.gs)
 *   3. Select `buildCleanTabs` in the function dropdown → Run
 *   4. Authorise if prompted, then check the two new tabs
 *
 * Safe to re-run: it recreates both tabs from scratch each time.
 *
 * NOTE: the Clean tab is a SNAPSHOT. New signups keep arriving on the first
 * tab, so re-run this whenever you want a refreshed copy. Do not reorder the
 * tabs — the splash page and dashboard always read the FIRST one.
 */

var CLEAN_SHEET = "Clean";
var REMOVED_SHEET = "Removed";

/** Same columns as the live sheet. */
var CLEAN_HEADERS = [
  "Timestamp", "Email", "Name", "Phone", "Birthday", "Device MAC", "AP MAC",
  "SSID", "Branch", "Promo Offers", "Disconnected", "Total Time",
  "Device Name", "Vendor",
];

/**
 * Rows that are OUR OWN test submissions, not customers.
 *
 * Deliberately narrow. A junk *email* is not a junk *visit* — a guest who
 * typed "s@hotmail.com" still walked in, connected and stayed 31 minutes,
 * and that visit belongs in the footfall, dwell and daypart numbers. Only
 * remove rows that never represented a real person.
 *
 * Short or odd-looking addresses are therefore KEPT. They're useless for
 * mailing but valid as visits; filter them at send time, not here.
 */
var JUNK_EMAIL_PATTERNS = [
  /^webhook@/i,
  /^curltest@/i,
  /^test@test\./i,          // test@test.com / test@test.net
  /^test@(gmaiil|asdfghjkl|hyperglow)/i, // our own portal tests
  /@example\.(com|org)$/i,
  /^asdf/i,
  /^qwerty/i,
];

var MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
var DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Run this one manually from the editor — it shows a summary when finished.
 * The scheduled version (rebuildCleanTabs) is silent.
 */
function buildCleanTabs() {
  var result = rebuildCleanTabs();
  var msg = result.error
    ? "Cleanup failed: " + result.error
    : "Cleanup complete\n\n" +
      "Original rows:    " + result.total + "\n" +
      "Kept (Clean):     " + result.kept + "\n" +
      "Removed:          " + result.removed + "\n" +
      "Store backfilled: " + result.backfilled + " rows recovered from AP MAC\n\n" +
      "Nothing was changed on the original tab. Review the 'Removed' tab " +
      "before relying on 'Clean'.";
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log(msg); // no UI available (e.g. run from a trigger)
  }
}

/**
 * Rebuild the Clean and Removed tabs. Safe to call from a time-based
 * trigger — never touches the UI. Returns a summary object.
 */
function rebuildCleanTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheets()[0];
  var last = src.getLastRow();
  if (last < 2) {
    return { error: "No data rows found on the first tab.", total: 0, kept: 0, removed: 0, backfilled: 0 };
  }

  var values = src.getRange(2, 1, last - 1, CLEAN_HEADERS.length).getValues();

  // ── Pass 1: learn which AP MAC belongs to which store ──────────────
  // 9% of rows never got a Branch. The AP they connected through tells us,
  // so we can recover them instead of writing them off as "Unknown".
  var apToBranch = {};
  var apCounts = {};
  values.forEach(function (r) {
    var ap = String(r[6] || "").toLowerCase().trim();
    var branch = String(r[8] || "").trim();
    if (!ap || !branch) return;
    apCounts[ap] = apCounts[ap] || {};
    apCounts[ap][branch] = (apCounts[ap][branch] || 0) + 1;
  });
  Object.keys(apCounts).forEach(function (ap) {
    var best = null, bestN = 0;
    Object.keys(apCounts[ap]).forEach(function (b) {
      if (apCounts[ap][b] > bestN) { bestN = apCounts[ap][b]; best = b; }
    });
    apToBranch[ap] = best;
  });

  // ── Pass 2: normalise every row ────────────────────────────────────
  var rows = [];
  values.forEach(function (r, i) {
    if (!r[0] && !r[1]) return; // skip blank rows

    var email = String(r[1] || "").trim().toLowerCase();
    var ap = String(r[6] || "").toLowerCase().trim();
    var branch = String(r[8] || "").trim();
    var backfilled = false;
    if (!branch && ap && apToBranch[ap]) {
      branch = apToBranch[ap];
      backfilled = true;
    }

    var deviceName = String(r[12] || "").trim();
    if (MAC_RE.test(deviceName)) deviceName = ""; // the old bug wrote the MAC here

    rows.push({
      sourceRow: i + 2,
      ts: toIsoSafe(r[0]),
      tsMillis: toMillis(r[0]),
      email: email,
      name: String(r[2] || "").trim(),
      phone: normalisePhone(r[3]),
      birthday: String(r[4] || "").trim(),
      mac: String(r[5] || "").toLowerCase().trim(),
      ap: ap,
      ssid: String(r[7] || "").trim(),
      branch: branch,
      promo: String(r[9] || "").trim(),
      disconnected: toIsoSafe(r[10]),
      duration: String(r[11] || "").trim(),
      deviceName: deviceName,
      vendor: String(r[13] || "").trim(),
      backfilled: backfilled,
    });
  });

  // Chronological, so "keep the first of a duplicate pair" is meaningful.
  rows.sort(function (a, b) { return a.tsMillis - b.tsMillis; });

  // ── Pass 3: decide what to drop ────────────────────────────────────
  var kept = [];
  var removed = [];
  var lastSeenByMac = {};

  rows.forEach(function (row) {
    var reason = junkReason(row);
    if (reason) { removed.push([row, reason]); return; }

    if (row.mac && row.tsMillis) {
      var prev = lastSeenByMac[row.mac];
      if (prev && row.tsMillis - prev < DUPLICATE_WINDOW_MS) {
        removed.push([row, "Duplicate submit (same device within 5 minutes)"]);
        return;
      }
      lastSeenByMac[row.mac] = row.tsMillis;
    }
    kept.push(row);
  });

  // ── Write the tabs ─────────────────────────────────────────────────
  var backfilledCount = kept.filter(function (r) { return r.backfilled; }).length;

  writeSheet(ss, CLEAN_SHEET, CLEAN_HEADERS, kept.map(function (r) {
    return [
      r.ts, r.email, r.name, textCell(r.phone), textCell(r.birthday), r.mac,
      r.ap, r.ssid, r.branch, r.promo, r.disconnected, r.duration,
      r.deviceName, r.vendor,
    ];
  }));

  writeSheet(ss, REMOVED_SHEET, ["Reason", "Source row"].concat(CLEAN_HEADERS),
    removed.map(function (pair) {
      var r = pair[0];
      return [pair[1], r.sourceRow, r.ts, r.email, r.name, textCell(r.phone),
              textCell(r.birthday), r.mac, r.ap, r.ssid, r.branch, r.promo,
              r.disconnected, r.duration, r.deviceName, r.vendor];
    }));

  // Record when this ran so the dashboard can show data freshness.
  PropertiesService.getScriptProperties().setProperty(
    "CLEAN_BUILT_AT",
    new Date().toISOString()
  );

  return {
    total: rows.length,
    kept: kept.length,
    removed: removed.length,
    backfilled: backfilledCount,
  };
}

/* ── Keeping the Clean tab current ──────────────────────────────────
   The dashboard reads Clean, so it must be rebuilt as new signups
   arrive. Run installCleanupTrigger() ONCE from the editor.           */

var CLEANUP_TRIGGER_FN = "rebuildCleanTabs";
var CLEANUP_EVERY_MINUTES = 15;

/** Run once: schedules an automatic rebuild every 15 minutes. */
function installCleanupTrigger() {
  removeCleanupTrigger(); // avoid stacking duplicates on re-run
  ScriptApp.newTrigger(CLEANUP_TRIGGER_FN)
    .timeBased()
    .everyMinutes(CLEANUP_EVERY_MINUTES)
    .create();
  var msg =
    "Automatic cleanup installed.\n\n" +
    "The Clean tab now rebuilds every " + CLEANUP_EVERY_MINUTES + " minutes, so " +
    "the dashboard stays current. Run removeCleanupTrigger() to stop it.";
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log(msg);
  }
}

/** Stop the automatic rebuild. */
function removeCleanupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === CLEANUP_TRIGGER_FN) ScriptApp.deleteTrigger(t);
  });
}

/** Why this row shouldn't count as a real customer — or "" if it should. */
function junkReason(row) {
  if (!row.email) return ""; // no email isn't junk on its own
  for (var i = 0; i < JUNK_EMAIL_PATTERNS.length; i++) {
    if (JUNK_EMAIL_PATTERNS[i].test(row.email)) return "Test / junk email (" + row.email + ")";
  }
  if (row.email.indexOf("@") === -1 || row.email.indexOf(".") === -1) {
    return "Malformed email (" + row.email + ")";
  }
  return "";
}

/**
 * Tidy phone numbers without destroying international ones.
 * UK numbers become 07…; anything else keeps its + and digits.
 */
function normalisePhone(v) {
  var s = String(v || "").replace(/^'/, "").trim();
  if (!s) return "";
  var plus = s.charAt(0) === "+";
  var digits = s.replace(/[^\d]/g, "");
  if (!digits) return "";

  if (digits.indexOf("0044") === 0) return "0" + digits.slice(4);
  if (digits.indexOf("44") === 0 && (plus || digits.length >= 12)) return "0" + digits.slice(2);
  if (digits.charAt(0) === "0") return digits;
  if (plus) return "+" + digits;         // keep other countries intact
  return digits;
}

/** Leading apostrophe stops Sheets eating leading zeros / parsing as a date. */
function textCell(v) {
  return v ? "'" + v : "";
}

function toIsoSafe(v) {
  if (!v) return "";
  if (Object.prototype.toString.call(v) === "[object Date]") return v.toISOString();
  return String(v);
}

function toMillis(v) {
  if (!v) return 0;
  if (Object.prototype.toString.call(v) === "[object Date]") return v.getTime();
  var t = new Date(String(v)).getTime();
  return isNaN(t) ? 0 : t;
}

/** Replace (or create) a tab and fill it. */
function writeSheet(ss, name, headers, data) {
  var sheet = ss.getSheetByName(name);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(name, ss.getNumSheets()); // always append at the end
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  sheet.setFrozenRows(1);
  if (data.length) {
    sheet.getRange(2, 1, data.length, headers.length).setValues(data);
  }
  return sheet;
}
