/**
 * UniFi Network Integration API client.
 *
 * Two modes (set UNIFI_MODE in .env):
 *
 *  "cloud"  (recommended) — goes through Ubiquiti's Cloud Connector Proxy.
 *           No port forwarding needed; works from any VPS.
 *           Base: https://api.ui.com/v1/connector/consoles/{CONSOLE_ID}/proxy/network/integration/v1
 *           Requires: UNIFI_API_KEY (from unifi.ui.com -> API Keys), UNIFI_CONSOLE_ID
 *
 *  "direct" — talks straight to the console (needs the console reachable
 *           from the VPS, e.g. via port forward or VPN).
 *           Base: https://{console-host}/proxy/network/integration/v1
 *           Requires: UNIFI_API_KEY (Network -> Settings -> Control Plane ->
 *           Integrations), UNIFI_CONTROLLER_URL
 */

const https = require("https");
const { URL } = require("url");

const MODE = process.env.UNIFI_MODE || "cloud";
const API_KEY = process.env.UNIFI_API_KEY || "";
const CONSOLE_ID = process.env.UNIFI_CONSOLE_ID || "";
const CONTROLLER_URL = (process.env.UNIFI_CONTROLLER_URL || "").replace(/\/+$/, "");
const SITE_ID = process.env.UNIFI_SITE_ID || "";
const AUTH_MINUTES = parseInt(process.env.AUTH_MINUTES || "1440", 10);

function baseUrl() {
  if (MODE === "direct") {
    if (!CONTROLLER_URL) throw new Error("UNIFI_CONTROLLER_URL is not set");
    return `${CONTROLLER_URL}/proxy/network/integration/v1`;
  }
  if (!CONSOLE_ID) throw new Error("UNIFI_CONSOLE_ID is not set");
  return `https://api.ui.com/v1/connector/consoles/${CONSOLE_ID}/proxy/network/integration/v1`;
}

/** Minimal HTTPS JSON request helper (handles self-signed certs in direct mode). */
function request(path, { method = "GET", body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl() + path);
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

async function getSiteId() {
  if (SITE_ID) return SITE_ID;
  const sites = items(await request("/sites"));
  if (!sites.length) throw new Error("No sites returned by UniFi API");
  return sites[0].id;
}

async function findClientByMac(siteId, mac) {
  const norm = mac.toLowerCase();
  // Preferred: server-side filter
  try {
    const filter = encodeURIComponent(`macAddress.eq('${norm}')`);
    const found = items(await request(`/sites/${siteId}/clients?filter=${filter}`));
    if (found.length) return found[0];
  } catch {
    /* fall through to manual scan */
  }
  // Fallback: scan the client list
  const all = items(await request(`/sites/${siteId}/clients?limit=200`));
  return all.find((c) => (c.macAddress || "").toLowerCase() === norm) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Authorize a guest device on the hotspot network.
 * Retries the client lookup a few times because a freshly connected
 * device can take a moment to appear in the API.
 */
async function authorizeGuest(mac) {
  if (!API_KEY) throw new Error("UNIFI_API_KEY is not set");
  const siteId = await getSiteId();

  let client = null;
  for (let attempt = 0; attempt < 4 && !client; attempt++) {
    if (attempt > 0) await sleep(1500);
    client = await findClientByMac(siteId, mac);
  }
  if (!client) throw new Error(`Client ${mac} not found on site ${siteId}`);

  await request(`/sites/${siteId}/clients/${client.id}/actions`, {
    method: "POST",
    body: {
      action: "AUTHORIZE_GUEST_ACCESS",
      timeLimitMinutes: AUTH_MINUTES,
    },
  });

  return { siteId, clientId: client.id, minutes: AUTH_MINUTES };
}

module.exports = { authorizeGuest };
