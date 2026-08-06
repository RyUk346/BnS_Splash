import { NextResponse } from "next/server";
import { ADMIN_COOKIE, isValidPassword, makeToken } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }

  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { success: false, error: "Admin password is not configured on the server." },
      { status: 500 }
    );
  }

  if (!isValidPassword(body.password)) {
    // Small delay to blunt brute-force attempts.
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ success: false, error: "Incorrect password." }, { status: 401 });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set(ADMIN_COOKIE, makeToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 12, // 12 hours
  });
  return res;
}

/** Logout */
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
