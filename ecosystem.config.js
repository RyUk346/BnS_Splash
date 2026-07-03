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
  ],
};
