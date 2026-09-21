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
const { consoleForAp, rememberAp } = require("./ap-routes");

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

// Site name used by the CLASSIC api (an internal reference like "default",
// not the UUID the Integration API uses).
const SITE_NAME = process.env.UNIFI_SITE_NAME || "default";

/**
 * Base URL for the older internal ("classic") Network API.
 * We use it only to read richer client details — it exposes `oui` (the
 * manufacturer shown in the UniFi dashboard) and `hostname`, neither of
 * which the newer Integration API returns.
 */
function classicBaseUrl(consoleId) {
  if (MODE === "direct") {
    if (!CONTROLLER_URL) throw new Error("UNIFI_CONTROLLER_URL is not set");
    return `${CONTROLLER_URL}/proxy/network/api/s/${SITE_NAME}`;
  }
  return `https://api.ui.com/v1/connector/consoles/${consoleId}/proxy/network/api/s/${SITE_NAME}`;
}

function baseUrl(consoleId) {
  if (MODE === "direct") {
    if (!CONTROLLER_URL) throw new Error("UNIFI_CONTROLLER_URL is not set");
    return `${CONTROLLER_URL}/proxy/network/integration/v1`;
  }
  return `https://api.ui.com/v1/connector/consoles/${consoleId}/proxy/network/integration/v1`;
}

/** Minimal HTTPS JSON request helper (handles self-signed certs in direct mode). */
// Background work (the session poller) can afford to wait; a guest staring at
// a "Connecting…" button cannot, so the guest path passes a shorter timeoutMs.
const DEFAULT_REQUEST_TIMEOUT_MS = 20000;

