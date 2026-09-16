// The requirement is absolute: every signup reaches the Google Sheet, and
// none arrives twice. These tests drive lib/sheet-sync against a fake Apps
// Script so the nasty cases can actually be exercised — in particular the one
// that made the old code unsafe, where a POST *looks* like it failed but the
// row was written anyway.

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheetsync-"));
process.chdir(tmp);

process.env.GOOGLE_SHEETS_WEBHOOK_URL = "https://script.google.test/exec";
process.env.SHEETS_READ_KEY = "test-key";

/* ── Fake Apps Script ────────────────────────────────────────────── */

/**
 * `sheet` is the rows actually stored. `behaviour` decides what the fake does,
 * so each test can simulate one real failure mode.
 */
const fake = {
  sheet: [],
  behaviour: "ok",
  appendCalls: 0,
  verifyCalls: 0,
  reset(behaviour = "ok") {
    this.sheet = [];
    this.behaviour = behaviour;
    this.appendCalls = 0;
    this.verifyCalls = 0;
  },
};

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);

  // GET ?action=verify
  if (!opts.method || opts.method === "GET") {
    fake.verifyCalls += 1;
    if (fake.behaviour === "verifyDown") throw new Error("ECONNREFUSED");
    if (fake.behaviour === "oldDeployment") {
      // A deployment predating the verify action falls through to its health
      // check, which has neither `success` nor `found`.
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, service: "HyperGlow WiFi signups webhook" }),
      };
    }
    const q = new URL(u).searchParams;
    if (q.get("key") !== process.env.SHEETS_READ_KEY) {
      return { ok: true, status: 200, json: async () => ({ success: false, error: "unauthorized" }) };
    }
    const wanted = (q.get("ts") || "").split(",").filter(Boolean);
    const found = wanted.filter((ts) => fake.sheet.some((r) => r.timestamp === ts));
    return { ok: true, status: 200, json: async () => ({ success: true, found }) };
  }

  // POST append
  fake.appendCalls += 1;
  const body = JSON.parse(opts.body);

  if (fake.behaviour === "appendDown") {
    return { status: 500 };
  }
  if (fake.behaviour === "writesThenLooksFailed") {
    // The case that made the old code unsafe: the row IS written, but the
    // response looks like a failure, so a naive retry would duplicate it.
    if (!fake.sheet.some((r) => r.timestamp === body.timestamp)) fake.sheet.push(body);
    return { status: 500 };
  }
  if (fake.behaviour === "silentFailure") {
    // The other unsafe case: a 302 that looks fine while the append threw.
    return { status: 302 };
  }

  // Normal: idempotent append, exactly as Code.gs now does it.
  if (!fake.sheet.some((r) => r.timestamp === body.timestamp)) fake.sheet.push(body);
  return { status: 302 };
};

/* ── Load the modules under test (after cwd + fetch are in place) ── */

const freshModules = () => {
  delete require.cache[require.resolve("../lib/pending-sheet.js")];
  delete require.cache[require.resolve("../lib/sheet-sync.js")];
  return {
    q: require("../lib/pending-sheet.js"),
    sync: require("../lib/sheet-sync.js"),
  };
};

const signup = (n) => ({
  timestamp: `2026-09-16T12:0${n}:00.000Z`,
  mac: `aa:bb:cc:00:00:0${n}`,
  email: `guest${n}@example.com`,
  firstName: `Guest ${n}`,
  phone: "07123456789",
  birthday: "14/03/1990",
  promo: "Yes",
  branch: "BnS Perry Barr",
});

const clearQueueFile = () => {
  const f = path.join(tmp, "data", "pending-sheet.json");
  if (fs.existsSync(f)) fs.unlinkSync(f);
};

/* ── Happy path ──────────────────────────────────────────────────── */
{
  clearQueueFile();
  const { q, sync } = freshModules();
  fake.reset("ok");

  q.enqueue(signup(1));
  const res = await sync.flushQueue({});
  eq("row reaches the sheet", fake.sheet.length, 1);
  eq("guest details are on the row", fake.sheet[0].email, "guest1@example.com");
  eq("queue is cleared once confirmed", q.pending().length, 0);
  eq("reports it saved one", res.saved, 1);
}

