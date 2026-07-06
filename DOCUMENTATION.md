# HyperGlow Guest WiFi Portal — Technical & Operations Documentation

**Project:** UniFi guest WiFi captive portal (splash page)
**Owner:** HyperGlow (hello@hyperglow.co.uk)
**First deployed:** July 2026 — Burger & Sauce store
**Audience:** developers / IT staff taking over maintenance of this system

---

## 1. What this project does

When a customer joins the store's guest WiFi, their phone is redirected to a branded
splash page hosted on HyperGlow's VPS. The customer fills in a short form
(Email, First Name, Phone, Birthday). On submit, the system:

1. Appends the customer's details to a Google Sheet (marketing data), and
2. Tells the store's UniFi router to authorize that device onto the internet.

The customer then gets internet access for a configurable period (default 24 h),
after which they must sign in again.

---

## 2. Architecture

```
 Customer phone                    VPS (77.68.55.132)                 Google / Ubiquiti cloud
┌──────────────┐   ①  join WiFi   ┌──────────────────────┐
│ joins        │ ───────────────► │                      │
│ "BurgerAnd   │                  │  nginx (:80/:443)    │
│  Sauce-Guest"│   ②  redirect    │   ├─ /guest/  ───────┼──► 302 to /SplashPage/BnS/guest/...
│              │  to 77.68.55.132 │   └─ /SplashPage/BnS │
│              │  /guest/s/...    │        │ proxy       │
│              │                  │        ▼             │
│              │   ③  form shown  │  Next.js app (:3020) │
│              │ ◄──────────────► │  (pm2:               │
│              │                  │   hyperglow-splash)  │
│              │   ④  submit      │        │             │
│              │ ───────────────► │        ├─────────────┼──► ⑤ Google Apps Script webhook
│              │                  │        │             │      (appends row to Sheet)
│              │                  │        └─────────────┼──► ⑥ api.ui.com Cloud Connector Proxy
│              │                  │                      │      → UniFi console → authorize MAC
│  ⑦ online ✓  │ ◄────────────────┴──────────────────────┘
└──────────────┘
```

Key design decision: the store's UniFi console sits behind the store ISP router
(double NAT — no public IP, no port forwarding). The VPS therefore authorizes
guests through **Ubiquiti's official Cloud Connector Proxy** (`api.ui.com`),
authenticated with an account-level API key. Nothing needs to be opened on the
store network.

---

## 3. Live deployment inventory (as of July 2026)

| Item | Value |
|---|---|
| Public URL | `https://location.hyperglow.co.uk/SplashPage/BnS` |
| VPS | Ubuntu 24.04, IP `77.68.55.132` |
| App directory | `/var/www/location/splash_page/BnS_Splash` |
| App port (localhost only) | `3020` |
| Process manager | pm2, app name **`hyperglow-splash`** (runs `next start -p 3020`) |
| nginx site config | `/etc/nginx/sites-available/location` (proxies `/SplashPage/BnS` → `:3020`; redirects `/guest/` → splash page) |
| nginx default config | `/etc/nginx/sites-available/default` (redirects IP-based `/guest/` hits → `https://location.hyperglow.co.uk/SplashPage/BnS...`) |
| HTTPS | Let's Encrypt via certbot (auto-renews; cert for `location.hyperglow.co.uk`) |
| Source repository | GitHub (private) — `hyperglow-splash` |
| Google Sheet | "HyperGlow WiFi Signups" (bound Apps Script web app = webhook) |
| UniFi console | **ROUTER-BNS-BH-PB** (UniFi Cloud Gateway Ultra), managed via unifi.ui.com |
| UniFi site | `default` |
| Guest SSID | **BurgerAndSauce-Guest** (VLAN-Guest 70, Application: Hotspot, Captive Portal) |
| UniFi External Portal Server | `77.68.55.132` (UniFi only accepts an IP here) |
| Pre-Authorization Allowance | `location.hyperglow.co.uk` |
| Other apps on this VPS | studio-plt (:3000), bru_cafe (:3002), hyperglow-admin (:3010), wc-poller — **do not reuse their ports** |

Secrets (API key, webhook URL) live only in `/var/www/location/splash_page/BnS_Splash/.env`
on the VPS. `.env` is git-ignored — it is *not* in the repository.

---

## 4. Request flow in detail

