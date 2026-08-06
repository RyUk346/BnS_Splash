"use client";

import { useEffect, useMemo, useState } from "react";
import {
  dedupeByDeviceDay,
  filterRows,
  formatDateTime,
  minutesToLabel,
  summarize,
  thisMonthRange,
  toCsv,
  toDateKey,
  visitsByBranch,
  visitsByDay,
  visitsByHour,
} from "@/lib/analytics";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

/* ───────────────────────── Small UI pieces ───────────────────────── */

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-wide text-white/50">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-white/40">{sub}</p>}
    </div>
  );
}

/** Simple responsive SVG bar chart (no chart library needed). */
function BarChart({ data, labelKey, valueKey, height = 160, formatLabel }) {
  if (!data.length) {
    return <p className="py-8 text-center text-sm text-white/40">No data for this range.</p>;
  }
  const max = Math.max(...data.map((d) => d[valueKey]), 1);
  const barW = 100 / data.length;

  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-40 w-full">
        {data.map((d, i) => {
          const h = (d[valueKey] / max) * (height - 20);
          return (
            <rect
              key={i}
              x={i * barW + barW * 0.15}
              y={height - h}
              width={barW * 0.7}
              height={h}
              rx={barW * 0.15}
              className="fill-white/80"
            >
              <title>{`${formatLabel ? formatLabel(d[labelKey]) : d[labelKey]}: ${d[valueKey]}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-white/40">
        <span>{formatLabel ? formatLabel(data[0][labelKey]) : data[0][labelKey]}</span>
        {data.length > 1 && (
          <span>
            {formatLabel
              ? formatLabel(data[data.length - 1][labelKey])
              : data[data.length - 1][labelKey]}
          </span>
        )}
      </div>
    </div>
  );
}

/** Horizontal bars — better for named categories like stores. */
function BranchBars({ data, onSelect }) {
  if (!data.length) {
    return <p className="py-8 text-center text-sm text-white/40">No data.</p>;
  }
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <button
          key={d.branch}
          onClick={() => onSelect && onSelect(d.branch)}
          className="block w-full text-left"
        >
          <div className="flex justify-between text-xs text-white/70">
            <span className="truncate">{d.branch}</span>
            <span className="ml-2 shrink-0 font-semibold text-white">{d.count}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-white/10">
            <div
              className="h-2 rounded-full bg-white/70"
              style={{ width: `${(d.count / max) * 100}%` }}
            />
          </div>
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────────── Login ─────────────────────────────── */

function LoginScreen({ onSuccess }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${BASE}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Login failed");
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6"
      >
        <h1 className="bns-heading text-2xl text-white">HyperGlow Admin</h1>
        <p className="mb-5 mt-1 text-sm text-white/50">Guest WiFi dashboard</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full rounded-lg border border-white/15 bg-white/10 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-white/50"
        />
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="bns-heading mt-4 w-full rounded-lg bg-white px-4 py-3 text-neutral-900 transition disabled:opacity-40"
        >
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

/* ─────────────────────────── Dashboard ───────────────────────────── */

export default function AdminDashboard() {
  const [authed, setAuthed] = useState(false);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  // Navigation: "overview" | "customers" | a store name
  const [view, setView] = useState("overview");
  const [storesOpen, setStoresOpen] = useState(true);
  const [navOpen, setNavOpen] = useState(false); // mobile drawer

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [onlyOptedIn, setOnlyOptedIn] = useState(false);

  async function load(force = false) {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`${BASE}/api/admin/data${force ? "?refresh=1" : ""}`);
      if (res.status === 401) {
        setAuthed(false);
        setRows(null);
        return;
      }
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Could not load data");
      setRows(data.rows);
      setAuthed(true);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    await fetch(`${BASE}/api/admin/login`, { method: "DELETE" });
    setAuthed(false);
    setRows(null);
  }

  /* Derived data ---------------------------------------------------- */

  const deduped = useMemo(() => dedupeByDeviceDay(rows || []), [rows]);

  const branches = useMemo(() => {
    const set = new Set(deduped.map((e) => e.branch || "Unknown"));
    return Array.from(set).sort();
  }, [deduped]);

  const isStoreView = view !== "overview" && view !== "customers";
  const activeBranch = isStoreView ? view : "all";

  const filtered = useMemo(() => {
    let out = filterRows(deduped, { branch: activeBranch, from, to });
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((e) =>
        [e.email, e.firstName, e.phone, e.mac].some((v) =>
          String(v || "").toLowerCase().includes(q)
        )
      );
    }
    if (onlyOptedIn) {
      out = out.filter((e) => (e.promo || "").toLowerCase() === "yes");
    }
    return out;
  }, [deduped, activeBranch, from, to, search, onlyOptedIn]);

  const stats = useMemo(() => summarize(filtered), [filtered]);
  const daily = useMemo(() => visitsByDay(filtered), [filtered]);
  const byBranch = useMemo(() => visitsByBranch(filtered), [filtered]);
  const hourly = useMemo(() => visitsByHour(filtered), [filtered]);

  // Per-store visit counts for the sidebar badges (date filter applied,
  // but not the store filter — so you can compare stores at a glance).
  const branchCounts = useMemo(() => {
    const scoped = filterRows(deduped, { branch: "all", from, to });
    const map = new Map();
    for (const e of scoped) {
      const b = e.branch || "Unknown";
      map.set(b, (map.get(b) || 0) + 1);
    }
    return map;
  }, [deduped, from, to]);

  /* Actions --------------------------------------------------------- */

  function setThisMonth() {
    const r = thisMonthRange();
    setFrom(r.from);
    setTo(r.to);
  }

  function setLastDays(n) {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - (n - 1));
    setFrom(toDateKey(start));
    setTo(toDateKey(now));
  }

  function downloadCsv() {
    const csv = toCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const label = isStoreView ? view.replace(/\s+/g, "-").toLowerCase() : "all-stores";
    const range = from || to ? `_${from || "start"}_to_${to || "end"}` : "";
    a.href = url;
    a.download = `wifi-signups_${label}${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function go(target) {
    setView(target);
    setNavOpen(false);
  }

  if (!authed) return <LoginScreen onSuccess={() => load(true)} />;

  const btn =
    "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10";

  const navItem = (active) =>
    `flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
      active ? "bg-white/15 font-semibold text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
    }`;

  const title = isStoreView ? view : view === "customers" ? "Customers" : "Overview";

  /* Sidebar --------------------------------------------------------- */

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-4">
      <div className="mb-4 px-1">
        <p className="bns-heading text-lg leading-tight text-white">HyperGlow</p>
        <p className="text-xs text-white/40">Guest WiFi Admin</p>
      </div>

      <button onClick={() => go("overview")} className={navItem(view === "overview")}>
        <span>Overview</span>
      </button>

      {/* Stores — expandable submenu */}
      <button
        onClick={() => setStoresOpen((o) => !o)}
        className={navItem(false) + " mt-1"}
        aria-expanded={storesOpen}
      >
        <span>Stores</span>
        <span className="text-xs text-white/40">{storesOpen ? "▾" : "▸"}</span>
      </button>
      {storesOpen && (
        <div className="ml-2 mt-0.5 space-y-0.5 border-l border-white/10 pl-2">
          {branches.length === 0 && (
            <p className="px-3 py-2 text-xs text-white/30">No stores yet</p>
          )}
          {branches.map((b) => (
            <button key={b} onClick={() => go(b)} className={navItem(view === b)}>
              <span className="truncate">{b}</span>
              <span className="ml-2 shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
                {branchCounts.get(b) || 0}
              </span>
            </button>
          ))}
        </div>
      )}

      <button onClick={() => go("customers")} className={navItem(view === "customers") + " mt-1"}>
        <span>Customers</span>
      </button>

      <div className="mt-auto space-y-2 pt-4">
        <button onClick={() => load(true)} className={btn + " w-full"} disabled={loading}>
          ↻ Refresh data
        </button>
        <button onClick={logout} className={btn + " w-full"}>
          Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 lg:hidden">
        <button onClick={() => setNavOpen(true)} className={btn} aria-label="Open navigation">
          ☰ Menu
        </button>
        <span className="bns-heading text-sm">{title}</span>
        <button onClick={downloadCsv} className={btn} disabled={!filtered.length}>
          ↓ CSV
        </button>
      </div>

      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-white/10 bg-white/[0.03] lg:block">
          {sidebar}
        </aside>

        {/* Mobile drawer */}
        {navOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setNavOpen(false)}
              aria-hidden
            />
            <aside className="absolute left-0 top-0 h-full w-64 border-r border-white/10 bg-neutral-900">
              {sidebar}
            </aside>
          </div>
        )}

        {/* Main content */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">
          <div className="mx-auto max-w-6xl">
            {/* Header */}
            <div className="mb-6 hidden items-center justify-between gap-3 lg:flex">
              <div>
                <h1 className="bns-heading text-2xl">{title}</h1>
                <p className="text-sm text-white/50">
                  {loading ? "Loading…" : `${filtered.length} device-days shown`}
                </p>
              </div>
              <button onClick={downloadCsv} className={btn} disabled={!filtered.length}>
                ↓ Download CSV
              </button>
            </div>

            {loadError && (
              <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {loadError}
              </div>
            )}

            {/* Filters */}
            <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-white/50">From</label>
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-neutral-900 px-3 py-2 text-sm text-white outline-none focus:border-white/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/50">To</label>
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-neutral-900 px-3 py-2 text-sm text-white outline-none focus:border-white/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/50">Search</label>
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Email, name, phone, MAC"
                    className="w-full rounded-lg border border-white/15 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/50"
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={setThisMonth} className={btn}>
                  This month
                </button>
                <button onClick={() => setLastDays(7)} className={btn}>
                  Last 7 days
                </button>
                <button onClick={() => setLastDays(30)} className={btn}>
                  Last 30 days
                </button>
                <button onClick={() => setLastDays(1)} className={btn}>
                  Today
                </button>
                <button
                  onClick={() => {
                    setFrom("");
                    setTo("");
                  }}
                  className={btn}
                >
                  All time
                </button>
                {view === "customers" && (
                  <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-white/70">
                    <input
                      type="checkbox"
                      checked={onlyOptedIn}
                      onChange={(e) => setOnlyOptedIn(e.target.checked)}
                      className="h-4 w-4 accent-white"
                    />
                    Marketing opt-ins only
                  </label>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Visits" value={stats.visits} sub="unique device-days" />
              <StatCard label="Customers" value={stats.uniqueEmails} sub="distinct emails" />
              <StatCard
                label="Avg. session"
                value={minutesToLabel(stats.avgMinutes)}
                sub="where duration known"
              />
              <StatCard
                label="Opt-in rate"
                value={`${stats.optInRate.toFixed(0)}%`}
                sub={`${stats.optedIn} of ${stats.visits}`}
              />
            </div>

            {/* Charts — hidden on the Customers view, which is list-focused */}
            {view !== "customers" && (
              <>
                <div className="mb-6 grid gap-4 lg:grid-cols-3">
                  <div
                    className={`rounded-xl border border-white/10 bg-white/5 p-4 ${
                      isStoreView ? "lg:col-span-3" : "lg:col-span-2"
                    }`}
                  >
                    <h2 className="mb-3 text-sm font-semibold text-white/80">Visits per day</h2>
                    <BarChart
                      data={daily}
                      labelKey="date"
                      valueKey="count"
                      formatLabel={(d) =>
                        new Date(d).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                        })
                      }
                    />
                  </div>
                  {!isStoreView && (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <h2 className="mb-3 text-sm font-semibold text-white/80">
                        By store{" "}
                        <span className="font-normal text-white/40">(click to open)</span>
                      </h2>
                      <BranchBars data={byBranch} onSelect={(b) => go(b)} />
                    </div>
                  )}
                </div>

                <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-4">
                  <h2 className="mb-3 text-sm font-semibold text-white/80">
                    Busiest times <span className="font-normal text-white/40">(hour of day)</span>
                  </h2>
                  <BarChart
                    data={hourly}
                    labelKey="hour"
                    valueKey="count"
                    formatLabel={(h) => `${h}:00`}
                  />
                </div>
              </>
            )}

            {/* Table */}
            <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/50">
                    <tr>
                      <th className="px-3 py-3">Connected</th>
                      <th className="px-3 py-3">Disconnected</th>
                      <th className="px-3 py-3">Duration</th>
                      <th className="px-3 py-3">Name</th>
                      <th className="px-3 py-3">Email</th>
                      <th className="px-3 py-3">Phone</th>
                      {!isStoreView && <th className="px-3 py-3">Store</th>}
                      <th className="px-3 py-3">Offers</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filtered.slice(0, 300).map((e, i) => (
                      <tr key={`${e.dateKey}-${e.mac}-${i}`} className="hover:bg-white/5">
                        <td className="whitespace-nowrap px-3 py-2.5 text-white/80">
                          {formatDateTime(e.timestamp)}
                          {e.sessions > 1 && (
                            <span className="ml-1 text-xs text-white/40">×{e.sessions}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-white/60">
                          {e.lastDisconnected ? formatDateTime(e.lastDisconnected) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-white/80">
                          {e.totalMinutes ? minutesToLabel(e.totalMinutes) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-white/80">{e.firstName || "—"}</td>
                        <td className="px-3 py-2.5 text-white/60">{e.email || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-white/60">
                          {e.phone || "—"}
                        </td>
                        {!isStoreView && (
                          <td className="whitespace-nowrap px-3 py-2.5 text-white/60">
                            {e.branch || "Unknown"}
                          </td>
                        )}
                        <td className="px-3 py-2.5">
                          <span
                            className={`rounded px-2 py-0.5 text-xs font-semibold ${
                              (e.promo || "").toLowerCase() === "yes"
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-white/10 text-white/50"
                            }`}
                          >
                            {e.promo || "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!filtered.length && !loading && (
                      <tr>
                        <td colSpan={8} className="px-3 py-10 text-center text-white/40">
                          No entries for these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {filtered.length > 300 && (
                <p className="border-t border-white/10 px-3 py-2 text-xs text-white/40">
                  Showing first 300 of {filtered.length}. Download the CSV for the full list.
                </p>
              )}
            </div>

            <p className="mt-6 text-center text-xs text-white/30">
              One row per device per day — repeat connections that day are merged.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
