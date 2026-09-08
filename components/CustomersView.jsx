"use client";

import { useMemo, useState } from "react";
import { formatDateTime, minutesToLabel } from "@/lib/analytics";

/**
 * One row per PERSON, not per visit.
 *
 * The visit log elsewhere in the dashboard answers "what happened"; this
 * answers "who are they and should we contact them". Contact details are the
 * most recent non-empty value the guest submitted, and anything they typed
 * inconsistently across visits is flagged rather than quietly picked.
 */

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function birthdayLabel(value) {
  const m = String(value || "").match(/^(\d{2})\/(\d{2})/);
  if (!m) return "";
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (!day || month < 1 || month > 12) return "";
  return `${day} ${MONTH_ABBR[month - 1]}`;
}

const TIER_STYLE = {
  vip: "bg-amber-400/20 text-warn",
  good: "bg-emerald-500/20 text-good",
  ok: "bg-sky-500/20 text-info",
  new: "bg-ink/10 text-ink/50",
};

// Email is the identity key, so it can never disagree with itself.
const CONFLICT_LABEL = {
  name: "name",
  phone: "phone number",
  birthday: "birthday",
};

/** "3 days ago" reads faster than a date when you're deciding who to chase. */
function agoLabel(days) {
  if (days === null || days === undefined) return "—";
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "Last week";
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

const SORTS = {
  recent: { label: "Last visit", fn: (a, b) => (a.daysSince ?? 1e9) - (b.daysSince ?? 1e9) },
  visits: { label: "Most visits", fn: (a, b) => b.visits - a.visits || (a.daysSince ?? 1e9) - (b.daysSince ?? 1e9) },
  lapsed: { label: "Longest away", fn: (a, b) => (b.daysSince ?? -1) - (a.daysSince ?? -1) },
  birthday: {
    label: "Birthday soonest",
    fn: (a, b) => (a.birthdayIn ?? 1e9) - (b.birthdayIn ?? 1e9),
  },
  name: { label: "Name", fn: (a, b) => String(a.name).localeCompare(String(b.name)) },
};

export default function CustomersView({
  roster,
  periodKeys,
  periodLabel,
  onlyOptedIn,
  search,
  onExport,
}) {
  const [scope, setScope] = useState("period"); // "period" | "all"
  const [sort, setSort] = useState("recent");
  const [needsAttention, setNeedsAttention] = useState(false);

  // Everything except the conflict toggle, so the toggle's badge counts the
  // people it would actually leave on screen.
  const base = useMemo(() => {
    let out = roster;
    if (scope === "period") out = out.filter((c) => periodKeys.has(c.key));
    if (onlyOptedIn) out = out.filter((c) => c.optedIn);

    const q = String(search || "").trim().toLowerCase();
    if (q) {
      out = out.filter((c) =>
        [c.name, c.email, c.phone].some((v) => String(v || "").toLowerCase().includes(q))
      );
    }
    return out;
  }, [roster, periodKeys, scope, onlyOptedIn, search]);

  const conflictCount = useMemo(() => base.filter((c) => c.hasConflict).length, [base]);

  const rows = useMemo(() => {
    const out = needsAttention ? base.filter((c) => c.hasConflict) : base;
    return out.slice().sort(SORTS[sort].fn);
  }, [base, needsAttention, sort]);

  const toggle = (active) =>
    `rounded-lg border px-3 py-1.5 text-xs xl:text-sm font-semibold transition ${
      active
        ? "border-ink/60 bg-ink text-surface"
        : "border-ink/15 bg-ink/5 text-ink/70 hover:bg-ink/10"
    }`;

  return (
    <div>
      {/* Scope + sort */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-ink/10 bg-ink/5 p-4">
        <span className="text-xs xl:text-sm text-ink/40">Showing:</span>
        <button onClick={() => setScope("period")} aria-pressed={scope === "period"} className={toggle(scope === "period")}>
          Visited {periodLabel}
        </button>
        <button
          onClick={() => setScope("all")}
          aria-pressed={scope === "all"}
          className={toggle(scope === "all")}
          title="Everyone on record, including people who haven't been back — the list a win-back offer targets"
        >
          Everyone on record
          <span className={scope === "all" ? "ml-1.5 text-surface/60" : "ml-1.5 text-ink/40"}>
            {roster.length}
          </span>
        </button>

        {/* Stays visible while it's active even if the count drops to zero,
            otherwise changing scope can strand the list with no way to clear
            the filter. */}
        {(conflictCount > 0 || needsAttention) && (
          <button
            onClick={() => setNeedsAttention((v) => !v)}
            aria-pressed={needsAttention}
            className={toggle(needsAttention) + " ml-2"}
            title="Guests who typed a different phone number or birthday on different visits"
          >
            ⚠ Conflicting details
            <span className={needsAttention ? "ml-1.5 text-surface/60" : "ml-1.5 text-ink/40"}>
              {conflictCount}
            </span>
          </button>
        )}

        <label className="ml-auto flex items-center gap-2 text-xs xl:text-sm text-ink/50">
          Sort by
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-lg border border-ink/15 bg-panel px-2 py-1.5 text-xs xl:text-sm text-ink outline-none focus:border-ink/50"
          >
            {Object.entries(SORTS).map(([k, s]) => (
              <option key={k} value={k}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={() => onExport(rows)}
          disabled={!rows.length}
          className="rounded-lg border border-ink/15 bg-ink/5 px-3 py-1.5 text-xs xl:text-sm font-semibold text-ink/80 transition hover:bg-ink/10 disabled:opacity-40"
        >
          ↓ Export {rows.length}
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-ink/10 bg-ink/5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm xl:text-base">
            <thead className="bg-ink/5 text-xs xl:text-sm uppercase tracking-wide text-ink/50">
              <tr>
                <th className="px-3 py-3">Customer</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Visits</th>
                <th className="px-3 py-3">Last visit</th>
                <th className="px-3 py-3">Birthday</th>
                <th className="px-3 py-3">Avg stay</th>
                <th className="px-3 py-3">Phone</th>
                <th className="px-3 py-3">Store</th>
                <th className="px-3 py-3">Offers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {rows.map((c) => (
                <tr key={c.key} className="hover:bg-ink/5">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-ink/90">{c.name || "—"}</span>
                      {c.hasConflict && (
                        <span
                          className="cursor-help text-warn"
                          title={`Typed a different ${Object.keys(c.conflicts)
                            .map((k) => CONFLICT_LABEL[k] || k)
                            .join(" and ")} on different visits:\n${Object.entries(c.conflicts)
                            .map(([k, v]) => `${CONFLICT_LABEL[k] || k}: ${v.join("  |  ")}`)
                            .join("\n")}`}
                        >
                          ⚠
                        </span>
                      )}
                    </div>
                    {c.email ? (
                      <a
                        href={`mailto:${c.email}`}
                        className="text-xs xl:text-sm text-ink/50 hover:text-ink hover:underline"
                      >
                        {c.email}
                      </a>
                    ) : (
                      <span className="text-xs xl:text-sm text-ink/30">no email on file</span>
                    )}
                  </td>

                  <td className="whitespace-nowrap px-3 py-2.5">
                    <span
                      className={`rounded px-2 py-0.5 text-xs xl:text-sm font-semibold ${TIER_STYLE[c.tier.tone]}`}
                      title={c.firstSeen ? `First seen ${formatDateTime(c.firstSeen)}` : ""}
                    >
                      {c.tier.label}
                    </span>
                  </td>

                  <td className="px-3 py-2.5 text-ink/80">{c.visits}</td>

                  <td
                    className="whitespace-nowrap px-3 py-2.5 text-ink/70"
                    title={c.lastSeen ? formatDateTime(c.lastSeen) : ""}
                  >
                    {agoLabel(c.daysSince)}
                  </td>

                  <td className="whitespace-nowrap px-3 py-2.5 text-ink/70">
                    {birthdayLabel(c.birthday) || <span className="text-ink/25">—</span>}
                    {c.birthdayIn !== null && c.birthdayIn <= 30 && (
                      <span
                        className="ml-1.5 rounded bg-amber-400/20 px-1.5 py-0.5 text-[11px] xl:text-xs font-semibold text-warn"
                        title="Worth a birthday offer while it's still useful"
                      >
                        {c.birthdayIn === 0 ? "today" : c.birthdayIn === 1 ? "tomorrow" : `${c.birthdayIn}d`}
                      </span>
                    )}
                  </td>

                  <td className="whitespace-nowrap px-3 py-2.5 text-ink/70">
                    {c.avgMinutes ? minutesToLabel(c.avgMinutes) : "—"}
                  </td>

                  <td className="whitespace-nowrap px-3 py-2.5 text-ink/60">
                    {c.phone ? (
                      <a href={`tel:${c.phone}`} className="hover:text-ink hover:underline">
                        {c.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>

                  <td className="px-3 py-2.5 text-ink/60">
                    {c.storeList.length > 1 ? (
                      <span title={c.storeList.join(", ")}>{c.storeList.length} stores</span>
                    ) : (
                      c.storeList[0] || "Unknown"
                    )}
                  </td>

                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded px-2 py-0.5 text-xs xl:text-sm font-semibold ${
                        c.optedIn ? "bg-emerald-500/20 text-good" : "bg-ink/10 text-ink/50"
                      }`}
                    >
                      {c.optedIn ? "Yes" : "No"}
                    </span>
                  </td>
                </tr>
              ))}

              {!rows.length && (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-ink/40">
                    {needsAttention
                      ? "Nobody here has conflicting details — turn that filter off to see the rest."
                      : scope === "period"
                      ? "Nobody matches in this period — try “Everyone on record”."
                      : "No customers match these filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs xl:text-sm text-ink/35">
        One row per person, matched on email address. Visits, stores and average stay are
        lifetime figures. Name, phone and birthday come from their most recent visit that
        filled the field in — ⚠ marks anyone who typed something different across visits.
      </p>
    </div>
  );
}
