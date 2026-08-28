# Method — Van Westendorp Price Sensitivity Meter (PSM)

**Status**: canonical method reference — the depth behind `../SKILL.md`. It lives inside the
skill so the skill travels as one self-contained unit: a machine, a product repo, or a
claude.ai account upload all get the method with it. Inside HQ: owned by `cfo-analyst`
(interpretation + ruling), executed with `market-researcher` (price evidence) and
`customer-voice` (segment reading). Created 2026-08-21.

**Propagation**: `scripts/install-vet-protocol.sh` ships the whole skill directory
(`--global` per machine → `~/.claude/skills/pricing-psm/`, `--repo <path>` per product repo).
For every session on every surface including claude.ai, upload the directory as a custom
account skill. This yabro-hq copy is the master — edit here, then re-propagate.

**HQ agents cannot invoke the skill** (no agent has the Skill tool): they `Read` this file
directly. Keep the path stable — `cfo-analyst`, `market-researcher` and `customer-voice`
all point at it by name.

---

## 1. The four questions

Ask in this order. Free-numeric answers, no scale, no anchoring examples, currency stated.

| # | Label | EN wording | zh-TW wording |
|---|---|---|---|
| 1 | **Too cheap** (TC) | At what price would this be so cheap you'd doubt its quality? | 多少錢會讓你覺得「這麼便宜，品質一定有問題」？ |
| 2 | **Bargain / cheap** (C) | At what price is this a bargain — clearly good value? | 多少錢會讓你覺得「這個價格划算，賺到了」？ |
| 3 | **Expensive but justifiable** (E) | At what price does it start to feel expensive, but you'd still buy? | 多少錢開始覺得「有點貴」，但你還是會買？ |
| 4 | **Too expensive** (TE) | At what price is it so expensive you wouldn't consider it? | 多少錢會讓你覺得「太貴了，不考慮」？ |

Show the product FIRST (the actual preview, the real deliverable, the real photo) — a PSM
run on a description prices the description, not the product.

**Validity filter**: a respondent is only usable if `TC < C < E < TE`. Drop the rest and
report how many you dropped (5–15% is normal; >25% means the questions or the product
description confused people — fix that before trusting anything).

---

## 2. Building the curves

Sort every distinct price mentioned, low → high. At each price point X compute:

| Curve | Definition | Direction |
|---|---|---|
| Too cheap | % of respondents whose TC ≥ X | descending |
| Bargain | % of respondents whose C ≥ X | descending |
| Expensive | % of respondents whose E ≤ X | ascending |
| Too expensive | % of respondents whose TE ≤ X | ascending |

Four curves, four intersections:

| Point | Intersection | What it actually means |
|---|---|---|
| **PMC** — Point of Marginal Cheapness | *too cheap* × *expensive* | **Floor.** Below this, more people doubt the value than find it expensive. Price under PMC and you lose buyers by looking cheap, not by being unaffordable. This is the value-signalling guard rail. |
| **PME** — Point of Marginal Expensiveness | *too expensive* × *bargain* | **Ceiling.** Above this, rejection on price dominates. |
| **OPP** — Optimal Price Point | *too cheap* × *too expensive* | The price where equal numbers reject you for being too cheap and too expensive — i.e. **total rejection is minimised**. |
| **IPP** — Indifference Price Point | *bargain* × *expensive* | The "normal price" in the buyer's head. In a market with a dominant player this lands on the leader's price. IPP ≫ OPP ⇒ a premium/brand market. IPP ≈ OPP ⇒ a commodity. |

**RAP** (Range of Acceptable Pricing) = PMC → PME. Everything you ship must sit inside it.

### The honest caveat, stated in every PSM output
OPP minimises *rejection*, not *loss of profit*. It has no idea what a unit costs you and no
idea how many units each price sells. Treating OPP as "the optimal price" is the single most
common way this method goes wrong. The CFO's margin arithmetic overrides it, always.

### Optional: Newton-Miller-Smith extension (adds volume)
If you can afford two extra questions, ask purchase probability (definitely / probably /
might / probably not / definitely not) at the IPP price and at the PME price. Convert to
weights (e.g. .70/.50/.30/.10/0), multiply by respondents at each price → trial-rate curve →
`price × trial rate` = a revenue curve. **This is what actually answers "balances volume and
profit margin."** Plain PSM cannot answer it; say so rather than pretending.

---

## 3. Three data modes — pick one and LABEL the output with it

AC does not run surveys. So Mode B is the default here, and it must be labelled honestly as
a proxy every single time.

### Mode A — Real PSM (survey)
n ≥ 30 for direction, n ≥ 100 before anyone says "confident", n ≥ 30 **per segment cell**
before segmenting at all. Respondents must be plausible buyers, not friends. Anything below
n = 30: report the four points as "indicative only" and never draw the segmentation section.

### Mode B — Desk-derived proxy PSM (DEFAULT — no survey needed)
Substitute the market's revealed prices for the buyer's stated prices. Run by
`market-researcher`, and it produces **anchors, not a PSM**.

