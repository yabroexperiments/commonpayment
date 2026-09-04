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
- Project-specific → write it to `./docs/decisions/<TZ=Asia/Taipei date +%F>-<session-slug>.md`.
  **DO NOT EDIT CLAUDE.md.** N parallel sessions appending to one mutable file is a
  conflict machine, and they are documentation conflicts — pure friction, no payoff
  (measured 2026-09-04: CLAUDE.md was the single most-churned file in 唱給你聽, famchat
  and gogolinesticker, up to 5x the busiest source file). A uniquely-named dated file
  cannot conflict with another session's, so this is enforced by construction rather
  than by everyone remembering to be careful.
- Applies to ALL projects → still note it in the same dated file, under a
  `## GLOBAL CANDIDATE` heading. Do NOT edit ~/.claude/CLAUDE.md: it is 241 KB against a
  262 KB hard cap where Codex silently truncates the tail, so an unreviewed append is a
  live risk to rules already in there.
- Folding durable rules back into CLAUDE.md is a SEPARATE, DELIBERATE act by a single
  reconciling writer (AC, or `/distill`) — never part of a wrap. End the summary by
  naming the dated file and any GLOBAL CANDIDATE headings in it, so that act has a queue.
- Anything saved to session memory or agent memory this session that matters on another
  machine or in cloud sessions must ALSO land in a committed file — memory does not
  travel; git does.
Also capture FRICTION, not just decisions. Scan the session for what the work itself
taught: where AC corrected you, where a documented rule got ignored anyway, where a
workflow was clunky or a step was easy to forget. Record the GENERALIZABLE PRINCIPLE
(strip the one-off specifics), not the incident. Key rule: when a guideline keeps getting
missed, the fix is to make it structurally hard to skip — a checklist step, a wrapper, an
enforced gate — NOT to restate it louder (cf. our "conditions enforced in code, not
memory" rule). Route each principle to the homes above; any change to a skill/command is
STAGED as a diff for AC to install, never silently auto-applied.
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
    ⚠️ NAMES ONLY, NEVER VALUES — not for a secret you just generated, not
    "temporarily", not inside a sample curl. Write `CRON_SECRET — rotated, set on
    Render + relay`, never the string itself. This section is exactly where
    budgethelper leaked a live CRON_SECRET for six weeks (b233c0d, 2026-07-21): a
    wrap documented the env change it had just made and pasted the working value
    into this list, then again into a sample command. A pushed secret CANNOT be
    un-pushed — GitHub serves it by SHA long after any force-push — so one
    careless line costs a rotation, not an edit. A value that must be written
    down goes in RECOVERY/key-rotation-worksheet.secret, which is gitignored and
    is not in any repo.
11. Commands to Resume (exact shell commands)
12. Context the Summary Would Lose (almost-decisions, paths not taken, intuitions —
    write like emailing your amnesiac future self)
NOTE: a handoff brief is concentrated producer reasoning — NEVER paste it into a
qa-verifier work order (qa-verifier gets acceptance criteria only).
Housekeeping: if ./docs/handoffs/ holds more than 10 handoff-*.md files, `git mv` all
but the newest 10 into ./docs/handoffs/archive/ (git history keeps everything anyway).

═══ TASK 3: Self-heal the handoff commands (local sessions only) ═══
If `$HOME/Documents/ClaudeCodex/claude-handoff/commands/` exists and this repo's
`.claude/commands/wrap.md`, `backtowork.md`, or `sync.md` are missing or differ from the
canonical copies there, copy them in and `git add -f` them (some repos gitignore
.claude/) so they ride along in this wrap's commit. Also `git rm -f --ignore-unmatch
.claude/commands/resume.md` if it is still present — it was renamed to backtowork.md
2026-08-25 to stop colliding with Claude Code's own built-in /resume. This is how new repos get the
commands without anyone remembering to run sync.sh. In cloud sessions the canonical
dir won't exist — skip silently.

═══ TASK 4: Commit & push ═══
1. `git status --porcelain -uall`. Build an EXPLICIT ALLOWLIST of the paths THIS
   session touched. **Never stage by wildcard and never "stage everything else"** —
   parallel sessions share this working tree, so a blanket stage commits someone
   else's half-finished file under your message, and has already shipped a build
   break that way. Anything secret-looking (.env*, *key*, *.secret, credentials,
   tokens), scratch/temp, or large-binary is flagged in the summary and NOT staged.
   If a path you did not touch is dirty, LEAVE IT and say so in the summary.
   A file whose mtime is seconds old means another session is typing right now.
   That check is about FILES. The brief you just wrote is the other risk: re-read
   §10 and any sample commands for literal credential values before staging. The
   pre-push hook catches prose shapes since 2026-09-04 (a backticked value after a
   credential word; `Authorization: Bearer <token>`), but a hit there means the
   secret is already in a local commit — treat it as a rotation, not a typo.
2. Commit the allowlist: `git add -- <exact paths>` then
   `git commit --only -F <msgfile> -- <the identical paths>`. `--only` bypasses
   whatever else is in the shared index, but it IGNORES untracked paths, so the
   `git add` is required, not optional. Always `-F <file>`, never `-m "..."`:
   prose is full of backticks and `$`, which the shell will mangle into immutable
   history. Push to origin. If rejected, do NOT `git pull --rebase` in a shared
   checkout that holds another session's files — cherry-pick your commit onto
   `origin/main` in a detached worktree and push that instead.
3. Verify by CONTENT, not by ancestry: `git cat-file -e origin/main:<a file only
   this session added>` and grep origin/main for a literal you typed. Ancestry passes
   vacuously, and after a cherry-pick your local SHA is SUPPOSED to be absent upstream.
4. BEFORE any of the above, if `git rev-parse --is-shallow-repository` is `true`, run
   `git fetch --unshallow --tags` first. A shallow clone reports fiction — phantom
   forced-updates, false ahead/behind, `merge-base` claiming divergence. NEVER
   `reset --hard`, force-push, or "recover" a branch on that evidence.
5. If this session's branch is now merged into `origin/main`
   (`git rev-list --count origin/main..<branch>` is 0), DELETE it — remote via
   `gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>` (a plain
   `git push origin --delete` is refused by the permission classifier), then the
   local one. Print the SHA first so the deletion is one command from reversible.
   A merged branch left behind reads as outstanding work forever; 34 had piled up
   across the workspace by 2026-09-04. Full sweep:
   `yabro-hq/scripts/branch-hygiene.sh` (report-only unless given `--delete <scope>`).
4. If this session touched OTHER repos, repeat this task inside each of them.
(The ClaudeCodex workspace ROOT is not a git repo — always run git inside the specific
repo, never the root.)

═══ FINALLY ═══
One summary: Task 1 diffs, handoff brief path, commit hash + push status per repo,
anything flagged-not-staged. End with: "Next session: run /backtowork — it pulls, reads the
newest brief plus any newer commits, and briefs you in 5 lines."
