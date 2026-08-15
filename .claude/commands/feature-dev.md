---
description: Guided feature development — explore, clarify, design options, gated build, evidence-based review
argument-hint: Optional feature description
---

# /feature-dev — gated feature workflow (in-house)

Provenance: adapted in-house 2026-07-22 from Anthropic's feature-dev plugin
(anthropics/claude-code @ ac062f33ab0c, vetted GREEN, deliberately NOT
installed — see yabro-hq/docs/vetted-external-code.md). This copy is ours:
wired to our rules and agents. CANONICAL: yabro-hq/.claude/commands/feature-dev.md
(propagated everywhere by scripts/install-vet-protocol.sh; the claude-handoff
copy is a sync mirror for new machines — edit the canonical, then re-run).
2026-07-30: Phase 3 gated on a written spec, Phase 6 split into two
non-merged review axes — rationale in yabro-hq/docs/research/
2026-07-30-skill-design-doctrine-ingest.md.

You are guiding a feature from vague idea to reviewed, verified code. Phases
are gates, not suggestions — do not skip, do not reorder. Track all phases
with the task/todo system.

## Hard rules (override everything below)
- **💰 Money-code guard (global rule in ~/.claude/CLAUDE.md):** if any phase
  would touch payment checkout, callbacks, amounts, refunds, or payout logic
  (ECPay, Stripe, any rail): STOP, name the files, explain in plain English,
  and wait for Albert's explicit per-change confirmation.
- Respect the repo's own CLAUDE.md and the workspace protocol
  (docs/agents/DISPATCH.md, JUDGMENT.md) where present.
- Fresh pull before starting (local clones drift): `git fetch && git pull
  --ff-only` — never work on a stale checkout.

## Phase 1 — Discovery
Initial request: $ARGUMENTS
If unclear, ask: what problem, for whom, what should it do, constraints?
Summarize your understanding in 2-3 sentences and confirm before proceeding.

## Phase 2 — Codebase exploration (read-only)
Launch 2-3 read-only Explore agents in parallel, each on a different angle:
similar existing features · architecture/abstractions of the target area ·
conventions, testing patterns, extension points. Each must return the 5-10
files that matter most. Read those files yourself afterwards — agents locate,
you understand. Present a short findings summary.

## Phase 3 — Clarifying questions → written spec
From the findings, list every underspecified point: edge cases, error
handling, integration points, scope boundaries, backward compatibility,
performance. Ask them as one organized list and WAIT for answers. If told
"whatever you think is best", state your recommendation and get explicit
confirmation of it.

**This phase completes when `docs/specs/<slug>.md` exists on disk and AC has
confirmed it** — not when the questions have been asked. Create `docs/specs/`
if the repo lacks it. The file carries seven sections:

1. **Goal** — one sentence: what changes for the buyer or the business.
   Written as an outcome, never as a description of what gets built.
2. **Success criterion** — how we would know it worked; the measurement and
   where it comes from. If measurement doesn't exist yet, that is a ticket.
3. **File map** — the 5-10 files from Phase 2, one line each on why it
   matters. This is what carries the exploration forward; a later session
   reads this instead of re-exploring.
4. **Decisions** — each question and its answer, tagged `[AC]` (AC decided)
   or `[rec-confirmed]` (we recommended, AC confirmed).
5. **Constraints** — repo rules and known gotchas this feature actually hits
   (money-code guard, PostgREST 1000-row cap, RLS, shared Cloudinary cloud).
6. **Out of scope** — named explicitly, so scope creep is visible later.
7. **Open questions** — must be empty to leave this phase.

**Gate: do not enter Phase 4 until that file exists and AC has confirmed it.**
Writing the spec IS the deliverable of this phase; the build is a separate
concern that starts only after AC signs off on the file.

## Phase 4 — Architecture options
Produce (via parallel Plan/architect agents or yourself for small features)
2-3 approaches with different centers of gravity: minimal-change ·
clean-architecture · pragmatic balance. Ground every option in the spec's
File map and Constraints. Compare trade-offs in plain language, give ONE
recommendation with reasoning, and ask which to build. WAIT.

## Phase 5 — Implementation (needs explicit approval from Phase 4)
Re-read the key files, then build exactly the chosen approach, following the
repo's conventions (naming, comment density, error handling, config via the
repo's established pattern). Money-code guard applies with full force here.

