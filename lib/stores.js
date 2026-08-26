// Store (console) registry.
//
// Source of truth is data/stores.json — writable at runtime, so stores can be
// added from the admin panel with no SSH, no .env edit and no restart.
//
// On first read, if that file doesn't exist yet, the list is seeded from the
// existing .env variables (UNIFI_CONSOLE_<n> / UNIFI_CONSOLES /
// UNIFI_CONSOLE_ID) so nothing breaks during the switchover.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const STORES_FILE = path.join(DATA_DIR, "stores.json");

/** "consoleId|Store Label" -> { id, label }, or null if unusable. */
function parseEntry(entry) {
  const [id, label] = String(entry || "").split("|").map((s) => s.trim());
  return id ? { id, label: label || id.slice(0, 12) } : null;
}

/** Stores defined in environment variables (the pre-panel way). */
function envStores() {
  const found = [];
  const seen = new Set();
  const add = (entry) => {
    const parsed = parseEntry(entry);
    if (parsed && !seen.has(parsed.id)) {
      seen.add(parsed.id);
      found.push(parsed);
    }
  };

  // UNIFI_CONSOLE_<n>, sorted numerically (so _10 comes after _2)
  Object.keys(process.env)
    .map((key) => {
      const m = key.match(/^UNIFI_CONSOLE_(\d+)$/);
      return m ? { key, n: Number(m[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.n - b.n)
    .forEach(({ key }) => add(process.env[key]));

  // Comma-separated list (newlines tolerated)
  const multi = (process.env.UNIFI_CONSOLES || "").trim();
  if (multi) multi.split(",").forEach(add);

  // Legacy single console
  const single = (process.env.UNIFI_CONSOLE_ID || "").trim();
  if (single && !seen.has(single)) {
    found.push({ id: single, label: process.env.UNIFI_BRANCH_NAME || single.slice(0, 12) });
  }

  return found;
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** All configured stores: [{ id, label, addedAt? }]. */
function readStores() {
  try {
    if (fs.existsSync(STORES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STORES_FILE, "utf8"));
      if (Array.isArray(parsed)) {
        return parsed.filter((s) => s && s.id).map((s) => ({
          id: String(s.id),
          label: String(s.label || s.id.slice(0, 12)),
          addedAt: s.addedAt || null,
        }));
      }
    }
  } catch (err) {
    console.error("stores.json unreadable, falling back to env:", err.message);
  }
  return envStores();
}

function writeStores(list) {
  ensureDir();
  const clean = list
    .filter((s) => s && s.id)
    .map((s) => ({
      id: String(s.id).trim(),
      label: String(s.label || "").trim() || String(s.id).slice(0, 12),
      addedAt: s.addedAt || new Date().toISOString(),
    }));
  fs.writeFileSync(STORES_FILE, JSON.stringify(clean, null, 2));
  return clean;
}

function addStore({ id, label }) {
  const cleanId = String(id || "").trim();
  if (!cleanId) throw new Error("Console ID is required");
  const list = readStores();
  if (list.some((s) => s.id === cleanId)) throw new Error("That console is already added");
  return writeStores([...list, { id: cleanId, label, addedAt: new Date().toISOString() }]);
}

function updateStore(id, label) {
  const list = readStores();
  if (!list.some((s) => s.id === id)) throw new Error("Store not found");
  return writeStores(list.map((s) => (s.id === id ? { ...s, label } : s)));
}

function removeStore(id) {
  const list = readStores();
  const next = list.filter((s) => s.id !== id);
  if (next.length === list.length) throw new Error("Store not found");
  if (!next.length) throw new Error("Cannot remove the last store — add another first");
  return writeStores(next);
}

/** True once the registry has been migrated to stores.json. */
function isFileBacked() {
  return fs.existsSync(STORES_FILE);
}

module.exports = {
  readStores,
  writeStores,
  addStore,
  updateStore,
  removeStore,
  envStores,
  isFileBacked,
  STORES_FILE,
};
