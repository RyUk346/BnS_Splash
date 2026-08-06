// Shared email helpers — safe to import from both client and server
// (no Node-only APIs here; DNS/MX lives in lib/email-server.js).

// Pragmatic RFC-5322-ish check: one @, no spaces, a dotted domain with a 2+ TLD.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Trim + lowercase. Emails are case-insensitive in practice for our use. */
export function normalizeEmail(value) {
  return (value || "").trim().toLowerCase();
}

export function isValidFormat(value) {
  return EMAIL_RE.test(normalizeEmail(value));
}

// Popular domains we compare typos against.
const COMMON_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "btinternet.com",
  "sky.com",
];

// Levenshtein edit distance (small strings, so the simple DP is fine).
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Suggest a corrected email if the domain looks like a typo of a common one.
 * Returns a suggested full email string, or null. Never auto-applies.
 */
export function suggestEmail(value) {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain || COMMON_DOMAINS.includes(domain)) return null;

  let best = null;
  let bestDist = Infinity;
  for (const cand of COMMON_DOMAINS) {
    const d = editDistance(domain, cand);
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  // Only suggest for a close miss (1–2 edits) — avoids nonsense suggestions.
  if (best && bestDist > 0 && bestDist <= 2) {
    return `${local}@${best}`;
  }
  return null;
}