/* ── The append succeeded but the response looked like a failure ── */
{
  clearQueueFile();
  const { q, sync } = freshModules();
  fake.reset("writesThenLooksFailed");

  q.enqueue(signup(2));
  const res = await sync.flushQueue({});
  eq("row was written despite the error response", fake.sheet.length, 1);
  // The post-append read-back notices the row landed even though the POST
  // reported 500, so it settles in this same pass rather than waiting for a
  // retry. That is the whole point of verifying instead of trusting the POST.
  eq("settled once read-back confirmed it", q.pending().length, 0);
  eq("counted as saved", res.saved, 1);
  eq("appended exactly once", fake.appendCalls, 1);

  // And a later pass must not re-send it.
  fake.behaviour = "ok";
  const before = fake.appendCalls;
  await sync.flushQueue({});
  eq("NO duplicate row", fake.sheet.length, 1);
  eq("nothing re-appended", fake.appendCalls, before);
}

/* ── The 302 lied: script threw, nothing written ─────────────────── */
{
  clearQueueFile();
  const { q, sync } = freshModules();
  fake.reset("silentFailure");

  q.enqueue(signup(3));
  await sync.flushQueue({});
  eq("nothing was actually written", fake.sheet.length, 0);
  // This is the regression that mattered: the old code trusted the 302 and
  // dropped the entry, losing the signup for good.
  eq("signup is NOT discarded on a false success", q.pending().length, 1);
  eq("details are intact for the retry", q.pending()[0].entry.email, "guest3@example.com");

  fake.behaviour = "ok";
  await sync.flushQueue({});
  eq("retry gets it onto the sheet", fake.sheet.length, 1);
  eq("and then clears", q.pending().length, 0);
}

/* ── Sheets is down entirely ─────────────────────────────────────── */
{
  clearQueueFile();
  const { q, sync } = freshModules();
  fake.reset("appendDown");

  for (let i = 4; i <= 6; i++) q.enqueue(signup(i));
  await sync.flushQueue({});
  eq("nothing written while down", fake.sheet.length, 0);
  eq("all three still queued", q.pending().length, 3);
  ok("failure is recorded for visibility", q.pending()[0].attempts >= 1);

  // Backs off rather than hammering: stops after the first failure.
  eq("stops after the first failure", fake.appendCalls, 1);

  fake.behaviour = "ok";
  await sync.flushQueue({});
  eq("all three land once it recovers", fake.sheet.length, 3);
  eq("queue fully drains", q.pending().length, 0);
}

/* ── Verification unavailable: must not append blind ─────────────── */
{
  clearQueueFile();
  const { q, sync } = freshModules();
  fake.reset("verifyDown");

  q.enqueue(signup(7));
  const res = await sync.flushQueue({});
  // Appending without being able to verify is how duplicates happen, so the
  // safe move is to wait.
  eq("does not append when it cannot verify", fake.appendCalls, 0);
  eq("entry is kept", q.pending().length, 1);
  eq("reports nothing saved", res.saved, 0);
}

/* ── Apps Script not yet redeployed: degrade, don't stall ────────── */
{
  clearQueueFile();
  const { q, sync } = freshModules();
  fake.reset("ok");
  fake.behaviour = "oldDeployment";

  q.enqueue(signup(1));
  const res = await sync.flushQueue({});
  // The old script has no verify action. Writing nothing at all would be far
  // worse than the previous best-effort behaviour, so it appends anyway.
  eq("still writes the row without verification", fake.sheet.length, 1);
  eq("and clears the queue", q.pending().length, 0);
  eq("counted as saved", res.saved, 1);
}

/* ── Device details are merged in when available ─────────────────── */
{
  clearQueueFile();
  const { q, sync } = freshModules();
  fake.reset("ok");

  const s = signup(8);
  q.enqueue(s);
  await sync.flushQueue({
    enrich: { [s.timestamp]: { deviceName: "Sam's iPhone", vendor: "Apple" } },
  });
  eq("device name written", fake.sheet[0].deviceName, "Sam's iPhone");
  eq("vendor written", fake.sheet[0].vendor, "Apple");
}

