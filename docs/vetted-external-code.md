# Vetted External Code Registry

The whitelist for THIS project. Every external artifact admitted gets a
row AFTER passing the External Code Vetting Protocol (run via `/vet`).
**In the environment but not listed here = unvetted → vet or remove.**

Verdicts: 🟢 approved · 🟡 approved-with-conditions · 🔴 rejected (do-not-retry record).

| Date | Artifact | Source (canonical) | Pinned version/SHA | Tier | Scanners run | Verdict | Conditions / notes |
|---|---|---|---|---|---|---|---|
| 2026-07-26 | `stripe` (official Stripe Node SDK) | npm `stripe` — github.com/stripe/stripe-node (owner: Stripe) | `^22.2.1` | official first-party | trusted-by-provenance (Stripe's own SDK) | 🟢 | Official SDK, already a direct dep in furrybooth + chattysticker (same `^22.2.1`); added here as an **optional peer** dep for the new Stripe module. Money code. Approved by Albert (official-SDK condition). |

## Rejected log

(none yet)

## Last upstream sweep

(never)
