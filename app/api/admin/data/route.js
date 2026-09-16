import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/admin-auth";
import { queueHealth } from "@/lib/sheet-sync";

export const dynamic = "force-dynamic";

/*
 * Apps Script is slow: it re-reads and serialises the whole sheet on every
 * call, and it cold-starts. A few seconds is normal and it grows with the
 * row count, so the dashboard must never sit and wait for it.
 *
 * Three things keep the panel responsive:
 *   FRESH_MS   – inside this window, serve from memory, no network at all
 *   STALE_MS   – past FRESH but inside STALE, serve the old rows INSTANTLY
 *                and refresh in the background (stale-while-revalidate)
 *   READ_TIMEOUT_MS – bound the read so a hung script can't spin forever
 *
 * Only the explicit "Refresh data" button (?refresh=1) waits for a live read.
 */
const FRESH_MS = 60 * 1000;
const STALE_MS = 30 * 60 * 1000;
const READ_TIMEOUT_MS = 25 * 1000;

let cache = { at: 0, rows: null, source: "raw", cleanedAt: "" };
// Shared so ten dashboard tabs don't trigger ten simultaneous sheet reads.
let inFlight = null;

function readSheet() {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const webhook = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    const readKey = process.env.SHEETS_READ_KEY;
    if (!webhook || !readKey) {
      throw new Error("GOOGLE_SHEETS_WEBHOOK_URL / SHEETS_READ_KEY not configured");
    }

    const url = `${webhook}?action=data&key=${encodeURIComponent(readKey)}`;
    const res = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Sheets read returned HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Sheets read failed");

    cache = {
      at: Date.now(),
      rows: data.rows || [],
      source: data.source || "raw", // "clean" once Cleanup.gs has run
      cleanedAt: data.cleanedAt || "",
    };
    return cache;
  })();

  // Clear the slot either way, so a failure doesn't wedge every later read.
  inFlight.catch(() => {}).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export async function GET(req) {
  if (!isAuthed(req)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  // Read fresh every time, never from the cache: this is the "is anything
  // missing from the sheet?" signal, and a stale answer would defeat it.
  let sheetQueue = { count: 0, oldestAgeMs: 0, maxAttempts: 0 };
  try {
    sheetQueue = queueHealth();
  } catch (err) {
    console.error("Could not read the pending Sheets queue:", err.message);
  }

  const force = new URL(req.url).searchParams.get("refresh") === "1";
  const age = cache.rows ? Date.now() - cache.at : Infinity;

  // Fresh enough — answer from memory.
  if (!force && cache.rows && age < FRESH_MS) {
    return NextResponse.json({
      success: true,
      rows: cache.rows,
      source: cache.source,
      cleanedAt: cache.cleanedAt,
      sheetQueue,
      cached: true,
      ageMs: age,
    });
  }

  // Getting stale, but usable. Hand back what we have and refresh behind the
  // scenes — this is what makes signing in feel instant instead of hanging on
  // Apps Script. The client shows a quiet "refreshing" hint and picks up the
  // new rows on its next poll.
  if (!force && cache.rows && age < STALE_MS) {
    readSheet().catch((err) =>
      console.error("Background sheet refresh failed:", err.message)
    );
    return NextResponse.json({
      success: true,
      rows: cache.rows,
      source: cache.source,
      cleanedAt: cache.cleanedAt,
      sheetQueue,
      cached: true,
      revalidating: true,
      ageMs: age,
    });
  }

  // Nothing usable cached (or the user asked for a live read) — wait for it.
  try {
    const fresh = await readSheet();
    return NextResponse.json({
      success: true,
      rows: fresh.rows,
      source: fresh.source,
      cleanedAt: fresh.cleanedAt,
      sheetQueue,
      ageMs: 0,
    });
  } catch (err) {
    console.error("Admin data fetch failed:", err.message);
    // Serve stale data rather than nothing, however old it is.
    if (cache.rows) {
      return NextResponse.json({
        success: true,
        rows: cache.rows,
        source: cache.source,
        cleanedAt: cache.cleanedAt,
        sheetQueue,
        stale: true,
        ageMs: age,
        error: err.message,
      });
    }
    return NextResponse.json({ success: false, error: err.message }, { status: 502 });
  }
}
