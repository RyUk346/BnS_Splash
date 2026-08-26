import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/admin-auth";
import { listHosts, testConsole } from "@/lib/unifi";
import { readStores } from "@/lib/stores";

export const dynamic = "force-dynamic";

/**
 * Every console on the UniFi account, flagged with whether it's already
 * added as a store. Feeds the "add store" picker.
 */
export async function GET(req) {
  if (!isAuthed(req)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const [hosts, stores] = [await listHosts(), readStores()];
    const added = new Set(stores.map((s) => s.id));
    return NextResponse.json({
      success: true,
      consoles: hosts.map((h) => ({ ...h, added: added.has(h.id) })),
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 502 });
  }
}

/** Connection test for one console: { id } */
export async function POST(req) {
  if (!isAuthed(req)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await req.json();
    if (!id) throw new Error("Console ID is required");
    const result = await testConsole(id);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
