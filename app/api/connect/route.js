import { NextResponse } from "next/server";
import { authorizeGuest } from "@/lib/unifi";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

async function saveToGoogleSheet(entry) {
  const webhook = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  if (!webhook) {
    console.warn("GOOGLE_SHEETS_WEBHOOK_URL not set — skipping sheet logging");
    return false;
  }
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
    // Apps Script replies with a redirect; follow it.
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Sheets webhook returned HTTP ${res.status}`);
  return true;
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }

  const email = (body.email || "").trim();
  const firstName = (body.firstName || "").trim();
  const phone = (body.phone || "").trim();
  const birthday = (body.birthday || "").trim();
  // Marketing consent: "Yes" | "No" (anything else is stored blank)
  const promo = body.promo === "Yes" ? "Yes" : body.promo === "No" ? "No" : "";
  const mac = (body.mac || "").trim();
  const ap = (body.ap || "").trim();
  const ssid = (body.ssid || "").trim();

  // Server-side validation of required fields
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ success: false, error: "A valid email is required" }, { status: 400 });
  }
  if (!firstName) {
    return NextResponse.json({ success: false, error: "First name is required" }, { status: 400 });
  }
  if (birthday && !/^\d{2}\/\d{2}$/.test(birthday)) {
    return NextResponse.json({ success: false, error: "Birthday must be DD/MM" }, { status: 400 });
  }

  // 1. Authorize the guest on UniFi first — this also tells us which
  //    branch (console) the device is connected to.
  let authorized = false;
  let authError = null;
  let branch = "";
  if (MAC_RE.test(mac)) {
    try {
      const result = await authorizeGuest(mac);
      authorized = true;
      branch = result.branch || "";
    } catch (err) {
      authError = err;
      console.error("UniFi authorization failed:", err.message);
    }
  } else {
    // No/invalid MAC — page was likely opened directly (testing), not via
    // the UniFi redirect. Log the signup but skip authorization.
    console.warn("No client MAC in request — skipping UniFi authorization");
  }

  // 2. Save to Google Sheets (non-fatal if it fails — don't strand the guest)
  let savedToSheet = false;
  try {
    savedToSheet = await saveToGoogleSheet({
      timestamp: new Date().toISOString(),
      email,
      firstName,
      phone,
      birthday,
      promo,
      mac,
      ap,
      ssid,
      branch,
    });
  } catch (err) {
    console.error("Google Sheets logging failed:", err.message);
  }

  if (authError) {
    return NextResponse.json(
      {
        success: false,
        savedToSheet,
        error: "Could not activate your WiFi access. Please try again.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, authorized, savedToSheet, branch });
}