/* ── A restart mid-flight loses nothing ──────────────────────────── */
{
  clearQueueFile();
  const { q } = freshModules();
  fake.reset("ok");

  q.enqueue(signup(9));
  // Simulate the process dying here: nothing was sent, queue is on disk.
  const reloaded = freshModules();
  eq("queue survived the restart", reloaded.q.pending().length, 1);
  await reloaded.sync.flushQueue({});
  eq("and the row still lands", fake.sheet.length, 1);
  eq("then clears", reloaded.q.pending().length, 0);
}

/* ── A double submit can't produce two rows ──────────────────────── */
{
  clearQueueFile();
  const { q, sync } = freshModules();
  fake.reset("ok");

  const s = signup(1);
  q.enqueue(s);
  q.enqueue(s); // same timestamp + mac
  eq("only queued once", q.pending().length, 1);
  await sync.flushQueue({});
  eq("one row on the sheet", fake.sheet.length, 1);
}

/* ── Two guests in the same millisecond ──────────────────────────── */
{
  const { nextRowKey, _reset } = require("../lib/row-key.js");
  _reset();
  // Same clock reading three times over — as happens when concurrent requests
  // land inside one millisecond.
  const a = nextRowKey(1758000000000);
  const b = nextRowKey(1758000000000);
  const c = nextRowKey(1758000000000);
  ok("row keys are unique within a millisecond", a !== b && b !== c && a !== c);
  ok("and strictly increasing", a < b && b < c);
  eq("format is unchanged ISO 8601", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(a), true);
  // Once the clock moves on, keys track real time again rather than drifting.
  eq("catches back up to the clock", nextRowKey(1758000000010), "2025-09-16T05:20:00.010Z");

  // The delivery consequence: two signups sharing a timestamp would have had
  // the second settled off the first one's row, losing it.
  clearQueueFile();
  const { q, sync } = freshModules();
  fake.reset("ok");

  _reset();
  const t1 = nextRowKey(1758000000000);
  const t2 = nextRowKey(1758000000000);
  q.enqueue({ ...signup(1), timestamp: t1, mac: "aa:bb:cc:00:00:01", email: "first@example.com" });
  q.enqueue({ ...signup(2), timestamp: t2, mac: "aa:bb:cc:00:00:02", email: "second@example.com" });
  eq("both queued", q.pending().length, 2);

  await sync.flushQueue({});
  eq("BOTH rows reach the sheet", fake.sheet.length, 2);
  const emails = fake.sheet.map((r) => r.email).sort();
  eq("neither guest is lost", emails, ["first@example.com", "second@example.com"]);
  eq("queue drains fully", q.pending().length, 0);
}

/* ── Queue health, which drives the admin warning ────────────────── */
{
  clearQueueFile();
  const { q, sync } = freshModules();
  fake.reset("appendDown");

  eq("healthy when empty", sync.queueHealth().count, 0);
  q.enqueue(signup(1));
  q.enqueue(signup(2));
  const h = sync.queueHealth();
  eq("counts what's waiting", h.count, 2);
  ok("reports an age", h.oldestAgeMs >= 0);
  await sync.flushQueue({});
  ok("reports attempts after a failure", sync.queueHealth().maxAttempts >= 1);
}

/* ── Large backlog drains in batches ─────────────────────────────── */
{
  clearQueueFile();
  const { q, sync } = freshModules();
  fake.reset("ok");

  for (let i = 0; i < 120; i++) {
    q.enqueue({ ...signup(1), timestamp: `2026-09-16T13:${String(i).padStart(2, "0")}:00.000Z`, mac: `aa:bb:cc:00:01:${String(i % 100).padStart(2, "0")}` });
  }
  eq("120 queued", q.pending().length, 120);
  await sync.flushQueue({ limit: 100 });
  eq("first pass takes 100", fake.sheet.length, 100);
  eq("20 left", q.pending().length, 20);
  await sync.flushQueue({ limit: 100 });
  eq("second pass finishes", q.pending().length, 0);
  eq("all 120 on the sheet", fake.sheet.length, 120);
}

process.chdir(cwd);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
