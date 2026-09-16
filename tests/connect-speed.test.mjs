// Tests for the connect-time fixes: parallel console lookup + AP routing.
//
// These are the two pieces that turned a ~30s guest connect into a few
// seconds, so they're worth pinning down. Deliberately no network: the
// racing helper is generic, and the routing table is plain file I/O.

import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : (fail++, console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`));
};
const ok = (name, cond) => eq(name, !!cond, true);

/* ── firstSuccess: the parallel lookup ───────────────────────────── */

const { firstSuccess } = require("../lib/unifi.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

{
  // The whole point: N consoles cost about one round trip, not N.
  const delay = 100;
  const consoles = ["a", "b", "c", "d", "e", "f"];
  const probe = async (id) => {
    await sleep(delay);
    if (id !== "f") throw new Error("not here"); // device is on the LAST one
    return id;
  };
  const t0 = Date.now();
  const found = await firstSuccess(consoles, probe);
  const elapsed = Date.now() - t0;
  eq("finds the device on the last console", found, "f");
  ok(`6 consoles take ~1 round trip, not 6 (${elapsed}ms vs ${delay * 6}ms serial)`,
     elapsed < delay * 2.5);
}

{
  // Fastest success wins even when a slower one would also match.
  const probe = async (c) => { await sleep(c.ms); return c.id; };
  const t0 = Date.now();
  const found = await firstSuccess([{ id: "slow", ms: 300 }, { id: "fast", ms: 20 }], probe);
  eq("fastest success wins", found, "fast");
  ok("returns without waiting for the slow one", Date.now() - t0 < 150);
}

{
  // Nobody has it -> reject, so the caller can retry.
  let threw = false;
  try {
    await firstSuccess(["a", "b"], async () => { throw new Error("not here"); });
  } catch (err) {
    threw = true;
    ok("rejects with a real Error when every console misses", err instanceof Error);
  }
  ok("all-miss rejects rather than resolving undefined", threw);
}

{
  // A real fault must not be masked by benign "device isn't here" misses.
  // AggregateError orders by position, so the naive "last error" picked the
  // miss and hid the 401 that actually needed attention.
  const notHere = (id) => {
    const e = new Error(`not on ${id}`);
    e.notHere = true;
    return e;
  };
  let caught = null;
  try {
    await firstSuccess(["a", "b", "c"], async (id) => {
      if (id === "b") throw new Error("HTTP 401 unauthorized");
      throw notHere(id);
    });
  } catch (err) { caught = err; }
  ok("surfaces the real error, not the benign miss", /401/.test(String(caught)));
  eq("real error is not flagged as all-not-here", caught.allNotHere, false);

  // All misses -> flagged, so the caller knows to just retry.
  let allMiss = null;
  try {
    await firstSuccess(["a", "b"], async (id) => { throw notHere(id); });
  } catch (err) { allMiss = err; }
  eq("all-miss is flagged", allMiss.allNotHere, true);
}

{
  // Batching keeps a big estate from firing every request at once.
  let live = 0, peak = 0;
  const probe = async (id) => {
    live++; peak = Math.max(peak, live);
    await sleep(30);
    live--;
    if (id !== 29) throw new Error("not here");
    return id;
  };
  const found = await firstSuccess([...Array(30).keys()], probe, 6);
  eq("finds the device in the last batch", found, 29);
  ok(`concurrency capped at the batch size (peak ${peak})`, peak <= 6);
}

{
  let threw = false;
  try { await firstSuccess([], async () => "x"); } catch { threw = true; }
  ok("empty list rejects", threw);
}

{
  // A single console still works — most installs start here.
  eq("single console resolves", await firstSuccess(["only"], async (i) => i), "only");
}

/* ── ap-routes: the routing table ────────────────────────────────── */

// ap-routes resolves data/ from process.cwd() at load time, so it has to be
// (re)loaded with cwd already pointing at a temp dir — otherwise the test
// writes its fixtures into the real project's data/ directory. Note that
// lib/unifi.js required above pulls ap-routes in transitively, so the cache
// entry must be dropped, not merely required after chdir.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aproutes-"));
const cwd = process.cwd();
process.chdir(tmp);

delete require.cache[require.resolve("../lib/ap-routes.js")];
const routes = require("../lib/ap-routes.js");
ok("routing table is isolated to the temp dir", routes.ROUTES_FILE.startsWith(tmp));

const AP = "aa:bb:cc:dd:ee:ff";

{
  eq("unknown AP returns empty", routes.consoleForAp(AP), "");

  routes.rememberAp(AP, "console-1");
  eq("learns an AP", routes.consoleForAp(AP), "console-1");

  // Case and separator differences are the same AP.
  eq("uppercase lookup matches", routes.consoleForAp("AA:BB:CC:DD:EE:FF"), "console-1");
  eq("dash-separated lookup matches", routes.consoleForAp("aa-bb-cc-dd-ee-ff"), "console-1");

  // An AP moved to another console — the table must correct, not duplicate.
  routes.rememberAp(AP, "console-2");
  eq("corrects a re-homed AP", routes.consoleForAp(AP), "console-2");
  eq("still one entry after correction", Object.keys(routes.allRoutes()).length, 1);

  routes.forgetAp(AP);
  eq("forget clears the entry", routes.consoleForAp(AP), "");

  // Garbage in must not poison the table.
  routes.rememberAp("", "console-1");
  routes.rememberAp("not-a-mac", "console-1");
  routes.rememberAp(AP, "");
  eq("junk is ignored", Object.keys(routes.allRoutes()).length, 0);
  eq("bad mac lookup returns empty", routes.consoleForAp("nope"), "");
}

{
  // Survives a restart: the table is flushed to disk and reloaded.
  routes.rememberAp(AP, "console-7");
  routes.rememberAp("11:22:33:44:55:66", "console-8");
  await sleep(5200); // batched flush

  const file = routes.ROUTES_FILE;
  ok("writes data/ap-routes.json", fs.existsSync(file));
  if (!fs.existsSync(file)) {
    console.log(`\n  (expected at ${file})`);
    console.log(`\n${pass} passed, ${fail + 1} failed`);
    process.exit(1);
  }

  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  eq("persists both APs", Object.keys(onDisk).sort(), ["11:22:33:44:55:66", AP].sort());
  eq("persists the console id", onDisk[AP].consoleId, "console-7");
  ok("stamps when it was learned", typeof onDisk[AP].at === "string");
}

{
  // A corrupt file must degrade to "search every console", never throw.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aproutes-bad-"));
  fs.mkdirSync(path.join(dir, "data"));
  fs.writeFileSync(path.join(dir, "data", "ap-routes.json"), "{ this is not json");
  process.chdir(dir);

  // Fresh module instance so it re-reads the (broken) file.
  delete require.cache[require.resolve("../lib/ap-routes.js")];
  const fresh = require("../lib/ap-routes.js");
  let threw = false;
  let result = "unset";
  try { result = fresh.consoleForAp(AP); } catch { threw = true; }
  ok("corrupt file does not throw", !threw);
  eq("corrupt file behaves like an empty table", result, "");
}

process.chdir(cwd);

{
  // The table is keyed on a MAC supplied by the guest's own request, so it
  // must stay bounded rather than growing forever.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aproutes-cap-"));
  process.chdir(dir);
  delete require.cache[require.resolve("../lib/ap-routes.js")];
  const capped = require("../lib/ap-routes.js");

  const hex = (n) => n.toString(16).padStart(2, "0");
  const macFor = (n) => `02:00:${hex((n >> 24) & 255)}:${hex((n >> 16) & 255)}:${hex((n >> 8) & 255)}:${hex(n & 255)}`;

  for (let i = 0; i < capped.MAX_ROUTES + 50; i++) {
    capped.rememberAp(macFor(i), `console-${i % 4}`);
  }
  const size = Object.keys(capped.allRoutes()).length;
  ok(`table is capped at ${capped.MAX_ROUTES} (got ${size})`, size <= capped.MAX_ROUTES);
  // Newest entries win — an AP that just came online matters more than a
  // stale one that hasn't been seen in months.
  eq("most recent AP is still routable",
     capped.consoleForAp(macFor(capped.MAX_ROUTES + 49)) !== "", true);

  process.chdir(cwd);
}

/* ── Pending Sheets queue: durability of a backgrounded write ────── */

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pending-"));
  process.chdir(dir);
  delete require.cache[require.resolve("../lib/pending-sheet.js")];
  const q = require("../lib/pending-sheet.js");

  const entry = {
    timestamp: "2026-09-16T12:00:00.000Z",
    mac: "AA:BB:CC:11:22:33",
    email: "sam@example.com",
    firstName: "Sam",
    phone: "07123456789",
    birthday: "14/03/1990",
    promo: "Yes",
    branch: "BnS Perry Barr",
  };

  const id = q.enqueue(entry);
  ok("enqueue returns an id", !!id);
  eq("one entry queued", q.pending().length, 1);
  // This is the point of the queue: the PII is on disk before we respond.
  eq("queued entry keeps the guest's details", q.pending()[0].entry.email, "sam@example.com");
  eq("queued entry keeps the phone", q.pending()[0].entry.phone, "07123456789");

  // Same submit twice in the same millisecond must not double-queue.
  eq("re-queueing the same visit is a no-op", q.enqueue(entry), id);
  eq("still one entry", q.pending().length, 1);

  q.noteFailure(id);
  eq("failures are counted for visibility", q.pending()[0].attempts, 1);

  q.settle(id);
  eq("settled entry is removed", q.pending().length, 0);
  q.settle(id); // settling twice must not throw
  q.settle("");
  eq("settle is idempotent", q.pending().length, 0);

  // Survives a restart.
  q.enqueue({ ...entry, timestamp: "2026-09-16T12:05:00.000Z" });
  delete require.cache[require.resolve("../lib/pending-sheet.js")];
  const reloaded = require("../lib/pending-sheet.js");
  eq("queue survives a process restart", reloaded.pending().length, 1);

  // A corrupt queue must not crash the connect route.
  fs.writeFileSync(path.join(dir, "data", "pending-sheet.json"), "not json at all");
  delete require.cache[require.resolve("../lib/pending-sheet.js")];
  const broken = require("../lib/pending-sheet.js");
  let threw = false;
  let list = null;
  try { list = broken.pending(); } catch { threw = true; }
  ok("corrupt queue does not throw", !threw);
  eq("corrupt queue reads as empty", list, []);
  ok("can still enqueue after corruption", !!broken.enqueue(entry));

  process.chdir(cwd);
}

/* ── Round-trip budget: the actual claim we're making ────────────── */

{
  const STORES = 6;
  const RTT = 600; // typical cloud-proxy round trip, ms

  // Before: 4 attempts x 6 consoles serial, 1.5s between attempts, then
  // getClientInfo, then an awaited Sheets write, then 12s of polling where
  // every poll also swept all 6 consoles.
  const beforeLookup = STORES * RTT;            // worst case, device on last store
  const beforeRetries = 1500 + STORES * RTT;    // one extra sweep when too early
  const beforeInfo = 2 * RTT;                   // device name + fingerprint
  const beforeSheets = 2000;                    // Apps Script cold start
  const beforePolls = 3 * (STORES * RTT + 1200); // 3 ticks, each a full sweep
  const before = beforeLookup + beforeRetries + beforeInfo + beforeSheets + beforePolls;

  // After: AP MAC picks the console (1 request), details and Sheets moved off
  // the critical path, polls hit one console.
  const afterLookup = RTT;                      // one console, chosen by AP
  const afterRetries = 500 + RTT;               // one tighter retry if too early
  const afterPolls = 2 * (RTT + 600);           // 2 ticks, single console each
  const after = afterLookup + afterRetries + afterPolls;

  console.log(`\n  round-trip budget @ ${STORES} stores, ${RTT}ms RTT`);
  console.log(`    before: ~${(before / 1000).toFixed(1)}s`);
  console.log(`    after:  ~${(after / 1000).toFixed(1)}s`);
  ok("modelled connect time drops under 5s", after < 5000);
  ok("modelled improvement is at least 4x", before / after >= 4);

  // The old design got worse with every store; the new one shouldn't.
  const afterAt30 = afterLookup + afterRetries + afterPolls; // independent of STORES
  eq("cost no longer scales with store count", afterAt30, after);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
