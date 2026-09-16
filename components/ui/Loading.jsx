"use client";

/*
 * Loading states for the admin panel.
 *
 * Reading the Google Sheet takes a few seconds and grows with the row count,
 * so the panel has to say something while it waits. Signing in used to leave
 * the login form sitting there with an idle button, which read as a hang.
 *
 * The rule here: never show a blank screen and never show a static one. A
 * skeleton in the shape of the real content tells you what's coming and how
 * long it'll roughly be.
 */

/** Spinning ring. `className` sets the size, e.g. "h-4 w-4". */
export function Spinner({ className = "h-4 w-4", label }) {
  return (
    <span
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/** Grey block that pulses. Used to pre-draw the shape of loading content. */
export function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded bg-ink/10 ${className}`} aria-hidden />;
}

/**
 * The dashboard, pre-drawn, while the first load runs.
 *
 * Deliberately mirrors the real layout — four stat cards, a filter bar, a
 * table — so the page doesn't jump around when the data lands.
 */
export function DashboardSkeleton({ message = "Loading your guest data…", note }) {
  return (
    <div className="w-full" aria-busy="true">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <Skeleton className="h-8 w-40" />
          <div className="mt-2 flex items-center gap-2 text-sm xl:text-base text-ink/50">
            <Spinner className="h-3.5 w-3.5" label={message} />
            <span>{message}</span>
          </div>
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      {/* Filters */}
      <div className="mb-6 rounded-xl border border-ink/10 bg-ink/5 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-ink/10 bg-ink/5 p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-8 w-24" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-ink/10 bg-ink/5">
        <div className="border-b border-ink/10 bg-ink/5 px-3 py-3">
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex items-center gap-4 border-b border-ink/5 px-3 py-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="hidden h-4 w-40 sm:block" />
            <Skeleton className="ml-auto h-4 w-20" />
          </div>
        ))}
      </div>

      {note && <p className="mt-4 text-center text-xs xl:text-sm text-ink/40">{note}</p>}
    </div>
  );
}

/** Small "working on it" pill, for refreshes that aren't blocking the view. */
export function RefreshingBadge({ children = "Refreshing…" }) {
  return (
    <span className="ml-2 inline-flex items-center gap-1.5 rounded bg-ink/10 px-2 py-0.5 text-[11px] xl:text-xs text-ink/60">
      <Spinner className="h-3 w-3" />
      {children}
    </span>
  );
}
