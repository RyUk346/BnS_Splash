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

const { readStores } = require("./stores");

/**
 * Configured consoles as [{ id, label }].
 *
 * Read fresh on every call from data/stores.json (managed via the admin
 * panel), falling back to the .env variables until that file exists — so
 * adding a store needs no restart, and existing .env setups keep working.
 */
function consoles() {
  return readStores();
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

// A few common OUIs (first 3 MAC octets -> manufacturer). The UniFi
// Integration API doesn't return the vendor field the dashboard shows, so we
// derive what we can from the MAC itself.
const OUI = {
  "6c:63:f8": "Ubiquiti", "74:ac:b9": "Ubiquiti", "78:8a:20": "Ubiquiti",
  "3c:22:fb": "Apple", "a4:83:e7": "Apple", "88:66:a5": "Apple",
  "f0:18:98": "Apple", "ac:bc:32": "Apple", "d0:81:7a": "Apple",
  "78:bd:bc": "Samsung", "5c:0a:5b": "Samsung", "e8:50:8b": "Samsung",
  "3c:5a:b4": "Google", "f4:f5:e8": "Google", "94:eb:2c": "Google",
  "00:1b:21": "Intel", "7c:b2:7d": "Intel", "e4:b3:18": "Intel",
  "50:2e:5c": "Huawei", "00:e0:4c": "Realtek", "b8:27:eb": "Raspberry Pi",
  "fc:a1:83": "Amazon", "00:11:62": "Star Micronics",
};

/**
 * Best-effort manufacturer from a MAC address.
 *
 * NOTE: iOS 14+/Android 10+ use per-network *randomised* MACs by default, so
 * most guest phones present a locally-administered address with no real OUI.
 * Those are reported as "Randomised" rather than a wrong guess.
 */
function vendorFromMac(mac) {
  const m = String(mac || "").toLowerCase().replace(/-/g, ":");
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(m)) return "";
  // Bit 1 of the first octet set => locally administered => randomised.
  const firstOctet = parseInt(m.slice(0, 2), 16);
  if (firstOctet & 0b10) return "Randomised";
  return OUI[m.slice(0, 8)] || "";
}

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
        return {
          branch: con.label,
          consoleId: con.id,
          minutes: AUTH_MINUTES,
          // Whatever UniFi knows about the device — usually a friendly name
          // like "Apple iPhone 14" or "Galaxy-Tab-A8". Often blank on first
          // sight of a brand-new device.
          deviceName: client.name || "",
          deviceType: client.type || "", // WIRELESS / WIRED
          vendor: vendorFromMac(mac),
        };
      } catch (err) {
        lastError = err; // console unreachable / API error — try the next one
      }
    }
  }

  throw lastError || new Error(`Client ${mac} not found on any configured console`);
}

/**
 * List the MAC addresses currently connected to a console (any client).
 * Used by the session poller to detect when a guest device has left.
 * Returns a lowercase Set of MAC strings.
 */
async function getConnectedMacs(consoleId) {
  const siteId = await getSiteId(consoleId);
  const macs = new Set();
  // Page through clients (the API caps page size).
  let offset = 0;
  const limit = 200;
  for (let page = 0; page < 20; page++) {
    const batch = items(
      await request(consoleId, `/sites/${siteId}/clients?limit=${limit}&offset=${offset}`)
    );
    for (const c of batch) {
      if (c.macAddress) macs.add(c.macAddress.toLowerCase());
    }
    if (batch.length < limit) break;
    offset += limit;
  }
  return macs;
}

/** The configured consoles: [{ id, label }]. */
function getConsoles() {
  return consoles();
}

/**
 * Is this device actually authorized on the network yet?
 * Asks each configured console for the client and reads its access flag.
 * Returns true / false, or null if no console could answer (unknown).
 */
async function isGuestAuthorized(mac) {
  if (!API_KEY) return null;
  const list = consoles();
  let sawAnswer = false;

  for (const con of list) {
    try {
      const siteId = await getSiteId(con.id);
      const client = await findClientByMac(con.id, siteId, mac);
      sawAnswer = true;
      if (!client) continue; // not on this console
      const access = client.access || {};
      // Guests carry access.authorized; non-guest/default clients are
      // already on the network, so treat them as authorized too.
      if (access.type && access.type !== "GUEST") return true;
      return access.authorized === true;
    } catch {
      // console unreachable — try the next one
    }
  }
  return sawAnswer ? false : null;
}

/** Raw HTTPS GET against a full URL (used for the account-level hosts list). */
function getJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "GET",
        headers: { "X-API-Key": API_KEY, Accept: "application/json" },
        timeout: 20000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            /* non-JSON */
          }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else
            reject(
              new Error((json && (json.message || json.error)) || `HTTP ${res.statusCode}`)
            );
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    req.end();
  });
}

/**
 * Every UniFi console on the account: [{ id, name, ip, state }].
 * Powers the "discover consoles" dropdown in the admin panel, so nobody has
 * to copy 60-character console IDs by hand.
 */
async function listHosts() {
  if (!API_KEY) throw new Error("UNIFI_API_KEY is not set");
  const resp = await getJson("https://api.ui.com/v1/hosts");
  return items(resp).map((h) => {
    const r = h.reportedState || {};
    return {
      id: h.id,
      name: r.name || r.hostname || h.id.slice(0, 12),
      ip: h.ipAddress || r.ip || "",
      state: r.state || "",
      model: (r.hardware && r.hardware.name) || "",
    };
  });
}

/**
 * Can we actually reach this console with the current API key?
 * Returns { ok: true, site } or { ok: false, error }.
 */
async function testConsole(consoleId) {
  try {
    const sites = items(await request(consoleId, "/sites"));
    if (!sites.length) return { ok: false, error: "No sites returned" };
    return { ok: true, site: sites[0].name || sites[0].id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  authorizeGuest,
  getConnectedMacs,
  getConsoles,
  isGuestAuthorized,
  listHosts,
  testConsole,
};