1. Phone joins the SSID. The UniFi gateway tags it as an unauthorized guest.
2. Any HTTP request from the phone is intercepted; UniFi redirects it to
   `http://77.68.55.132/guest/s/default/?ap=<AP MAC>&id=<client MAC>&t=<ts>&url=<original>&ssid=<ssid>`.
3. nginx (default server block) 302-redirects to
   `https://location.hyperglow.co.uk/SplashPage/BnS/guest/s/default/?...` (same query string).
4. The Next.js route `app/guest/s/[site]/page.js` renders the form
   (`components/SplashForm.jsx`). The client MAC (`id` param) rides along in the URL.
5. On submit, the browser POSTs JSON to `/SplashPage/BnS/api/connect`
   (`app/api/connect/route.js`), which:
   - validates Email (required, format) and First Name (required); Birthday must be `DD/MM` if given;
   - POSTs the entry to the Google Apps Script webhook (**non-fatal** on failure —
     a Sheets outage never blocks a guest from getting online; failures are logged);
   - calls `lib/unifi.js → authorizeGuest(mac)`:
     `GET /sites` → resolve site id → `GET /sites/{id}/clients?filter=macAddress.eq('<mac>')`
     (with retries — a fresh device can take a few seconds to appear) →
     `POST /sites/{id}/clients/{clientId}/actions` with
     `{ "action": "AUTHORIZE_GUEST_ACCESS", "timeLimitMinutes": <AUTH_MINUTES> }`.
     All calls go through `https://api.ui.com/v1/connector/consoles/<CONSOLE_ID>/proxy/network/integration/v1`
     with header `X-API-Key`.
6. The form shows "You're connected!" and after ~4 s redirects the guest to their
   original destination (or `NEXT_PUBLIC_REDIRECT_URL`).

If the page is opened directly (no `id` param — e.g. testing in a normal browser),
the submission is still logged to the Sheet but UniFi authorization is skipped.
The server log line for this is `No client MAC in request — skipping UniFi authorization`.

---

## 5. Repository layout

```
BnS_Splash/
├── app/
│   ├── layout.js                 Root layout, metadata, global styles
│   ├── globals.css               Tailwind + HyperGlow background/glow styles
│   ├── page.js                   Splash form at /
│   ├── guest/s/[site]/page.js    Same form at /guest/s/<site> (UniFi's redirect target)
│   └── api/connect/route.js      POST endpoint: validate → Sheets → UniFi authorize
├── components/
│   └── SplashForm.jsx            The form UI + client-side validation + submit logic
├── lib/
│   └── unifi.js                  UniFi Integration API client (cloud proxy / direct)
├── apps-script/
│   └── Code.gs                   Google Apps Script webhook (copy into the Sheet)
├── ecosystem.config.js           pm2 definition (app name, port)
├── next.config.mjs               basePath comes from NEXT_PUBLIC_BASE_PATH
├── tailwind.config.js            Brand colors (glowviolet/glowcyan/glowpink)
├── .env.example                  Template for all environment variables
├── README.md                     From-scratch setup guide
└── DOCUMENTATION.md              This file
```

---

## 6. Configuration reference (`.env`)

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_SHEETS_WEBHOOK_URL` | yes | Apps Script web app URL (`.../exec`). Where form entries are POSTed. |
| `UNIFI_MODE` | yes | `cloud` (default; via api.ui.com proxy) or `direct` (straight to console — needs reachability). |
| `UNIFI_API_KEY` | yes | Ubiquiti account API key (unifi.ui.com → profile → API Keys). Inherits the creator's admin rights — treat like a password. |
| `UNIFI_CONSOLES` | cloud mode | One or more branches: comma-separated `consoleId\|Branch label` pairs (IDs from `GET https://api.ui.com/v1/hosts`). On submit, each console is checked for the guest's MAC; the matching one authorizes it, and the label is logged to the Sheet's Branch column. |
| `UNIFI_CONSOLE_ID` | legacy | Single-console form, used only if `UNIFI_CONSOLES` is empty. |
| `UNIFI_CONTROLLER_URL` | direct mode | `https://<console address>` — only if `UNIFI_MODE=direct`. |
| `UNIFI_SITE_ID` | no | Leave blank → first site is auto-detected (`default`). |
| `AUTH_MINUTES` | no | Guest session length in minutes. Default `1440` (24 h). |
| `NEXT_PUBLIC_REDIRECT_URL` | no | Fallback destination after connecting. Default `https://hyperglow.co.uk`. |
| `NEXT_PUBLIC_BASE_PATH` | no | Subpath the app is served under. Currently `/SplashPage/BnS`. **Changing it requires `npm run build`.** |

