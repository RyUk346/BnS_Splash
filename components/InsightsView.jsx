"use client";

import { useMemo } from "react";
import { Panel, StatCard, BarChart, HBars, HeatMap, Figure, Insight } from "@/components/ui/Charts";
import {
  MIN_SAMPLE,
  birthdayMonths,
  dataQuality,
  daypartAnalysis,
  daypartOf,
  dayHourGrid,
  dwellDistribution,
  guestKey,
  minutesToLabel,
  siteComparison,
  timeToReturn,
  visitFrequency,
  zonedParts,
} from "@/lib/analytics";

const MONTH_NAMES = ["January","February","March","April","May","June","July",
  "August","September","October","November","December"];

export default function InsightsView({ entries, rawRows, guestIndex, onShowAudience }) {
  const dayparts = useMemo(() => daypartAnalysis(entries, guestIndex), [entries, guestIndex]);
  const heat = useMemo(() => dayHourGrid(entries), [entries]);
  const dwell = useMemo(() => dwellDistribution(entries), [entries]);
  const ttr = useMemo(() => timeToReturn(guestIndex), [guestIndex]);
  const freq = useMemo(() => visitFrequency(guestIndex), [guestIndex]);
  const birthdays = useMemo(() => birthdayMonths(entries), [entries]);
  const sites = useMemo(() => siteComparison(entries, guestIndex), [entries, guestIndex]);
  const dq = useMemo(() => dataQuality(rawRows || []), [rawRows]);

  // The daypart that keeps people coming back, among those with enough data.
  const stickiest = useMemo(() => {
    const usable = dayparts.filter((d) => d.firstVisits >= MIN_SAMPLE && d.returnRate != null);
    return usable.sort((a, b) => b.returnRate - a.returnRate)[0] || null;
  }, [dayparts]);

  const busiest = useMemo(
    () => [...dayparts].filter((d) => d.visits > 0).sort((a, b) => b.index - a.index)[0] || null,
    [dayparts]
  );

  /** Guests who visited during a given trading period, in the current filter. */
  function openDaypart(d) {
    if (!onShowAudience) return;
    const seen = new Map();
    for (const e of entries) {
      const p = daypartOf(e.timestamp);
      if (!p || p.key !== d.key) continue;
      const key = guestKey(e);
      if (seen.has(key)) {
        seen.get(key).count += 1;
        continue;
      }
      seen.set(key, {
        key,
        name: e.firstName || "",
        email: e.email || "",
        phone: e.phone || "",
        last: e.timestamp,
        count: 1,
        branches: new Set(e.branch ? [e.branch] : []),
        contactable: String(e.promo || "").toLowerCase() === "yes" && !!e.email,
      });
    }
    onShowAudience({
      title: `${d.label} guests`,
      subtitle: `${d.visits} visits in the selected period`,
      guests: Array.from(seen.values()),
    });
  }

  function openMonth(row) {
    if (!onShowAudience || !row) return;
    onShowAudience({
      title: `${MONTH_NAMES[row.month - 1]} birthdays`,
      subtitle: `${row.count} guest${row.count === 1 ? "" : "s"} · ${row.contactable} can be emailed`,
      guests: row.guests,
    });
  }

  // The genuinely actionable slice: whose birthday is today, tomorrow, and
  // across the rest of this month. Dates use the business timezone so the
  // "today" card doesn't flip early or late for a viewer elsewhere.
  const upcoming = useMemo(() => {
    const now = zonedParts(new Date());
    const tmr = zonedParts(new Date(Date.now() + 86400000));
    const onDay = (month, day) => {
      const row = birthdays.rows[month - 1];
      return row ? row.guests.filter((g) => g.day === day) : [];
    };
    const monthRow = birthdays.rows[now.month - 1];

    return [
      { key: "today", label: "Today", guests: onDay(now.month, now.day) },
      { key: "tomorrow", label: "Tomorrow", guests: onDay(tmr.month, tmr.day) },
      {
        key: "month",
        label: MONTH_NAMES[now.month - 1],
        guests: monthRow ? monthRow.guests : [],
      },
    ].map((c) => ({
      ...c,
      contactable: c.guests.filter((g) => g.contactable).length,
    }));
  }, [birthdays]);

  return (
    <div className="space-y-6">
      {/* ── Dayparts ───────────────────────────────────────────── */}
      <Panel
        title="Trading periods — where to put your effort"
        note="Busy index: visits per trading hour, where 100 = an average hour. Return rate: how many first-time guests in that period came back at all. Click a row for the guest list."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm xl:text-base">
            <thead className="text-xs xl:text-sm uppercase tracking-wide text-white/50">
              <tr>
                <th className="py-2 pr-3">Period</th>
                <th className="py-2 pr-3">Visits</th>
                <th className="py-2 pr-3">Busy index</th>
                <th className="py-2 pr-3">Opted in</th>
                <th className="py-2 pr-3">Came back</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {dayparts
                .filter((d) => d.visits > 0)
                .map((d) => (
                  <tr
                    key={d.key}
                    onClick={onShowAudience ? () => openDaypart(d) : undefined}
                    className={onShowAudience ? "cursor-pointer hover:bg-white/5" : ""}
                    title={onShowAudience ? "Show guests who visited in this period" : undefined}
                  >
                    <td className="py-2.5 pr-3 font-medium text-white/90">{d.label}</td>
                    <td className="py-2.5 pr-3 text-white/70">
                      {d.visits}
                      <span className="ml-1 text-xs text-white/30">{d.share.toFixed(0)}%</span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={d.index >= 100 ? "text-white" : "text-white/50"}>{d.index}</span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <Figure value={d.optInRate} n={d.optInAnswered} suffix="%" />
                    </td>
                    <td className="py-2.5 pr-3">
                      <Figure value={d.returnRate} n={d.firstVisits} suffix="%" />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {stickiest && busiest && stickiest.key !== busiest.key && (
          <div className="mt-4">
            <Insight tone="good">
              <strong>{stickiest.label}</strong> guests return at{" "}
              {stickiest.returnRate.toFixed(0)}% — your stickiest period — while{" "}
              <strong>{busiest.label}</strong> is busiest (index {busiest.index}). Volume and
              loyalty are in different places: promoting into the busy period reaches the most
              people but converts the fewest.
            </Insight>
          </div>
        )}
        {!stickiest && (
          <p className="mt-3 text-xs xl:text-sm text-white/40">
            Return rates need at least {MIN_SAMPLE} first visits in a period before they mean
            anything. Keep collecting.
          </p>
        )}
      </Panel>

      {/* ── When people come ───────────────────────────────────── */}
      <Panel title="When guests connect" note="Day of week against hour of day, in store local time.">
        <HeatMap grid={heat.grid} max={heat.max} days={heat.days} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Return timing ────────────────────────────────────── */}
        <Panel
          title="How quickly guests come back"
          note={
            ttr.n
              ? `All-time, not limited by the date filter. Median gap ${ttr.median.toFixed(1)} days · ${ttr.withinWeekPct.toFixed(0)}% return within a week · ${ttr.n} return visits`
              : "No repeat visits recorded yet."
          }
        >
          <HBars data={ttr.buckets} />
          {ttr.n >= MIN_SAMPLE && (
            <div className="mt-4">
              <Insight>
                Send your follow-up offer around <strong>day {Math.max(2, Math.round(ttr.median) - 1)}</strong>.
                A message that lands after two weeks reaches people who have already decided.
              </Insight>
            </div>
          )}
        </Panel>

        {/* ── Frequency ────────────────────────────────────────── */}
        <Panel
          title="How often guests visit"
          note="Every guest on record (all-time), by number of visits. The gap between one and two visits is where growth lives."
        >
          <HBars
            data={freq}
            formatValue={(d) => `${d.count} (${d.pct.toFixed(0)}%)`}
            valueKey="count"
          />
          {freq[0] && freq[0].pct > 60 && (
            <div className="mt-4">
              <Insight tone="warn">
                {freq[0].pct.toFixed(0)}% of guests have visited only once. Converting even a
                tenth of them into a second visit would lift total visits by roughly{" "}
                {((freq[0].count * 0.1) / Math.max(1, freq.reduce((s, f) => s + f.count, 0)) * 100).toFixed(1)}%.
              </Insight>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Dwell ────────────────────────────────────────────── */}
        <Panel
          title="How long guests stay"
          note={
            dwell.n
              ? `Median ${minutesToLabel(dwell.median)} · 90% leave within ${minutesToLabel(dwell.p90)} · ${dwell.n} sessions measured`
              : "No session durations recorded yet."
          }
        >
          <HBars data={dwell.buckets} />
          {dwell.n >= MIN_SAMPLE && (
            <p className="mt-3 text-xs xl:text-sm text-white/40">
              {dwell.quickPct.toFixed(0)}% stay under 20 minutes (likely takeaway),{" "}
              {(100 - dwell.quickPct).toFixed(0)}% stay longer (likely eating in).
            </p>
          )}
        </Panel>

        {/* ── Birthdays ────────────────────────────────────────── */}
        <Panel
          title="Birthday campaign planner"
          note={`${birthdays.known} guests gave a birthday · ${birthdays.missing} didn't · click a month for the list`}
        >
          <HBars
            data={birthdays.rows.map((r) => ({
              label: r.label, count: r.count, contactable: r.contactable,
            }))}
            formatValue={(d) => `${d.count}`}
            onSelect={
              onShowAudience
                ? (label) => {
                    const row = birthdays.rows.find((r) => r.label === label);
                    if (row) openMonth(row);
                  }
                : undefined
            }
          />
          <div className="mt-4 grid grid-cols-3 gap-2">
            {upcoming.map((c) => {
              const hasAny = c.guests.length > 0;
              const urgent = hasAny && (c.key === "today" || c.key === "tomorrow");
              return (
                <button
                  key={c.key}
                  onClick={() =>
                    onShowAudience &&
                    onShowAudience({
                      title:
                        c.key === "month"
                          ? `${c.label} birthdays`
                          : `Birthdays ${c.label.toLowerCase()}`,
                      subtitle: `${c.guests.length} guest${
                        c.guests.length === 1 ? "" : "s"
                      } · ${c.contactable} can be emailed`,
                      guests: c.guests,
                    })
                  }
                  disabled={!hasAny}
                  className={`rounded-lg border p-3 text-center transition disabled:cursor-default ${
                    urgent
                      ? "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20"
                      : "border-white/10 bg-white/5 hover:bg-white/10 disabled:hover:bg-white/5"
                  }`}
                >
                  <p className={`text-xs xl:text-sm ${urgent ? "text-emerald-300/80" : "text-white/40"}`}>
                    {c.label}
                  </p>
                  <p className="text-lg xl:text-xl font-bold text-white">{c.guests.length}</p>
                  <p className="text-[10px] xl:text-xs text-white/40">
                    {c.contactable} contactable
                  </p>
                </button>
              );
            })}
          </div>
          {upcoming[0].guests.length > 0 && (
            <p className="mt-3 text-xs xl:text-sm text-emerald-300">
              {upcoming[0].guests.length} birthday
              {upcoming[0].guests.length === 1 ? "" : "s"} today — worth a message this morning.
            </p>
          )}
        </Panel>
      </div>

      {/* ── Site comparison ────────────────────────────────────── */}
      <Panel title="Store comparison" note="Same period, side by side.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm xl:text-base">
            <thead className="text-xs xl:text-sm uppercase tracking-wide text-white/50">
              <tr>
                <th className="py-2 pr-3">Store</th>
                <th className="py-2 pr-3">Visits</th>
                <th className="py-2 pr-3">Guests</th>
                <th className="py-2 pr-3">Per day</th>
                <th className="py-2 pr-3">Opt-in</th>
                <th className="py-2 pr-3">Median stay</th>
                <th className="py-2 pr-3">Repeat share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {sites.map((s) => (
                <tr key={s.site}>
                  <td className="py-2.5 pr-3 font-medium text-white/90">{s.site}</td>
                  <td className="py-2.5 pr-3 text-white/70">{s.visits}</td>
                  <td className="py-2.5 pr-3 text-white/70">{s.guests}</td>
                  <td className="py-2.5 pr-3 text-white/70">{s.perDay.toFixed(1)}</td>
                  <td className="py-2.5 pr-3"><Figure value={s.optInRate} n={s.visits} suffix="%" /></td>
                  <td className="py-2.5 pr-3 text-white/70">
                    {s.medianDwell ? minutesToLabel(s.medianDwell) : "—"}
                  </td>
                  <td className="py-2.5 pr-3"><Figure value={s.returnShare} n={s.visits} suffix="%" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── Data quality ───────────────────────────────────────── */}
      <Panel
        title="Data quality"
        note="For the selected period only — so a problem you've already fixed stops being reported. Worth a glance weekly."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="WiFi names in use"
            value={dq.ssidVariants || "—"}
            sub={
              dq.ssidVariants > 1
                ? "Renaming resets guest recognition"
                : dq.ssidVariants === 1
                ? "Consistent across all stores"
                : "Not reported by these consoles"
            }
            tone={dq.ssidVariants > 1 ? "warn" : "good"}
          />
          <StatCard
            label="Missing store"
            value={`${dq.missingBranchPct.toFixed(1)}%`}
            sub={`${dq.missingBranch} records unattributed`}
            tone={dq.missingBranchPct > 5 ? "warn" : "good"}
          />
          <StatCard
            label="Duplicate submits"
            value={dq.doubleSubmits}
            sub={`${dq.doubleSubmitPct.toFixed(1)}% of records`}
            tone={dq.doubleSubmitPct > 3 ? "warn" : "good"}
          />
          <StatCard
            label="No session length"
            value={`${dq.noDurationPct.toFixed(0)}%`}
            sub="Still connected, or left before tracking"
          />
        </div>

        {dq.ssidVariants > 1 && (
          <div className="mt-4">
            <Insight tone="warn">
              Guests have connected to <strong>{dq.ssidVariants} differently-named networks</strong>
              {": "}
              {dq.ssidList.slice(0, 4).map((s) => `${s.name} (${s.n})`).join(", ")}. Because{" "}
              {dq.randomisedMacPct.toFixed(0)}% of phones randomise their address per network name,
              every rename makes returning guests look like new ones. Settle on one name across all
              stores.
            </Insight>
          </div>
        )}
      </Panel>

      <p className="pb-2 text-center text-xs xl:text-sm text-white/30">
        Figures marked <span className="text-amber-300/70">low n</span> are based on too few
        visits to act on. Guest counts are WiFi users only — a subset of footfall, so read rates
        rather than totals.
      </p>
    </div>
  );
}
