// Store registry, including the UniFi console name.
//
// The console name matters because the UniFi dashboard identifies routers
// ONLY by that name — never by the console ID we key everything on. Without
// it there's no way to match a row here to the hardware in front of you.

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stores-"));
process.chdir(tmp);

// Loaded after chdir so data/ resolves inside the temp dir.
delete require.cache[require.resolve("../lib/stores.js")];
const S = require("../lib/stores.js");
ok("registry is isolated to the temp dir", S.STORES_FILE.startsWith(tmp));

const ID1 = "6C63F8E0BB2F00000000000000000000:818255038";
const ID2 = "74FA296B889600000000000000000000:641510570";

/* ── Adding ──────────────────────────────────────────────────────── */
{
  let list = S.addStore({ id: ID1, label: "BnS Perry Barr", consoleName: "BNS-PB-GW1" });
  eq("store added", list.length, 1);
  eq("branch label kept", list[0].label, "BnS Perry Barr");
  eq("console name kept", list[0].consoleName, "BNS-PB-GW1");
  ok("addedAt stamped", typeof list[0].addedAt === "string");

  // The two names are independent — this is the whole point.
  list = S.addStore({ id: ID2, label: "BnS Wolverhampton MS", consoleName: "BNS-BH-BW-GW1" });
  eq("second store added", list.length, 2);
  eq("second console name", list[1].consoleName, "BNS-BH-BW-GW1");

  let threw = false;
  try { S.addStore({ id: ID1, label: "Duplicate" }); } catch { threw = true; }
  ok("re-adding the same console is rejected", threw);

  threw = false;
  try { S.addStore({ id: "", label: "No id" }); } catch { threw = true; }
  ok("a store with no console id is rejected", threw);
}

/* ── Adding without a console name (manual paste path) ───────────── */
{
  const list = S.addStore({ id: "AAA:1", label: "Pasted manually" });
  const hit = list.find((s) => s.id === "AAA:1");
  eq("missing console name stores as empty, not undefined", hit.consoleName, "");
}

/* ── Renaming the branch must not touch the console name ─────────── */
{
  const list = S.updateStore(ID1, "BnS Perry Barr (new)");
  const hit = list.find((s) => s.id === ID1);
  eq("branch label updated", hit.label, "BnS Perry Barr (new)");
  eq("console name untouched by a branch rename", hit.consoleName, "BNS-PB-GW1");
}

/* ── Backfilling / correcting the console name ───────────────────── */
{
  // A router renamed in UniFi.
  let list = S.setConsoleName(ID1, "BNS-PB-GW2");
  eq("console name corrected", list.find((s) => s.id === ID1).consoleName, "BNS-PB-GW2");
  eq("branch label survives the correction", list.find((s) => s.id === ID1).label, "BnS Perry Barr (new)");

  // A store added before the field existed.
  list = S.setConsoleName("AAA:1", "BNS-OLD-GW1");
  eq("backfills an empty console name", list.find((s) => s.id === "AAA:1").consoleName, "BNS-OLD-GW1");

  // No-ops must not rewrite the file needlessly.
  const before = fs.readFileSync(S.STORES_FILE, "utf8");
  S.setConsoleName(ID1, "BNS-PB-GW2"); // same value
  S.setConsoleName(ID1, "");           // empty
  S.setConsoleName("not-a-store", "X"); // unknown id
  eq("no-op updates leave the file alone", fs.readFileSync(S.STORES_FILE, "utf8"), before);
}

/* ── Round trip through disk ─────────────────────────────────────── */
{
  delete require.cache[require.resolve("../lib/stores.js")];
  const reloaded = require("../lib/stores.js");
  const list = reloaded.readStores();
  eq("all stores survive a restart", list.length, 3);
  eq("console names survive a restart", list.find((s) => s.id === ID2).consoleName, "BNS-BH-BW-GW1");
}

/* ── Old file without the field still loads ──────────────────────── */
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stores-old-"));
  fs.mkdirSync(path.join(dir, "data"));
  // Exactly the shape written before consoleName existed.
  fs.writeFileSync(
    path.join(dir, "data", "stores.json"),
    JSON.stringify([{ id: ID1, label: "BnS Perry Barr", addedAt: "2026-01-01T00:00:00.000Z" }], null, 2)
  );
  process.chdir(dir);
  delete require.cache[require.resolve("../lib/stores.js")];
  const old = require("../lib/stores.js");

  const list = old.readStores();
  eq("old file still loads", list.length, 1);
  eq("missing field reads as empty string", list[0].consoleName, "");
  eq("label preserved", list[0].label, "BnS Perry Barr");
  // And it can be backfilled in place.
  const after = old.setConsoleName(ID1, "BNS-PB-GW1");
  eq("old record accepts a backfilled name", after[0].consoleName, "BNS-PB-GW1");
  eq("addedAt preserved through the backfill", after[0].addedAt, "2026-01-01T00:00:00.000Z");
  process.chdir(tmp);
}

/* ── Corrupt file falls back to env rather than throwing ─────────── */
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stores-bad-"));
  fs.mkdirSync(path.join(dir, "data"));
  fs.writeFileSync(path.join(dir, "data", "stores.json"), "{{ not json");
  process.chdir(dir);
  process.env.UNIFI_CONSOLES = "FALLBACK:1|Fallback Store";
  delete require.cache[require.resolve("../lib/stores.js")];
  const broken = require("../lib/stores.js");

  let threw = false;
  let list = [];
  try { list = broken.readStores(); } catch { threw = true; }
  ok("corrupt file does not throw", !threw);
  eq("falls back to the env configuration", list.length, 1);
  eq("env store label", list[0].label, "Fallback Store");
  delete process.env.UNIFI_CONSOLES;
  process.chdir(tmp);
}

/* ── Removal ─────────────────────────────────────────────────────── */
{
  delete require.cache[require.resolve("../lib/stores.js")];
  const R = require("../lib/stores.js");
  let list = R.removeStore("AAA:1");
  eq("store removed", list.length, 2);
  ok("the right one went", !list.some((s) => s.id === "AAA:1"));

  list = R.removeStore(ID2);
  eq("down to one", list.length, 1);

  let threw = false;
  try { R.removeStore(ID1); } catch { threw = true; }
  ok("cannot remove the last store", threw);
}

process.chdir(cwd);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