`NEXT_PUBLIC_*` variables are baked in at **build time** → rebuild after changing them.
The others are read at runtime → `pm2 restart hyperglow-splash --update-env` is enough.

---

## 7. Operations runbook

All commands run on the VPS as root (or with sudo), from
`/var/www/location/splash_page/BnS_Splash` unless stated.

### Day-to-day

| Task | Command |
|---|---|
| Check app status | `pm2 status` |
| Tail logs (live) | `pm2 logs hyperglow-splash` |
| Recent errors | `pm2 logs hyperglow-splash --err --lines 50` |
| Restart app | `pm2 restart hyperglow-splash` |
| Check port locally | `curl -I http://localhost:3020/SplashPage/BnS` → expect `200` |
| Check public URL | `curl -I https://location.hyperglow.co.uk/SplashPage/BnS` |
| nginx config test + reload | `sudo nginx -t && sudo systemctl reload nginx` |
| Certificate status | `sudo certbot certificates` (renewal is automatic) |

### Deploying a code update

```bash
cd /var/www/location/splash_page/BnS_Splash
git pull
npm install          # only needed if dependencies changed
npm run build        # required for any code or NEXT_PUBLIC_* change
pm2 restart hyperglow-splash
pm2 save
```

### Changing configuration

```bash
nano .env
# runtime vars (webhook, API key, AUTH_MINUTES):
pm2 restart hyperglow-splash --update-env
# NEXT_PUBLIC_* vars (base path, redirect URL):
npm run build && pm2 restart hyperglow-splash
```

### Rotating the UniFi API key (do this if it leaks, or before expiry)

1. unifi.ui.com → profile icon → **API Keys** → Create New API Key
   (scope: Site Manager + UniFi Applications; site: ROUTER-BNS-BH-PB only; longest expiry).
2. `nano .env` → replace `UNIFI_API_KEY`.
3. `pm2 restart hyperglow-splash --update-env`.
4. Submit a test signup from a guest device and confirm it gets online.
5. Revoke the old key at unifi.ui.com.

⚠ If the key has an expiry date, set a calendar reminder — an expired key means
guests can no longer be authorized (form will show "Could not activate your WiFi access").

### Changing how long guests stay online

`.env` → `AUTH_MINUTES` (e.g. `240` = 4 h) → `pm2 restart hyperglow-splash --update-env`.

### PM2 crash course for newcomers

pm2 keeps the app alive and starts it on boot. Gotchas learned the hard way:

- `pm2 start ecosystem.config.js` on an **already-known** app only *restarts* it
  with its **old** arguments. To apply a changed port/args:
  `pm2 delete hyperglow-splash && pm2 start ecosystem.config.js && pm2 save`.
- Always `pm2 save` after the process list looks right — that snapshot is what
  `pm2 resurrect` / a reboot restores.
- This VPS runs 4 other apps under pm2. Be careful with `pm2 delete all`,
  `pm2 update`, etc. If the daemon is ever wiped: `pm2 resurrect`.

---

## 8. Google Sheets integration

- The Sheet's webhook is a **container-bound Apps Script**: open the Sheet →
  Extensions → Apps Script. The code is a copy of `apps-script/Code.gs`.
- It's deployed as a **Web app**: Execute as *Me*, access *Anyone*. The `/exec`
  URL is what's in `.env`.
- Columns written: Timestamp, Email, First Name, Phone, Birthday (DD/MM),
  Device MAC, AP MAC, SSID. The header row is auto-created.
- **After editing the script you must publish a new version**
  (Deploy → Manage deployments → ✏️ → Version: New version → Deploy),
  otherwise the old code keeps running.
- Quick health checks:
  - Open the `/exec` URL in a browser → should return `{"ok":true,...}`.
  - `curl -sL -X POST <exec-url> -H "Content-Type: application/json" -d '{"email":"t@t.com","firstName":"T"}'`
    → `{"success":true}` + a row in the Sheet.
- Apps Script quota (free Google account) is ~20,000 URL-fetch calls/day —
  far beyond any store's signup volume.

## 9. UniFi configuration (per store router)

Where everything lives in the Network app (v10.x, via unifi.ui.com):

