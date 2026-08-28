---
name: pricing-psm
description: Van Westendorp Price Sensitivity Meter — find the price band a buyer's head already accepts. Use whenever setting or changing a price, launching a paid product or tier, judging whether a price is too low or too high, deciding whether a discount is hurting, researching what to charge, or sizing willingness-to-pay. Works without survey data — the default path is deep research of competitor and substitute prices to derive the band.
---

# Van Westendorp Price Sensitivity Meter (PSM)

PSM answers ONE question: **what price band does the buyer's head already accept?**
It says nothing about revenue, volume, or margin — those come from arithmetic afterwards.
Reporting "the PSM says price it at X" and stopping is half the job.

Full method (curve maths, TW price psychology, output contract) travels with this skill:
`references/van-westendorp-method.md`, in this skill's own directory. Read it when you need
the detail; this file alone is enough to run the analysis.

---

## Step 0 — pick the data mode, and SAY WHICH ONE

Announce the mode and the sample size / listing count in the first three lines of any output.
An unlabelled proxy presented as a real PSM is a fabricated number.

| Mode | When | Strength |
|---|---|---|
| **A — Survey** | The user pasted real respondent answers | Real PSM |
| **B — Desk-derived proxy** | **DEFAULT.** No survey data (AC does not run surveys) | Anchors, not a PSM |
| **C — Live price test** | The product already has traffic + working conversion tracking | **Strongest.** Revealed preference beats every stated-preference method — rank it ABOVE the PSM's own conclusion |

Modes combine. B tells you where to aim; C tells you the truth.

## Step 1 — get the numbers

### Mode B (default): deep research of competitor + substitute prices
1. **Price ladder** — ≥10 currently-listed real prices for direct competitors AND
   substitutes. Every row: URL · price · what's included · date observed · reachable by
   this buyer (y/n). TW sources worth sweeping: 蝦皮, momo, Pinkoi, Etsy, LINE 貼圖小舖 /
   Creators Market, the DIY-tool tier (Canva / Fotor / Picsart / remove.bg class), POD
   (Printful / Printify / 客製化禮品), local 攝影・寫真 studios, Fiverr / 接案 platforms
   for the human-labour substitute.
2. **Group into rungs**: free/freemium · impulse · considered · premium · bespoke.
   State what CHANGES between rungs — that is what a price increase must buy the customer.
3. **Derive the proxy points** (label each INFERENCE, never OBSERVATION):
   - proxy **PMC** ≈ cheapest rung buyers still treat as a real paid product (just above
     free, or where reviews start saying 便宜沒好貨)
   - proxy **IPP** ≈ median of direct competitors' most-sold tier
   - proxy **PME** ≈ where the buyer switches to a materially different solution (a human
     studio, a DIY tool, doing nothing)
   - proxy **OPP** — **do not invent one.** Desk research cannot see the too-cheap curve.
     Report the band `[proxy PMC, proxy IPP]` and say why OPP is absent.
4. **Evidence bar**: <6 usable listings ⇒ "unsizeable with free sources", not a number.
   Listings >90 days old are flagged, never silently used.

### Mode A: the four questions
Show the real product first — a PSM run on a description prices the description.

| # | EN | zh-TW |
|---|---|---|
| 1 **Too cheap** (TC) | So cheap you'd doubt the quality? | 多少錢會讓你覺得「這麼便宜，品質一定有問題」？ |
| 2 **Bargain** (C) | A bargain — clearly good value? | 多少錢會讓你覺得「這個價格划算」？ |
| 3 **Expensive** (E) | Starting to feel expensive, but you'd still buy? | 多少錢開始覺得「有點貴」但還是會買？ |
| 4 **Too expensive** (TE) | So expensive you wouldn't consider it? | 多少錢會讓你覺得「太貴了，不考慮」？ |

Validity filter: keep a respondent only if `TC < C < E < TE`. Report how many you dropped
(5–15% normal; >25% means the questions confused people — fix that first).
Sample bars: n≥30 direction · n≥100 before saying "confident" · n≥30 **per segment cell**
before segmenting at all.

## Step 2 — build the curves (Mode A)

At each distinct price X: *too cheap* = % whose TC ≥ X (descending) · *bargain* = % whose
C ≥ X (descending) · *expensive* = % whose E ≤ X (ascending) · *too expensive* = % whose
TE ≤ X (ascending).

| Point | Intersection | Meaning |
|---|---|---|
| **PMC** Marginal Cheapness | too cheap × expensive | **Floor.** Below it you lose buyers to DOUBT, not to affordability. The value-signalling guard rail. |
| **PME** Marginal Expensiveness | too expensive × bargain | **Ceiling.** |
| **OPP** Optimal Price Point | too cheap × too expensive | Minimum TOTAL REJECTION. |
| **IPP** Indifference Price | bargain × expensive | The "normal price" in the buyer's head; lands on the market leader's price. IPP ≫ OPP ⇒ premium market. IPP ≈ OPP ⇒ commodity. |

