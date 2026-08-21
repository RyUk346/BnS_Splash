# Adding a New Store (Router)

Checklist for bringing another **Burger & Sauce** branch onto the guest WiFi
splash page. Takes ~15 minutes. No code changes, no rebuild.

> Adding a **different brand** (not Burger & Sauce) is a different job — the
> splash page is hardcoded to B&S branding and one Google Sheet. See
> "Different brand?" at the bottom.

---

## Before you start

Have to hand:

- Access to [unifi.ui.com](https://unifi.ui.com) with the new console adopted
- SSH access to the VPS (`77.68.55.132`)
- The current API key (in `.env` as `UNIFI_API_KEY`)

---

## Step 1 — Configure the hotspot on the new console

On unifi.ui.com, switch to the new console (console picker, top-left).

**1a. Create the guest WiFi**
*Settings → WiFi → Create New*

| Setting | Value |
|---|---|
| Name | e.g. `BurgerAndSauce-Guest` (same name across stores is fine) |
| Password | Open, or a simple shared password — your choice |
| **Application** | **Hotspot** ← critical, not "Standard" |
| Hotspot Type | **Captive Portal** |
| Broadcasting APs | All |

**1b. Point the portal at the VPS**
*Client Devices → Hotspot → Landing Page → One Way Methods*

- Tick **External Portal Server** → **Edit** → enter `77.68.55.132`
  (IP only — the field rejects hostnames)
- **Better option** (matches Castle Vale, avoids certificate warnings):
  tick **Domain**, enter `location.hyperglow.co.uk`, keep **Secure Portal**
  ticked, and **untick "HTTPs Redirection Support"**

**1c. Pre-Authorization Allowances**
In the same Landing Page settings, add:

```
location.hyperglow.co.uk
```

Save everything.

---

## Step 2 — Get the console ID

The API key must be able to reach the new console. If the key is scoped to
**All Sites** (current key `splash-page-v3` is), skip ahead — otherwise add the
new store to the key's Sites list at unifi.ui.com → profile → API Keys.

On the VPS, list your consoles and find the new one's ID:

```bash
cd /var/www/location/splash_page/BnS_Splash

# All consoles with their names
curl -s https://api.ui.com/v1/hosts -H "X-API-Key: $(grep '^UNIFI_API_KEY=' .env | cut -d= -f2)" \
  | tr ',' '\n' | grep -E '"id"|"name"' | head -40
```

Console IDs start with the gateway's MAC. If you know the MAC, grab it directly:

```bash
curl -s https://api.ui.com/v1/hosts -H "X-API-Key: YOUR_KEY" | grep -o '"id":"6C63F8XXXXXX[^"]*"'
```

**Verify the key can reach it** (replace `NEW_CONSOLE_ID`):

```bash
curl -s "https://api.ui.com/v1/connector/consoles/NEW_CONSOLE_ID/proxy/network/integration/v1/sites" \
  -H "X-API-Key: YOUR_KEY"
```

- Site list returned → good, continue
- `{"code":"forbidden"}` → the key isn't scoped to this console. Fix the key's
  Sites scope (or create a new key with **All Sites**) before continuing.

---

## Step 3 — Add the store on the VPS

```bash
cd /var/www/location/splash_page/BnS_Splash
nano .env
```

Add **one new line** for the store — that's the whole change:

```env
UNIFI_CONSOLE_4=NEW_CONSOLE_ID|BnS Merry Hill
```

Use the next free number (any number works, and gaps are fine). The label
after `|` is what appears in the Sheet's **Branch** column and in the admin
dashboard sidebar — use a readable store name.

> Older `.env` files list every console on one comma-separated
> `UNIFI_CONSOLES=` line. That still works, and you can mix both forms —
> duplicates are ignored. New stores are easier to add as numbered lines.

Apply it — no rebuild needed, env-only change:

```bash
pm2 restart hyperglow-splash --update-env
```

---

## Step 4 — Test

1. On a phone at the new store, join the guest SSID.
2. The splash page should pop up automatically (if not, open any http site
   such as `neverssl.com` to trigger it).
3. Fill the form → it should connect and redirect to burgerandsauce.com.
4. Check the Google Sheet: the new row should show your store label in the
   **Branch** column.
5. The store appears in the admin dashboard sidebar automatically.

Watch the logs while testing:

```bash
pm2 logs hyperglow-splash --err --lines 20
```

Clean = working. `Client … not found on any configured console` = the console
ID is missing/wrong in `.env`, or the key can't reach it (redo Step 2).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Could not activate your WiFi access" | Console not in `UNIFI_CONSOLES`, or API key not scoped to it | Redo Steps 2–3 |
| `forbidden` from the verify curl | API key's Sites scope excludes this console | Recreate key with **All Sites** |
| Splash page never appears | Missing pre-auth allowance, or portal address wrong | Recheck Step 1b/1c |
| Certificate warning on the phone | Console redirects to `https://<IP>` | Use the **Domain** option in Step 1b, untick HTTPs Redirection Support |
| Branch column shows a long hex string | Missing `\|Label` on the console entry | Add `\|Store Name` in `.env`, restart |
| Row never appears in the Sheet | Sheets webhook broken (affects all stores) | `curl -sL "<GOOGLE_SHEETS_WEBHOOK_URL>"` should return `{"ok":true,...}`; if not, re-copy the `/exec` URL from Apps Script → Manage deployments |

---

## Quick reference — VPS commands

```bash
cd /var/www/location/splash_page/BnS_Splash

nano .env                                   # edit config
pm2 restart hyperglow-splash --update-env   # apply .env changes (no rebuild)
pm2 logs hyperglow-splash --err --lines 20  # errors
pm2 status                                  # app + poller state

# after a CODE change (git pull), rebuild is required:
git pull && npm install && npm run build && pm2 restart hyperglow-splash
```

**Rule of thumb:** `.env` change → restart only. Code change → `npm run build`
then restart.

---

## Different brand?

Adding a non-B&S brand needs development work, not just config. Today the
splash page hardcodes: the B&S logo, the redirect to burgerandsauce.com, the
privacy-policy link, the consent wording, and a single Google Sheet.

The planned approach (see `DOCUMENTATION.md` §12) is a `brands.json` mapping
each brand to its logo, colours, redirect, Sheet webhook and console list,
served under `/SplashPage/<brand>`. Roughly a day's work, after which new
brands become config-only too.
