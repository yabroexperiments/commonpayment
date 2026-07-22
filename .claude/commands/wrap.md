---
name: wrap
description: End-of-session handoff — persist learnings, write handoff brief, commit & push
---

We're wrapping this session for a clean handoff. Do ALL tasks in order, thoroughly, and
do NOT stop mid-flow to ask for approval — AC may have walked away, and a stalled wrap
means nothing gets committed. Apply edits directly and show every diff in the final
summary; AC reverts anything he disagrees with. If unsure whether something matters,
INCLUDE IT.

═══ TASK 1: Persist durable learnings ═══
Route every durable learning from this session (architectural decisions + why,
conventions, naming patterns, gotchas, pinned versions, env/config that matters,
order-sensitive commands) to where a future session will actually find it:
- Applies to ALL projects → belongs in ~/.claude/CLAUDE.md; edit it if running locally,
  otherwise state exactly what to add.
- Project-specific → this repo's CLAUDE.md — BUT the repo's own maintenance rules WIN
  (line caps, "numbers go to metrics.md", "narratives go to docs/..."). When the repo
  routes content elsewhere, write the learning THERE and add at most a one-line pointer
  in CLAUDE.md. Never let a wrap push CLAUDE.md over its cap.
- Anything saved to session memory or agent memory this session that matters on another
  machine or in cloud sessions must ALSO land in a committed file — memory does not
  travel; git does.
No one-off session noise. Show the diffs at the end, not before saving.

═══ TASK 2: Handoff brief ═══
Create `./docs/handoffs/handoff-<stamp>.md` where <stamp> = `TZ=Asia/Taipei date
+%Y-%m-%d-%H%M` — ALWAYS Taipei time, so briefs from local and cloud (UTC) sessions
sort correctly.
Be exhaustive — next session has amnesia. POINT at durable docs (missions, standups,
decisions, specs) with paths instead of restating their content. Sections:
1. Mission (big picture)
2. Current State (exact snapshot)
3. Completed This Session (file paths / pointers to durable docs)
4. In-Flight Work (where we stopped; code state: compiles? tests pass? half-refactored?)
5. Next Steps (prioritized, executable by a stranger)
6. Key Decisions + Rationale (so we don't re-litigate)
7. Open Questions / Blockers
8. Gotchas & Landmines (what broke or wasted time)
9. Files Modified (one-line each)
10. Env / Config / Dependency changes (.env, package.json, Airtable, Vercel)
11. Commands to Resume (exact shell commands)
12. Context the Summary Would Lose (almost-decisions, paths not taken, intuitions —
    write like emailing your amnesiac future self)
NOTE: a handoff brief is concentrated producer reasoning — NEVER paste it into a
qa-verifier work order (qa-verifier gets acceptance criteria only).
Housekeeping: if ./docs/handoffs/ holds more than 10 handoff-*.md files, `git mv` all
but the newest 10 into ./docs/handoffs/archive/ (git history keeps everything anyway).

═══ TASK 3: Self-heal the handoff commands (local sessions only) ═══
If `$HOME/Documents/ClaudeCodex/claude-handoff/commands/` exists and this repo's
`.claude/commands/wrap.md`, `resume.md`, or `sync.md` are missing or differ from the
canonical copies there, copy them in and `git add -f` them (some repos gitignore
.claude/) so they ride along in this wrap's commit. This is how new repos get the
commands without anyone remembering to run sync.sh. In cloud sessions the canonical
dir won't exist — skip silently.

═══ TASK 4: Commit & push ═══
1. `git status`. REVIEW the untracked list BEFORE staging: anything that looks like a
   secret (.env*, *key*, *.secret, credentials, tokens), a scratch/temp file, or a large
   binary gets flagged in the final summary and NOT staged. Stage everything else,
   including untracked files.
2. Commit with a clear session-summary message. Push to origin. If rejected,
   `git pull --rebase` and retry.
3. Verify with `git status -sb` — the branch must show in sync with origin, not
   "ahead" (`git log -1` does NOT prove the push landed).
4. If this session touched OTHER repos, repeat this task inside each of them.
(The ClaudeCodex workspace ROOT is not a git repo — always run git inside the specific
repo, never the root.)

═══ FINALLY ═══
One summary: Task 1 diffs, handoff brief path, commit hash + push status per repo,
anything flagged-not-staged. End with: "Next session: run /resume — it pulls, reads the
newest brief plus any newer commits, and briefs you in 5 lines."
