"use client";

/* Shared presentation pieces for the admin dashboard.
   Plain SVG/CSS — no chart library, so nothing extra to install or maintain. */

export const PANEL = "rounded-xl border border-white/10 bg-white/5 p-4";

/** Section wrapper with a title and optional explanatory note. */
export function Panel({ title, note, right, children, className = "" }) {
  return (
    <div className={`${PANEL} ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm xl:text-base font-semibold text-white/90">{title}</h2>}
            {note && <p className="mt-0.5 text-xs xl:text-sm text-white/40">{note}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub, tone }) {
  const tones = {
    good: "text-emerald-300",
    warn: "text-amber-300",
    bad: "text-red-300",
  };
  return (
    <div className={PANEL}>
      <p className="text-xs xl:text-sm uppercase tracking-wide text-white/50">{label}</p>
      <p className={`mt-1 text-2xl xl:text-3xl 2xl:text-4xl font-bold ${tones[tone] || "text-white"}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs xl:text-sm text-white/40">{sub}</p>}
    </div>
  );
}

/**
 * Marks a figure as too small to trust. Showing "30.8%" from six people is
 * worse than showing nothing — it invites decisions the data can't support.
 */
export function Figure({ value, n, min = 30, suffix = "" }) {
  if (value == null) return <span className="text-white/30">—</span>;
  const weak = n != null && n < min;
  return (
    <span
      className={weak ? "text-white/40" : "text-white"}
      title={n != null ? `Based on ${n} ${n === 1 ? "visit" : "visits"}${weak ? " — too few to rely on" : ""}` : undefined}
    >
      {typeof value === "number" ? value.toFixed(value < 10 ? 1 : 0) : value}
      {suffix}
      {weak && <span className="ml-1 text-[10px] xl:text-xs text-amber-300/70">low n</span>}
    </span>
  );
}

/** Vertical bars. Optionally stacked (two series). */
export function BarChart({ data, labelKey, valueKey, stackKey, height = 160, formatLabel, colors = ["#ffffffcc", "#ffffff55"] }) {
  if (!data.length) {
    return <p className="py-8 text-center text-sm xl:text-base text-white/40">No data for this range.</p>;
  }
  const max = Math.max(...data.map((d) => (d[valueKey] || 0) + (stackKey ? d[stackKey] || 0 : 0)), 1);
  const bw = 100 / data.length;
  const fmt = (v) => (formatLabel ? formatLabel(v) : v);

  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-40 w-full xl:h-48">
        {data.map((d, i) => {
          const v1 = d[valueKey] || 0;
          const v2 = stackKey ? d[stackKey] || 0 : 0;
          const h1 = (v1 / max) * (height - 16);
          const h2 = (v2 / max) * (height - 16);
          return (
            <g key={i}>
              <rect x={i * bw + bw * 0.15} y={height - h1} width={bw * 0.7} height={h1}
                    rx={Math.min(bw * 0.15, 1.2)} fill={colors[0]}>
                <title>{`${fmt(d[labelKey])}: ${v1}${stackKey ? ` new, ${v2} returning` : ""}`}</title>
              </rect>
              {stackKey && (
                <rect x={i * bw + bw * 0.15} y={height - h1 - h2} width={bw * 0.7} height={h2}
                      rx={Math.min(bw * 0.15, 1.2)} fill={colors[1]}>
                  <title>{`${fmt(d[labelKey])}: ${v2} returning`}</title>
                </rect>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] xl:text-xs text-white/40">
        <span>{fmt(data[0][labelKey])}</span>
        {data.length > 1 && <span>{fmt(data[data.length - 1][labelKey])}</span>}
      </div>
    </div>
  );
}

/** Horizontal labelled bars — best for named categories. */
export function HBars({ data, labelKey = "label", valueKey = "count", suffix = "", onSelect, formatValue }) {
  if (!data.length) return <p className="py-6 text-center text-sm xl:text-base text-white/40">No data.</p>;
  const max = Math.max(...data.map((d) => d[valueKey] || 0), 1);
  return (
    <div className="space-y-2">
      {data.map((d) => {
        const Row = onSelect ? "button" : "div";
        return (
          <Row
            key={d[labelKey]}
            onClick={onSelect ? () => onSelect(d[labelKey]) : undefined}
            className={`block w-full text-left ${onSelect ? "cursor-pointer" : ""}`}
          >
            <div className="flex justify-between text-xs xl:text-sm text-white/70">
              <span className="truncate">{d[labelKey]}</span>
              <span className="ml-2 shrink-0 font-semibold text-white">
                {formatValue ? formatValue(d) : `${d[valueKey]}${suffix}`}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-white/10">
              <div className="h-2 rounded-full bg-white/70" style={{ width: `${(d[valueKey] / max) * 100}%` }} />
            </div>
          </Row>
        );
      })}
    </div>
  );
}

/** Day × hour heatmap — shows exactly when the shop is busy. */
export function HeatMap({ grid, max, days }) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  if (!max) return <p className="py-6 text-center text-sm xl:text-base text-white/40">No data for this range.</p>;
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="flex">
          <div className="w-9 shrink-0" />
          {hours.map((h) => (
            <div key={h} className="flex-1 text-center text-[9px] xl:text-[10px] text-white/30">
              {h % 3 === 0 ? h : ""}
            </div>
          ))}
        </div>
        {grid.map((row, r) => (
          <div key={r} className="flex items-center">
            <div className="w-9 shrink-0 text-[10px] xl:text-xs text-white/40">{days[r]}</div>
            {row.map((v, c) => (
              <div key={c} className="flex-1 px-[1px] py-[1px]">
                <div
                  className="h-4 rounded-[2px] xl:h-5"
                  style={{ backgroundColor: v ? `rgba(255,255,255,${0.12 + (v / max) * 0.78})` : "rgba(255,255,255,0.04)" }}
                  title={`${days[r]} ${String(c).padStart(2, "0")}:00 — ${v} visit${v === 1 ? "" : "s"}`}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A single takeaway sentence, styled so it reads as guidance not decoration. */
export function Insight({ tone = "info", children }) {
  const tones = {
    info: "border-white/15 bg-white/5 text-white/80",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  };
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm xl:text-base ${tones[tone]}`}>{children}</div>
  );
}
