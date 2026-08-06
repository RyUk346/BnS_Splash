/**
 * HyperGlow Guest WiFi — Google Sheets webhook
 *
 * Setup:
 * 1. Create a Google Sheet (e.g. "HyperGlow WiFi Signups").
 * 2. Extensions -> Apps Script, delete any code there, paste this file.
 * 3. Click Deploy -> New deployment -> type: Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 4. Click Deploy, authorize when prompted, and copy the Web app URL.
 * 5. Put that URL in the splash server's .env as GOOGLE_SHEETS_WEBHOOK_URL.
 *
 * Handles two actions:
 *   (default)         append a new signup row
 *   updateDuration    find the row by Timestamp + Device MAC and fill in
 *                     "Disconnected" + "Total Time" (called by the poller)
 */

var HEADERS = [
  "Timestamp",       // A
  "Email",           // B
  "First Name",      // C
  "Phone",           // D
  "Birthday",        // E  (DD/MM/YYYY)
  "Device MAC",      // F
  "AP MAC",          // G
  "SSID",            // H
  "Branch",          // I
  "Promo Offers",    // J
  "Disconnected",    // K
  "Total Time",      // L
];

var COL_TIMESTAMP = 1; // A
var COL_MAC = 6;       // F
var COL_DISCONNECTED = 11; // K
var COL_DURATION = 12;     // L

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

    // Create header row on first use
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
      sheet.setFrozenRows(1);
    }

    if (data.action === "updateDuration") {
      return handleUpdate(sheet, data);
    }

    // Default: append a new signup row.
    sheet.appendRow([
      data.timestamp || new Date().toISOString(),
      data.email || "",
      data.firstName || "",
      // Leading apostrophe keeps phone numbers/birthdays as text
      // so Sheets doesn't strip leading zeros or parse dates.
      data.phone ? "'" + data.phone : "",
      data.birthday ? "'" + data.birthday : "",
      data.mac || "",
      data.ap || "",
      data.ssid || "",
      data.branch || "",
      data.promo || "",
      "", // Disconnected (filled later by the poller)
      "", // Total Time
    ]);

    return json({ success: true });
  } catch (err) {
    return json({ success: false, error: String(err) });
  }
}

/** Find the signup row by Timestamp + MAC and write disconnect + duration. */
function handleUpdate(sheet, data) {
  var last = sheet.getLastRow();
  if (last < 2) return json({ success: false, error: "no rows" });

  var keyTs = String(data.timestamp || "");
  var keyMac = String(data.mac || "").toLowerCase();

  // Scan from the bottom up — recent sessions are near the end.
  var values = sheet
    .getRange(2, 1, last - 1, COL_MAC)
    .getValues(); // columns A..F for each data row

  for (var i = values.length - 1; i >= 0; i--) {
    var rowTs = String(values[i][COL_TIMESTAMP - 1]);
    var rowMac = String(values[i][COL_MAC - 1]).toLowerCase();
    if (rowTs === keyTs && rowMac === keyMac) {
      var rowNumber = i + 2; // account for header + 0-index
      sheet.getRange(rowNumber, COL_DISCONNECTED).setValue(data.disconnectedAt || "");
      sheet.getRange(rowNumber, COL_DURATION).setValue(data.duration || "");
      return json({ success: true, updatedRow: rowNumber });
    }
  }
  return json({ success: false, error: "row not found" });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/**
 * GET endpoints.
 *   ?action=data&key=YOUR_KEY   → all rows as JSON (used by the admin dashboard)
 *   (no params)                 → health check
 *
 * IMPORTANT: set READ_KEY below to a long random string and put the same
 * value in the splash server's .env as SHEETS_READ_KEY.
 */
var READ_KEY = "HyperGlowSplashPage@HG";

function doGet(e) {
  var params = (e && e.parameter) || {};

  if (params.action === "data") {
    if (params.key !== READ_KEY) {
      return json({ success: false, error: "unauthorized" });
    }
    return json({ success: true, rows: readAllRows() });
  }

  return json({ ok: true, service: "HyperGlow WiFi signups webhook" });
}

/** Every data row as an object keyed by our known columns. */
function readAllRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var last = sheet.getLastRow();
  if (last < 2) return [];

  var values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    // Skip completely empty rows
    if (!r[0] && !r[1]) continue;
    out.push({
      timestamp: toIso(r[0]),
      email: String(r[1] || ""),
      firstName: String(r[2] || ""),
      phone: String(r[3] || ""),
      birthday: String(r[4] || ""),
      mac: String(r[5] || ""),
      ap: String(r[6] || ""),
      ssid: String(r[7] || ""),
      branch: String(r[8] || ""),
      promo: String(r[9] || ""),
      disconnected: toIso(r[10]),
      duration: String(r[11] || ""),
    });
  }
  return out;
}

/** Sheets may hand back a Date object or a string; normalise to ISO text. */
function toIso(v) {
  if (!v) return "";
  if (Object.prototype.toString.call(v) === "[object Date]") {
    return v.toISOString();
  }
  return String(v);
}
