"use client";

import { useEffect, useState } from "react";

export const THEME_KEY = "hg-admin-theme";

/**
 * Light/dark switch for the admin panel.
 *
 * The theme itself is set on <html data-theme> by the inline script in
 * app/layout.js, which runs before first paint — otherwise the page flashes
 * dark before React hydrates. This component only reads that value and
 * changes it.
 *
 * With nothing stored we follow the operating system, including live changes
 * (macOS/Windows auto-switching at dusk). Once the user picks a side, their
 * choice is stored and the system is ignored.
 */
export default function ThemeToggle({ className = "" }) {
  // Starts null so the server and the first client render agree; the real
  // value arrives in the effect below, after hydration.
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") || "dark");

    // Follow the OS only while the user hasn't expressed a preference.
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (e) => {
      let stored = null;
      try {
        stored = localStorage.getItem(THEME_KEY);
      } catch {
        /* private mode — treat as no preference */
      }
      if (stored) return;
      const next = e.matches ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      setTheme(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage blocked — the theme still applies for this session */
    }
  }

  const isLight = theme === "light";

  return (
    <button
      onClick={toggle}
      // Rendered but inert until we know the theme, so the layout doesn't shift.
      disabled={theme === null}
      aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
      title={isLight ? "Switch to dark theme" : "Switch to light theme"}
      className={`flex items-center justify-center gap-2 rounded-lg border border-ink/15 bg-ink/5 px-3 py-2 text-xs xl:text-sm font-semibold text-ink/80 transition hover:bg-ink/10 disabled:opacity-0 ${className}`}
    >
      <span aria-hidden className="text-base leading-none">
        {isLight ? "☾" : "☀"}
      </span>
      <span>{isLight ? "Dark" : "Light"}</span>
    </button>
  );
}
