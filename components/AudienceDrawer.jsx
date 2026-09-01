"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "@/lib/analytics";

/**
 * Slide-over list of guests, with the actions an owner actually needs:
 * copy the addresses, export them, or open a mail draft.
 *
 * Deliberately does NOT send email itself. Marketing mail needs an
 * unsubscribe link and delivery reputation management — that belongs in a
 * proper email platform, not a BCC blast from a dashboard.
 */
export default function AudienceDrawer({ open, onClose, title, subtitle, guests, emptyNote }) {
  const [copied, setCopied] = useState("");
  const [onlyContactable, setOnlyContactable] = useState(true);

  // Escape to close — expected behaviour for a slide-over.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) setCopied("");
  }, [open]);

  const list = useMemo(() => {
    const g = guests || [];
    return onlyContactable ? g.filter((x) => x.contactable) : g;
  }, [guests, onlyContactable]);

  const emails = useMemo(
    () => list.filter((g) => g.email && g.contactable).map((g) => g.email),
    [list]
  );

  if (!open) return null;

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 2500);
    } catch {
      setCopied("Copy failed — select the list manually");
    }
  }

  function downloadCsv() {
    const esc = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [["Name", "Email", "Phone", "Last visit", "Visits", "Store", "Opted in"].join(",")];
    for (const g of list) {
      lines.push(
        [
          g.name,
          g.email,
          g.phone || "",
          g.last ? formatDateTime(g.last) : "",
          g.count || 1,
          Array.from(g.branches || []).join(" / "),
          g.contactable ? "Yes" : "No",
        ]
          .map(esc)
          .join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audience_${String(title).toLowerCase().replace(/\s+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // mailto has a practical URL length limit; past ~40 addresses it silently
  // truncates or fails, so we steer bigger sends to copy/CSV instead.
  const mailtoSafe = emails.length > 0 && emails.length <= 40;
  const mailtoHref = `mailto:?bcc=${encodeURIComponent(emails.join(","))}`;

  const btn =
    "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs xl:text-sm font-semibold text-white/80 transition hover:bg-white/10 disabled:opacity-40";
  const btnPrimary =
    "rounded-lg bg-white px-3 py-2 text-xs xl:text-sm font-semibold text-neutral-900 transition hover:bg-white/90 disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <aside className="relative flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-neutral-950 shadow-2xl">
        {/* Header */}
        <div className="border-b border-white/10 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="bns-heading text-xl xl:text-2xl text-white">{title}</h2>
              {subtitle && <p className="mt-0.5 text-sm xl:text-base text-white/50">{subtitle}</p>}
            </div>
            <button onClick={onClose} className={btn} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => copy(emails.join(", "), `${emails.length} addresses copied`)}
              className={btnPrimary}
              disabled={!emails.length}
            >
              Copy {emails.length} email{emails.length === 1 ? "" : "s"}
            </button>
            <button onClick={downloadCsv} className={btn} disabled={!list.length}>
              ↓ CSV
            </button>
            <a
              href={mailtoSafe ? mailtoHref : undefined}
              className={`${btn} ${mailtoSafe ? "" : "pointer-events-none opacity-40"}`}
              title={
                mailtoSafe
                  ? "Opens your mail app with everyone in BCC"
                  : "Too many recipients for a mail link — use Copy or CSV"
              }
            >
              Open mail draft
            </a>
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs xl:text-sm text-white/60">
              <input
                type="checkbox"
                checked={onlyContactable}
                onChange={(e) => setOnlyContactable(e.target.checked)}
                className="h-4 w-4 accent-white"
              />
              Opted-in only
            </label>
          </div>

          {copied && <p className="mt-2 text-xs xl:text-sm text-emerald-300">{copied}</p>}

          <p className="mt-3 text-[11px] xl:text-xs text-white/35">
            Paste into your email platform (Mailchimp, Brevo…) rather than sending a
            large BCC — marketing mail must carry an unsubscribe link, and bulk BCC
            tends to land in spam.
          </p>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {!list.length && (
            <p className="p-6 text-center text-sm xl:text-base text-white/40">
              {emptyNote || "Nobody in this group."}
            </p>
          )}
          <ul className="divide-y divide-white/5">
            {list.map((g) => (
              <li key={g.key} className="flex items-center gap-3 px-5 py-3 hover:bg-white/5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm xl:text-base font-medium text-white">
                    {g.name || "—"}
                    {!g.contactable && (
                      <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] xl:text-xs text-white/50">
                        not opted in
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs xl:text-sm text-white/50">{g.email || "no email"}</p>
                  <p className="mt-0.5 text-[11px] xl:text-xs text-white/35">
                    {g.birthday
                      ? `Birthday ${g.birthday}`
                      : g.last
                      ? `Last visit ${formatDateTime(g.last)}`
                      : ""}
                    {g.count > 1 ? ` · ${g.count} visits` : ""}
                    {g.branches && g.branches.size
                      ? ` · ${Array.from(g.branches).join(" / ")}`
                      : ""}
                  </p>
                </div>
                {g.email && (
                  <a
                    href={`mailto:${g.email}`}
                    className="shrink-0 rounded-lg border border-white/15 px-2 py-1 text-[11px] xl:text-xs text-white/60 hover:bg-white/10"
                    title={`Email ${g.email}`}
                  >
                    Email
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-white/10 px-5 py-3 text-xs xl:text-sm text-white/40">
          {list.length} shown{" "}
          {onlyContactable && guests && guests.length > list.length
            ? `· ${guests.length - list.length} hidden (not opted in)`
            : ""}
        </div>
      </aside>
    </div>
  );
}