| Setting | Location | Current value |
|---|---|---|
| Guest SSID | Settings → WiFi | `BurgerAndSauce-Guest`, Application = **Hotspot**, Hotspot Type = **Captive Portal**, VLAN-Guest (70) |
| External Portal Server | Client Devices → Hotspot → Landing Page → One Way Methods → External Portal Server → Edit | `77.68.55.132` (**IP only** — the field rejects hostnames) |
| Pre-Authorization Allowances | Same Landing Page settings | `location.hyperglow.co.uk` (lets unauthorized guests load the splash page) |

The UniFi redirect always targets `/guest/s/<site>/` on the portal IP —
the nginx *default* server block turns that into the real splash URL.

**Adding another branch of the same brand** (same page, same Sheet):

1. Make sure the API key has access to the new console (account-level key
   scoped to "All sites", or re-scope it to include the new console).
2. On the new console, repeat the table above: guest SSID with
   Application = Hotspot, External Portal Server = `77.68.55.132`,
   pre-auth allowance `location.hyperglow.co.uk`.
3. Append the new console to `UNIFI_CONSOLES` in `.env`
   (`...existing...,NEWCONSOLEID|Branch label`) and
   `pm2 restart hyperglow-splash --update-env`.

No nginx or code changes needed — the server finds the guest's device on
whichever branch console it's connected to.

**Console API access** requires: UniFi OS ≥ 5.0.3 and Network app ≥ 9.1
(current: UniFi OS 5.1.19 / Network 10.4.57). No inbound ports are opened at
the store; everything rides Ubiquiti's cloud (`api.ui.com`).

---

## 10. Troubleshooting

| Symptom | Diagnosis | Fix |
|---|---|---|
| Splash page never appears on phones | Pre-auth allowance missing, or DNS/HTTPS issue | Verify `location.hyperglow.co.uk` is in Pre-Authorization Allowances; test `http://77.68.55.132/guest/s/default/?id=aa:bb:cc:dd:ee:ff` in a browser → must land on the form |
| Form submits, guest gets "Could not activate your WiFi access" | UniFi API failing | `pm2 logs hyperglow-splash` — look for `UniFi authorization failed`. Usual causes: expired/revoked API key (rotate, §7), console offline, wrong `UNIFI_CONSOLE_ID` |
| `Client aa:bb:.. not found on site` in logs | Device not visible to controller yet, or wrong console | Confirm the test device is on the guest SSID of *this* store's console; retry; check console in `GET /v1/hosts` |
| Rows missing in Sheet but guests get online | Webhook broken (by design non-fatal) | Logs show `Google Sheets logging failed: ...`; re-test webhook (§8); re-deploy new version of Apps Script |
| Page 404s | app down or nginx broken | `pm2 status`; `curl -I localhost:3020/SplashPage/BnS`; `sudo nginx -t` |
| App up but wrong port answering | Another VPS app owns the port | `sudo ss -tlnp \| grep <port>` — see inventory §3 for port map |
| Guests stuck on iPhone mini-browser | Captive-portal quirk | Usually resolves after the 4 s redirect; ensure the HTTPS cert is valid |
| Everything broken after VPS reboot | pm2 didn't resurrect | `pm2 resurrect`; verify with `pm2 status`; then `pm2 save` |

## 11. Security & data protection

- **Secrets**: only in `.env` on the VPS (never committed). The UniFi API key
  grants admin over the console — rotate immediately if exposed.
- **Personal data (GDPR)**: the Sheet contains names, emails, phone numbers and
  birthdays of UK customers collected for marketing. Restrict Sheet access to
  those who need it; honour deletion requests (delete the row); consider adding
  a privacy-policy link on the splash page footer.
- **Network**: the app listens only on localhost:3020; nginx terminates TLS.
  The store network exposes no inbound ports.
- The splash page states guests agree to receive updates from HyperGlow —
  keep marketing use within that consent.

## 12. Roadmap — multi-store (planned, not yet built)

When a second store comes online, the plan agreed with the owner:

- Upgrade the app once to **multi-tenant**: a `stores.json` maps a store slug to
  `{ name, logo, colors, consoleId, sheetsWebhook }`. One running instance serves
  all stores; each store's router points at the same VPS (distinguished by port
  or AP MAC), each store gets its own branding and its own Google Sheet.
- Adding store N then = create Sheet (§8) + add JSON entry + configure the new
  console's hotspot (§9). No new deployments.

Until then, the interim option is one app copy per store (clone, own `.env`,
own port, own nginx block) — identical branding only.

---

*Document maintained alongside the code. Update §3 (inventory) whenever
infrastructure changes — it's the section a newcomer needs most.*
