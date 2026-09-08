"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import StoreManager from "@/components/StoreManager";
import ThemeToggle from "@/components/ThemeToggle";
import InsightsView from "@/components/InsightsView";
import CustomersView from "@/components/CustomersView";
import AudienceDrawer from "@/components/AudienceDrawer";
import { Panel, StatCard, BarChart, HBars, Insight } from "@/components/ui/Charts";
import {
  // aliased: `audience` is also the name of the drawer's state below
  audience as audienceStats,
  buildGuestIndex,
  customerRoster,
  customersToCsv,
  daysUntilBirthday,
  dedupeByDeviceDay,
  filterRows,
  formatDateTime,
  guestKey,
  lastDaysRange,
  lifecycleSegments,
  loyaltyTier,
  minutesToLabel,
  newVsReturningByDay,
  retentionSummary,
  summarize,
  thisMonthRange,
  toCsv,
  toDateKey,
  visitsByBranch,
} from "@/lib/analytics";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14/03/1990" → "14 Mar". Older records have no year, hence the optional group. */
function birthdayLabel(value) {
  const m = String(value || "").match(/^(\d{2})\/(\d{2})/);
  if (!m) return "";
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (!day || month < 1 || month > 12) return "";
  return `${day} ${MONTH_ABBR[month - 1]}`;
}

/** Colour for a loyalty tier badge — VIPs should catch the eye. */
const TIER_STYLE = {
  vip: "bg-amber-400/20 text-warn",
  good: "bg-emerald-500/20 text-good",
  ok: "bg-sky-500/20 text-info",
  new: "bg-ink/10 text-ink/50",
};

