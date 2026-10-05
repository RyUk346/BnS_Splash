import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/admin-auth";
import {
  readStores,
  addStore,
  updateStore,
  setConsoleName,
  removeStore,
  isFileBacked,
} from "@/lib/stores";

export const dynamic = "force-dynamic";

const deny = () =>
  NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });

/** List configured stores. */
export async function GET(req) {
  if (!isAuthed(req)) return deny();
  return NextResponse.json({
    success: true,
    stores: readStores(),
    // false = still reading from .env; the first write migrates it to disk
    fileBacked: isFileBacked(),
  });
}

/**
 * Add a store: { id, label, consoleName? }
 *
 * `consoleName` is what UniFi calls the hardware. The panel already has it
 * from the console picker, so it's passed through rather than costing another
 * api.ui.com round trip here.
 */
export async function POST(req) {
  if (!isAuthed(req)) return deny();
  try {
    const { id, label, consoleName } = await req.json();
    const stores = addStore({ id, label, consoleName });
    return NextResponse.json({ success: true, stores });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}

/**
 * Rename a store: { id, label }
 * Or record the console's own UniFi name: { id, consoleName }
 *
 * The second form is how a rename in UniFi, or a store added before this
 * field existed, gets backfilled — the panel sends it after discovering the
 * live console list.
 */
export async function PATCH(req) {
  if (!isAuthed(req)) return deny();
  try {
    const { id, label, consoleName } = await req.json();
    if (consoleName !== undefined && label === undefined) {
      return NextResponse.json({ success: true, stores: setConsoleName(id, consoleName) });
    }
    const stores = updateStore(id, label);
    return NextResponse.json({ success: true, stores });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}

/** Remove a store: { id } */
export async function DELETE(req) {
  if (!isAuthed(req)) return deny();
  try {
    const { id } = await req.json();
    const stores = removeStore(id);
    return NextResponse.json({ success: true, stores });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
