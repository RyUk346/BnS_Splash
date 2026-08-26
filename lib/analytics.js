// Pure data helpers for the admin dashboard — no React, no I/O, so they can
// be unit-tested and reused on either side.

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

/** ISO/Sheets timestamp -> "YYYY-MM-DD" (local date), or "" */
export function toDateKey(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

/** CSV text for the given entries. */
export function toCsv(entries) {
  const headers = [
    "Date",
    "First Connected",
    "Last Disconnected",
    "Total Time",
    "Sessions",
    "Name",
    "Email",
    "Phone",
    "Birthday",
    "Branch",
    "Promo Offers",
    "Device Name",
    "Vendor",
    "Device MAC",
    "SSID",
  ];
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const e of entries) {
    lines.push(
      [
        e.dateKey,
        formatDateTime(e.timestamp),
        e.lastDisconnected ? formatDateTime(e.lastDisconnected) : "",
        e.totalMinutes ? minutesToLabel(e.totalMinutes) : "",
        e.sessions,
        e.firstName,
        e.email,
        e.phone,
        e.birthday,
        e.branch,
        e.promo,
        e.deviceName,
        e.vendor,
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
