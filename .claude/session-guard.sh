#!/usr/bin/env bash
# session-guard.sh — runs at SessionStart in EVERY session, local and cloud.
# Managed by yabro-hq/scripts/install-session-guard.sh — edit the master, re-stamp.
# Is every repo running the current copy? ./scripts/check-session-guard-drift.sh
#
# WHY THIS FILE EXISTS, in one paragraph: a fresh cloud session clones --depth 50.
# A shallow clone cannot find a true merge-base, so git REPORTS FICTION — phantom
# `forced update`, invented ahead/behind, `merge-base --is-ancestor` answering NO
# for a plain ancestor, `branch -r --contains` finding nothing. A session that
# "repairs" that with a reset or force-push causes the exact data loss it thinks
# it is preventing. Measured 2026-09-04: famchat reported "ahead 78, behind 51,
# divergent" when the truth was ahead 0, behind 57 with nothing lost; gasbot
# arrived with 52 of 58 commits. Verified the same day that a repo's COMMITTED
# SessionStart hook does run in cloud, which is what makes this fixable in code
# rather than in prose nobody re-reads.
#
# CONTRACT: never blocks a session (always exit 0), never writes into the repo,
# never mutates history. It only materializes history and reports.
set -uo pipefail

R="${CLAUDE_PROJECT_DIR:-$(pwd)}"
LOG="${TMPDIR:-/tmp}/claude-session-guard.log"
g() { git -C "$R" "$@" 2>/dev/null; }
git -C "$R" rev-parse --git-dir >/dev/null 2>&1 || exit 0   # not a repo: nothing to do
out=""
add() { [ -n "$out" ] && out="$out | $1" || out="$1"; }

# ── 1. Materialize history BEFORE anything judges git state ────────────────────
if [ "$(g rev-parse --is-shallow-repository)" = "true" ]; then
  before=$(g rev-list --count HEAD)
  git -C "$R" fetch --unshallow --tags --quiet 2>>"$LOG"; rc=$?
  after=$(g rev-list --count HEAD)
  if [ "$(g rev-parse --is-shallow-repository)" = "true" ]; then
    # Left shallow: say so loudly. Silence here would be worse than the problem,
    # because every git reading below is then still fiction.
    out="⚠️ SHALLOW CLONE AND UNSHALLOW FAILED (rc=$rc). Git state here is UNRELIABLE: ahead/behind, merge-base and --contains all report fiction. Do NOT reset --hard, force-push, or 'recover' a branch. Retry: git fetch --unshallow --tags"
  else
    out="history materialized: shallow clone $before → $after commits (git state below is now real)"
  fi
fi
git -C "$R" fetch --prune --quiet 2>>"$LOG"

# ── 2. Orient: branch, and whether it is behind ────────────────────────────────
br=$(g rev-parse --abbrev-ref HEAD)
if g rev-parse --verify -q origin/main >/dev/null; then
  behind=$(g rev-list --count "HEAD..origin/main"); ahead=$(g rev-list --count "origin/main..HEAD")
  add "branch=$br ahead=${ahead:-?} behind=${behind:-?}"
  [ "${behind:-0}" -gt 30 ] && out="$out (far behind — re-read files before editing; another session has moved main)"
fi

# ── 3. Concurrency + collision: who else is live in this repo right now ────────
# The cap is 5 (AC, 2026-09-04). This counts BRANCHES, not sessions, and cannot
# tell a live session from a merged ref left behind — which is exactly why /wrap
# now deletes its branch on merge. Without that hygiene this number is noise.
live=$(g for-each-ref --format='%(refname:short) %(committerdate:unix)' refs/remotes/origin \
        | grep -E 'origin/(claude|agent|codex)/' | awk -v c="$(date +%s)" 'c-$2 < 86400 {print $1}')
n=$(printf '%s' "$live" | grep -c . )
if [ "${n:-0}" -gt 0 ]; then
  add "${n} branch(es) active in the last 24h: $(printf '%s' "$live" | sed 's#origin/##' | tr '\n' ' ')"
  [ "$n" -gt 5 ] && out="$out ⚠️ OVER THE CAP OF 5 — expect collisions; consider finishing one before starting another."
fi

# ── 3b. Migration numbers: the claim the working tree cannot see ──────────────
# THREE collisions in ONE DAY (famchat, 2026-09-14, three sessions). Each picked
# "the next number after what is in MY working tree", and a migration number is
# claimed in two places that tree cannot see: a sibling session's BRANCH, and
# the DB ledger. `ls src/db/` shows neither.
#
# So this prints the next free number BEFORE a session picks one — the whole
# point, since a rule that must be remembered is a rule that gets skipped — and
# shouts when two branches already claim one slot.
#
# Covers the branch half only; the ledger needs credentials this hook must never
# hold. That half is downstream anyway: ledger names derive from filenames.
# Self-skips in every repo with no numbered migrations, so one file still serves
# all of them. Read-only, like everything else here.
if ls "$R"/src/db/[0-9][0-9][0-9][0-9]*_*.sql >/dev/null 2>&1; then
  migs=$( { g ls-files src/db
            for ref in $(g for-each-ref --format='%(refname:short)' refs/remotes/origin \
                         | grep -v '/HEAD$'); do
              g ls-tree --name-only "$ref" src/db/
            done
          } | sed 's#.*/##' | grep -E '^[0-9]{4}[a-z]?_.+\.sql$' | sort -u )
  if [ -n "$migs" ]; then
    # A slot claimed by two DIFFERENT filenames. The same file on many branches
    # is just a merged file; 0045 beside 0045b is a deliberate insert.
    dup=$(printf '%s\n' "$migs" | sed -E 's/^([0-9]{4}[a-z]?)_.*/\1/' | uniq -d | tr '\n' ' ')
    top=$(printf '%s\n' "$migs" | sed -E 's/^([0-9]{4}).*/\1/' | sort -n | tail -1)
    nxt=$(printf '%04d' $((10#${top:-0} + 1)))
    if [ -n "${dup// /}" ]; then
      add "⚠️ MIGRATION NUMBER COLLISION — slot(s) ${dup}are claimed by two different files across branches. Renumber YOURS before applying (never one the DB already recorded). Next free: $nxt"
    else
      add "next free migration number: $nxt (checked against every remote branch, not just this tree)"
    fi
  fi
fi

# ── 4. CLAUDE.md size: the file every session reads and no test covers ─────────
if [ -f "$R/CLAUDE.md" ]; then
  L=$(wc -l < "$R/CLAUDE.md" | tr -d ' ')
  [ "$L" -gt 400 ] && add "⚠️ CLAUDE.md is $L lines (>400): put session learnings in ./docs/decisions/<date>-<slug>.md, NOT here — see /wrap TASK 1."
fi

[ -n "$out" ] || exit 0
# ── 5. Report on BOTH channels ──────────────────────────────────────────────────
# Measured 2026-09-04 (gasbot, cloud): a SessionStart hook's `systemMessage` is shown
# to the HUMAN in the UI and NEVER reaches the model — the agent, asked point-blank,
# truthfully did not have it. Everything above that only printed systemMessage was
# firing into a void as far as the agent is concerned. The field injected into the
# model's context at SessionStart is hookSpecificOutput.additionalContext. Emit both:
# additionalContext so the AGENT acts on it, systemMessage so AC sees it in the UI.
# Two DISTINCT markers so the next cloud probe can tell which channel the agent saw.
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r'; }
printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' \
  "$(esc "GUARD-UI-CHANNEL | $out")" \
  "$(esc "GUARD-MODEL-CHANNEL | session-guard (.claude/session-guard.sh) ran at session start: $out")"
exit 0