1. **Collect the price ladder.** ≥10 real, currently-listed prices for direct competitors
   AND substitutes. Every row: URL + price + what's included + date observed + TW-reachable
   (y/n). Sources that matter for us: 蝦皮, momo, Pinkoi, Etsy, LINE 貼圖小舖 / Creators Market,
   Canva / Fotor / Picsart / remove.bg-class AI tools, POD (Printful/Printify/客製化禮品),
   local 攝影/寵物寫真 studios, Fiverr / 接案 platforms for the human-labour substitute.
2. **Segment the ladder into rungs**: free/freemium · impulse · considered · premium · bespoke.
   Note what changes between rungs — that is what a price increase must buy the customer.
3. **Map to proxy points** (each labelled INFERENCE, never OBSERVATION):
   - proxy **PMC** ≈ the cheapest rung buyers still treat as a real paid product — typically
     just above the free/freemium rung, or the price at which reviews start saying 便宜沒好貨.
   - proxy **IPP** ≈ median of the DIRECT competitors' most-sold tier.
   - proxy **PME** ≈ the price at which the buyer switches to a materially different solution
     (a human studio, a DIY tool, doing nothing).
   - proxy **OPP** — do NOT fabricate one. Desk research cannot see the too-cheap curve.
     Report the band `[proxy PMC, proxy IPP]` and say so.
4. **Evidence bar**: <6 usable listings ⇒ output is "unsizeable with free sources", not a
   number. Stale listings (>90 days) are flagged, not silently used.
5. **Taiwan price psychology**: TWD ladders cluster at 99 / 149 / 199 / 299 / 390 / 490 /
   590 / 790 / 990 / 1,280 / 1,680. Landing between rungs (e.g. NT$530) reads as unconsidered.
   NT$990 → NT$1,280 is a bigger perceived jump than the arithmetic — the four-digit boundary
   is a real barrier for impulse categories.

### Mode C — Live price test (STRONGEST, and usually cheapest for us)
When a product already has traffic, revealed preference beats every stated-preference method.
gogolinesticker has 188 completed previews and a preview→checkout leak of 3.72% — a two-week
price variant on that existing traffic is more informative than any survey we could field,
costs ~NT$0, and produces a number the CFO can rule on. **If a live test is available,
say so in the output and rank it above the PSM's own conclusion.**
Precondition: the price variant and the conversion counter pass `qa-verifier` BEFORE going
live (CLAUDE.md launch gate). No instrumentation ⇒ no test ⇒ CFO veto per the standing rule.

---

## 4. Segmentation — how the curves move

Never segment below n = 30 per cell (Mode A) or below 4 distinct listings per rung (Mode B).
When you can, read the shifts this way:

| Segment | Curve behaviour | Pricing consequence |
|---|---|---|
| **Gift / occasion buyer** (memorial, birthday, 送禮) | Whole set shifts right; the *too cheap* curve shifts hardest — a cheap gift is a worse gift | Widest RAP, highest PMC. This is where premium tiers live. |
| **Budget / self-use** | Narrow RAP, low PME, *too cheap* curve nearly flat — they will not doubt a low price | Serve with the entry tier only; do not let this segment set the headline price. |
| **Professional / commercial use** (小賣家, 工作室) | RAP shifts right AND widens; they price against their own labour cost, not against a hobby budget | Where NT$3,000+ tiers become possible — the standing higher-ticket gap. |
| **Novelty / impulse** | Everything compresses toward one rung; TE lands close to C | One price, no tiers, no negotiation room. |

**Signalling high value** (the reason PMC matters more than OPP for us):
- The floor is a *signal*, not a concession. Discounting below PMC does not buy volume — it
  buys doubt. gogolinesticker's current soft-launch discount (NT$600/1,000/1,300 →
  NT$460/760/960) is exactly the move this method warns about; whether it sits below PMC is
  an open question the desk research must answer, not assume.
- Anchor with a visible top tier even if it rarely sells: it moves the whole *expensive*
  curve right for the tier you actually want to sell.
- Raise the floor with proof (delivery speed, revision policy, before/after samples,
  real buyer photos) before raising the number. Price rises that arrive without new proof
  read as greed; the same rise with new proof reads as an upgrade.

---

## 5. Output contract

Every PSM run writes to `docs/company/finance/YYYY-MM-DD-<slug>-psm.md` and contains:

1. **Mode used** (A / B / C) and sample size or listing count — in the first three lines.
2. The four points (or the honest subset) in TWD, with arithmetic shown.
3. RAP band + the recommended test price, snapped to a TWD psychological rung.
4. **CFO margin check**: contribution margin at the recommended price after AI + payment +
   fulfillment costs. A price inside the RAP but below the margin floor is REJECTED — the
   PSM loses to the arithmetic.
5. Segmentation section, or an explicit "not segmentable at n=<count>".
6. The cheapest real-world test that would falsify the recommendation (≤NT$1,000, ≤2 founder-hours).
7. Every claim labelled OBSERVATION (URL + date) or INFERENCE.

Draft-only: no agent changes a live price. ECPay/Stripe amounts are untouchable from HQ
(CLAUDE.md rule 5). The output is a recommendation; AC executes the price change personally.
