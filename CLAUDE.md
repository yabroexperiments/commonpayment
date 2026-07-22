# CLAUDE.md — commonpayment

> Shared payment-processor package for the yabroexperiments portfolio.
> Sibling to `commongenerator`. Lives at `Projects/commonpayment/`
> because it's used by apps OUTSIDE `PetBusiness/` too (e.g. SkinIQ
> under `Projects/SkincareDB/`, LINEgashelper under
> `Projects/LINEgashelper/`).

---

## Who I Am

- Name: Albert, non-technical founder based in Taiwan
- I make product decisions and write prompts. You write all the code.
- Always explain what you're doing in plain language before doing it.
- If there are multiple ways to do something, tell me the tradeoffs simply and recommend one.
- Ask me before installing new dependencies or making big structural changes.

---

## What this package is

A storage-agnostic payment integration for Taiwan's two major
payment aggregators: **ECPay (綠界)** and **藍新 (NewebPay)**.

Consumers (any yabroexperiments app that needs to take money from
TW customers) install this via `npm install
github:yabroexperiments/commonpayment`, pick a provider name from
their own storage / env, and call `createProvider(name)` to get a
common `PaymentProvider` interface for building orders + verifying
callbacks.

Same install / version-bump pattern as `commongenerator`:
```bash
npm install commonpayment   # re-resolves #main, regenerates lockfile
git add package-lock.json
git commit -m "Bump commonpayment to <sha> (<reason>)"
```

---

## Why standalone (not under PetBusiness)

`commongenerator` lives under `PetBusiness/` because only the pet
products use it. **`commonpayment` is at `Projects/` root** because
it's used across the whole portfolio:

| Project | Path | Will use commonpayment? |
|---|---|---|
| gogoLINEsticker | `PetBusiness/gogoLINEsticker/` | ✅ first consumer (live) |
| gogo-gallery (FurryBooth) | `PetBusiness/狗狗畫廊/gogo-gallery/` | ✅ planned (v2 POD checkout) |
| LINEgashelper | `LINEgashelper/` | ✅ planned (NT$120/yr) |
| yabrostudio-com | `yabrostudio-com/` | ✅ planned (hosts LINEgashelper sales) |
| SkinIQ / SkincareDB | `SkincareDB/` | ✅ planned (NT$299/yr Phase 1; was Stripe, can use ECPay too) |
| Future portfolio apps | `Projects/<name>/` | ✅ default for any TW-payment-collecting app |
| commongenerator | `PetBusiness/commongenerator/` | ❌ N/A (image-gen only, no payment) |
| PetPlaces / DogRating / non-revenue apps | various | ❌ free tools |

This is why the package lives at portfolio root, not under any
umbrella.

---

## Layout

```
commonpayment/
├── src/
│   ├── index.ts        — public API: createProvider, isProviderName, type exports
│   ├── types.ts        — PaymentProvider interface, shared types
│   ├── ecpay.ts        — EcpayProvider (CheckMacValue SHA256)
│   └── newebpay.ts     — NewebpayProvider (AES-256-CBC + TradeSha SHA256)
├── dist/               — compiled output (gitignored; rebuilt on `npm install`)
├── package.json        — exports = ./dist/index.js + ./dist/index.d.ts
├── tsconfig.json       — TS5, NodeNext, strict
├── README.md           — public-facing intro
├── INTEGRATION_GUIDE.md — full step-by-step for new consumers
├── LICENSE             — MIT
├── CLAUDE.md           — this file
└── AGENTS.md           — symlink to CLAUDE.md
```

---

## What the package does NOT do

- ❌ Read your DB (Supabase / Postgres / etc.) — you decide which
  provider to use, then call `createProvider(name)`
- ❌ Provide Next.js / Express / Hono adapters — consumers wire the
  pure-TS exports into their own framework
- ❌ Provide DB schema — consumers define their own `applications`
  / `orders` table; see `INTEGRATION_GUIDE.md` §6 for the suggested
  shape
- ❌ Handle e-invoices (電子發票) — separate concern; v1 might add
  an `InvoiceProvider` sibling interface later
- ❌ Automate refunds — out of scope; refund via each provider's
  merchant backend or their separate refund API

---

## Provider differences hidden behind the interface

| | ECPay | NewebPay |
|---|---|---|
| Signature | `CheckMacValue` (single SHA256 over sorted+.NET-encoded params) | `TradeInfo` (AES-256-CBC hex) + `TradeSha` (SHA256 hex) |
| Outbound params | ~12 plain form fields | 4 fields (MerchantID + Version + encrypted TradeInfo + TradeSha) |
| Callback ack | Literal `1\|OK` (3-day retry if anything else) | HTTP 200 (any body) |
| `ReturnURL` semantic | Server-to-server callback | Browser landing (!! opposite of ECPay) |
| Server callback param | `ReturnURL` | `NotifyURL` |
| Order-ID limit | 20 chars alphanumeric | 30 chars alphanumeric + `_` + `-` |
| Credit-card fee | 2.88% | 2.8% |
| Individual seller cap | NT$300k / 30 days | NT$200k / 30 days |
| Test card | 4311-9522-2222-2222 / 01/30 / 222 | 4000-2211-1111-1111 |

