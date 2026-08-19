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
  const mac = (new URL(req.url).searchParams.get("mac") || "").trim();
  if (!MAC_RE.test(mac)) {
    return NextResponse.json({ authorized: null, error: "bad mac" }, { status: 400 });
  }

  try {
    const authorized = await isGuestAuthorized(mac.toLowerCase());
    return NextResponse.json({ authorized });
  } catch (err) {
    console.error("connection-status check failed:", err.message);
    return NextResponse.json({ authorized: null });
  }
}
