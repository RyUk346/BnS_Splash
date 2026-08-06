import { NextResponse } from "next/server";
import { EMAIL_RE, normalizeEmail, suggestEmail } from "@/lib/email";
import { isDisposableDomain } from "@/lib/disposable-domains";

export const dynamic = "force-dynamic";

// DNS lookups run over DNS-over-HTTPS (port 443) instead of classic DNS
// (port 53). Many networks — and this project's dev environment — block
// outbound port 53, which makes Node's dns.resolveMx fail with ECONNREFUSED.
// DoH is just HTTPS, so it works everywhere the server has internet.
// IP literals (not hostnames) so we never need DNS to reach the resolver.
const DOH_ENDPOINTS = ["https://1.1.1.1/dns-query", "https://8.8.8.8/resolve"];

// DNS record type numbers
const TYPE_MX = 15;
// DNS response status codes
const STATUS_NOERROR = 0;
const STATUS_NXDOMAIN = 3; // domain does not exist

// Per-domain cache so repeat domains (gmail.com, etc.) don't re-query.
const mxCache = new Map(); // domain -> { hasMx, expires }
const MX_TTL_MS = 60 * 60 * 1000; // 1 hour
const MX_TIMEOUT_MS = 4000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

/** One DoH query. Returns the parsed JSON, trying endpoints in order. */
async function dohQuery(name, type) {
  let lastErr = null;
  for (const base of DOH_ENDPOINTS) {
    try {
      const url = `${base}?name=${encodeURIComponent(name)}&type=${type}`;
      const res = await withTimeout(
        fetch(url, { headers: { accept: "application/dns-json" } }),
        MX_TIMEOUT_MS
      );
      if (res.ok) return await res.json();
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("all DoH endpoints failed");
}

/**
 * Does the domain exist and accept mail?
 *   true  → has MX records
 *   false → domain does not exist (NXDOMAIN) → reject
 *   null  → couldn't determine (network error) → caller FAILS OPEN
 */
async function domainHasMx(domain) {
  const cached = mxCache.get(domain);
  if (cached && cached.expires > Date.now()) return cached.hasMx;

  try {
    const j = await dohQuery(domain, "MX");

    if (j.Status === STATUS_NXDOMAIN) {
      mxCache.set(domain, { hasMx: false, expires: Date.now() + MX_TTL_MS });
      return false; // domain doesn't exist at all
    }
    if (j.Status === STATUS_NOERROR) {
      const hasMx = Array.isArray(j.Answer) && j.Answer.some((a) => a.type === TYPE_MX);
      if (hasMx) {
        mxCache.set(domain, { hasMx: true, expires: Date.now() + MX_TTL_MS });
        return true;
      }
      // Domain exists but has no MX. Confirm it's a real domain via an A
      // record; if even that is NXDOMAIN, reject — otherwise accept (some
      // valid domains receive mail via their A record).
      const a = await dohQuery(domain, "A");
      if (a.Status === STATUS_NXDOMAIN) {
        mxCache.set(domain, { hasMx: false, expires: Date.now() + MX_TTL_MS });
        return false;
      }
      return null; // exists, no MX — be lenient
    }
    return null; // SERVFAIL etc. → inconclusive
  } catch (err) {
    console.warn(`[validate-email] DoH lookup for ${domain} failed: ${err.message}`);
    return null; // network problem → fail open, never strand a guest
  }
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ valid: false, reason: "bad_request" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);

  // 1. Format
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ valid: false, reason: "format", message: "Please enter a valid email address." });
  }

  const domain = email.slice(email.lastIndexOf("@") + 1);

  // 2. Typo suggestion (don't block, but surface it)
  const suggestion = suggestEmail(email);

  // 3. Disposable domains → hard reject
  if (isDisposableDomain(domain)) {
    return NextResponse.json({
      valid: false,
      reason: "disposable",
      message: "Please use a permanent email address.",
      suggestion,
    });
  }

  // 4. MX records → reject only on a definitive "no". Fail open on unknown.
  const hasMx = await domainHasMx(domain);
  if (hasMx === false) {
    return NextResponse.json({
      valid: false,
      reason: "no_mx",
      message: "This email domain doesn't look deliverable — please check it.",
      suggestion,
    });
  }

  // Valid (or unknown-but-accepted). Return the normalized email + any suggestion.
  return NextResponse.json({ valid: true, email, suggestion });
}
