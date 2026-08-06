// pm2 process file — run with: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "hyperglow-splash",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
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
