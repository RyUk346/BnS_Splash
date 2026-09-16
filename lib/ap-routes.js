// AP MAC -> console (store) routing table.
//
// Why this exists: authorizing a guest means asking UniFi "which console is
// this device on?". With one console that's one request. With six it was six
// requests, tried one after another, over the cloud proxy — and a guest at the
// console that happened to sit last in the list waited through five misses
// first. That was the bulk of the ~30s connect time, and it got worse with
// every store added.
//
// UniFi already tells us which access point the guest came through (`ap` in
// the portal redirect URL). An AP belongs to exactly one console, so the first
// guest through each AP teaches us the mapping and everyone after goes
// straight to the right console.
//
// The table is a cache, never a source of truth: if the mapped console doesn't
// have the device (AP re-homed, entry stale), the caller falls back to
// searching and re-learns. Losing the file costs one slow connect per AP.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const ROUTES_FILE = path.join(DATA_DIR, "ap-routes.json");

let cache = null; // { [apMac]: { consoleId, at } }
let dirty = false;
let flushTimer = null;

function normaliseMac(mac) {
  const m = String(mac || "").toLowerCase().trim().replace(/-/g, ":");
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(m) ? m : "";
}

function load() {
  if (cache) return cache;
  cache = {};
  try {
    if (fs.existsSync(ROUTES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ROUTES_FILE, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [ap, v] of Object.entries(parsed)) {
          const mac = normaliseMac(ap);
          const consoleId = v && typeof v === "object" ? v.consoleId : v;
          if (mac && consoleId) {
            cache[mac] = { consoleId: String(consoleId), at: (v && v.at) || null };
          }
        }
      }
    }
  } catch (err) {
    // A corrupt file must not break guest connections — it only means we go
    // back to searching until the table is relearned.
    console.error("ap-routes.json unreadable, starting empty:", err.message);
    cache = {};
  }
  return cache;
}

/** Batched write — a busy lunchtime shouldn't mean a disk write per guest. */
function scheduleFlush() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!dirty) return;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      // tmp + rename: a crash mid-write would otherwise truncate the file and
      // lose the whole table rather than one entry.
      const tmp = `${ROUTES_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
      fs.renameSync(tmp, ROUTES_FILE);
      dirty = false; // only clear once the write actually landed
    } catch (err) {
      // Leave `dirty` set so the next change reschedules and tries again,
      // instead of silently going memory-only until a restart.
      console.error("could not save ap-routes.json:", err.message);
    }
  }, 5000);
  // Don't hold the process open just for this.
  if (flushTimer.unref) flushTimer.unref();
}

/** Console this AP was last seen on, or "" if we've never routed it. */
function consoleForAp(apMac) {
  const mac = normaliseMac(apMac);
  if (!mac) return "";
  const hit = load()[mac];
  return hit ? hit.consoleId : "";
}

// The AP MAC comes from the guest's request, so the key space is attacker-
// influenced: anyone who can connect could add MAC-shaped entries. A real
// estate has tens of APs, so a few hundred is far more than enough and keeps
// the table bounded. Poisoning an entry is self-correcting — the next guest
// there falls through to a search, which overwrites it.
const MAX_ROUTES = 500;

/** Record (or correct) which console an AP belongs to. */
function rememberAp(apMac, consoleId) {
  const mac = normaliseMac(apMac);
  const id = String(consoleId || "").trim();
  if (!mac || !id) return;
  const map = load();
  if (map[mac] && map[mac].consoleId === id) return; // unchanged

  if (!map[mac] && Object.keys(map).length >= MAX_ROUTES) {
    // Evict the oldest learned entry rather than refusing to learn — a real
    // AP that just came online matters more than a stale one.
    let oldestMac = null;
    let oldestAt = null;
    for (const [k, v] of Object.entries(map)) {
      const at = v && v.at ? v.at : "";
      if (oldestAt === null || at < oldestAt) {
        oldestAt = at;
        oldestMac = k;
      }
    }
    if (oldestMac) delete map[oldestMac];
  }

  map[mac] = { consoleId: id, at: new Date().toISOString() };
  scheduleFlush();
}

/** Drop an AP's mapping — used when the mapped console no longer has it. */
function forgetAp(apMac) {
  const mac = normaliseMac(apMac);
  if (!mac) return;
  const map = load();
  if (map[mac]) {
    delete map[mac];
    scheduleFlush();
  }
}

/** Whole table, for diagnostics in the admin panel. */
function allRoutes() {
  return { ...load() };
}

module.exports = {
  consoleForAp,
  rememberAp,
  forgetAp,
  allRoutes,
  ROUTES_FILE,
  MAX_ROUTES,
};
