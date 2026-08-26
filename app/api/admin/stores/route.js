import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/admin-auth";
import { readStores, addStore, updateStore, removeStore, isFileBacked } from "@/lib/stores";

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

/** Add a store: { id, label } */
export async function POST(req) {
  if (!isAuthed(req)) return deny();
  try {
    const { id, label } = await req.json();
    const stores = addStore({ id, label });
    return NextResponse.json({ success: true, stores });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}

/** Rename a store: { id, label } */
export async function PATCH(req) {
  if (!isAuthed(req)) return deny();
  try {
    const { id, label } = await req.json();
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
