import { NextResponse } from "next/server";
import { isGuestAuthorized } from "@/lib/unifi";

export const dynamic = "force-dynamic";

const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

/**
 * Has the gateway actually applied this device's guest authorization yet?
 * The splash page polls this after submitting, and only redirects the guest
 * once the network really is open — instead of guessing with a fixed delay.
 *
 * Response: { authorized: true | false | null }
 *   null = we couldn't reach any console; caller should stop waiting and
 *          proceed rather than trap the guest on the form.
 */
export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const mac = (params.get("mac") || "").trim();
  // /api/connect tells the page which console authorized the device. Passing
  // it back means this check hits one console instead of searching every
  // store — and this runs once a second while the guest waits, so it was
  // easily the second-biggest cost in the connect flow.
  //
  // This endpoint is reachable by an unauthenticated guest before they're let
  // onto the network, so the value is treated as untrusted: isGuestAuthorized
  // only accepts it if it matches a configured store, and anything else is
  // ignored rather than used to build a request URL.
  const consoleId = (params.get("console") || "").trim();

  if (!MAC_RE.test(mac)) {
    return NextResponse.json({ authorized: null, error: "bad mac" }, { status: 400 });
  }

  try {
    const authorized = await isGuestAuthorized(mac.toLowerCase(), consoleId);
    return NextResponse.json({ authorized });
  } catch (err) {
    console.error("connection-status check failed:", err.message);
    return NextResponse.json({ authorized: null });
  }
}
