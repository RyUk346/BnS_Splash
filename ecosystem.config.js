// pm2 process file — run with: pm2 start ecosystem.config.js
//
// The port comes from PORT in .env so this file is identical on every
// machine (no more local-vs-VPS drift). Default 3000 if unset.
//
// Read .env directly rather than via dotenv — pm2 loads this file before
// `npm install` may have run, and a missing module here would break pm2.
const fs = require("fs");
const path = require("path");

function envValue(key) {
  if (process.env[key]) return process.env[key];
  try {
    const file = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    for (const line of file.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      if (trimmed.slice(0, eq).trim() === key) {
        return trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no .env — fall through to the default */
  }
  return null;
}

const PORT = envValue("PORT") || "3000";

module.exports = {
  apps: [
    {
      name: "hyperglow-splash",
      script: "node_modules/next/dist/bin/next",
      args: `start -p ${PORT}`,
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      // Session-duration poller. Runs on a cron schedule (every 3 min),
      // exits each run, and is restarted by pm2 at the next tick.
      name: "hyperglow-poller",
      script: "scripts/session-poller.js",
      cwd: __dirname,
      cron_restart: "*/3 * * * *",
      autorestart: false, // it's a one-shot; cron re-launches it
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
