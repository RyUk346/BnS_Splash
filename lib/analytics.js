// Pure data helpers for the admin dashboard — no React, no I/O, so they can
// be unit-tested and reused on either side.

/**
 * All day/hour maths is done in the BUSINESS timezone, not the viewer's.
 * A UK store's "late night" must not shift because someone opens the
 * dashboard from another country. Override with NEXT_PUBLIC_TIMEZONE.
 */
export const BUSINESS_TZ =
  (typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_TIMEZONE) ||
  "Europe/London";

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  weekday: "short",
});

const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** { year, month, day, hour, dow, dateKey } in the business timezone, or null. */
export function zonedParts(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const p = Object.fromEntries(
    partsFmt.formatToParts(d).map((x) => [x.type, x.value])
  );
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    dow: DOW[p.weekday] ?? 0,
    dateKey: `${p.year}-${p.month}-${p.day}`,
  };
}

/** "1h 12m" | "47m" | "" -> minutes (number). Unparseable -> 0. */
export function durationToMinutes(label) {
  if (!label) return 0;
  const s = String(label).trim();
  const h = s.match(/(\d+)\s*h/i);
  const m = s.match(/(\d+)\s*m/i);
  if (!h && !m) {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

/** minutes -> "1h 12m" / "47m" */
export function minutesToLabel(mins) {
  const total = Math.max(0, Math.round(mins || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** ISO/Sheets timestamp -> "YYYY-MM-DD" in the business timezone, or "" */
export function toDateKey(ts) {
  if (!ts) return "";
  // Date objects come from the date pickers, which are already local dates.
  if (ts instanceof Date) {
    if (isNaN(ts.getTime())) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${ts.getFullYear()}-${p(ts.getMonth() + 1)}-${p(ts.getDate())}`;
  }
  const z = zonedParts(ts);
  return z ? z.dateKey : "";
}

export function formatDateTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Collapse rows to ONE entry per device per calendar day.
 * Keeps the first connection of that day, sums all session durations,
 * and records how many times the device connected.
 */
export function dedupeByDeviceDay(rows) {
  const map = new Map();

  for (const r of rows) {
    const dateKey = toDateKey(r.timestamp);
    if (!dateKey) continue;
    // Devices without a MAC (direct page opens) fall back to email so they
    // still de-duplicate sensibly rather than all colliding into one row.
    const deviceKey = (r.mac || r.email || "unknown").toLowerCase();
    const key = `${dateKey}::${deviceKey}`;

    const mins = durationToMinutes(r.duration);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        ...r,
        dateKey,
        sessions: 1,
        totalMinutes: mins,
        firstSeen: r.timestamp,
        lastDisconnected: r.disconnected || "",
      });
      continue;
    }

    existing.sessions += 1;
    existing.totalMinutes += mins;
    // Keep the earliest connect time of the day...
    if (new Date(r.timestamp) < new Date(existing.firstSeen)) {
      existing.firstSeen = r.timestamp;
      existing.timestamp = r.timestamp;
    }
    // ...and the latest disconnect.
    if (r.disconnected && (!existing.lastDisconnected || new Date(r.disconnected) > new Date(existing.lastDisconnected))) {
      existing.lastDisconnected = r.disconnected;
    }
    // Prefer a row that actually has contact details.
    if (!existing.email && r.email) existing.email = r.email;
    if (!existing.firstName && r.firstName) existing.firstName = r.firstName;
    if (!existing.deviceName && r.deviceName) existing.deviceName = r.deviceName;
    if (!existing.vendor && r.vendor) existing.vendor = r.vendor;
    if (!existing.branch && r.branch) existing.branch = r.branch;
    if (!existing.promo && r.promo) existing.promo = r.promo;
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );
}

/** Filter by branch label and inclusive date range (YYYY-MM-DD strings). */
export function filterRows(rows, { branch, from, to }) {
  return rows.filter((r) => {
    if (branch && branch !== "all" && (r.branch || "Unknown") !== branch) return false;
    const dk = toDateKey(r.timestamp);
    if (!dk) return false;
    if (from && dk < from) return false;
    if (to && dk > to) return false;
    return true;
  });
}

/** Headline numbers for the stat cards. */
export function summarize(entries) {
  const withDuration = entries.filter((e) => e.totalMinutes > 0);
  const totalMinutes = withDuration.reduce((s, e) => s + e.totalMinutes, 0);
  const optedIn = entries.filter((e) => (e.promo || "").toLowerCase() === "yes").length;
  const uniqueEmails = new Set(
    entries.map((e) => (e.email || "").toLowerCase()).filter(Boolean)
  ).size;

  return {
    visits: entries.length,
    uniqueEmails,
    avgMinutes: withDuration.length ? totalMinutes / withDuration.length : 0,
    totalMinutes,
    optedIn,
    optInRate: entries.length ? (optedIn / entries.length) * 100 : 0,
  };
}

/** Visits per day, ascending — for the trend chart. */
export function visitsByDay(entries) {
  const map = new Map();
  for (const e of entries) {
    map.set(e.dateKey, (map.get(e.dateKey) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Visits per branch, descending. */
export function visitsByBranch(entries) {
  const map = new Map();
  for (const e of entries) {
    const b = e.branch || "Unknown";
    map.set(b, (map.get(b) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([branch, count]) => ({ branch, count }))
    .sort((a, b) => b.count - a.count);
}

/** Visits per hour of day (0–23) — shows peak trading times. */
export function visitsByHour(entries) {
  const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
  for (const e of entries) {
    const d = new Date(e.timestamp);
    if (!isNaN(d.getTime())) buckets[d.getHours()].count += 1;
  }
  return buckets;
}

/**
 * CSV text for the given entries.
 *
 * Ordered for marketing use: who they are and how to reach them first, the
 * visit detail after. Device name and vendor are deliberately omitted — they
 * are diagnostic fields, they stay in the Google Sheet, and they only get in
 * the way when this file is imported into an email platform.
 *
 * `visits` / `customerType` are added by the dashboard where guest history is
 * available; the columns stay in the file either way so the shape is stable.
 */
export function toCsv(entries) {
  const headers = [
    "Name",
    "Email",
    "Phone",
    "Birthday",
    "Customer Type",
    "Total Visits",
    "Marketing Opt-in",
    "Branch",
    "Visit Date",
    "First Connected",
    "Last Disconnected",
    "Total Time",
    "Sessions",
    "Device MAC",
    "SSID",
  ];
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const e of entries) {
    const visits = e.visits || "";
    lines.push(
      [
        e.firstName,
        e.email,
        e.phone,
        e.birthday,
        e.tier ? e.tier.label : visits ? loyaltyTier(visits).label : "",
        visits,
        e.promo,
        e.branch,
        e.dateKey,
        formatDateTime(e.timestamp),
        e.lastDisconnected ? formatDateTime(e.lastDisconnected) : "",
        e.totalMinutes ? minutesToLabel(e.totalMinutes) : "",
        e.sessions,
        e.mac,
        e.ssid,
      ]
        .map(esc)
        .join(",")
    );
  }
  return lines.join("\n");
}

/** First and last day of the current month as YYYY-MM-DD. */
export function thisMonthRange(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const y = now.getFullYear();
  const m = now.getMonth();
  const first = `${y}-${p(m + 1)}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const last = `${y}-${p(m + 1)}-${p(lastDay)}`;
  return { from: first, to: last };
}

/** Last N days ending today, as YYYY-MM-DD. */
export function lastDaysRange(n, now = new Date()) {
  const start = new Date(now);
  start.setDate(now.getDate() - (n - 1));
  return { from: toDateKey(start), to: toDateKey(now) };
}

/* ══════════════════════════════════════════════════════════════════
   Business analytics
   ══════════════════════════════════════════════════════════════════
   Everything below works on DEDUPED entries (one row per device per day).

   Two rules that keep these numbers honest:

   1. Guest history is always computed from the FULL dataset, never the
      filtered one. Otherwise a guest whose first visit predates the
      selected window would be miscounted as "new".
   2. Anything derived from a small sample carries its n, so the UI can
      refuse to show a precise-looking percentage built on six people.
   ────────────────────────────────────────────────────────────────── */

/** Below this, a rate is too noisy to act on — the UI greys it out. */
export const MIN_SAMPLE = 30;

/**
 * Loyalty tier from lifetime visit count. Gives staff a one-word answer to
 * "how much is this customer worth keeping?".
 */
export function loyaltyTier(visits) {
  const n = Number(visits) || 0;
  if (n >= 5) return { key: "vip", label: "VIP", tone: "vip" };
  if (n >= 3) return { key: "regular", label: "Regular", tone: "good" };
  if (n === 2) return { key: "returning", label: "Returning", tone: "ok" };
  return { key: "new", label: "First visit", tone: "new" };
}

/**
 * Days until a guest's next birthday, from a "DD/MM" or "DD/MM/YYYY" value.
 * 0 = today. Returns null if there's no usable birthday.
 *
 * Used to surface a birthday offer while it's still actionable — the single
 * most reliable upsell trigger in this dataset.
 *
 * 29 February is deliberately allowed to land on 1 March in non-leap years,
 * which is how the offer would be honoured anyway. Any other impossible date
 * (31/04, from the days before the splash page validated the calendar) returns
 * null rather than quietly sliding into the next month.
 */
export function daysUntilBirthday(birthday, now = new Date()) {
  const m = String(birthday || "").match(/^(\d{2})\/(\d{2})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;

  const leapDay = day === 29 && month === 2;
  const build = (year) => {
    const d = new Date(year, month - 1, day);
    // JS rolls overflow into the next month; reject it unless it's 29 Feb.
    if (d.getMonth() !== month - 1 && !leapDay) return null;
    return d;
  };

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = build(now.getFullYear());
  if (next === null) return null;
  if (next < today) next = build(now.getFullYear() + 1);
  if (next === null) return null;
  return Math.round((next - today) / 86400000);
}

/** Stable identity for a guest: email if we have one, else the device. */
export function guestKey(entry) {
  const email = String(entry.email || "").trim().toLowerCase();
  return email || `mac:${String(entry.mac || "").toLowerCase()}`;
}

/**
 * Visit history per guest, from the full dataset.
 * -> Map(key -> { key, email, name, visits: [ISO...], first, last, count, optedIn })
 */
export function buildGuestIndex(allEntries) {
  const map = new Map();
  for (const e of allEntries) {
    const key = guestKey(e);
    if (!key || key === "mac:") continue;
    let g = map.get(key);
    if (!g) {
      g = { key, email: e.email || "", name: e.firstName || "", visits: [], optedIn: false, branches: new Set() };
      map.set(key, g);
    }
    g.visits.push(e.timestamp);
    if (!g.name && e.firstName) g.name = e.firstName;
    if (!g.email && e.email) g.email = e.email;
    if (String(e.promo || "").toLowerCase() === "yes") g.optedIn = true;
    if (e.branch) g.branches.add(e.branch);
  }
  for (const g of map.values()) {
    g.visits.sort();
    g.first = g.visits[0];
    g.last = g.visits[g.visits.length - 1];
    g.count = g.visits.length;
  }
  return map;
}

/** Is this specific visit the guest's first ever? */
export function isFirstVisit(entry, guestIndex) {
  const g = guestIndex.get(guestKey(entry));
  if (!g) return true;
  return new Date(entry.timestamp).getTime() <= new Date(g.first).getTime();
}

/**
 * New vs returning visits per day within the filtered set, judged against
 * full history. Returns [{ date, newGuests, returning }] ascending.
 */
export function newVsReturningByDay(entries, guestIndex) {
  const map = new Map();
  for (const e of entries) {
    const d = e.dateKey || toDateKey(e.timestamp);
    if (!d) continue;
    if (!map.has(d)) map.set(d, { date: d, newGuests: 0, returning: 0 });
    const bucket = map.get(d);
    if (isFirstVisit(e, guestIndex)) bucket.newGuests += 1;
    else bucket.returning += 1;
  }
  return Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Headline retention figures for a set of visits. */
export function retentionSummary(entries, guestIndex) {
  let firstVisits = 0;
  let returnVisits = 0;
  const guests = new Set();
  for (const e of entries) {
    guests.add(guestKey(e));
    if (isFirstVisit(e, guestIndex)) firstVisits += 1;
    else returnVisits += 1;
  }
  const total = entries.length;
  // Of the guests seen in this window, how many have ever visited more than once?
  let repeatGuests = 0;
  for (const k of guests) {
    const g = guestIndex.get(k);
    if (g && g.count > 1) repeatGuests += 1;
  }
  return {
    visits: total,
    guests: guests.size,
    firstVisits,
    returnVisits,
    returnShare: total ? (returnVisits / total) * 100 : 0,
    repeatGuests,
    repeatGuestShare: guests.size ? (repeatGuests / guests.size) * 100 : 0,
    visitsPerGuest: guests.size ? total / guests.size : 0,
  };
}

/**
 * Gaps between consecutive visits, across all guests (full history).
 * Drives the "when to send the win-back" decision.
 */
export function timeToReturn(guestIndex) {
  const gaps = [];
  for (const g of guestIndex.values()) {
    for (let i = 1; i < g.visits.length; i++) {
      const days =
        (new Date(g.visits[i]).getTime() - new Date(g.visits[i - 1]).getTime()) / 86400000;
      if (days >= 0) gaps.push(days);
    }
  }
  gaps.sort((a, b) => a - b);
  const median = gaps.length
    ? gaps.length % 2
      ? gaps[(gaps.length - 1) / 2]
      : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2
    : 0;

  const buckets = [
    { label: "Same day", min: 0, max: 1 },
    { label: "1–2 days", min: 1, max: 3 },
    { label: "3–7 days", min: 3, max: 8 },
    { label: "8–14 days", min: 8, max: 15 },
    { label: "15–30 days", min: 15, max: 31 },
    { label: "30 days +", min: 31, max: Infinity },
  ].map((b) => ({
    label: b.label,
    count: gaps.filter((d) => d >= b.min && d < b.max).length,
  }));

  const within7 = gaps.filter((d) => d < 8).length;
  return {
    n: gaps.length,
    median,
    buckets,
    withinWeekPct: gaps.length ? (within7 / gaps.length) * 100 : 0,
  };
}

/**
 * Who to contact this week, by how long since their last visit.
 * Computed from full history as of `now` — not affected by the date filter.
 */
export function lifecycleSegments(guestIndex, now = new Date()) {
  const defs = [
    { key: "active", label: "Active", desc: "Seen in the last 7 days", min: 0, max: 7,
      action: "No offer needed — they're already coming" },
    { key: "cooling", label: "Cooling", desc: "7–14 days since last visit", min: 7, max: 14,
      action: "Best moment to nudge — most returns happen in this window" },
    { key: "atRisk", label: "At risk", desc: "14–30 days", min: 14, max: 30,
      action: "Win-back offer" },
    { key: "lapsed", label: "Lapsed", desc: "30 days or more", min: 30, max: Infinity,
      action: "Strong reactivation, or let go" },
  ];
  const out = defs.map((d) => ({ ...d, total: 0, contactable: 0, guests: [] }));

  for (const g of guestIndex.values()) {
    const days = (now.getTime() - new Date(g.last).getTime()) / 86400000;
    if (days < 0) continue;
    const seg = out.find((s) => days >= s.min && days < s.max);
    if (!seg) continue;
    seg.total += 1;
    const contactable = !!(g.optedIn && g.email);
    if (contactable) seg.contactable += 1;
    // Keep everyone so the audience list can show who ISN'T contactable and
    // why — a name with no opt-in is still useful context for the owner.
    seg.guests.push({ ...g, contactable, daysSince: Math.floor(days) });
  }
  for (const s of out) {
    s.guests.sort((a, b) => a.daysSince - b.daysSince);
  }
  return out;
}

/** How many visits each guest has made — the "one-timer wall". */
export function visitFrequency(guestIndex) {
  const counts = new Map();
  for (const g of guestIndex.values()) {
    const k = Math.min(g.count, 5); // 5 = "5+"
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const total = guestIndex.size;
  return Array.from({ length: 5 }, (_, i) => {
    const v = i + 1;
    const n = counts.get(v) || 0;
    return {
      label: v === 5 ? "5+ visits" : `${v} visit${v > 1 ? "s" : ""}`,
      count: n,
      pct: total ? (n / total) * 100 : 0,
    };
  });
}

/* ── Dayparts ────────────────────────────────────────────────────── */

// Hours are business-local and expressed on a 6:00–30:00 scale so late
// trading wraps past midnight. Spans must be realistic: counting "late" as
// nine hours would make its per-hour index look artificially weak.
export const DAYPARTS = [
  { key: "morning", label: "Morning", start: 6, end: 11 },
  { key: "lunch", label: "Lunch", start: 11, end: 15 },
  { key: "afternoon", label: "Afternoon", start: 15, end: 17 },
  { key: "evening", label: "Evening", start: 17, end: 21 },
  { key: "late", label: "Late", start: 21, end: 25 }, // 21:00–01:00
  { key: "overnight", label: "Overnight", start: 25, end: 30 }, // 01:00–06:00
];

export function daypartOf(ts) {
  const z = zonedParts(ts);
  if (!z) return null;
  let h = z.hour;
  if (h < 6) h += 24; // treat 00:00–05:59 as part of "late"
  return DAYPARTS.find((p) => h >= p.start && h < p.end) || null;
}

/**
 * Per-daypart volume, capture and stickiness.
 *
 *  index      visits per trading hour, 100 = an average hour
 *  optInRate  % of that daypart's guests who accepted marketing
 *  returnRate % of FIRST visits in that daypart that led to another visit
 */
export function daypartAnalysis(entries, guestIndex) {
  const rows = DAYPARTS.map((p) => ({
    key: p.key,
    label: `${p.label} ${String(p.start).padStart(2, "0")}–${String(p.end % 24).padStart(2, "0")}`,
    hours: p.end - p.start,
    visits: 0,
    optIn: 0,
    optInAnswered: 0,
    firstVisits: 0,
    firstVisitsReturned: 0,
  }));
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

  for (const e of entries) {
    const p = daypartOf(e.timestamp);
    if (!p) continue;
    const row = byKey[p.key];
    row.visits += 1;
    const promo = String(e.promo || "").toLowerCase();
    if (promo === "yes" || promo === "no") {
      row.optInAnswered += 1;
      if (promo === "yes") row.optIn += 1;
    }
    if (isFirstVisit(e, guestIndex)) {
      row.firstVisits += 1;
      const g = guestIndex.get(guestKey(e));
      if (g && g.count > 1) row.firstVisitsReturned += 1;
    }
  }

  const totalVisits = rows.reduce((s, r) => s + r.visits, 0);
  const totalHours = rows.reduce((s, r) => s + r.hours, 0);
  const avgPerHour = totalHours ? totalVisits / totalHours : 0;

  return rows.map((r) => ({
    ...r,
    share: totalVisits ? (r.visits / totalVisits) * 100 : 0,
    index: avgPerHour ? Math.round((r.visits / r.hours / avgPerHour) * 100) : 0,
    optInRate: r.optInAnswered ? (r.optIn / r.optInAnswered) * 100 : null,
    returnRate: r.firstVisits ? (r.firstVisitsReturned / r.firstVisits) * 100 : null,
  }));
}

/** 7×24 grid of visit counts — rows Mon..Sun. */
export function dayHourGrid(entries) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  let max = 0;
  for (const e of entries) {
    const z = zonedParts(e.timestamp);
    if (!z) continue;
    grid[z.dow][z.hour] += 1;
    if (grid[z.dow][z.hour] > max) max = grid[z.dow][z.hour];
  }
  return { grid, max, days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] };
}

/** Dwell-time distribution — how long guests actually stay. */
export function dwellDistribution(entries) {
  const mins = entries.map((e) => e.totalMinutes).filter((m) => m > 0).sort((a, b) => a - b);
  const buckets = [
    { label: "Under 10m", min: 0, max: 10 },
    { label: "10–20m", min: 10, max: 20 },
    { label: "20–30m", min: 20, max: 30 },
    { label: "30–45m", min: 30, max: 45 },
    { label: "45–60m", min: 45, max: 60 },
    { label: "1–2h", min: 60, max: 120 },
    { label: "Over 2h", min: 120, max: Infinity },
  ].map((b) => ({ label: b.label, count: mins.filter((m) => m >= b.min && m < b.max).length }));

  const pick = (q) => (mins.length ? mins[Math.min(mins.length - 1, Math.floor(mins.length * q))] : 0);
  const quick = mins.filter((m) => m < 20).length;

  return {
    n: mins.length,
    median: pick(0.5),
    p90: pick(0.9),
    mean: mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : 0,
    buckets,
    quickVisit: quick,
    sitIn: mins.length - quick,
    quickPct: mins.length ? (quick / mins.length) * 100 : 0,
  };
}

/** Birthdays by month — a ready-made campaign calendar. */
export function birthdayMonths(entries) {
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const rows = names.map((label, i) => ({
    month: i + 1, label, count: 0, contactable: 0, guests: [],
  }));
  const seen = new Set();
  let known = 0;
  let missing = 0;

  for (const e of entries) {
    const key = guestKey(e);
    if (seen.has(key)) continue; // count each guest once
    seen.add(key);
    const m = String(e.birthday || "").match(/^(\d{2})\/(\d{2})/);
    if (!m) {
      missing += 1;
      continue;
    }
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) {
      missing += 1;
      continue;
    }
    known += 1;
    const row = rows[month - 1];
    row.count += 1;
    const contactable = String(e.promo || "").toLowerCase() === "yes" && !!e.email;
    if (contactable) row.contactable += 1;
    row.guests.push({
      key,
      name: e.firstName || "",
      email: e.email || "",
      phone: e.phone || "",
      birthday: e.birthday || "",
      day,
      last: e.timestamp,
      branches: new Set(e.branch ? [e.branch] : []),
      count: 1,
      contactable,
    });
  }
  for (const r of rows) r.guests.sort((a, b) => a.day - b.day);
  return { rows, known, missing };
}

/** Per-site comparison table. */
export function siteComparison(entries, guestIndex) {
  const map = new Map();
  for (const e of entries) {
    const site = e.branch || "Unknown";
    if (!map.has(site)) {
      map.set(site, {
        site, visits: 0, guests: new Set(), optIn: 0, optInAnswered: 0,
        dwell: [], first: e.timestamp, last: e.timestamp, returnVisits: 0,
      });
    }
    const s = map.get(site);
    s.visits += 1;
    s.guests.add(guestKey(e));
    const promo = String(e.promo || "").toLowerCase();
    if (promo === "yes" || promo === "no") {
      s.optInAnswered += 1;
      if (promo === "yes") s.optIn += 1;
    }
    if (e.totalMinutes > 0) s.dwell.push(e.totalMinutes);
    if (new Date(e.timestamp) < new Date(s.first)) s.first = e.timestamp;
    if (new Date(e.timestamp) > new Date(s.last)) s.last = e.timestamp;
    if (!isFirstVisit(e, guestIndex)) s.returnVisits += 1;
  }

  return Array.from(map.values())
    .map((s) => {
      const d = s.dwell.sort((a, b) => a - b);
      const days =
        Math.max(1, Math.round((new Date(s.last) - new Date(s.first)) / 86400000) + 1);
      return {
        site: s.site,
        visits: s.visits,
        guests: s.guests.size,
        optInRate: s.optInAnswered ? (s.optIn / s.optInAnswered) * 100 : null,
        medianDwell: d.length ? d[Math.floor(d.length / 2)] : null,
        perDay: s.visits / days,
        returnShare: s.visits ? (s.returnVisits / s.visits) * 100 : 0,
        first: s.first,
        last: s.last,
      };
    })
    .sort((a, b) => b.visits - a.visits);
}

/**
 * Contactable marketing audience — the number that matters before any send.
 */
export function audience(guestIndex) {
  let optedIn = 0;
  let withEmail = 0;
  let withPhone = 0;
  let declined = 0;
  for (const g of guestIndex.values()) {
    if (g.optedIn) {
      optedIn += 1;
      if (g.email) withEmail += 1;
    } else declined += 1;
  }
  return {
    guests: guestIndex.size,
    optedIn,
    declined,
    mailable: withEmail,
    optInRate: guestIndex.size ? (optedIn / guestIndex.size) * 100 : 0,
    withPhone,
  };
}

/**
 * Data-quality checks on the RAW rows (before de-duplication).
 * These are the problems that quietly corrupt every other number.
 */
export function dataQuality(rawRows) {
  const total = rawRows.length;
  const ssid = new Map();
  let missingBranch = 0;
  let missingPhone = 0;
  let missingEmail = 0;
  let randomisedMac = 0;
  let withMac = 0;
  let noDuration = 0;
  const emailCase = new Set();
  const stampsByMac = new Map(); // mac -> [timestamps], for double-submit detection
  let doubleSubmits = 0;

  for (const r of rawRows) {
    if (r.ssid) ssid.set(r.ssid, (ssid.get(r.ssid) || 0) + 1);
    if (!r.branch) missingBranch += 1;
    if (!r.phone) missingPhone += 1;
    if (!r.email) missingEmail += 1;
    if (r.email && r.email !== r.email.toLowerCase()) emailCase.add(r.email);
    if (!r.duration) noDuration += 1;

    const mac = String(r.mac || "").toLowerCase();
    if (mac) {
      withMac += 1;
      const first = parseInt(mac.slice(0, 2), 16);
      if (!Number.isNaN(first) && first & 0b10) randomisedMac += 1;

      const t = new Date(r.timestamp).getTime();
      if (!Number.isNaN(t)) {
        if (!stampsByMac.has(mac)) stampsByMac.set(mac, []);
        stampsByMac.get(mac).push(t);
      }
    }
  }

  // A double submit = the same device registering twice within 5 minutes.
  // Sort per device first: the raw sheet isn't guaranteed to be in order,
  // and comparing only against the previously-seen row misses them.
  for (const stamps of stampsByMac.values()) {
    stamps.sort((a, b) => a - b);
    for (let i = 1; i < stamps.length; i++) {
      if (stamps[i] - stamps[i - 1] < 5 * 60 * 1000) doubleSubmits += 1;
    }
  }

  const ssidList = Array.from(ssid.entries())
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n);

  const pct = (n) => (total ? (n / total) * 100 : 0);
  return {
    total,
    ssidVariants: ssidList.length,
    ssidList,
    ssidMissingPct: pct(total - ssidList.reduce((s, x) => s + x.n, 0)),
    missingBranch,
    missingBranchPct: pct(missingBranch),
    missingPhonePct: pct(missingPhone),
    missingEmail,
    emailCaseIssues: emailCase.size,
    randomisedMacPct: withMac ? (randomisedMac / withMac) * 100 : 0,
    doubleSubmits,
    doubleSubmitPct: pct(doubleSubmits),
    noDurationPct: pct(noDuration),
  };
}
