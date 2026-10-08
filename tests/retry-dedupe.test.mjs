// A retried connect must never produce two Sheet rows.
//
// When a connect fails the guest's details are already saved, and the splash
// page retries once automatically. If that retry used a fresh row key the
// guest would appear twice in the sheet — turning a fix for one complaint
// ("it failed") into a worse one ("my data is duplicated"). The retry carries
// the original key back via `retryOf`, and this checks that every layer which
// could duplicate actually dedupes on it.

import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  okk ? pass++ : (fail++, console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`));
};
const ok = (name, cond) => eq(name, !!cond, true);

const cwd = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "retry-"));
process.chdir(tmp);

process.env.GOOGLE_SHEETS_WEBHOOK_URL = "https://script.google.test/exec";
process.env.SHEETS_READ_KEY = "test-key";

/* Fake Apps Script with the same idempotent append the real one does. */
const sheet = [];
let appendCalls = 0;
globalThis.fetch = async (url, opts = {}) => {
  if (!opts.method || opts.method === "GET") {
    const q = new URL(String(url)).searchParams;
    const wanted = (q.get("ts") || "").split(",").filter(Boolean);
    const found = wanted.filter((ts) => sheet.some((r) => r.timestamp === ts));
    return { ok: true, status: 200, json: async () => ({ success: true, found }) };
  }
  appendCalls += 1;
  const body = JSON.parse(opts.body);
  // Code.gs: skip when a row with this timestamp + mac already exists.
  const dup = sheet.some(
    (r) => r.timestamp === body.timestamp &&
           String(r.mac || "").toLowerCase() === String(body.mac || "").toLowerCase()
  );
  if (!dup) sheet.push(body);
  return { status: 302 };
};

delete require.cache[require.resolve("../lib/pending-sheet.js")];
delete require.cache[require.resolve("../lib/sheet-sync.js")];
const q = require("../lib/pending-sheet.js");
const sync = require("../lib/sheet-sync.js");

const KEY = "2026-10-08T12:00:00.000Z";
const signup = {
  timestamp: KEY,
  mac: "aa:bb:cc:11:22:33",
  email: "guest@example.com",
  firstName: "Guest",
  phone: "07123456789",
  birthday: "14/03/1990",
  promo: "Yes",
  branch: "BnS Perry Barr",
};

/* ── The retry path: same key, queued twice ─────────────────────── */
{
  // Attempt 1 — authorization fails, but the signup is queued first.
  const id1 = q.enqueue(signup);
  eq("queued on the failed attempt", q.pending().length, 1);

  // Attempt 2 — the page retries with retryOf, so the server reuses the key.
  const id2 = q.enqueue({ ...signup });
  eq("retry reuses the same queue id", id2, id1);
  eq("still ONE queued entry, not two", q.pending().length, 1);

  await sync.flushQueue({});
  eq("exactly one row on the sheet", sheet.length, 1);
  eq("it's the right guest", sheet[0].email, "guest@example.com");
  eq("queue drained", q.pending().length, 0);
}

/* ── What a retry WITHOUT retryOf would have done ───────────────── */
{
  // Proves the guard is doing real work: a fresh key is a second row.
  const before = sheet.length;
  q.enqueue({ ...signup, timestamp: "2026-10-08T12:00:00.001Z" });
  await sync.flushQueue({});
  eq("a different key DOES create a second row", sheet.length, before + 1);
  ok("which is exactly what retryOf prevents", sheet.length === 2);
}

/* ── Belt and braces: the append itself is idempotent ───────────── */
{
  const callsBefore = appendCalls;
  // Force a re-send of a row that's already on the sheet.
  q.enqueue(signup);
  await sync.flushQueue({});
  eq("no extra row even if it is re-sent", sheet.filter((r) => r.timestamp === KEY).length, 1);
  ok("and the queue clears", q.pending().length === 0);
  ok("verification avoided a pointless append", appendCalls === callsBefore);
}

/* ── A genuinely different guest still gets their own row ───────── */
{
  const other = {
    ...signup,
    timestamp: "2026-10-08T12:05:00.000Z",
    mac: "dd:ee:ff:44:55:66",
    email: "second@example.com",
  };
  q.enqueue(other);
  await sync.flushQueue({});
  ok("second guest is not swallowed by dedupe",
     sheet.some((r) => r.email === "second@example.com"));
}

/* ── retryOf validation (mirrors the route's check) ─────────────── */
{
  const valid = (v, now = Date.parse("2026-10-08T12:00:30.000Z")) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
    Math.abs(now - Date.parse(v)) < 10 * 60 * 1000;

  ok("accepts a key from moments ago", valid("2026-10-08T12:00:00.000Z"));
  ok("rejects junk", !valid("not-a-timestamp"));
  ok("rejects an empty value", !valid(""));
  ok("rejects a loose ISO string without ms", !valid("2026-10-08T12:00:00Z"));
  ok("rejects something hours old", !valid("2026-10-08T09:00:00.000Z"));
  ok("rejects a future key", !valid("2026-10-08T23:00:00.000Z"));
  ok("rejects SQL-ish injection attempts", !valid("2026-10-08T12:00:00.000Z' OR '1"));
}

process.chdir(cwd);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