**RAP** = PMC → PME. Everything you ship sits inside it.

## Step 3 — the caveats you must state, every time

- **OPP minimises rejection, not lost profit.** It knows nothing about unit cost or volume.
  Never call it "the optimal price" without the margin check beside it. This is the single
  most common way this method goes wrong.
- **Plain PSM cannot balance volume against margin.** If that's the question, say so, then
  name the **Newton-Miller-Smith extension**: ask purchase probability (definitely /
  probably / might / probably not / never → weights .70/.50/.30/.10/0) at the IPP price and
  the PME price, multiply out to a trial-rate curve, `price × trial rate` = revenue curve.
- **Margin overrides the band.** A price inside the RAP but below the contribution-margin
  floor (after AI + payment + fulfillment costs) is REJECTED. Arithmetic beats the survey.

## Step 4 — segmentation & signalling high value

Never segment below n=30 per cell (Mode A) or 4 distinct listings per rung (Mode B).

| Segment | Curve behaviour | Consequence |
|---|---|---|
| **Gift / occasion** (送禮, memorial) | Whole set shifts right; *too cheap* shifts hardest — a cheap gift is a worse gift | Widest RAP, highest floor. Premium tiers live here. |
| **Budget / self-use** | Narrow RAP, low ceiling, *too cheap* curve nearly flat — they won't doubt a low price | Entry tier only; never let this segment set the headline price. |
| **Professional / commercial** (小賣家, 工作室) | Shifts right AND widens — they price against their own labour cost | Where high-ticket tiers become possible. |
| **Novelty / impulse** | Everything compresses to one rung; TE sits close to C | One price, no tiers. |

Signalling high value — why PMC matters more than OPP:
- The floor is a **signal, not a concession**. Discounting below PMC doesn't buy volume, it
  buys doubt.
- Anchor with a visible top tier even if it rarely sells — it drags the *expensive* curve
  right for the tier you actually want to sell.
- Raise the floor with **proof** (delivery speed, revision policy, before/after samples, real
  buyer photos) before raising the number. A price rise without new proof reads as greed;
  the same rise with new proof reads as an upgrade.
- Snap to TWD psychological rungs: 99 / 149 / 199 / 299 / 390 / 490 / 590 / 790 / 990 /
  1,280 / 1,680. Landing between rungs (NT$530) reads as unconsidered. The four-digit
  boundary (990 → 1,280) is a bigger perceived jump than the arithmetic.

## Step 5 — output

1. Data mode + sample size / listing count, first three lines.
2. The points the data supports (omit the rest — never interpolate a missing one), in currency.
3. RAP band + recommended test price, snapped to a psychological rung.
4. Margin check at that price. Below the floor ⇒ REJECTED, stated plainly.
5. Segmentation, or an explicit "not segmentable at n=<count>".
6. The cheapest real-world test that would falsify the recommendation.
7. Every claim labelled OBSERVATION (URL + date) or INFERENCE.
8. **2–3 price options with tradeoffs, never one number presented as settled** — final
   pricing is a taste call and belongs to the human.

---

## Running this inside 阿伯工作室 (yabro-hq)

Only when `.claude/agents/cfo-analyst.md` exists in the working repo — otherwise skip this
section entirely and run the method yourself.

- Read `docs/company/metrics.md` FIRST (CLAUDE.md rule 3): live prices, conversion rates and
  per-unit costs are inputs, not background.
- **Main session only** (agents never invoke each other — if you are a subagent, run the
  method yourself and stop here): dispatch `market-researcher` for the price ladder and
  `customer-voice` for the buyer's four numbers + segments, in parallel; then gate on
  `cfo-analyst` for interpretation, the margin check and the ruling. The CFO's veto is the
  verdict unless AC overrides, and an override is recorded in `docs/company/decisions/`
  with the dissent attached.
- Write to `docs/company/finance/YYYY-MM-DD-<slug>-psm.md` (rule 4 — chat-only output
  doesn't count as work).
- **Draft-only** (rule 1 + rule 5): recommend the price, never change it. ECPay / Stripe
  amounts are untouchable from HQ. A live price test needs `qa-verifier` on the variant and
  its counter BEFORE it goes live (launch gate); no instrumentation ⇒ no test ⇒ CFO veto.
- gogolinesticker standing case: 188 previews, 3.72% preview→checkout, current soft-launch
  discount NT$600/1,000/1,300 → NT$460/760/960. A price variant on that existing traffic is
  Mode C, costs ~NT$0, and beats any survey we could field. Whether the discount sits below
  the floor is an open question for the research — never an assumption.