The `PaymentProvider` interface normalises all of this — consumers
get the same `buildOrder` / `verifyCallback` / `formatAck` /
`generateMerchantOrderId` API for both.

---

## Cross-project rules (per `~/.claude/CLAUDE.md` global memory)

### Sync protocol

This is a public GitHub repo (`yabroexperiments/commonpayment`).
Standard git protocol:

**Session start:**
1. `git pull --ff-only origin main`
2. Check what's untracked / uncommitted

**Session end:**
1. Write `.handoffs/YYYY-MM-DD-<task>.md` if substantial work landed
2. Commit + push to `main` (no feature branches needed for tiny package — direct-to-main is fine for ~5-line edits)
3. For any consuming app, also bump its lockfile via
   `npm install commonpayment` + commit there

### AGENTS.md ↔ CLAUDE.md symlink

`AGENTS.md` is a symlink to `CLAUDE.md`. Same convention as every
yabroexperiments repo — both filenames resolve to the same content.
If `AGENTS.md` ever becomes a regular file (atomic-save tool broke
the symlink), fix with:

```bash
rm AGENTS.md && ln -s CLAUDE.md AGENTS.md
```

### Don't `git add -A`

Stage by path. Past leaks of `.env.local.bak` across the portfolio
prove this matters.

### Commit message convention

HEREDOC body, end with:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Versioning + release

**v0.x — install from `#main` only.** Consumers use
`npm install github:yabroexperiments/commonpayment` which pins to
the current main HEAD. Lockfile bumps pull new commits.

**No npm publish yet.** Private install-from-git is enough for the
portfolio; can publish to npm later if external consumers ever
appear (unlikely for a portfolio-internal package).

**Breaking changes are discouraged.** Add new types/exports rather
than break existing ones — each consumer's lockfile bump shouldn't
require code changes unless we're shipping intentional
deprecations.

---

## Open work items

- **Live production credentials:** both adapters have sandbox creds
  baked in. Production creds come from the consumer's Vercel env —
  per provider, per consumer. Coordinated via each consumer's own
  `.env.local.example`.
- **gogoLINEsticker migration:** the first consumer was using
  in-tree `src/lib/payment/` before this package existed. That code
  is the source of these files; after this package ships, the
  consumer's in-tree copy gets replaced with `npm install
  commonpayment` + import-path rewrites. See the parent session's
  handoff for the cutover commit.
- **Future consumers** (gogo-gallery, LINEgashelper, SkinIQ) add
  this package as they cross their first revenue line. No work to
  do here ahead of time — each consumer wires it up itself per
  `INTEGRATION_GUIDE.md`.

---

## Session start checklist (when working on commonpayment itself)

1. `git pull --ff-only`
2. Check which consumers are pinned to which commit:
   ```bash
   grep -r '"commonpayment"' ~/Documents/ClaudeCodex/Projects/*/package-lock.json
   ```
3. Look at the latest handoff (`.handoffs/` if any exist).
4. Make changes — preserve backward compat on the `PaymentProvider`
   interface unless intentionally shipping a breaking change.
5. `npm run build && npm run typecheck` to verify clean.
6. Push to `main`.
7. In any consumer that should pick up the change: `npm install
   commonpayment` + commit the lockfile bump.

---

## Where this came from

Originally the code lived in-tree at
`PetBusiness/gogoLINEsticker/app/src/lib/payment/` after the
2026-05-30 in-tree refactor (commit `cc87b6a`). Extracted to a
standalone repo per Albert's spec on 2026-05-30 evening: "this
commonpayment is a level higher than the common generator … under
the Projects as other projects in the level of PetBusiness may
also collect payments in the future."

Original design doc:
`~/Documents/ClaudeCodex/docs/PAYMENT_PROCESSOR.md`.



<!-- ECVP:BEGIN (managed by install-vet-protocol.sh — edit the yabro-hq copy, then re-run) -->
> **🛡️ EXTERNAL CODE VETTING PROTOCOL — mandatory, ALL projects
> (Albert, 2026-07-21).** NO external skill / plugin / MCP server /
> package / prompt / workflow enters any environment without passing
> the ECVP pipeline (run via **`/vet <url>`**; full spec in
> `docs/external-code-vetting-protocol.md` in this repo, or
> `~/.claude/docs/` for the global copy). Pipeline: intake
> (true-owner/typosquat check, trust tier) → scan (SkillSpector for
> skills, mcp-scan for MCP, Socket+OSV for packages) → full-file
> analysis (scanners are bypassable — a scan pass alone is NEVER a
> green light) → quarantine test in a secret-free throwaway session →
> merge pinned to exact SHA + row in the project's
> `docs/vetted-external-code.md` registry (present but unlisted =
> unvetted) → monitor (updates are new vettings). Hard rules: secrets
> and unvetted code never meet; unknown author + wants
> network/auth/secrets = automatic reject; Albert reads only
> plain-English GREEN/YELLOW/RED verdicts and makes the go/no-go call.
<!-- ECVP:END -->
