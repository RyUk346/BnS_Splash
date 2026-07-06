# HyperGlow Guest WiFi Splash Page

> **Taking over this project?** Read [`DOCUMENTATION.md`](DOCUMENTATION.md) — it documents the live deployment, operations runbook, and troubleshooting. This README is the from-scratch setup guide.

A UniFi external captive portal: guests join your WiFi, get redirected to this page on your VPS, fill in a short form, the details land in a Google Sheet, and the guest is authorized onto the internet via the UniFi API.

```
Guest joins WiFi
      │
      ▼
UniFi redirects guest to your VPS
  https://wifi.yourdomain.com/guest/s/default/?id=<guest MAC>&ap=..&ssid=..&url=..
      │
      ▼
Guest submits the form (Email* + First Name* required)
      │
      ├──► Row appended to your Google Sheet
      │
      └──► Server calls UniFi API: "authorize this MAC" ──► guest is online
```

Because you manage the router remotely through unifi.ui.com, this project uses Ubiquiti's **Cloud Connector Proxy** (`api.ui.com`) to send the authorize command. That means **no port forwarding on the Virgin Media router is needed** — the VPS talks to Ubiquiti's cloud, which relays to your console. Requires UniFi OS ≥ 5.0.3 (you're on 5.1.19 ✓) and Network app ≥ 9.1 (you're on 10.4 ✓).

---

## Part A — Google Sheet (≈5 minutes)

