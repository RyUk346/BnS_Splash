// Stage timing for the guest connect path.
//
// This exists because three rounds of "it should be about N seconds" were
// wrong. The connect flow spans a browser, our server, api.ui.com and a
// console in a shop — guessing which link is slow doesn't work, and the
// arithmetic was off by 5x. Every connect now logs where its time went, in
// one grep-able line.
//
// Deliberately cheap: Date.now() and a string. No sampling, no aggregation —
// pm2 already keeps the logs, and a busy day is a few hundred lines.

/**
 * Start timing.
 *
 *   const t = startTimer("connect");
 *   … work …
 *   t.mark("authorize");
 *   … work …
 *   t.done({ branch: "Perry Barr" });
 *
 * -> [timing] connect total=1240ms authorize=1180ms branch="Perry Barr"
 */
function startTimer(label) {
  const t0 = Date.now();
  let last = t0;
  const stages = [];

  return {
    /** Record the time since the previous mark. */
    mark(name) {
      const now = Date.now();
      stages.push([name, now - last]);
      last = now;
      return now - t0;
    },

    /** Milliseconds so far, without recording a stage. */
    elapsed() {
      return Date.now() - t0;
    },

    /** Log the line. `extra` values are appended as key=value pairs. */
    done(extra = {}) {
      const total = Date.now() - t0;
      const parts = [`total=${total}ms`];
      for (const [name, ms] of stages) parts.push(`${name}=${ms}ms`);
      for (const [k, v] of Object.entries(extra)) {
        if (v === undefined || v === null || v === "") continue;
        parts.push(`${k}=${typeof v === "string" ? JSON.stringify(v) : v}`);
      }
      console.log(`[timing] ${label} ${parts.join(" ")}`);
      return total;
    },
  };
}

module.exports = { startTimer };
