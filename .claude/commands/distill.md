---
name: distill
description: Single-writer fold-in — promote durable rules from docs/decisions/*.md into CLAUDE.md, with AC approving each one
---

You are the ONE reconciling writer for this repo's CLAUDE.md. `/wrap` never edits
CLAUDE.md any more (N sessions appending to one file was the conflict machine); it
writes session learnings to `./docs/decisions/<date>-<slug>.md`. Nothing promotes
those into the rules file except this command, run deliberately by AC, in a session
where no other session is editing CLAUDE.md. Do the steps in order.

═══ STEP 0: Preconditions (refuse if any fails) ═══
- `git status --porcelain -- CLAUDE.md` must be EMPTY. A dirty CLAUDE.md is another
  session mid-edit; stop and say so.
- `git fetch origin && git status -sb`: if behind, `git pull --ff-only` first. If
  diverged, stop — reconcile is not this command's job.
- Read `.claude/session-guard.sh`'s CLAUDE.md line cap (400 unless the repo says
  otherwise). Note the current line count. You may not end above the cap.

═══ STEP 1: Gather candidates ═══
List `./docs/decisions/*.md` that do NOT end with a line matching `^<!-- distilled `.
For each, read it and extract only what is a DURABLE RULE — something a future
session must know to avoid a repeat: a convention, a gotcha, a pinned version, a
hard constraint, a decision-with-why. Skip narrative, status, and anything already
in CLAUDE.md (grep for it — a rule stated twice rots twice). Group by theme.
Anything under a `## GLOBAL CANDIDATE` heading is NOT for this repo's CLAUDE.md:
collect it separately (Step 4).

═══ STEP 2: Propose — do NOT edit yet ═══
Present a numbered list. For each candidate: the one- or two-sentence rule as it
would appear in CLAUDE.md, the source file, and WHERE in CLAUDE.md it goes (an
existing section, or a named new one). State the projected line count after all
edits versus the cap. If it would exceed the cap, also propose what to REMOVE or
condense — a rule file that only grows is a journal with a different name.
Then WAIT for AC. He answers by number (keep / drop / edit). Do not proceed on
silence.

═══ STEP 3: Apply the approved set, as ONE commit ═══
- Edit CLAUDE.md with the approved wording only. Never touch the managed blocks
  (`<!-- ECVP:BEGIN -->` … `<!-- SESSION:END -->` etc. — those are stamped by
  yabro-hq; edit the masters there).
- Append to each consumed decision file a final line:
  `<!-- distilled YYYY-MM-DD into CLAUDE.md (§<section>) -->`
  (date from `TZ=Asia/Taipei date +%F`, run now — never a date from memory). A
  consumed file is kept, not deleted: it is the provenance.
- Assert the post-edit line count is ≤ the cap; if not, you mis-planned — revert
  and go back to Step 2.
- Stage an explicit allowlist (CLAUDE.md + the decision files you marked), commit
  with `-F <msgfile>` (never `-m`), `git commit --only -- <same paths>`. Message:
  `distill: <N> rules from <M> decision files → CLAUDE.md`, listing each rule's
  source. Push. Verify by content: grep origin/main:CLAUDE.md for a phrase you
  just added.

═══ STEP 4: Global candidates — stage, never apply ═══
For `## GLOBAL CANDIDATE` items, write the proposed text to
`./docs/decisions/global-candidates-<date>.md` and tell AC. NEVER edit
`~/.claude/CLAUDE.md` from here: it is over its size FAIL line (241 KB against a
262 KB cap where Codex truncates the tail), it does not exist in cloud sessions,
and adding to it is AC's call with the size guard in front of him.

═══ FINALLY ═══
One summary: rules promoted (with sections), decision files marked, line count
before → after vs cap, commit sha + content-verified, global candidates staged.
