// Minimal password gate for the admin dashboard.
// Not a full auth system — one shared password, stored in .env, exchanged for
// an httpOnly cookie. Enough to keep customer data off the open internet.

import crypto from "crypto";

export const ADMIN_COOKIE = "hg_admin";

function secret() {
  return process.env.ADMIN_PASSWORD || "";
}

/** Deterministic token derived from the password — changes if the password does. */
export function makeToken() {
  return crypto
    .createHash("sha256")
    .update(`hyperglow-admin::${secret()}`)
    .digest("hex");
}

export function isValidPassword(input) {
  const expected = secret();
  if (!expected) return false; // no password configured → deny everything
  const a = Buffer.from(String(input || ""));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b); // constant-time compare
}

/** True when the request carries a valid admin cookie. */
export function isAuthed(req) {
  if (!secret()) return false;
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  return !!token && token === makeToken();
}
