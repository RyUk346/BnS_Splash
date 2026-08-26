#!/usr/bin/env node
/**
 * Session poller — tracks how long each guest device stays connected and
 * writes "Disconnected" + "Total Time" back to its Google Sheet row.
 *
 * How it runs: pm2 cron (see ecosystem.config.js) executes this script on a
 * schedule (default every 3 min). Each run:
 *   1. drains new sessions from the web app's inbox into tracking state,
 *   2. asks each console which MACs are currently connected,
 *   3. for tracked sessions still present → refresh lastSeen,
 *      for sessions absent longer than the grace period → mark disconnected,
 *      compute duration, and PATCH the Sheet row.
 *
 * Env used (from .env): GOOGLE_SHEETS_WEBHOOK_URL, UNIFI_* (via lib/unifi).
 */

const path = require("path");
// Load .env (the app relies on pm2/dotenv; load manually for standalone runs).
try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
} catch {
  /* dotenv optional — pm2 injects env in production */
}

const { getConnectedMacs, getConsoles, getClientInfo } = require("../lib/unifi");
const { drainInbox, loadState, saveState } = require("../lib/sessions");

const GRACE_MS = parseInt(process.env.SESSION_GRACE_MINUTES || "10", 10) * 60 * 1000;
const WEBHOOK = process.env.GOOGLE_SHEETS_WEBHOOK_URL || "";

function fmtDuration(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function updateSheetRow(session, disconnectedAt, durationLabel, extra = {}) {
  if (!WEBHOOK) {
    console.warn("[poller] GOOGLE_SHEETS_WEBHOOK_URL not set — cannot update row");
    return false;
  }
  // See the note in app/api/connect/route.js: Apps Script runs the script
  // and then 302s to its output URL, which often 404s on the follow-up hop
  // even though the write succeeded. Don't follow it.
  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    redirect: "manual",
    body: JSON.stringify({
      action: "updateDuration",
      timestamp: session.timestamp, // row key (col A)
      mac: session.mac, // row key (col F)
      disconnectedAt,
      duration: durationLabel,
      ...extra, // deviceName / vendor, once UniFi has fingerprinted the device
    }),
  });
  if (res.status >= 200 && res.status < 400) return true;
  throw new Error(`Sheets update HTTP ${res.status}`);
}

async function run() {
  const now = Date.now();

  // 1. Merge any new sessions from the web app into tracking state.
  let sessions = loadState();
  const incoming = drainInbox();
  if (incoming.length) {
    sessions = sessions.concat(incoming);
    console.log(`[poller] +${incoming.length} new session(s)`);
  }

  const active = sessions.filter((s) => s.status === "active");
  if (!active.length) {
    saveState(prune(sessions, now));
    return;
  }

  // 2. Which consoles do we actually need to poll?
  const neededConsoles = new Set(active.map((s) => s.consoleId).filter(Boolean));
  const presentByConsole = {};
  for (const con of getConsoles()) {
    if (!neededConsoles.has(con.id)) continue;
    try {
      presentByConsole[con.id] = await getConnectedMacs(con.id);
    } catch (err) {
      // Console unreachable this cycle — skip it; sessions keep their lastSeen
      // and we retry next run (never falsely disconnect on an API hiccup).
      console.warn(`[poller] could not poll console ${con.id}: ${err.message}`);
    }
  }

  // 3. Update each active session.
  for (const s of active) {
    const present = presentByConsole[s.consoleId];
    if (!present) continue; // console wasn't polled this cycle

    if (present.has(s.mac)) {
      s.lastSeen = new Date(now).toISOString();

      // While the device is still connected, try to pick up the name and
      // vendor UniFi has worked out for it. Fingerprinting takes a minute or
      // two, so this usually succeeds on a later cycle than the first.
      if (!s.deviceName || !s.vendor) {
        try {
          const info = await getClientInfo(s.consoleId, s.mac);
          const isMac = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(info.deviceName || "");
          if (!s.deviceName && info.deviceName && !isMac) s.deviceName = info.deviceName;
          if (!s.vendor && info.vendor) s.vendor = info.vendor;
        } catch {
          /* not fatal — try again next cycle */
        }
      }
    } else {
      const goneFor = now - new Date(s.lastSeen).getTime();
      if (goneFor >= GRACE_MS) {
        const disconnectedAt = s.lastSeen; // last time we actually saw it
        const durationMs = new Date(disconnectedAt).getTime() - new Date(s.connectedAt).getTime();
        const durationLabel = fmtDuration(durationMs);
        try {
          await updateSheetRow(s, disconnectedAt, durationLabel, {
            deviceName: s.deviceName || "",
            vendor: s.vendor || "",
          });
          s.status = "done";
          s.disconnectedAt = disconnectedAt;
          s.duration = durationLabel;
          console.log(`[poller] ${s.mac} disconnected — ${durationLabel}`);
        } catch (err) {
          console.error(`[poller] failed to update row for ${s.mac}: ${err.message}`);
          // leave active; retry next cycle
        }
      }
    }
  }

  saveState(prune(sessions, now));
}

// Drop finished sessions after a day so the state file stays small.
function prune(sessions, now) {
  const cutoff = now - 24 * 60 * 60 * 1000;
  return sessions.filter(
    (s) => s.status === "active" || new Date(s.lastSeen).getTime() > cutoff
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[poller] fatal:", err);
    process.exit(1);
  });
