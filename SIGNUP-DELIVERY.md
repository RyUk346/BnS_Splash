# Signup Delivery

How every guest signup is guaranteed to reach the Google Sheet, exactly once.

## The problem this solves

The Sheet write used to happen while the guest waited. That made it slow
(Apps Script cold-starts in 1–3 seconds) but at least a failure was visible.
Moving it off the critical path to speed up connections created a new risk: a
crash, a restart or a Sheets outage between the response and the write would
silently lose a signup.

Worse, the old code couldn't actually tell whether a write had worked. Apps
Script answers a `POST` with a 302 redirect to its own output URL, and that
second hop frequently fails even when the row was written. So the result was
untrustworthy **in both directions**:

| What it looked like | What may have happened | Old behaviour |
|---|---|---|
| Failed | Row was written | Retry → **duplicate row** |
| Succeeded | Script threw, nothing written | Discard → **signup lost** |

## How it works now

```
guest submits
   │
   ├─► queued to data/pending-sheet.json      ← on disk BEFORE the response
   │
   ├─► guest gets their WiFi and is redirected
   │
   └─► background: append row ──► read back to confirm ──► clear from queue
                                        │
                                    not confirmed?
                                        │
                                  stays queued, retried
                                  by the poller every 3 min
```

Four things make the guarantee hold:

1. **Queued to disk before responding.** A local synchronous write, measured
   in microseconds. This happens even when UniFi authorization fails — that's
   precisely when a guest retries repeatedly, and losing their details every
   time would be the worst moment to do it.
2. **The append is idempotent.** `Code.gs` checks for an existing row with the
   same timestamp before appending, so a retry can't duplicate.
3. **Confirmation by read-back, not by the POST result.** A `GET` asks the
   Sheet which timestamps are actually present. GET responses come back
   cleanly — it's how the dashboard reads rows. An entry is only removed from
   the queue once the row is confirmed there.
4. **Retries run on a schedule.** The session poller (pm2 cron, every 3
   minutes) drains the queue whether or not anyone is using the WiFi. The web
   app also flushes immediately after each signup, but that's an optimisation
   to get the row in within seconds — not what guarantees it lands.

Nothing is ever dropped. A queued entry is a few hundred bytes, so even a
week-long outage is a few megabytes — far cheaper than a lost customer.

## Deploying this

**The Apps Script must be redeployed.** Two things were added to `Code.gs`:
the duplicate check in `doPost`, and the `verify` action in `doGet`.

In the Sheet: **Extensions → Apps Script**, paste the current
`apps-script/Code.gs`, then **Deploy → Manage deployments → edit → Deploy**.
Redeploying the existing deployment keeps the same URL, so no `.env` change
is needed.

If you deploy the server first and forget the script, nothing breaks: the
server detects the missing `verify` action, logs

```
Apps Script has no 'verify' action — redeploy apps-script/Code.gs to
guarantee every signup lands. Falling back to unverified appends.
```

and reverts to the old best-effort behaviour until you redeploy. Rows still
get written; they just aren't confirmed.

`data/` must be writable by the pm2 user — that's where the queue lives.

## Checking it's working

The admin dashboard shows a banner whenever anything is waiting:

> **3 signups not yet on the sheet** — saved on the server and retried every
> 3 minutes, so nothing is lost. They should appear within a few minutes.

Seeing this briefly after a busy period is normal. It turns red if the oldest
entry has been waiting over an hour, which means the Sheet connection needs
attention rather than more patience.

From the VPS:

```bash
# What's waiting (contains guest PII — don't paste it anywhere)
cat data/pending-sheet.json | head -40

# What the poller did on its last runs
pm2 logs hyperglow-poller --lines 50 | grep "sheet sync"
```

A healthy poller run logs nothing about the sheet when the queue is empty.

## Two things to watch

- **The queue file holds guest PII** (names, emails, phones, birthdays) until
  each row is confirmed. `data/` is git-ignored and must stay that way. Treat
  it like the Sheet itself under GDPR.
- **Only one web worker may own the queue.** `ecosystem.config.js` runs
  `instances: 1` in fork mode, which is required — two workers would each
  hold their own view of the file and overwrite each other. Don't scale that
  process without moving the queue to something transactional.