function request(
  consoleId,
  path,
  { method = "GET", body = null, classic = false, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}
) {
  return new Promise((resolve, reject) => {
    const url = new URL((classic ? classicBaseUrl(consoleId) : baseUrl(consoleId)) + path);
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
        timeout: timeoutMs,
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

// consoleId -> siteId, or the in-flight promise for it. Caching the PROMISE
// rather than the resolved value matters now that consoles are queried in
// parallel: ten simultaneous guests would otherwise each fire their own
// /sites request per console on a cold cache.
const siteCache = new Map();

function getSiteId(consoleId, timeoutMs) {
  if (process.env.UNIFI_SITE_ID) return Promise.resolve(process.env.UNIFI_SITE_ID);
  const hit = siteCache.get(consoleId);
  if (hit) return hit;

  const p = (async () => {
    const sites = items(await request(consoleId, "/sites", { timeoutMs }));
    if (!sites.length) throw new Error(`No sites returned for console ${consoleId}`);
    return sites[0].id;
  })();
  siteCache.set(consoleId, p);
  // Don't cache a failure — the next caller should be able to retry.
  p.catch(() => siteCache.delete(consoleId));
  return p;
}

// Does this console's server-side MAC filter actually work?
//   undefined = not established yet, true = works, false = always empty
//
// Timing logs showed `find` costing 2.3x the round-trip time on every single
// lookup: the filtered query was coming back empty and the 200-client scan
// behind it was finding the device. So on this UniFi version the filter is
// silently useless, and we were paying for it every time. Once that's been
// observed for a console, the filter is skipped and the scan is used
// directly — halving the cost of every lookup.
const filterWorks = new Map(); // consoleId -> boolean

/**
 * Find a client by MAC on one console.
 *
 * `deep` controls the fallback scan. When racing every console, the extra
 * scan per miss doubles request volume for no benefit, so the race passes
 * deep=false — unless we already know the filter is useless here, in which
 * case the scan is the only thing that works and gets used regardless.
 */
async function findClientByMac(consoleId, siteId, mac, { deep = true, timeoutMs } = {}) {
  const norm = mac.toLowerCase();
  const scan = async () => {
    const all = items(
      await request(consoleId, `/sites/${siteId}/clients?limit=200`, { timeoutMs })
    );
    return all.find((c) => (c.macAddress || "").toLowerCase() === norm) || null;
  };

  // Known-useless filter: don't waste a round trip on it.
  if (filterWorks.get(consoleId) === false) return scan();

  let filterFailed = false;
  try {
    const filter = encodeURIComponent(`macAddress.eq('${norm}')`);
    const found = items(
      await request(consoleId, `/sites/${siteId}/clients?filter=${filter}`, { timeoutMs })
    );
    if (found.length) {
      filterWorks.set(consoleId, true);
      return found[0];
    }
  } catch (err) {
    filterFailed = true;
    if (!deep) throw err; // caller is racing — report the error, don't scan
  }

  // Filter said "not here". Either that's true, or the filter is broken.
  if (!deep && !filterFailed) return null;

  const viaScan = await scan();
  if (viaScan && !filterFailed && filterWorks.get(consoleId) !== false) {
    // The filter missed a client that plainly exists — it can't be trusted.
    console.warn(
      `UniFi MAC filter returns nothing on console ${consoleId}; ` +
        "using the client list directly from now on (saves a round trip per lookup)."
    );
    filterWorks.set(consoleId, false);
  }
  return viaScan;
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
 * Richer device details for one MAC, read from the classic API — the same
 * source the UniFi dashboard uses for its Name and Vendor columns.
 *
 *   oui       -> manufacturer ("Apple, Inc."), blank when UniFi can't tell
 *   name      -> alias an admin set on the client
 *   hostname  -> device-reported name ("Watch", "Alexs-iPhone")
 *   dev_*     -> fingerprinting results, when UniFi has identified the device
 *
 * Returns { deviceName, vendor } — either may be "" if UniFi hasn't
 * fingerprinted the device yet (it usually needs a minute or two).
 */
async function getClientInfo(consoleId, mac) {
  const norm = String(mac || "").toLowerCase();
  try {
    // Active clients first…
    let all = items(await request(consoleId, "/stat/sta", { classic: true }));
    let c = all.find((x) => (x.mac || "").toLowerCase() === norm);

    // …then the known-clients history. UniFi keeps fingerprint results after
    // a device disconnects, so a guest who left before we could enrich them
    // can still be identified.
    if (!c) {
      try {
        const known = items(
          await request(consoleId, "/stat/alluser?within=24", { classic: true })
        );
        c = known.find((x) => (x.mac || "").toLowerCase() === norm);
      } catch {
        /* history unavailable — fall through */
      }
    }
    if (!c) return { deviceName: "", vendor: "" };

    const isMac = (v) => /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(String(v || "").trim());

    // Name: admin alias > device-reported hostname > fingerprinted model.
    let deviceName = "";
    if (c.name && !isMac(c.name)) deviceName = c.name;
    else if (c.hostname && !isMac(c.hostname)) deviceName = c.hostname;

    // Vendor straight from the OUI registry — this is the dashboard's column.
    let vendor = String(c.oui || "").trim();

    // Randomised MACs have no OUI, but UniFi may still have fingerprinted the
    // device. Those results are numeric IDs, so resolve them via the
    // fingerprint dictionary (cached; best-effort).
    if (!vendor || !deviceName) {
      const fp = await getFingerprintDict(consoleId);
      if (fp) {
        if (!vendor && c.dev_vendor != null) vendor = fp.vendors[String(c.dev_vendor)] || "";
        if (!deviceName) {
          const family = c.dev_family != null ? fp.families[String(c.dev_family)] : "";
          const model = c.dev_id != null ? fp.devices[String(c.dev_id)] : "";
          const os = c.os_name != null ? fp.osNames[String(c.os_name)] : "";
          deviceName = model || [vendor, family || os].filter(Boolean).join(" ").trim();
        }
      }
    }

    return { deviceName: String(deviceName || "").trim(), vendor: String(vendor || "").trim() };
  } catch {
    return { deviceName: "", vendor: "" }; // classic API unavailable — not fatal
  }
}

// UniFi's fingerprint dictionary maps the numeric dev_vendor / dev_family /
// dev_id / os_name fields to human names. It's effectively static, so fetch
// it once per console and keep it in memory.
const fpCache = new Map(); // consoleId -> { at, dict }
const FP_TTL_MS = 24 * 60 * 60 * 1000;

async function getFingerprintDict(consoleId) {
  const hit = fpCache.get(consoleId);
  if (hit && Date.now() - hit.at < FP_TTL_MS) return hit.dict;

  try {
    // v2 endpoint, so it sits outside both of our usual base URLs.
    const base =
      MODE === "direct"
        ? `${CONTROLLER_URL}/proxy/network/v2/api/fingerprint_devices/0`
        : `https://api.ui.com/v1/connector/consoles/${consoleId}/proxy/network/v2/api/fingerprint_devices/0`;
    const raw = await getJson(base);

    // Shape varies between versions; accept the common variants.
    // Values arrive as plain strings on some versions and objects on others,
    // and a few carry stray whitespace/tabs — normalise both.
    const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const asMap = (v) => {
      if (!v) return {};
      if (Array.isArray(v)) {
        return Object.fromEntries(
          v.map((x) => [String(x.id ?? x.key), clean(x.name ?? x.value)])
        );
      }
      return Object.fromEntries(
        Object.entries(v).map(([k, val]) => [
          String(k),
          clean(typeof val === "string" ? val : val && (val.name || val.vendor_name)),
        ])
      );
    };

    const dict = {
      vendors: asMap(raw.vendor_ids || raw.vendors),
      families: asMap(raw.family_ids || raw.families),
      devices: asMap(raw.dev_ids || raw.devices),
      osNames: asMap(raw.os_name_ids || raw.os_names),
    };
    fpCache.set(consoleId, { at: Date.now(), dict });
    return dict;
  } catch {
    fpCache.set(consoleId, { at: Date.now(), dict: null }); // don't retry constantly
    return null;
  }
}

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

/** Thrown when a console answered and simply doesn't have the device. */
class NotHere extends Error {
  constructor(consoleId) {
    super(`not on ${consoleId}`);
    this.name = "NotHere";
    this.notHere = true;
  }
}

/**
 * Look for a device on one console. Resolves { con, siteId, client } when
 * found; rejects when it isn't there or the console errors — so this can be
 * raced with Promise.any.
 *
 * The two rejection kinds are distinguished on purpose: "answered, not here"
 * means try again shortly (the device may not have appeared yet), whereas a
 * transport error means this console is no use right now and a routing hint
 * pointing at it should be abandoned rather than retried into a timeout.
 */
async function probeConsole(con, mac, { deep = true, timeoutMs } = {}) {
  const siteId = await getSiteId(con.id, timeoutMs);
  const client = await findClientByMac(con.id, siteId, mac, { deep, timeoutMs });
  if (!client) throw new NotHere(con.id);
  return { con, siteId, client };
}

/**
 * Run `fn` over `items` and resolve with the first success, rejecting only if
 * every one fails.
 *
 * Serial was the original behaviour and it cost a full round trip per miss; a
 * guest at the last-listed store paid for every store ahead of it. Racing
 * makes the whole sweep cost about as much as one lookup.
 *
 * Batched rather than all-at-once so a large estate doesn't fire thirty
 * simultaneous requests at api.ui.com and get throttled.
 */
async function firstSuccess(items, fn, batchSize = 6) {
  if (!items.length) throw new Error("nothing to try");
  const failures = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    try {
      return await Promise.any(batch.map((item) => fn(item)));
    } catch (err) {
      // AggregateError: everything in this batch failed.
      if (err && Array.isArray(err.errors)) failures.push(...err.errors);
      else failures.push(err);
    }
  }
  // Report a real failure ahead of a plain "device isn't on this console".
  // AggregateError orders by position, not cause, so picking the last one
  // usually surfaced a benign miss and hid the 401 or timeout that mattered.
  const real = failures.find((e) => e && !e.notHere);
  const chosen = real || failures[failures.length - 1];
  const out = chosen || new Error("all attempts failed");
  out.allNotHere = failures.length > 0 && !real;
  throw out;
}

/** First console that has this device. Rejects if none do. */
function raceConsoles(list, mac, batchSize = 6, timeoutMs) {
  // deep=true, despite the extra request per miss.
  //
  // This used to pass deep=false to keep request volume down, which was a
  // mistake: on a UniFi version whose MAC filter returns nothing (see
  // findClientByMac), suppressing the scan meant the race could never locate
  // a device at all — so the first guest at a new access point failed
  // outright after burning every retry. Correctness wins; and once the
  // filter has been observed to be useless, each probe is a single request
  // anyway.
  return firstSuccess(
    list,
    (con) => probeConsole(con, mac, { deep: true, timeoutMs }),
    batchSize
  );
}

// A freshly associated device takes a moment to show up in UniFi's client
// list, so a miss is often just "too early" rather than "wrong console".
// Kept deliberately short: this is time a guest spends staring at a button.
const FIND_ATTEMPTS = 5;
const FIND_RETRY_MS = 250;
// Hard ceiling on the whole lookup. Per-request timeouts alone don't bound
// this: several attempts against a dead console at 20s each would hold the
// guest on "Connecting…" for minutes. Better to fail in a few seconds and let
// them retry — their details are already saved either way.
const FIND_BUDGET_MS = 5000;
// Individual UniFi calls on the guest's critical path. The 20s default is for
// background work; a guest is waiting on these, and a console that hasn't
// answered in 6s isn't about to.
const FIND_REQUEST_TIMEOUT_MS = 6000;
// The status poll runs on a ~1.2s client budget, so waiting longer than this
// for any single check is pointless — the guest will have been redirected.
const STATUS_TIMEOUT_MS = 3000;

/**
 * Authorize a guest device and report which store it belongs to.
 *
 * `apMac` is the access point from the portal redirect URL. When we already
 * know which console that AP lives on we ask only that console — one request
 * instead of one per store. The mapping is a cache, so if it's wrong (AP moved
 * consoles) we fall back to searching and correct it.
 *
 * Device name and vendor are deliberately NOT fetched here: they need two more
 * round trips, UniFi usually hasn't fingerprinted a just-joined device anyway,
 * and the session poller fills them in properly a few minutes later. The
 * caller enriches them off the critical path.
 */
async function authorizeGuest(mac, { apMac = "" } = {}) {
  if (!API_KEY) throw new Error("UNIFI_API_KEY is not set");
  const list = consoles();
  if (!list.length) throw new Error("No UniFi consoles configured (UNIFI_CONSOLES / UNIFI_CONSOLE_ID)");

  const hintedId = apMac ? consoleForAp(apMac) : "";
  let hinted = hintedId ? list.find((c) => c.id === hintedId) : null;

  const t0 = Date.now();
  const deadline = t0 + FIND_BUDGET_MS;
  let lastError = null;
  // Reported back to the caller so the connect log can attribute the time.
  const timing = { findMs: 0, authMs: 0, attempts: 0, waitedMs: 0, hinted: !!hinted };

  for (let attempt = 0; attempt < FIND_ATTEMPTS; attempt++) {
    timing.attempts = attempt + 1;
    if (attempt > 0) {
      if (Date.now() >= deadline) break;
      await sleep(FIND_RETRY_MS);
      timing.waitedMs += FIND_RETRY_MS;
    }

    // Give the hinted console the first couple of tries on its own; past that
    // assume the hint is stale and search properly.
    const useHint = hinted && attempt < 2;

    let found = null;
    const findStart = Date.now();
    try {
      found = useHint
        ? await probeConsole(hinted, mac, { timeoutMs: FIND_REQUEST_TIMEOUT_MS })
        : await raceConsoles(list, mac, 6, FIND_REQUEST_TIMEOUT_MS);
      timing.findMs += Date.now() - findStart;
    } catch (err) {
      timing.findMs += Date.now() - findStart;
      lastError = err;
      // "Answered, device not here" is usually just too early, so the hint
      // stays — the next guest at this AP shouldn't pay for a sweep, and a
      // successful search overwrites the mapping anyway. A transport error is
      // different: that console is no use right now, and retrying it into a
      // 20s timeout is exactly the stall this change set out to remove.
      if (useHint && !err.notHere) hinted = null;
      continue;
    }

    const { con, siteId, client } = found;
    const authStart = Date.now();
    try {
      await request(con.id, `/sites/${siteId}/clients/${client.id}/actions`, {
        method: "POST",
        body: {
          action: "AUTHORIZE_GUEST_ACCESS",
          timeLimitMinutes: AUTH_MINUTES,
        },
        timeoutMs: FIND_REQUEST_TIMEOUT_MS,
      });
      timing.authMs = Date.now() - authStart;
    } catch (err) {
      timing.authMs = Date.now() - authStart;
      lastError = err;
      continue;
    }

    if (apMac) rememberAp(apMac, con.id);

    return {
      branch: con.label,
      consoleId: con.id,
      minutes: AUTH_MINUTES,
      deviceName: "", // enriched off the critical path; poller backfills later
      deviceType: client.type || "", // WIRELESS / WIRED
      vendor: vendorFromMac(mac), // local MAC lookup, no network call
      timing,
    };
  }

  throw lastError || new Error(`Client ${mac} not found on any configured console`);
}

/**
 * Richer device details (name + manufacturer) for a device we've already
 * located. Two extra round trips, so it runs after the guest has been let
 * through rather than while they wait.
 */
async function getClientDetails(consoleId, mac) {
  const looksLikeMac = (v) =>
    /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(String(v || "").trim());
  try {
    const info = await getClientInfo(consoleId, mac);
    return {
      deviceName: looksLikeMac(info.deviceName) ? "" : info.deviceName || "",
      vendor: info.vendor || vendorFromMac(mac),
    };
  } catch {
    return { deviceName: "", vendor: vendorFromMac(mac) };
  }
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
 * Has this device's guest authorization actually been applied yet?
 *
 * The splash page polls this every second while the guest waits, so it must
 * be cheap. Pass the consoleId that /api/connect already identified and we
 * check exactly one console; without it we fall back to searching, which is
 * what this used to do on every single poll.
 */
async function isGuestAuthorized(mac, consoleId = "") {
  if (!API_KEY) return null;

  const verdict = (client) => {
    const access = client.access || {};
    // Guests carry access.authorized; non-guest/default clients are already
    // on the network, so treat them as authorized too.
    if (access.type && access.type !== "GUEST") return true;
    return access.authorized === true;
  };

  const list = consoles();

  // The consoleId arrives from the splash page's query string, so it is
  // untrusted input. It gets interpolated into an api.ui.com URL that carries
  // our account API key, and `new URL()` would happily resolve "../" segments
  // in it — so anything not in the configured store list is discarded rather
  // than used.
  const hinted = consoleId ? list.find((c) => c.id === consoleId) : null;

  if (hinted) {
    try {
      const siteId = await getSiteId(hinted.id, STATUS_TIMEOUT_MS);
      // deep=false and a short timeout: a guest is waiting on this, and the
      // 200-client fallback scan would double the cost of every miss.
      const client = await findClientByMac(hinted.id, siteId, mac, {
        deep: false,
        timeoutMs: STATUS_TIMEOUT_MS,
      });
      // Reachable and the client isn't authorized yet -> keep waiting.
      return client ? verdict(client) : false;
    } catch {
      // This console errored. Don't report "null" (which tells the page to
      // stop waiting and redirect) off one transient failure — fall through
      // and ask the others.
    }
  }

  // Fallback sweep: no usable console id was supplied.
  //
  // This was a serial loop with the default 20s per-request timeout, and it
  // was measured at 18.3 SECONDS for six consoles — worse than the original
  // problem, sitting right on the path of a waiting guest. Now it's the same
  // parallel race the authorize path uses, with the short poll timeout.
  const rest = hinted ? list.filter((c) => c.id !== hinted.id) : list;
  if (!rest.length) return null;

  try {
    const { client } = await firstSuccess(
      rest,
      (con) => probeConsole(con, mac, { timeoutMs: STATUS_TIMEOUT_MS }),
      6
    );
    return verdict(client);
  } catch (err) {
    // Every console answered and none had the device -> definitively false.
    // Anything else means we couldn't get an answer, which is `null` and
    // tells the caller to stop waiting rather than keep polling.
    return err && err.allNotHere ? false : null;
  }
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
  getClientDetails,
  getConnectedMacs,
  getConsoles,
  getClientInfo,
  isGuestAuthorized,
  listHosts,
  testConsole,
  // exported for tests
  firstSuccess,
  raceConsoles,
};
