---
name: sync
description: Quick machine-hop — commit & push everything, no full handoff ceremony
---

Quick sync (no handoff brief). I'm just hopping machines:
1. `git status`. REVIEW untracked files first: anything secret-looking (.env*, *key*,
   *.secret, credentials), scratch/temp, or large-binary gets flagged and NOT staged.
   Stage everything else, including untracked files.
2. Commit — and make the commit message carry the state, so /resume on the other
   machine can recover it from `git log` alone:
   - subject: one-line summary of the work in progress
   - body: 2–4 lines — what's in flight, the exact stopping point, the #1 next step.
3. Push to origin. If rejected, `git pull --rebase` and retry.
4. Verify with `git status -sb` — in sync with origin, not "ahead".
(Run git inside the specific repo we worked in, not the ClaudeCodex root. If the
session touched multiple repos, sync each one.)
