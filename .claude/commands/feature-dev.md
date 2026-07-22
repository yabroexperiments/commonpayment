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

## Phase 3 — Clarifying questions (DO NOT SKIP)
From the findings, list every underspecified point: edge cases, error
handling, integration points, scope boundaries, backward compatibility,
performance. Ask them as one organized list and WAIT for answers. If told
"whatever you think is best", state your recommendation and get explicit
confirmation of it.

## Phase 4 — Architecture options
Produce (via parallel Plan/architect agents or yourself for small features)
2-3 approaches with different centers of gravity: minimal-change ·
clean-architecture · pragmatic balance. Compare trade-offs in plain language,
give ONE recommendation with reasoning, and ask which to build. WAIT.

## Phase 5 — Implementation (needs explicit approval from Phase 4)
Re-read the key files, then build exactly the chosen approach, following the
repo's conventions (naming, comment density, error handling, config via the
repo's established pattern). Money-code guard applies with full force here.

## Phase 6 — Review & verification
Two parts, both required:
1. **Review:** parallel reviewer passes (bugs/correctness · simplicity/DRY ·
   repo-convention adherence). Report only findings you are ≥80% confident
   are real — quality over noise, each with file:line and a concrete fix.
2. **Verify like qa-verifier:** actually run what proves it works — build,
   tests, a real invocation — and show the evidence lines. "Looks right" is
   not done; a failing check = not done.
Present findings + evidence; ask fix-now / fix-later / ship.

## Phase 7 — Summary
What was built, key decisions, files touched, evidence of verification,
suggested next steps. If the session is ending, follow the repo's handoff
convention (/wrap where available).
