/**
 * UniFi Network Integration API client — multi-console aware.
 *
 * Supports one or more UniFi consoles (e.g. several branches of the same
 * brand). On submit, the guest's MAC is looked up on each console in order;
 * whichever console knows the device is the one that authorizes it.
 *
 * Configuration (.env):
 *
 *   UNIFI_CONSOLES   Comma-separated list of consoleId|label pairs, e.g.
 *                    UNIFI_CONSOLES=6C63...B6A:818255038|Perry Barr,6C63...DF5:550385364|Castle Vale
 *                    (label is free text, used for the Sheet's Branch column)
 *
 *   UNIFI_CONSOLE_ID Legacy single-console form (still supported).
 *
 *   UNIFI_MODE       "cloud" (default) — via api.ui.com Cloud Connector Proxy.
 *                    "direct" — straight to one console (UNIFI_CONTROLLER_URL).
 *
 *   UNIFI_API_KEY    Ubiquiti account API key. Must have access to ALL
 *                    listed consoles.
 */

const https = require("https");
const { URL } = require("url");

const MODE = process.env.UNIFI_MODE || "cloud";
const API_KEY = process.env.UNIFI_API_KEY || "";
const CONTROLLER_URL = (process.env.UNIFI_CONTROLLER_URL || "").replace(/\/+$/, "");
const AUTH_MINUTES = parseInt(process.env.AUTH_MINUTES || "1440", 10);

/** Parse configured consoles into [{ id, label }]. */
function consoles() {
  const multi = (process.env.UNIFI_CONSOLES || "").trim();
  if (multi) {
    return multi
      .split(",")
      .map((entry) => {
        const [id, label] = entry.split("|").map((s) => s.trim());
        return id ? { id, label: label || id.slice(0, 12) } : null;
      })
      .filter(Boolean);
  }
  const single = (process.env.UNIFI_CONSOLE_ID || "").trim();
  if (single) return [{ id: single, label: process.env.UNIFI_BRANCH_NAME || "" }];
  return [];
}

function baseUrl(consoleId) {
  if (MODE === "direct") {
    if (!CONTROLLER_URL) throw new Error("UNIFI_CONTROLLER_URL is not set");
    return `${CONTROLLER_URL}/proxy/network/integration/v1`;
  }
  return `https://api.ui.com/v1/connector/consoles/${consoleId}/proxy/network/integration/v1`;
}

/** Minimal HTTPS JSON request helper (handles self-signed certs in direct mode). */
function request(consoleId, path, { method = "GET", body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl(consoleId) + path);
    const payload = body ? JSON.stringify(body) : null;

    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers: {
          "X-API-Key": API_KEY,
          Accept: "application/json",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
        },
        // UniFi consoles use self-signed certs; api.ui.com has a valid cert.
        rejectUnauthorized: MODE !== "direct",
        timeout: 20000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            /* non-JSON response */
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            const msg =
              (json && (json.message || json.error || JSON.stringify(json))) ||
              `HTTP ${res.statusCode}`;
            reject(new Error(`UniFi API ${method} ${path} failed: ${msg}`));
          }
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error("UniFi API request timed out")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Lists come back either as a raw array or as { data: [...] }. */
function items(resp) {
  if (Array.isArray(resp)) return resp;
  if (resp && Array.isArray(resp.data)) return resp.data;
  return [];
}

const siteCache = new Map(); // consoleId -> siteId

async function getSiteId(consoleId) {
  if (process.env.UNIFI_SITE_ID) return process.env.UNIFI_SITE_ID;
  if (siteCache.has(consoleId)) return siteCache.get(consoleId);
  const sites = items(await request(consoleId, "/sites"));
  if (!sites.length) throw new Error(`No sites returned for console ${consoleId}`);
  siteCache.set(consoleId, sites[0].id);
  return sites[0].id;
}

async function findClientByMac(consoleId, siteId, mac) {
  const norm = mac.toLowerCase();
  // Preferred: server-side filter
  try {
    const filter = encodeURIComponent(`macAddress.eq('${norm}')`);
    const found = items(
      await request(consoleId, `/sites/${siteId}/clients?filter=${filter}`)
    );
    if (found.length) return found[0];
  } catch {
    /* fall through to manual scan */
  }
  // Fallback: scan the client list
  const all = items(await request(consoleId, `/sites/${siteId}/clients?limit=200`));
  return all.find((c) => (c.macAddress || "").toLowerCase() === norm) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Authorize a guest device. Tries every configured console (branch) —
 * whichever one the device is connected to wins. Returns { branch }.
 * Retries the rounds a few times because a freshly connected device can
 * take a moment to appear in the API.
 */
async function authorizeGuest(mac) {
  if (!API_KEY) throw new Error("UNIFI_API_KEY is not set");
  const list = consoles();
  if (!list.length) throw new Error("No UniFi consoles configured (UNIFI_CONSOLES / UNIFI_CONSOLE_ID)");

  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(1500);

    for (const con of list) {
      try {
        const siteId = await getSiteId(con.id);
        const client = await findClientByMac(con.id, siteId, mac);
        if (!client) continue;

        await request(con.id, `/sites/${siteId}/clients/${client.id}/actions`, {
          method: "POST",
          body: {
            action: "AUTHORIZE_GUEST_ACCESS",
            timeLimitMinutes: AUTH_MINUTES,
          },
        });
        return { branch: con.label, consoleId: con.id, minutes: AUTH_MINUTES };
      } catch (err) {
        lastError = err; // console unreachable / API error — try the next one
      }
    }
  }

  throw lastError || new Error(`Client ${mac} not found on any configured console`);
}

module.exports = { authorizeGuest };