1. Go to [sheets.new](https://sheets.new) and create a sheet, e.g. **HyperGlow WiFi Signups**.
2. **Extensions → Apps Script**. Delete the placeholder code and paste in the contents of [`apps-script/Code.gs`](apps-script/Code.gs). Save.
3. **Deploy → New deployment → Select type: Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**, approve the permissions prompt, and copy the **Web app URL** (ends in `/exec`).
5. Keep that URL — it goes into `.env` as `GOOGLE_SHEETS_WEBHOOK_URL`.

> The header row is created automatically on the first submission. If you ever edit Code.gs, you must re-deploy (Deploy → Manage deployments → edit → New version).

## Part B — UniFi API key + console ID (≈5 minutes)

1. Go to [unifi.ui.com](https://unifi.ui.com), click your **profile icon → API Keys** (or visit account.ui.com → API Keys).
2. Create a key, name it e.g. `splash-page`, and copy it — it's shown only once.
3. Find your **console ID** from your VPS (or any machine with curl):

   ```bash
   curl -s https://api.ui.com/v1/hosts -H "X-API-Key: YOUR_KEY"
   ```

   In the JSON response, copy the `"id"` of your console (a long hex string — it also appears in your unifi.ui.com browser URL after `/consoles/`).

4. Sanity-check that the proxy works end to end:

   ```bash
   curl -s "https://api.ui.com/v1/connector/consoles/YOUR_CONSOLE_ID/proxy/network/integration/v1/sites" \
     -H "X-API-Key: YOUR_KEY"
   ```

   You should get back a site list (your site is `default`). If this works, guest authorization will work.

## Part C — Deploy to your VPS (≈15 minutes)

Assumes Ubuntu/Debian. You need a **domain/subdomain pointed at the VPS** (e.g. `wifi.hyperglow.co.uk` → your VPS IP) because guests' devices must reach it by name, and HTTPS avoids captive-portal warnings.

```bash
# 1. Install Node.js 20 (skip if already installed)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx

# 2. Get the project onto the VPS (git clone, scp, or rsync this folder)
cd /var/www
sudo mkdir -p hyperglow-splash && sudo chown $USER hyperglow-splash
# ...copy the project files into /var/www/hyperglow-splash...
cd hyperglow-splash

# 3. Configure
cp .env.example .env
nano .env        # fill in GOOGLE_SHEETS_WEBHOOK_URL, UNIFI_API_KEY, UNIFI_CONSOLE_ID

# 4. Build & run
npm install
npm run build
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save && pm2 startup   # auto-start on reboot (follow the printed command)
```

### Nginx + HTTPS

```bash
sudo tee /etc/nginx/sites-available/hyperglow-splash <<'EOF'
server {
    listen 80;
    server_name wifi.hyperglow.co.uk;   # ← your domain

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
sudo ln -s /etc/nginx/sites-available/hyperglow-splash /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Free HTTPS certificate
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d wifi.hyperglow.co.uk
```

Visit `https://wifi.hyperglow.co.uk` — you should see the splash page. Submit a test entry: it should appear in your Google Sheet (authorization is skipped when there's no MAC in the URL, which is expected when testing directly).

## Part D — UniFi configuration (≈10 minutes)

In your UniFi Network app (via unifi.ui.com):

1. **Guest WiFi network**
   *Settings → WiFi → Create New* (or edit an existing SSID). Enable **Hotspot Portal** (on newer versions this is under the WiFi's *Advanced* settings, or by assigning the network to the **Hotspot zone**).

2. **Captive portal → external server**
   *Settings → Hotspot / Captive Portal → Authentication* → choose **External Portal Server** and enter your portal address (`wifi.hyperglow.co.uk`).
   UniFi will redirect guests to:
   `https://wifi.hyperglow.co.uk/guest/s/default/?ap=..&id=<guest MAC>&t=..&url=..&ssid=..`
   — this app handles that route automatically.

3. **Pre-authorization allowances (walled garden)**
   In the Hotspot settings, add your portal domain (`wifi.hyperglow.co.uk`) to the allowed/pre-auth list so unauthorized guests can load the page. (The Google Sheets call is server-side, so no Google domains are needed.)

4. **Test with a real device**
   Join the guest SSID with a phone → the splash page should pop up → fill the form → "You're connected!" → internet works, and the row is in your Sheet.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Splash page never appears on the phone | Portal domain missing from pre-auth allowances; or DNS for your domain not resolving. Try opening `neverssl.com` manually to trigger the redirect. |
| Form submits but "Could not activate your WiFi access" | UniFi API call failing. Check `pm2 logs hyperglow-splash`. Verify the Part B step-4 curl still works, and that the API key hasn't been revoked. |
| Row not appearing in the Sheet | Re-check `GOOGLE_SHEETS_WEBHOOK_URL`; make sure the Apps Script deployment is "Anyone" access and you copied the `/exec` URL, not `/dev`. |
| `Client not found on site` in logs | The guest's device uses MAC randomization and reconnected with a new MAC, or the site ID is wrong. Leave `UNIFI_SITE_ID` blank to auto-detect. |
| Works on Android, iPhone stuck | iOS captive portal mini-browser can be finicky with redirects; the built-in 4s delay usually handles it. Ensure HTTPS is valid (no self-signed cert on the portal). |

## Security notes

- `.env` holds your UniFi API key — never commit it (already in `.gitignore`). The key inherits your admin permissions; treat it like a password.
- You collect personal data (email, name, phone, birthday) from UK guests — GDPR applies. The Sheet should be access-restricted, and consider adding a short privacy notice/link on the page.
- Rotate the API key from unifi.ui.com if it ever leaks.

## Alternative: direct mode (no cloud proxy)

If you later give the console a public address (Virgin Media hub in modem mode, or port forward 443 to `192.168.0.95`), you can bypass the cloud hop:

```env
UNIFI_MODE=direct
UNIFI_CONTROLLER_URL=https://your-public-ip-or-ddns
UNIFI_API_KEY=key-from-Network→Settings→Control Plane→Integrations
```

Cloud mode adds ~1s latency per authorization — irrelevant for a splash page — so the default is fine.

## Sources

- [External Hotspot API for Authorization Clients — Ubiquiti](https://help.ui.com/hc/en-us/articles/31228198640023-External-Hotspot-API-for-Authorization-Clients)
- [Getting Started with the Official UniFi API — Ubiquiti](https://help.ui.com/hc/en-us/articles/30076656117655-Getting-Started-with-the-Official-UniFi-API)
- [UniFi Hotspots and Captive Portals — Ubiquiti](https://help.ui.com/hc/en-us/articles/115000166827-UniFi-Hotspots-and-Captive-Portals)