**Success criteria before code** (added 2026-08-15, Karpathy ingest —
`yabro-hq/docs/company/research/2026-08-15-karpathy-llm-coding-best-practices.md`):
before the first edit, restate the spec's Success criterion as
machine-checkable checks (a test that must pass, a curl that must return X,
a build that must boot). **If no checkable criterion can be named, STOP
LOUDLY and say so** — "I cannot state how we'd verify this" is a Phase 3
gap, never something to silently build through.

**Naive-correct-first**: when performance or cleverness tempts, build the
obviously-correct simple version first and lock it in with the tests; only
then optimize, with the tests holding correctness. Never start from the
clever version.

**Build test-first** (adapted 2026-07-29 from Matt Pocock's tdd skill, MIT,
vetted @ 2ab9580 — see yabro-hq/docs/vetted-external-code.md):
- **Agree the seams first.** A seam = the public boundary a test observes
  behavior at. Name the seams under test as part of the Phase 4 approval (or
  confirm them now) — testing effort goes to critical paths, not every edge
  case. No test at an unconfirmed seam.
- **Red before green, one vertical slice at a time.** ONE failing test →
  watch it fail → only enough code to pass it → watch it pass → repeat.
  Never all-tests-up-front (bulk tests verify imagined behavior); never
  speculative code no test demanded.
- **Tests verify behavior through public interfaces, never internals.** A
  good test reads like a spec and survives refactors. Reject tests that:
  mock internal collaborators or test private methods; verify through a
  side channel (query the DB instead of the interface); break on refactor
  without behavior change; or are **tautological** — expected value
  recomputed the way the code computes it. Expected values come from an
  independent source: a known-good literal, worked example, or the spec.
- **Mock only at system boundaries** — external APIs, time, randomness;
  never our own modules. Prefer dependency injection and per-operation
  SDK-style clients so each mock returns one specific shape. For our stack:
  ECPay/Stripe/Printful clients are mocked at their boundary — tests never
  touch real payment code paths (money-code guard aligned).
- **Refactoring is not part of the loop** — it belongs to Phase 6 review,
  not the red→green cycle.

## Phase 6 — Review & verification
Review runs on **two axes that stay separate**, plus verification. All three
are required, and reviewers are never the author (DISPATCH §6).

**Axis A — Conformance.** Does the code match the spec's Decisions and the
repo's conventions, and is it correct? Parallel reviewer passes:
bugs/correctness · simplicity/DRY · repo-convention adherence. Report only
findings you are ≥80% confident are real, each with file:line and a concrete
fix.

The simplicity pass runs the **de-bloat checklist** (2026-08-15, Karpathy
ingest — agents systematically over-engineer): (a) no dead code left behind;
(b) no try/catch that swallows an error without a positive control proving
the happy path fires; (c) no abstraction with a single caller; (d) no
drive-by edits to comments/code orthogonal to the task; (e) ask the
100-line question — "couldn't this be 10× smaller?" — and if yes, shrink it
before presenting. Findings here are normal Axis A findings: named, loud,
file:line.

**Axis B — Requirement.** Does this achieve the spec's **Goal** and satisfy
its **Success criterion**? Delegate to `qa-verifier` with a fresh context,
handing it ONLY the spec's Goal + Success criterion + where to look — never
the build reasoning. Code that is spec-conformant and convention-perfect can
still miss the outcome the spec was written to get (built exactly as
specified, but below the fold on mobile where the traffic is; shipped without
the instrumentation its success criterion depends on).

**Present the two axes as two separate blocks. Never interleave them, never
rank findings across them, never collapse them into one list.** Ranking makes
one axis's verdict read as the whole verdict. Report Axis B explicitly even
when it passes — an empty Axis A block is a statement about code quality
alone, and on its own it is not a ship signal.

**Verification (both axes):** actually run what proves it works — build,
tests, a real invocation — and show the evidence lines. "Looks right" is not
done; a failing check = not done.

Present both blocks + evidence; ask fix-now / fix-later / ship.

## Phase 7 — Summary
What was built, key decisions, files touched, evidence of verification,
suggested next steps. If any decision changed during Phases 4-6, update
`docs/specs/<slug>.md` to match what shipped — a spec that disagrees with the
code misleads the next session worse than no spec at all. If the session is ending, follow the repo's handoff
convention (/wrap where available).
