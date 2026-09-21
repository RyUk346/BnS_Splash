import { NextResponse } from "next/server";
import { authorizeGuest, getClientDetails } from "@/lib/unifi";
import { EMAIL_RE, normalizeEmail } from "@/lib/email";
import { recordSession } from "@/lib/sessions";
import { enqueue } from "@/lib/pending-sheet";
import { flushQueue, appendRow } from "@/lib/sheet-sync";
import { nextRowKey } from "@/lib/row-key";
import { startTimer } from "@/lib/timing";

export const dynamic = "force-dynamic";

const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

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

  // Shared timestamp — written to the Sheet AND used as the row key, so the
  // poller can find this exact row later, and so the delivery queue can
  // confirm the row landed. nextRowKey (not Date.now) because two guests
  // submitting in the same millisecond would otherwise share a key, and the
  // read-back would mark the second one delivered off the first one's row.
  const timestamp = nextRowKey();

  // 1. Authorize the guest on UniFi first — this also tells us which
  //    branch (console) the device is connected to.
  let authorized = false;
  let authError = null;
  let branch = "";
  let consoleId = "";
  let vendor = ""; // cheap MAC-derived guess; the background task refines it
  const t = startTimer("connect");
  let authTiming = null;

  if (MAC_RE.test(mac)) {
    try {
      // `ap` lets UniFi's own access-point ID pick the console directly
      // instead of us searching every store for the device.
      const result = await authorizeGuest(mac, { apMac: ap });
      authorized = true;
      branch = result.branch || "";
      consoleId = result.consoleId || "";
      vendor = result.vendor || "";
      authTiming = result.timing || null;
    } catch (err) {
      authError = err;
      console.error("UniFi authorization failed:", err.message);
    }
  } else {
    // No/invalid MAC — page was likely opened directly (testing), not via
    // the UniFi redirect. Log the signup but skip authorization.
    console.warn("No client MAC in request — skipping UniFi authorization");
  }

  // 2. Persist the signup to disk BEFORE responding.
  //
  //    This is the durability point, and it has to come before the 502 below:
  //    a UniFi outage is exactly when a guest retries repeatedly, and losing
  //    their details every time would be the worst possible moment to do it.
  //    The write is local and synchronous — microseconds, not the 1-3s Apps
  //    Script cold start it replaces on the critical path.
  const queueId = enqueueSignup({
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
  });

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

  // 4. Send the guest on their way. Everything still outstanding — the two
  //    UniFi calls for device details and the Apps Script append — happens
  //    after this point, so the guest never waits on either. The queue entry
  //    above is what makes that safe: it is only cleared once a read-back
  //    confirms the row is on the sheet, and the poller retries the rest.
  if (queueId) {
    pushToSheet(timestamp, { consoleId, mac, vendor });
  } else {
    // Queueing failed, so there is no durable copy to retry from. Write it
    // now, before responding, rather than lose it.
    await appendInline({
      timestamp, email, firstName, phone, birthday, promo,
      mac, ap, ssid, branch, deviceName: "", vendor,
    });
  }

  // One grep-able line per connect: `pm2 logs hyperglow-splash | grep timing`.
  // This is what tells us where a slow connect actually went, rather than
  // reasoning about it from the code.
  t.done({
    ok: authorized,
    find: authTiming ? `${authTiming.findMs}ms` : "",
    auth: authTiming ? `${authTiming.authMs}ms` : "",
    waited: authTiming ? `${authTiming.waitedMs}ms` : "",
    tries: authTiming ? authTiming.attempts : "",
    hinted: authTiming ? authTiming.hinted : "",
    branch,
  });

  if (authError) {
    return NextResponse.json(
      {
        success: false,
        error: "Could not activate your WiFi access. Please try again.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    authorized,
    branch,
    // Lets the splash page poll only this console instead of all of them.
    consoleId,
  });
}

function enqueueSignup(entry) {
  try {
    return enqueue(entry);
  } catch (err) {
    // The queue is what makes delivery guaranteed, so failing to write it is
    // the one case that could still lose a signup. Realistically this means a
    // full disk or wrong permissions on data/ — neither of which stops the
    // Sheet itself working. So rather than drop the lead, fall back to writing
    // the row inline: slower for this one guest, but saved.
    console.error("CRITICAL: could not queue signup for Sheets:", String(err));
    return "";
  }
}

/**
 * Last-resort direct append, used only when queueing failed.
 *
 * Awaited before responding, so this guest waits for Apps Script — the thing
 * every other path avoids. That trade is deliberate: a few seconds of delay
 * beats losing their details, and it only happens when data/ is unwritable.
 */
async function appendInline(entry) {
  try {
    await appendRow(entry);
    console.error("Signup written directly (queue unavailable) — fix data/ permissions");
  } catch (err) {
    console.error("CRITICAL: signup could not be saved at all:", String(err), JSON.stringify({
      // Enough to recover the row by hand from the logs. Logs are already
      // considered sensitive for this app; the Sheet holds the same fields.
      timestamp: entry.timestamp,
      email: entry.email,
      firstName: entry.firstName,
      phone: entry.phone,
      birthday: entry.birthday,
      promo: entry.promo,
      branch: entry.branch,
      mac: entry.mac,
    }));
  }
}

/**
 * Look up the device details, then try to get this signup onto the sheet —
 * all after the response has gone out, so the guest never waits for it.
 *
 * Deliberately not awaited: this runs on a long-lived Node server under pm2
 * (fork mode), so the promise survives the response. It is NOT safe on a
 * freeze-after-response platform like Vercel. That's also why the poller runs
 * the same flush on a schedule — this call is an optimisation to get the row
 * in within seconds, not the thing that guarantees it lands.
 */
function pushToSheet(timestamp, { consoleId, mac, vendor }) {
  (async () => {
    const enrich = {};
    if (consoleId && MAC_RE.test(mac)) {
      try {
        const details = await getClientDetails(consoleId, mac);
        enrich[timestamp] = {
          deviceName: details.deviceName || "",
          vendor: details.vendor || vendor || "",
        };
      } catch (err) {
        console.error("Device detail lookup failed:", String(err));
      }
    }
    // Flushes this signup and sweeps up anything still outstanding.
    await flushQueue({ limit: 25, enrich });
  })().catch((err) => {
    // String(err), not err.message: a rejection with a non-object would throw
    // inside this handler, and an unhandled rejection takes the worker down.
    console.error("Background Sheets push crashed:", String(err));
  });
}

/* Retries are NOT run from here.
 *
 * An in-process timer in a route module only starts once that route is first
 * requested, so a queue left over from before a restart would sit untouched
 * until the next guest connected — overnight, that's hours. The session
 * poller runs every 3 minutes under pm2 cron regardless of traffic, so it
 * owns the retry sweep (see scripts/session-poller.js). */
