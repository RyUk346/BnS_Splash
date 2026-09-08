import { NextResponse } from "next/server";
import { authorizeGuest } from "@/lib/unifi";
import { EMAIL_RE, normalizeEmail } from "@/lib/email";
import { recordSession } from "@/lib/sessions";

export const dynamic = "force-dynamic";

const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

async function saveToGoogleSheet(entry) {
  const webhook = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  if (!webhook) {
    console.warn("GOOGLE_SHEETS_WEBHOOK_URL not set — skipping sheet logging");
    return false;
  }
  // Apps Script runs doPost (appending the row) and THEN answers with a 302
  // pointing at script.googleusercontent.com for the JSON reply. Following
  // that hop often fails with a Google "Page not found" page even though the
  // row was written — which used to surface as a bogus "HTTP 404" error.
  // So: don't follow the redirect. Reaching the 302 means the script ran.
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
    redirect: "manual",
  });

  // 2xx = direct reply, 3xx = script ran and is redirecting to its output.
  if (res.status >= 200 && res.status < 400) return true;

  throw new Error(`Sheets webhook returned HTTP ${res.status}`);
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const firstName = (body.firstName || "").trim();
  // Same normalisation as the splash form, repeated here because client-side
  // checks are bypassable: digits only, +44/0044 folded back to a leading 0.
  const phone = (() => {
    let d = String(body.phone || "").replace(/\D/g, "");
    if (d.startsWith("0044")) d = "0" + d.slice(4);
    else if (d.startsWith("44")) d = "0" + d.slice(2);
    return d.slice(0, 11);
  })();
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
  if (birthday && !/^\d{2}\/\d{2}\/\d{4}$/.test(birthday)) {
    return NextResponse.json(
      { success: false, error: "Birthday must be DD/MM/YYYY" },
      { status: 400 }
    );
  }
  // Client-side checks are bypassable, so the same rule is enforced here.
  if (phone && !/^07\d{9}$/.test(phone)) {
    return NextResponse.json(
      { success: false, error: "Phone must be a UK mobile — 11 digits starting 07" },
      { status: 400 }
    );
  }

  // Shared timestamp — written to the Sheet AND used as the row key so the
  // poller can find this exact row later to fill in disconnect + duration.
  const timestamp = new Date().toISOString();

  // 1. Authorize the guest on UniFi first — this also tells us which
  //    branch (console) the device is connected to.
  let authorized = false;
  let authError = null;
  let branch = "";
  let consoleId = "";
  let deviceName = "";
  let vendor = "";
  if (MAC_RE.test(mac)) {
    try {
      const result = await authorizeGuest(mac);
      authorized = true;
      branch = result.branch || "";
      consoleId = result.consoleId || "";
      deviceName = result.deviceName || "";
      vendor = result.vendor || "";
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
      timestamp,
      email,
      firstName,
      phone,
      birthday,
      promo,
      mac,
      ap,
      ssid,
      branch,
      deviceName,
      vendor,
    });
  } catch (err) {
    console.error("Google Sheets logging failed:", err.message);
  }

  // 3. Register the session so the poller can track connection duration.
  //    Keyed by timestamp + mac, which uniquely identifies the Sheet row.
  if (authorized && MAC_RE.test(mac)) {
    try {
      recordSession({
        timestamp, // Sheet row key (col A)
        mac: mac.toLowerCase(),
        consoleId,
        branch,
        connectedAt: timestamp,
        lastSeen: timestamp,
        status: "active",
      });
    } catch (err) {
      console.error("Session record failed:", err.message);
    }
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
