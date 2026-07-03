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
 */

var HEADERS = [
  "Timestamp",
  "Email",
  "First Name",
  "Phone",
  "Birthday (DD/MM)",
  "Device MAC",
  "AP MAC",
  "SSID",
];

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
    ]);

    return ContentService.createTextOutput(
      JSON.stringify({ success: true })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: String(err) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/** Optional: visit the web app URL in a browser to check it's alive. */
function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, service: "HyperGlow WiFi signups webhook" })
  ).setMimeType(ContentService.MimeType.JSON);
}
