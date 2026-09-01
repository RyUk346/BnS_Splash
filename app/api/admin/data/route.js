import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// Short server-side cache so repeated dashboard refreshes don't hammer
// Apps Script (which is slow-ish and quota-limited).
let cache = { at: 0, rows: null };
const CACHE_MS = 60 * 1000;

export async function GET(req) {
  if (!isAuthed(req)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const webhook = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  const readKey = process.env.SHEETS_READ_KEY;
  if (!webhook || !readKey) {
    return NextResponse.json(
      { success: false, error: "GOOGLE_SHEETS_WEBHOOK_URL / SHEETS_READ_KEY not configured" },
      { status: 500 }
    );
  }

  const force = new URL(req.url).searchParams.get("refresh") === "1";
  if (!force && cache.rows && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json({
      success: true,
      rows: cache.rows,
      source: cache.source,
      cleanedAt: cache.cleanedAt,
      cached: true,
    });
  }

  try {
    const url = `${webhook}?action=data&key=${encodeURIComponent(readKey)}`;
    const res = await fetch(url, { redirect: "follow", cache: "no-store" });
    if (!res.ok) throw new Error(`Sheets read returned HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Sheets read failed");

    cache = {
      at: Date.now(),
      rows: data.rows || [],
      source: data.source || "raw", // "clean" once Cleanup.gs has run
      cleanedAt: data.cleanedAt || "",
    };
    return NextResponse.json({
      success: true,
      rows: cache.rows,
      source: cache.source,
      cleanedAt: cache.cleanedAt,
    });
  } catch (err) {
    console.error("Admin data fetch failed:", err.message);
    // Serve stale data rather than nothing, if we have any.
    if (cache.rows) {
      return NextResponse.json({ success: true, rows: cache.rows, stale: true });
    }
    return NextResponse.json({ success: false, error: err.message }, { status: 502 });
  }
}
