"use client";

import { useEffect, useMemo, useState } from "react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

const btn =
  "rounded-lg border border-ink/15 bg-ink/5 px-3 py-2 text-xs xl:text-sm font-semibold text-ink/80 transition hover:bg-ink/10 disabled:opacity-40";
const btnPrimary =
  "rounded-lg bg-ink px-4 py-2 text-xs xl:text-sm font-semibold text-surface transition hover:bg-ink/90 disabled:opacity-40";
const input =
  "w-full rounded-lg border border-ink/15 bg-panel px-3 py-2 text-sm xl:text-base text-ink placeholder-ink/30 outline-none focus:border-ink/50";

/** Small coloured status pill. */
function Pill({ tone, children }) {
  const tones = {
    ok: "bg-emerald-500/20 text-good",
    bad: "bg-red-500/20 text-bad",
    idle: "bg-ink/10 text-ink/50",
    busy: "bg-amber-500/20 text-warn",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${tones[tone] || tones.idle}`}>
      {children}
    </span>
  );
}

export default function StoreManager() {
  const [stores, setStores] = useState([]);
  const [fileBacked, setFileBacked] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Add-store panel
  const [adding, setAdding] = useState(false);
  const [consoles, setConsoles] = useState(null); // null = not discovered yet
  const [discovering, setDiscovering] = useState(false);
  const [pickedId, setPickedId] = useState("");
  const [manualId, setManualId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const [storeSearch, setStoreSearch] = useState("");

  // Per-store UI state
  const [tests, setTests] = useState({}); // id -> {tone,text}
  const [editing, setEditing] = useState(null); // id being renamed
  const [editLabel, setEditLabel] = useState("");

  async function loadStores() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${BASE}/api/admin/stores`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Could not load stores");
      setStores(data.stores);
      setFileBacked(data.fileBacked);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStores();
    // Fetch the live console list straight away, not just when adding a
    // store: it's what lets the table show each console's own UniFi name.
    // Deliberately not awaited — it goes out to api.ui.com, and the table
    // (read from a local file) should render immediately regardless.
    discover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** consoleId -> what UniFi currently calls it. */
  const liveNames = useMemo(() => {
    const map = new Map();
    for (const c of consoles || []) if (c.name) map.set(c.id, c.name);
    return map;
  }, [consoles]);

  /**
   * Save any console name we've learned that isn't on file yet.
   *
   * Covers stores added before the field existed, and routers renamed in
   * UniFi since. Fire-and-forget: the name is already on screen either way.
   */
  useEffect(() => {
    if (!consoles || !stores.length) return;
    const stale = stores.filter((s) => {
      const live = liveNames.get(s.id);
      return live && live !== s.consoleName;
    });
    if (!stale.length) return;

    (async () => {
      for (const s of stale) {
        try {
          await fetch(`${BASE}/api/admin/stores`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: s.id, consoleName: liveNames.get(s.id) }),
          });
        } catch {
          /* cosmetic — the live name is displayed from `consoles` anyway */
        }
      }
      loadStores();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consoles, stores.length]);

  function flash(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(""), 4000);
  }

  async function discover() {
    setDiscovering(true);
    setError("");
    try {
      const res = await fetch(`${BASE}/api/admin/consoles`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Discovery failed");
      setConsoles(data.consoles);
    } catch (err) {
      setError(err.message);
    } finally {
      setDiscovering(false);
    }
  }

  function openAdd() {
    setAdding(true);
    setPickedId("");
    setManualId("");
    setNewLabel("");
    if (!consoles) discover();
  }

  async function save() {
    const id = (pickedId || manualId).trim();
    if (!id) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${BASE}/api/admin/stores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          label: newLabel.trim(),
          // Already in hand from the picker, so no extra UniFi call to get it.
          consoleName: liveNames.get(id) || "",
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Could not add store");
      setStores(data.stores);
      setFileBacked(true);
      setAdding(false);
      setConsoles(null); // refresh "already added" flags next time
      flash("Store added — it's live immediately, no restart needed.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function testStore(id) {
    setTests((t) => ({ ...t, [id]: { tone: "busy", text: "Checking…" } }));
    try {
      const res = await fetch(`${BASE}/api/admin/consoles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      setTests((t) => ({
        ...t,
        [id]: data.ok
          ? { tone: "ok", text: "Reachable" }
          : { tone: "bad", text: data.error || "Unreachable" },
      }));
    } catch (err) {
      setTests((t) => ({ ...t, [id]: { tone: "bad", text: err.message } }));
    }
  }

  async function rename(id) {
    try {
      const res = await fetch(`${BASE}/api/admin/stores`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, label: editLabel.trim() }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Rename failed");
      setStores(data.stores);
      setEditing(null);
      flash("Store renamed. New sign-ups use the new label.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(store) {
    if (
      !window.confirm(
        `Remove "${store.label}"?\n\nGuests at this store will no longer be able to connect until it's added back. Existing Sheet data is not affected.`
      )
    )
      return;
    try {
      const res = await fetch(`${BASE}/api/admin/stores`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: store.id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Remove failed");
      setStores(data.stores);
      setConsoles(null);
      flash("Store removed.");
    } catch (err) {
      setError(err.message);
    }
  }

  const available = (consoles || []).filter((c) => !c.added);

  /**
   * Filter the list by branch name or UniFi console name.
   *
   * Matches the live console name as well as the stored one, so searching for
   * a router by what UniFi calls it today works even if it was renamed since
   * it was added. The console ID is matched too — handy when you have an ID
   * in front of you and want to know which store it is.
   */
  const visibleStores = useMemo(() => {
    const q = storeSearch.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter((s) =>
      [s.label, s.consoleName, liveNames.get(s.id), s.id].some((v) =>
        String(v || "").toLowerCase().includes(q)
      )
    );
  }, [stores, storeSearch, liveNames]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="bns-heading text-2xl xl:text-3xl 2xl:text-4xl">Stores</h1>
          <p className="text-sm xl:text-base text-ink/50">
            {loading ? "Loading…" : `${stores.length} configured`}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadStores} className={btn} disabled={loading}>
            ↻ Refresh
          </button>
          <button onClick={openAdd} className={btnPrimary}>
            + Add store
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm xl:text-base text-bad">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm xl:text-base text-good">
          {notice}
        </div>
      )}
      {!fileBacked && !loading && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm xl:text-base text-warn">
          These stores are currently read from the server&apos;s <code>.env</code> file. Adding or
          editing one here moves the list into <code>data/stores.json</code>, after which changes
          take effect instantly without touching the server.
        </div>
      )}

      {/* Add store panel */}
      {adding && (
        <div className="mb-6 rounded-xl border border-ink/15 bg-ink/5 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm xl:text-base font-semibold text-ink/90">Add a store</h2>
            <button onClick={() => setAdding(false)} className="text-xs xl:text-sm text-ink/40 hover:text-ink">
              ✕ Cancel
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs xl:text-sm text-ink/50">
                UniFi console <span className="text-bad">*</span>
                {discovering && <span className="ml-2 text-warn">discovering…</span>}
              </label>

              {consoles === null && !discovering && (
                <button onClick={discover} className={btn}>
                  Find consoles on my account
                </button>
              )}

              {consoles !== null && (
                <>
                  <select
                    value={pickedId}
                    onChange={(e) => {
                      setPickedId(e.target.value);
                      const c = available.find((x) => x.id === e.target.value);
                      if (c && !newLabel) setNewLabel(c.name);
                    }}
                    className={input}
                  >
                    <option value="">
                      {available.length ? "Select a console…" : "No unadded consoles found"}
                    </option>
                    {available.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.model ? ` · ${c.model}` : ""}
                        {c.state ? ` · ${c.state}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-ink/40">
                    {consoles.length} console{consoles.length === 1 ? "" : "s"} on the account,{" "}
                    {consoles.length - available.length} already added.
                  </p>
                </>
              )}

              <details className="mt-3">
                <summary className="cursor-pointer text-xs xl:text-sm text-ink/40 hover:text-ink/70">
                  Or paste a console ID manually
                </summary>
                <input
                  type="text"
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  placeholder="6C63F8...:123456789"
                  className={`${input} mt-2 font-mono text-xs xl:text-sm`}
                />
              </details>
            </div>

            <div>
              <label className="mb-1 block text-xs xl:text-sm text-ink/50">
                Store name <span className="text-bad">*</span>
              </label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. BnS Merry Hill"
                className={input}
              />
              <p className="mt-1 text-[11px] text-ink/40">
                Shown in the Google Sheet&apos;s Branch column and in this sidebar.
                {liveNames.get(pickedId) && (
                  <>
                    {" "}
                    This is your name for the branch — the console calls itself{" "}
                    <span className="font-medium text-ink/60">{liveNames.get(pickedId)}</span> in
                    UniFi.
                  </>
                )}
              </p>

              {/* Store name is now genuinely required, not just marked as
                  such. Without it the store fell back to a truncated console
                  ID, and that string is what lands in the Sheet's Branch
                  column — which every per-store figure in the dashboard is
                  grouped by. An unnamed store makes its own data unreadable. */}
              <button
                onClick={save}
                disabled={saving || !(pickedId || manualId.trim()) || !newLabel.trim()}
                className={`${btnPrimary} mt-4`}
              >
                {saving ? "Adding…" : "Add store"}
              </button>
              <p className="mt-3 text-[11px] text-ink/40">
                <span className="text-bad">*</span> required
              </p>
            </div>
          </div>

          <p className="mt-4 border-t border-ink/10 pt-3 text-[11px] text-ink/40">
            Reminder: the router itself still needs its hotspot configured in UniFi (guest WiFi set
            to <strong>Hotspot</strong>, External Portal Server, and the pre-authorisation
            allowance). See the &ldquo;Adding a Store&rdquo; guide.
          </p>
        </div>
      )}

      {/* Search. Appears once the list is long enough to be worth scanning —
          below that it's just a box in the way. */}
      {stores.length > 5 && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1 sm:max-w-sm">
            <input
              type="text"
              value={storeSearch}
              onChange={(e) => setStoreSearch(e.target.value)}
              placeholder="Search by store or console name…"
              aria-label="Search stores"
              className={`${input} pr-8`}
            />
            {storeSearch && (
              <button
                onClick={() => setStoreSearch("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-ink/40 transition hover:text-ink"
              >
                ✕
              </button>
            )}
          </div>
          {storeSearch && (
            <span className="text-xs xl:text-sm text-ink/50">
              {visibleStores.length} of {stores.length}
            </span>
          )}
        </div>
      )}

      {/* Store list */}
      <div className="overflow-hidden rounded-xl border border-ink/10 bg-ink/5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm xl:text-base">
            <thead className="bg-ink/5 text-xs xl:text-sm uppercase tracking-wide text-ink/50">
              <tr>
                <th className="px-4 py-3">Store</th>
                <th className="px-4 py-3">UniFi console</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {visibleStores.map((s) => (
                <tr key={s.id} className="hover:bg-ink/5">
                  <td className="px-4 py-3">
                    {editing === s.id ? (
                      <div className="flex gap-2">
                        <input
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          className={`${input} max-w-[220px]`}
                          autoFocus
                        />
                        <button onClick={() => rename(s.id)} className={btnPrimary}>
                          Save
                        </button>
                        <button onClick={() => setEditing(null)} className={btn}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <span className="font-semibold text-ink">{s.label}</span>
                    )}
                  </td>
                  {/* The name UniFi itself shows (e.g. BNS-BH-BW-GW1). Without
                      it there's no way to tell which physical router a row is,
                      because the UniFi dashboard never shows the console ID. */}
                  <td className="px-4 py-3">
                    {(() => {
                      const live = liveNames.get(s.id);
                      const name = live || s.consoleName;
                      if (!name) {
                        return (
                          <>
                            <span className="text-ink/40">
                              {consoles === null ? "Loading…" : "Name unavailable"}
                            </span>
                            <span
                              className="mt-0.5 block font-mono text-[11px] text-ink/30"
                              title={s.id}
                            >
                              {s.id.slice(0, 14)}…{s.id.slice(-10)}
                            </span>
                          </>
                        );
                      }
                      return (
                        <>
                          <span className="font-medium text-ink/80">{name}</span>
                          {live && s.consoleName && live !== s.consoleName && (
                            <span
                              className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-warn"
                              title={`Renamed in UniFi — was "${s.consoleName}"`}
                            >
                              renamed
                            </span>
                          )}
                          <span
                            className="mt-0.5 block font-mono text-[11px] text-ink/30"
                            title={s.id}
                          >
                            {s.id.slice(0, 14)}…{s.id.slice(-10)}
                          </span>
                        </>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    {tests[s.id] ? (
                      <Pill tone={tests[s.id].tone}>{tests[s.id].text}</Pill>
                    ) : (
                      <Pill tone="idle">Not checked</Pill>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => testStore(s.id)} className={btn}>
                        Test
                      </button>
                      <button
                        onClick={() => {
                          setEditing(s.id);
                          setEditLabel(s.label);
                        }}
                        className={btn}
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => remove(s)}
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs xl:text-sm font-semibold text-bad transition hover:bg-red-500/20"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!visibleStores.length && !loading && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-ink/40">
                    {stores.length ? (
                      <>
                        No store matches &ldquo;{storeSearch}&rdquo;.{" "}
                        <button
                          onClick={() => setStoreSearch("")}
                          className="underline hover:text-ink"
                        >
                          Clear search
                        </button>
                      </>
                    ) : (
                      "No stores configured yet."
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-xs xl:text-sm text-ink/30">
        Changes take effect immediately — no server restart or redeploy required.
      </p>
    </div>
  );
}
