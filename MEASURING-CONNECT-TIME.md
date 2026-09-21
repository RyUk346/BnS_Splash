# Measuring Connect Time

Every guest connection now logs where its time went. Use this instead of
guessing — the guessing was wrong by about 5x.

## Read the numbers

On the VPS:

```bash
# Last 30 connections, newest at the bottom
pm2 logs hyperglow-splash --lines 400 --nostream | grep "connect total=" | tail -30
```

Match on `connect total=`, not `"timing connect"` — pm2 prefixes each line and
the text is `[timing] connect`, so the bracket sits between the two words and
a `timing connect` pattern silently matches nothing.

Each line looks like:

```
[timing] connect total=1840ms find=620ms auth=580ms waited=250ms tries=2 hinted=true branch="BnS Perry Barr"
```

| Field | Meaning | If it's the big number |
|---|---|---|
| `total` | whole `/api/connect` request | — |
| `find` | locating the device on a console | the UniFi lookup is slow, or the device isn't visible yet |
| `auth` | the `AUTHORIZE_GUEST_ACCESS` call | pure round-trip time to `api.ui.com` |
| `waited` | our own retry sleeps | the device took several tries to appear |
| `tries` | attempts needed | `1` is ideal; `3+` means UniFi is slow to list new clients |
| `hinted` | did the AP→console cache hit? | `false` on every line means the cache isn't being populated |

And for the post-connect check:

```bash
pm2 logs hyperglow-splash --lines 400 --nostream | grep "status total=" | tail -20
```

```
[timing] status total=410ms authorized=true scoped=true
```

`scoped=true` means it queried one console rather than searching all of them.

## Work out the round-trip time

`auth` is a single request to `api.ui.com`, so it *is* your round-trip time.

```bash
# Median auth time across recent connections
pm2 logs hyperglow-splash --lines 600 --nostream | grep -o 'auth="[0-9]*' |
  grep -o '[0-9]*' | sort -n | awk '{a[NR]=$1} END {print "median auth RTT:", a[int(NR/2)] "ms"}'
```

**Measured on 21 Sep 2026: 465ms.** That's the floor for anything that needs
a UniFi call, and every stage below is a multiple of it.

Everything scales with this number. Under ~400ms, connections should feel
instant. Over ~1.5s and the cloud path itself is the bottleneck — at that
point the fix is UniFi's **local** portal or a direct connection to the
consoles, not more application tuning.

## The whole-guest view

Server logs cover our side. What the guest experiences also includes:

1. the splash page loading,
2. `/api/connect` (the `total` above),
3. the brief online check (≤1.2s),
4. **burgerandsauce.com loading over a freshly opened connection.**

Point 4 is not instrumented and is not ours, but a guest counts it as
"connecting". If `total` is ~2s and the guest still reports 15s, that's where
to look next — time it with DevTools on a phone, or temporarily point
`NEXT_PUBLIC_REDIRECT_URL` at a trivial page and compare.

## Deliberate waits still in the code

All of these are ceilings, not fixed costs — a normal connection hits none of
them.

| Wait | Value | Why it exists |
|---|---|---|
| Online check budget | 1200ms | Confirms the network really opened before redirecting |
| Online poll interval | 300ms | Gap between those checks |
| Retry gap | 250ms | A just-joined device isn't listed by UniFi instantly |
| Lookup budget | 5000ms | Stops a dead console holding the guest indefinitely |
| Request timeout (guest) | 6000ms | A console that hasn't answered by then won't |
| Request timeout (poll) | 3000ms | Longer is pointless; the client gives up at 1.2s |
| Email MX check | 2500ms | Normally prefetched while the guest fills the form |

Worst case if everything goes wrong: about **2.2 seconds** of deliberate
waiting, down from 11.3s.