/* Shared UI pieces (StatCard, BarChart, HBars, Panel, Insight) come from
   components/ui/Charts so the Insights view renders identically. */

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
    <div className="admin-root flex min-h-screen items-center justify-center bg-surface px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-ink/10 bg-ink/5 p-6"
      >
        <img
          src={`${BASE}/bns-logo.svg`}
          alt="Burger & Sauce"
          width={567}
          height={97}
          className="logo-white-asset mb-5 h-auto w-full max-w-[220px]"
        />
        <p className="mb-5 text-sm xl:text-base text-ink/50">Guest WiFi dashboard</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full rounded-lg border border-ink/15 bg-ink/10 px-4 py-3 text-ink placeholder-ink/30 outline-none focus:border-ink/50"
        />
        {error && <p className="mt-2 text-xs xl:text-sm text-bad">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="bns-heading mt-4 w-full rounded-lg bg-ink px-4 py-3 text-surface transition disabled:opacity-40"
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
  const [dataSource, setDataSource] = useState({ source: "raw", cleanedAt: "" });
  // Guest list slide-over: { title, subtitle, guests } or null
  const [audience, setAudience] = useState(null);

  // Navigation: "overview" | "customers" | a store name
  const [view, setView] = useState("overview");
  const [storesOpen, setStoresOpen] = useState(true);
  const [navOpen, setNavOpen] = useState(false); // mobile drawer

  // Default to the last 7 days — the window an owner actually acts on.
  const [from, setFrom] = useState(() => lastDaysRange(7).from);
  const [to, setTo] = useState(() => lastDaysRange(7).to);
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
      setDataSource({ source: data.source || "raw", cleanedAt: data.cleanedAt || "" });
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

  const FIXED_VIEWS = ["overview", "insights", "customers", "manage-stores"];
  const isStoreView = !FIXED_VIEWS.includes(view);
  const activeBranch = isStoreView ? view : "all";

  // Store + date only. "Who visited in this period" must not also depend on
  // the search box or the opt-in checkbox, or the Customers scope toggle
  // would quietly mean something different from what it says.
  const scoped = useMemo(
    () => filterRows(deduped, { branch: activeBranch, from, to }),
    [deduped, activeBranch, from, to]
  );

  const filtered = useMemo(() => {
    let out = scoped;
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
  }, [scoped, search, onlyOptedIn]);

  const stats = useMemo(() => summarize(filtered), [filtered]);
  const byBranch = useMemo(() => visitsByBranch(filtered), [filtered]);

  // Guest history is built from the FULL dataset, never the filtered view —
  // otherwise a guest whose first visit predates the window looks "new".
  const guestIndex = useMemo(() => buildGuestIndex(deduped), [deduped]);
  const retention = useMemo(() => retentionSummary(filtered, guestIndex), [filtered, guestIndex]);
  const dailySplit = useMemo(
    () => newVsReturningByDay(filtered, guestIndex),
    [filtered, guestIndex]
  );
  const segments = useMemo(() => lifecycleSegments(guestIndex), [guestIndex]);
  const reach = useMemo(() => audienceStats(guestIndex), [guestIndex]);

  /* Sales context per row -------------------------------------------
     The table is a list of visits, but the useful question is about the
     *person*: is this a regular worth looking after, a first-timer worth
     converting, or someone with a birthday coming up? Loyalty is counted
     against full history so a regular still reads as a regular inside a
     seven-day window. */
  const enriched = useMemo(() => {
    const now = new Date();
    return filtered.map((e) => {
      const g = guestIndex.get(guestKey(e));
      const visits = g ? g.count : 1;
      const at = new Date(e.timestamp).getTime();
      // Which visit in their history this row represents.
      const nth = g ? g.visits.filter((v) => new Date(v).getTime() <= at).length : 1;
      return {
        ...e,
        visits,
        nth,
        tier: loyaltyTier(visits),
        birthdayIn: daysUntilBirthday(e.birthday, now),
        firstSeen: g ? g.first : e.timestamp,
      };
    });
  }, [filtered, guestIndex]);

  // Targeting filter: turns the list into "who should we contact, and why".
  const [focus, setFocus] = useState("all");

  const focusCounts = useMemo(
    () => ({
      birthday: enriched.filter((r) => r.birthdayIn !== null && r.birthdayIn <= 30).length,
      loyal: enriched.filter((r) => r.visits >= 3).length,
      first: enriched.filter((r) => r.visits === 1).length,
    }),
    [enriched]
  );

  const tableRows = useMemo(() => {
    if (focus === "birthday") {
      return enriched
        .filter((r) => r.birthdayIn !== null && r.birthdayIn <= 30)
        .sort((a, b) => a.birthdayIn - b.birthdayIn);
    }
    if (focus === "loyal") {
      return enriched.filter((r) => r.visits >= 3).sort((a, b) => b.visits - a.visits);
    }
    if (focus === "first") return enriched.filter((r) => r.visits === 1);
    return enriched;
  }, [enriched, focus]);

  /* Customer roster — one record per person, lifetime figures.
     Built from the whole dataset so a regular still shows every visit; the
     Customers view scopes it to the date window using periodKeys. */
  const roster = useMemo(() => {
    const full = customerRoster(deduped);
    if (!isStoreView) return full;
    // Inside a store view, only people who have actually been to that store.
    return full.filter((c) => c.storeList.includes(view));
  }, [deduped, isStoreView, view]);

  const periodKeys = useMemo(
    () => new Set(scoped.map((e) => guestKey(e))),
    [scoped]
  );

  const periodLabel = useMemo(() => {
    if (!from && !to) return "at any time";
    if (from && to && from === to) return "on this day";
    return "in this period";
  }, [from, to]);

  // Raw (pre-dedupe) rows for the same period — data-quality checks need the
  // duplicates the dedupe removes, but must still respect the date filter,
  // otherwise old problems keep being reported as if they were current.
  const filteredRaw = useMemo(
    () => filterRows(rows || [], { branch: activeBranch, from, to }),
    [rows, activeBranch, from, to]
  );

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
    // Export what's on screen, targeting filter included — so "birthday soon"
    // can be downloaded and pasted straight into an email platform.
    const csv = toCsv(tableRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const label = isStoreView ? view.replace(/\s+/g, "-").toLowerCase() : "all-stores";
    const range = from || to ? `_${from || "start"}_to_${to || "end"}` : "";
    const tag = focus === "all" ? "" : `_${focus}`;
    a.href = url;
    a.download = `wifi-signups_${label}${range}${tag}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Customer-shaped CSV — one row per person, not per visit. */
  function downloadCustomersCsv(customers) {
    const csv = customersToCsv(customers);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const label = isStoreView ? view.replace(/\s+/g, "-").toLowerCase() : "all-stores";
    a.href = url;
    a.download = `wifi-customers_${label}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function go(target) {
    setView(target);
    setNavOpen(false);
    // Insights hides the chips, so a filter left on there would silently
    // narrow the CSV with nothing on screen to explain it.
    if (target === "insights") setFocus("all");
  }

  if (!authed) return <LoginScreen onSuccess={() => load(true)} />;

  const btn =
    "rounded-lg border border-ink/15 bg-ink/5 px-3 py-2 text-xs xl:text-sm font-semibold text-ink/80 transition hover:bg-ink/10";

  const navItem = (active) =>
    `flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm xl:text-base transition ${
      active ? "bg-ink/15 font-semibold text-ink" : "text-ink/60 hover:bg-ink/5 hover:text-ink"
    }`;

  const TITLES = {
    overview: "Overview",
    insights: "Insights",
    customers: "Customers",
    "manage-stores": "Manage stores",
  };
  const title = isStoreView ? view : TITLES[view];

  /* Sidebar --------------------------------------------------------- */

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-4">
      <div className="mb-5 px-1">
        {/* Plain <img>, not next/image: the logo is an SVG, so there is
            nothing for the image optimiser to do, and Next would need
            dangerouslyAllowSVG to serve it through /_next/image. */}
        <img
          src={`${BASE}/bns-logo.svg`}
          alt="Burger & Sauce"
          width={567}
          height={97}
          className="logo-white-asset h-auto w-full max-w-[190px]"
        />
        <p className="mt-2 text-xs xl:text-sm text-ink/40">Guest WiFi Admin</p>
      </div>

      <button onClick={() => go("overview")} className={navItem(view === "overview")}>
        <span>Overview</span>
      </button>

      <button onClick={() => go("insights")} className={navItem(view === "insights")}>
        <span>Insights</span>
      </button>

      {/* Stores — expandable submenu */}
      <button
        onClick={() => setStoresOpen((o) => !o)}
        className={navItem(false) + " mt-1"}
        aria-expanded={storesOpen}
      >
        <span>Stores</span>
        <span className="text-xs xl:text-sm text-ink/40">{storesOpen ? "▾" : "▸"}</span>
      </button>
      {storesOpen && (
        <div className="ml-2 mt-0.5 space-y-0.5 border-l border-ink/10 pl-2">
          {branches.length === 0 && (
            <p className="px-3 py-2 text-xs xl:text-sm text-ink/30">No stores yet</p>
          )}
          {branches.map((b) => (
            <button key={b} onClick={() => go(b)} className={navItem(view === b)}>
              <span className="truncate">{b}</span>
              <span className="ml-2 shrink-0 rounded bg-ink/10 px-1.5 py-0.5 text-[10px] xl:text-xs text-ink/60">
                {branchCounts.get(b) || 0}
              </span>
            </button>
          ))}
          <button
            onClick={() => go("manage-stores")}
            className={navItem(view === "manage-stores")}
          >
            <span className="text-ink/70">+ Manage stores</span>
          </button>
        </div>
      )}

      <button onClick={() => go("customers")} className={navItem(view === "customers") + " mt-1"}>
        <span>Customers</span>
      </button>

      <div className="mt-auto space-y-2 pt-4">
        <ThemeToggle className="w-full" />
        <button onClick={() => load(true)} className={btn + " w-full"} disabled={loading}>
          ↻ Refresh data
        </button>
        <button onClick={logout} className={btn + " w-full"}>
          Sign out
        </button>

        <div className="flex flex-col items-center gap-1.5 border-t border-ink/10 pt-4">
          <span className="text-[10px] xl:text-xs uppercase tracking-wider text-ink/30">
            Powered by
          </span>
          <a
            href="https://hyperglow.co.uk"
            target="_blank"
            rel="noopener noreferrer"
            className="opacity-70 transition hover:opacity-100"
          >
            {/* BASE prefix to match how SplashForm loads its logo — the app
                is served under /SplashPage/BnS, not the domain root. */}
            <Image
              src={`${BASE}/hyperglow-logo.png.webp`}
              alt="HyperGlow"
              width={300}
              height={74}
              className="logo-dark-asset h-auto w-full max-w-[120px]"
            />
          </a>
        </div>
      </div>
    </nav>
  );

  return (
    // admin-root lets globals.css theme the <body> too, so overscroll doesn't
    // reveal the splash page's black background in light mode.
    <div className="admin-root min-h-screen bg-surface text-ink">
      <AudienceDrawer
        open={!!audience}
        onClose={() => setAudience(null)}
        title={audience?.title || ""}
        subtitle={audience?.subtitle || ""}
        guests={audience?.guests || []}
      />

      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3 lg:hidden">
        <button onClick={() => setNavOpen(true)} className={btn} aria-label="Open navigation">
          ☰ Menu
        </button>
        <span className="bns-heading text-sm xl:text-base">{title}</span>
        {/* Customers exports from inside its own view, and manage-stores has
            no list at all — a CSV button on either would export the hidden
            visit log, still narrowed by whatever chip was last selected. */}
        {view === "customers" || view === "manage-stores" ? (
          <span className="w-16" />
        ) : (
          <button onClick={downloadCsv} className={btn} disabled={!tableRows.length}>
            ↓ CSV
          </button>
        )}
      </div>

      <div className="flex">
        {/* Desktop sidebar */}
        {/* Sidebar: ~1/6 of the viewport, clamped so it stays usable on very
            narrow laptops and doesn't sprawl on ultra-wide displays. */}
        <aside className="sticky top-0 hidden h-screen w-1/6 min-w-[200px] max-w-[300px] shrink-0 border-r border-ink/10 bg-ink/[0.03] lg:block">
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
            <aside className="absolute left-0 top-0 h-full w-64 border-r border-ink/10 bg-panel">
              {sidebar}
            </aside>
          </div>
        )}

        {/* Main content */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 xl:px-8">
          {view === "manage-stores" ? (
            <div className="w-full">
              <StoreManager />
            </div>
          ) : (
          <div className="w-full">
            {/* Header */}
            <div className="mb-6 hidden items-center justify-between gap-3 lg:flex">
              <div>
                <h1 className="bns-heading text-2xl xl:text-3xl 2xl:text-4xl">{title}</h1>
                <p className="text-sm xl:text-base text-ink/50">
                  {loading
                    ? "Loading…"
                    : view === "customers"
                    ? `${roster.length} people on record`
                    : focus === "all"
                    ? `${filtered.length} visits shown`
                    : `${tableRows.length} of ${filtered.length} visits shown`}
                  {!loading && dataSource.source === "clean" && (
                    <span
                      className="ml-2 rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] xl:text-xs text-good"
                      title={
                        dataSource.cleanedAt
                          ? `Duplicates and test rows removed, store backfilled. Last cleaned ${formatDateTime(dataSource.cleanedAt)}`
                          : "Reading the cleaned dataset"
                      }
                    >
                      cleaned
                    </span>
                  )}
                </p>
              </div>
              {view !== "customers" && (
                <button onClick={downloadCsv} className={btn} disabled={!tableRows.length}>
                  ↓ Download CSV
                </button>
              )}
            </div>

            {loadError && (
              <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm xl:text-base text-bad">
                {loadError}
              </div>
            )}

            {/* Filters */}
            <div className="mb-6 rounded-xl border border-ink/10 bg-ink/5 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs xl:text-sm text-ink/50">From</label>
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="w-full rounded-lg border border-ink/15 bg-panel px-3 py-2 text-sm xl:text-base text-ink outline-none focus:border-ink/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs xl:text-sm text-ink/50">To</label>
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="w-full rounded-lg border border-ink/15 bg-panel px-3 py-2 text-sm xl:text-base text-ink outline-none focus:border-ink/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs xl:text-sm text-ink/50">Search</label>
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={view === "customers" ? "Name, email, phone" : "Email, name, phone, MAC"}
                    className="w-full rounded-lg border border-ink/15 bg-panel px-3 py-2 text-sm xl:text-base text-ink placeholder-ink/30 outline-none focus:border-ink/50"
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
                <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs xl:text-sm text-ink/70">
                  <input
                    type="checkbox"
                    checked={onlyOptedIn}
                    onChange={(e) => setOnlyOptedIn(e.target.checked)}
                    className="h-4 w-4 accent-ink"
                  />
                  Marketing opt-ins only
                </label>
              </div>

              {/* Targeting — narrows the visit log to a group worth acting on.
                  Customers has its own controls, Insights is chart-led. */}
              {view !== "insights" && view !== "customers" && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/10 pt-3">
                  <span className="text-xs xl:text-sm text-ink/40">Show:</span>
                  {[
                    { key: "all", label: "Everyone", count: enriched.length },
                    { key: "birthday", label: "Birthday within 30 days", count: focusCounts.birthday },
                    { key: "loyal", label: "Regulars (3+ visits)", count: focusCounts.loyal },
                    { key: "first", label: "First-timers", count: focusCounts.first },
                  ].map((c) => (
                    <button
                      key={c.key}
                      onClick={() => setFocus(c.key)}
                      aria-pressed={focus === c.key}
                      className={`rounded-lg border px-3 py-1.5 text-xs xl:text-sm font-semibold transition ${
                        focus === c.key
                          ? "border-ink/60 bg-ink text-surface"
                          : "border-ink/15 bg-ink/5 text-ink/70 hover:bg-ink/10"
                      }`}
                    >
                      {c.label}
                      <span className={focus === c.key ? "ml-1.5 text-surface/60" : "ml-1.5 text-ink/40"}>
                        {c.count}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Visits" value={stats.visits} sub="unique device-days" />
              <StatCard
                label="Customers"
                value={retention.guests}
                sub={`${retention.visitsPerGuest.toFixed(2)} visits each`}
              />
              <StatCard
                label="Returning"
                value={`${retention.returnShare.toFixed(0)}%`}
                sub={`${retention.returnVisits} of ${retention.visits} visits`}
              />
              <StatCard
                label="Opt-in rate"
                value={`${stats.optInRate.toFixed(0)}%`}
                sub={`${stats.optedIn} of ${stats.visits}`}
                tone={stats.optInRate < 50 ? "warn" : "good"}
              />
            </div>

            {view === "insights" ? (
              <InsightsView
                entries={filtered}
                rawRows={filteredRaw}
                guestIndex={guestIndex}
                onShowAudience={setAudience}
              />
            ) : view === "customers" ? (
              <CustomersView
                roster={roster}
                periodKeys={periodKeys}
                periodLabel={periodLabel}
                onlyOptedIn={onlyOptedIn}
                search={search}
                onExport={downloadCustomersCsv}
              />
            ) : (
              <>
                {/* Who to contact this week — the most actionable panel */}
                {!isStoreView && (
                  <Panel
                    className="mb-6"
                    title="Who to contact this week"
                    note="Everyone on record, grouped by how long since their last visit. Counts are all-time, not limited by the date filter."
                    right={
                      <span className="text-xs xl:text-sm text-ink/40">
                        {reach.mailable} contactable of {reach.guests}
                      </span>
                    }
                  >
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {segments.map((s) => (
                        <button
                          key={s.key}
                          onClick={() =>
                            setAudience({
                              title: s.label,
                              subtitle: `${s.desc} · ${s.contactable} of ${s.total} can be emailed`,
                              guests: s.guests,
                            })
                          }
                          className={`rounded-lg border p-3 text-left transition hover:brightness-125 ${
                            s.key === "cooling"
                              ? "border-emerald-500/40 bg-emerald-500/10"
                              : "border-ink/10 bg-ink/5"
                          }`}
                        >
                          <div className="flex items-baseline justify-between">
                            <p className="text-sm xl:text-base font-semibold text-ink">{s.label}</p>
                            <p className="text-lg xl:text-xl font-bold text-ink">{s.total}</p>
                          </div>
                          <p className="mt-0.5 text-xs xl:text-sm text-ink/40">{s.desc}</p>
                          <p className="mt-2 text-xs xl:text-sm text-ink/60">{s.action}</p>
                          <p className="mt-1 text-[11px] xl:text-xs text-ink/40">
                            {s.contactable} can be emailed
                          </p>
                          <p className="mt-2 text-[11px] xl:text-xs font-semibold text-ink/70">
                            View list →
                          </p>
                        </button>
                      ))}
                    </div>
                    {segments[1] && segments[1].contactable > 0 && (
                      <div className="mt-4">
                        <Insight tone="good">
                          <strong>{segments[1].contactable} guests</strong> are in the 7–14 day
                          window and opted in to offers. This is the group most likely to respond —
                          they are due back about now.{" "}
                          <button
                            onClick={() =>
                              setAudience({
                                title: "Cooling",
                                subtitle: "7–14 days since last visit — the best moment to nudge",
                                guests: segments[1].guests,
                              })
                            }
                            className="font-semibold underline underline-offset-2"
                          >
                            Open the list
                          </button>
                        </Insight>
                      </div>
                    )}
                  </Panel>
                )}

                <div className="mb-6 grid gap-4 lg:grid-cols-3">
                  <Panel
                    className={isStoreView ? "lg:col-span-3" : "lg:col-span-2"}
                    title="New vs returning guests"
                    note="Solid = first-time visitors · faded = guests who have been before"
                  >
                    <BarChart
                      data={dailySplit}
                      labelKey="date"
                      valueKey="newGuests"
                      stackKey="returning"
                      formatLabel={(d) =>
                        new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
                      }
                    />
                  </Panel>
                  {!isStoreView && (
                    <Panel title="By store" note="Click a bar to open that store">
                      <HBars data={byBranch} labelKey="branch" valueKey="count" onSelect={(b) => go(b)} />
                    </Panel>
                  )}
                </div>
              </>
            )}

            {/* Visit log. Insights is chart-led and Customers is person-led,
                so neither shows it. */}
            <div
              className={`overflow-hidden rounded-xl border border-ink/10 bg-ink/5 ${
                view === "insights" || view === "customers" ? "hidden" : ""
              }`}
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm xl:text-base">
                  <thead className="bg-ink/5 text-xs xl:text-sm uppercase tracking-wide text-ink/50">
                    <tr>
                      <th className="px-3 py-3">Visit</th>
                      <th className="px-3 py-3">Name</th>
                      <th className="px-3 py-3">Customer</th>
                      <th className="px-3 py-3">Visits</th>
                      <th className="px-3 py-3">Birthday</th>
                      <th className="px-3 py-3">Stayed</th>
                      <th className="px-3 py-3">Email</th>
                      <th className="px-3 py-3">Phone</th>
                      {!isStoreView && <th className="px-3 py-3">Store</th>}
                      <th className="px-3 py-3">Offers</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {tableRows.slice(0, 300).map((e, i) => (
                      <tr key={`${e.dateKey}-${e.mac}-${i}`} className="hover:bg-ink/5">
                        <td className="whitespace-nowrap px-3 py-2.5 text-ink/80">
                          {formatDateTime(e.timestamp)}
                          {e.sessions > 1 && (
                            <span className="ml-1 text-xs xl:text-sm text-ink/40">×{e.sessions}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-ink/80">{e.firstName || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <span
                            className={`rounded px-2 py-0.5 text-xs xl:text-sm font-semibold ${TIER_STYLE[e.tier.tone]}`}
                            title={`${e.visits} visit${e.visits === 1 ? "" : "s"} on record, first seen ${formatDateTime(e.firstSeen)}`}
                          >
                            {e.tier.label}
                          </span>
                        </td>
                        <td
                          className="whitespace-nowrap px-3 py-2.5 text-ink/80"
                          title={`This was visit number ${e.nth}`}
                        >
                          {e.visits}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-ink/70">
                          {birthdayLabel(e.birthday) || <span className="text-ink/25">—</span>}
                          {e.birthdayIn !== null && e.birthdayIn <= 30 && (
                            <span
                              className="ml-1.5 rounded bg-amber-400/20 px-1.5 py-0.5 text-[11px] xl:text-xs font-semibold text-warn"
                              title="Worth a birthday offer while it's still useful"
                            >
                              {e.birthdayIn === 0
                                ? "today"
                                : e.birthdayIn === 1
                                ? "tomorrow"
                                : `${e.birthdayIn}d`}
                            </span>
                          )}
                        </td>
                        <td
                          className="whitespace-nowrap px-3 py-2.5 text-ink/80"
                          title={
                            e.lastDisconnected
                              ? `${formatDateTime(e.timestamp)} → ${formatDateTime(e.lastDisconnected)}`
                              : "Still connected, or no disconnect recorded"
                          }
                        >
                          {e.totalMinutes ? minutesToLabel(e.totalMinutes) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-ink/60">
                          {e.email ? (
                            <a href={`mailto:${e.email}`} className="hover:text-ink hover:underline">
                              {e.email}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-ink/60">
                          {e.phone ? (
                            <a href={`tel:${e.phone}`} className="hover:text-ink hover:underline">
                              {e.phone}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        {!isStoreView && (
                          <td className="whitespace-nowrap px-3 py-2.5 text-ink/60">
                            {e.branch || "Unknown"}
                          </td>
                        )}
                        <td className="px-3 py-2.5">
                          <span
                            className={`rounded px-2 py-0.5 text-xs xl:text-sm font-semibold ${
                              (e.promo || "").toLowerCase() === "yes"
                                ? "bg-emerald-500/20 text-good"
                                : "bg-ink/10 text-ink/50"
                            }`}
                          >
                            {e.promo || "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!tableRows.length && !loading && (
                      <tr>
                        <td colSpan={isStoreView ? 9 : 10} className="px-3 py-10 text-center text-ink/40">
                          {focus === "all"
                            ? "No entries for these filters."
                            : "Nobody in this group for the selected dates — try widening the date range."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {tableRows.length > 300 && (
                <p className="border-t border-ink/10 px-3 py-2 text-xs xl:text-sm text-ink/40">
                  Showing first 300 of {tableRows.length}. Download the CSV for the full list.
                </p>
              )}
            </div>

            {/* Explains the visit log only — Customers and Insights have their
                own notes, and two contradicting footnotes read as a bug. */}
            {view !== "insights" && view !== "customers" && (
              <p className="mt-6 text-center text-xs xl:text-sm text-ink/30">
                One row per device per day — repeat connections that day are merged.
              </p>
            )}
          </div>
          )}
        </main>
      </div>
    </div>
  );
}
