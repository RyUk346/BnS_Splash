# Data Sanitisation

How guest WiFi data is cleaned before it reaches the admin dashboard.

## The principle

The **first tab** of the Google Sheet is an append-only record of exactly what
guests submitted. It is never edited. Cleaning produces a **separate `Clean`
tab**, and every dropped row is listed in a **`Removed`** tab with its reason —
so the process is reversible and auditable.

```
Guest submits → raw tab (never modified)
                   ↓  Cleanup.gs, every 15 min
                Clean tab  →  admin dashboard
                Removed tab (audit of what was dropped, and why)
```

If the `Clean` tab is missing or empty, the dashboard falls back to the raw tab
rather than showing nothing.

## What gets fixed

| Fix | Detail |
|---|---|
| **Emails** | Trimmed and lowercased, so `Bob@Gmail.com` and `bob@gmail.com` count as one guest |
| **Phones** | UK numbers normalised to `07…` (`+447…`, `0044…`, spaces and brackets all collapse); international numbers keep their `+` and country code |
| **Store backfill** | Rows with no Branch get one, inferred from the AP MAC they connected through — recovered ~17 previously unattributed rows |
| **Device Name** | Cells containing a raw MAC address (from an earlier bug) are blanked |
| **Ordering** | Rows sorted chronologically |

## What gets removed

| Removed | Rule |
|---|---|
| **Duplicate submits** | Same device registering twice within 5 minutes — keeps the first. These came from a double-submit bug and inflated counts by ~4% |
| **Our own test rows** | `webhook@`, `curltest@`, `test@test.*`, `@example.com`, and the portal test addresses used during setup |
| **Malformed emails** | No `@` or no `.` |

## What is deliberately NOT removed

**A junk email is not a junk visit.** A guest who typed `s@hotmail.com` still
walked in, connected and stayed 31 minutes — that visit belongs in the
footfall, dwell and daypart figures. Short, odd or lazy-looking addresses are
therefore **kept**; filter them at send time, not here.

Also left alone:

- **Suspected typo domains** (`gmaiil.com`) — flagged in the dashboard's data
  quality panel, never auto-corrected. Changing someone's address is a guess.
- **Old `DD/MM` birthdays** — the year was never collected, so it can't be
  recovered. Newer records store `DD/MM/YYYY`.
- **Missing phone numbers** — the field is optional by design.

## Running it

In the Sheet: **Extensions → Apps Script**.

| Function | When |
|---|---|
| `buildCleanTabs` | Manually — rebuilds both tabs and shows a summary |
| `installCleanupTrigger` | **Once** — schedules an automatic rebuild every 15 minutes |
| `removeCleanupTrigger` | To stop the automatic rebuild |

Safe to re-run at any time: both tabs are recreated from scratch.

## Verifying it's working

The admin header shows a green **`cleaned`** badge next to the record count, with
the last rebuild time on hover. No badge means the dashboard is reading raw
data — check that the `Clean` tab exists and the trigger is installed.

## Two things to watch

- **Up to ~16 minutes of lag** on new signups reaching the dashboard (15-minute
  rebuild plus a 60-second server cache). Fine for analysis; not live.
- **Cleaning hides the duplicate-submit symptom, not its cause.** If new
  duplicates keep appearing in the `Removed` tab, the fix belongs in the splash
  page rather than the cleanup script.

## Also cleaned at read time

Independently of the above, the dashboard applies **one row per device per
calendar day** — repeat connections on the same day are merged into a single
visit, with the earliest connect time, latest disconnect and summed duration.
That happens in `lib/analytics.js` and applies whichever tab is being read.
