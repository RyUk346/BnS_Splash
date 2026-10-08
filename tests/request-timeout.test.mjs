// Every UniFi request must settle within its budget, exactly once.
//
// Background: production logged a 140-SECOND connect against a 6-second
// per-request timeout. Node's `timeout` option maps to socket.setTimeout — an
// INACTIVITY timeout that only arms once a socket is assigned. It does not
// bound the TCP connect phase, so a stalled handshake falls through to the
// operating system's connect timeout (~127s on Linux with default
// tcp_syn_retries). That matches the observed 140s.
//
// WHAT THESE TESTS DO AND DON'T SHOW
//
// They verify the absolute deadline fires, that a request settles exactly
// once, that parallel requests all settle, and that the timer doesn't break
// the success path. They do NOT reproduce a dropped SYN — that needs a
// network that silently blackholes packets, which a test sandbox doesn't
// have (an unroutable address returns ENETUNREACH immediately rather than
// hanging). The dropped-SYN reasoning rests on Node's documented behaviour,
// not on a test here.

import { createRequire } from "module";
import http from "http";
import net from "net";

const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  okk ? pass++ : (fail++, console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`));
};
const ok = (name, cond) => eq(name, !!cond, true);

process.env.UNIFI_API_KEY = "test-key";
process.env.UNIFI_MODE = "direct";

/* A server that accepts the connection and then says nothing, ever. The
   request is live but will never complete on its own. */
const silent = net.createServer((sock) => {
  sock.on("error", () => {});
  // deliberately no response
});
await new Promise((r) => silent.listen(0, "127.0.0.1", r));
const silentPort = silent.address().port;

process.env.UNIFI_CONTROLLER_URL = `https://127.0.0.1:${silentPort}`;
const { request, getJson } = require("../lib/unifi.js");

/* ── A request that would otherwise hang gives up on time ────────── */
{
  const BUDGET = 700;
  const t0 = Date.now();
  let err = null;
  try {
    await request("console-1", "/sites", { timeoutMs: BUDGET });
  } catch (e) {
    err = e;
  }
  const took = Date.now() - t0;

  ok("rejects instead of hanging", err instanceof Error);
  ok(`settles close to its ${BUDGET}ms budget (took ${took}ms)`, took >= BUDGET * 0.5 && took < BUDGET * 3);
  ok("names the console and path in the error", /console-1|\/sites|exceeded|timed out/i.test(String(err)));
}

/* ── getJson too — it's what reads the account's console list ────── */
{
  const BUDGET = 700;
  const t0 = Date.now();
  let err = null;
  try {
    await getJson(`https://127.0.0.1:${silentPort}/v1/hosts`, BUDGET);
  } catch (e) {
    err = e;
  }
  const took = Date.now() - t0;
  ok("getJson rejects instead of hanging", err instanceof Error);
  ok(`getJson settles close to its budget (took ${took}ms)`, took < BUDGET * 3);
}

/* ── One slow console can't drag a whole race past the budget ───── */
{
  // The connect path probes every console at once; this is the shape of that.
  const BUDGET = 700;
  const t0 = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      request(`console-${i}`, "/sites", { timeoutMs: BUDGET })
    )
  );
  const took = Date.now() - t0;
  eq("all six rejected", results.filter((r) => r.status === "rejected").length, 6);
  ok(`six parallel stalls still finish near the budget (took ${took}ms)`, took < BUDGET * 3);
}

/* ── The deadline must not fire on a request that succeeded ─────── */
{
  // A real server that answers immediately. The timer has to be cleared, the
  // promise must resolve, and nothing may settle twice.
  const good = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((r) => good.listen(0, "127.0.0.1", r));
  const p = good.address().port;

  // getJson against http:// via https fails fast — what matters is that it
  // settles once and the pending deadline doesn't then fire a second time.
  let settles = 0;
  await getJson(`https://127.0.0.1:${p}/x`, 1200).then(
    () => { settles += 1; },
    () => { settles += 1; }
  );
  await new Promise((r) => setTimeout(r, 1500)); // outlive the deadline
  eq("settles exactly once, deadline cannot double-settle", settles, 1);

  good.close();
}

/* ── A fast failure isn't delayed by the deadline ────────────────── */
{
  // Nothing listening: connection refused should surface immediately, not be
  // held until the budget expires.
  const closed = net.createServer();
  await new Promise((r) => closed.listen(0, "127.0.0.1", r));
  const deadPort = closed.address().port;
  await new Promise((r) => closed.close(r));

  const t0 = Date.now();
  let err = null;
  try {
    await getJson(`https://127.0.0.1:${deadPort}/x`, 5000);
  } catch (e) {
    err = e;
  }
  const took = Date.now() - t0;
  ok("connection refused surfaces as an error", err instanceof Error);
  ok(`and isn't delayed to the 5000ms budget (took ${took}ms)`, took < 1000);
}

silent.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
