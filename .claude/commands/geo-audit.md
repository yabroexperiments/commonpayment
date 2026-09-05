# /geo-audit — audit a project's serving geography (and fix it)

Purpose: find every service a project talks to on the request path, learn WHERE
each one actually runs, and co-locate them so users stop paying for geography.

Our users are in **Taiwan**. Vercel's default function region is **iad1 (US East)**.
Every project that has never set `"regions"` is therefore serving Taiwan from
Virginia — and if its database is in Asia, each server-rendered page pays two
trans-Pacific crossings (~400–600ms of pure geography, per serial query).

Run this on any project: existing, or right before the first deploy of a new one.

---

## 1. Inventory the request path (do this FIRST — it decides the answer)

List every service a *user-facing request* touches, and mark which ones the
function talks to **serially** (query → wait → query again):

| Layer | Where to look |
|---|---|
| Functions / SSR | Vercel project (or Render / Cloudflare / Fly) |
| Primary DB | Supabase / Postgres / Turso |
| Object storage / CDN media | Cloudinary, S3, R2, Supabase Storage |
| Long-running workers | Render, Railway, a separate engine repo |
| Webhook senders with a timeout contract | LINE (~1s ack), Stripe, ECPay |
| Third-party APIs on the hot path | AI inference, maps, mail |

## 2. Read the ACTUAL region of each — never the config file

A config file is not runtime truth. **An absent `"regions"` key means `iad1`,
and the file never says so.** Read the running record:

- **Vercel** — Vercel MCP `list_deployments` → the newest with `target: "production"`
  (the newest deployment overall is often a *preview*: `target: null`) →
  `get_deployment` → report `regions`. Cross-check `state: "READY"` and that the
  production alias points at your commit's SHA.
- **Supabase** — MCP `get_project` → `region` (e.g. `ap-northeast-2`).
  ⚠️ `list_projects` / `list_organizations` only show the org the token is
  connected to. On 2026-08-21 they returned exactly ONE project while
  `get_project` happily resolved a ref in another org. **Take the ref from the
  project's own env/config and `get_project` it — never infer the DB from the
  inventory list, and never inherit a sibling project's region.**
- **Render / others** — the service's own dashboard or config; record the region
  string verbatim.

## 3. Decide the function's region — in this priority order

1. **Serial data store wins.** If the hot paths issue 2+ *serial* round trips per
   render (select → status → re-select), put the function in the DB's region.
   Client→function is ONE round trip; DB round trips multiply.
2. **No data store? Follow the tightest timeout contract.** A LINE webhook relay
   must ack within ~1s and touches no DB — it belongs near LINE (`hnd1`), not
   near Postgres.
3. **Neither? Follow the users** (Taiwan). Only worth doing if the project has
   server-rendered or API routes at all.
4. **Fully static site → change nothing.** It is served from the edge CDN in
   every region already. Report that and stop.

Region codes verified in our own production deployment records:

| Backing store region | Vercel region | Notes |
|---|---|---|
| `ap-northeast-2` Seoul | `icn1` | dograting, sing-for-you, flight-scanner |
| `ap-northeast-1` Tokyo | `hnd1` | petplaces-taiwan; also the LINE-webhook choice (famchat relay) |
| `ap-southeast-1` Singapore | `sin1` | gogolinesticker |
| (US East default) | `iad1` | what you get by writing nothing |

Any other code: check Vercel's current region list before using it.

## 4. Apply

Add to `vercel.json`, preserving existing keys (`crons`, `functions`, headers…):

```json
{ "regions": ["icn1"] }
```

- **Hobby plan allows exactly ONE region — never list two.**
- `vercel.json` is schema-validated and takes **no comment keys**. A `"// note"`
  key fails the build; the rationale goes in the commit message.
- **Never touch payment/checkout/callback code while editing region config.**
- Commit message records: before region → after region, the DB region, and why.

## 5. Verify with data, not with the config you just wrote

After the deploy: fetch the new **production** deployment record and confirm
`regions` is the intended one, `state: "READY"`, and the production alias serves
your commit's SHA. Reading the config field back proves nothing.

Note for cloud/remote sessions: `curl` to our own domains is blocked by the
egress proxy (exit 56 / http 000) and looks exactly like an outage. Verify
through the Vercel MCP instead.

## 6. Report

Per project: function region before/after · store region(s) · which routes
benefit · anything latency-sensitive that MOVED WITH the function and might
care — flag it, do not change it. Examples: webhooks with tight timeout
contracts, third-party APIs pinned to a US region, an inference provider with
no Asia endpoint.

Then record the decision in the project's `CLAUDE.md` per its conventions, so
the next session does not re-derive it.
