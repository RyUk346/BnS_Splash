// Tiny file-backed store that links a guest's Wi-Fi session to its Google
// Sheet row, so the background poller can fill in disconnect time + duration.
//
// Two files under /data (git-ignored):
//   inbox.jsonl   — the web app APPENDS one JSON line per new session here.
//                   Append-only, so it never races with the poller.
//   sessions.json — owned/rewritten by the poller only (its tracking state).
//
// This separation means the Next.js app and the poller process never write
// the same file, avoiding corruption without needing a real lock.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const INBOX = path.join(DATA_DIR, "inbox.jsonl");
const STATE = path.join(DATA_DIR, "sessions.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** Called by the web app: record a newly authorized session (append-only). */
function recordSession(session) {
  ensureDir();
  fs.appendFileSync(INBOX, JSON.stringify(session) + "\n");
}

/** Poller: drain the inbox, returning any new sessions and clearing the file. */
function drainInbox() {
  ensureDir();
  if (!fs.existsSync(INBOX)) return [];
  const raw = fs.readFileSync(INBOX, "utf8");
  // Clear immediately so the app keeps appending fresh entries cleanly.
  fs.writeFileSync(INBOX, "");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** Poller: load its tracking state (array of sessions). */
function loadState() {
  ensureDir();
  if (!fs.existsSync(STATE)) return [];
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    return [];
  }
}

/** Poller: persist its tracking state. */
function saveState(sessions) {
  ensureDir();
  fs.writeFileSync(STATE, JSON.stringify(sessions, null, 2));
}

module.exports = { recordSession, drainInbox, loadState, saveState, DATA_DIR };
