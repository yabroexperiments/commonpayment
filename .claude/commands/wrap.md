---
name: wrap
description: End-of-session handoff — update CLAUDE.md, write handoff brief, commit & push
---

We're wrapping this session for a clean handoff. Do these THREE tasks in order, thoroughly. If unsure whether something matters, INCLUDE IT.

═══ TASK 1: Update ./CLAUDE.md ═══
Add DURABLE learnings from this session only: architectural decisions (+why), conventions, naming patterns, gotchas, pinned versions, env/config that matters, order-sensitive commands. No one-off session noise. Show me the diff before saving.

═══ TASK 2: Create ./docs/handoffs/handoff-[YYYY-MM-DD-HHMM].md ═══
Be exhaustive — next session has amnesia. Sections:
1. Mission (big picture)
2. Current State (exact snapshot)
3. Completed This Session (with file paths)
4. In-Flight Work (where we stopped; code state: compiles? tests pass? half-refactored?)
5. Next Steps (prioritized, executable by a stranger)
6. Key Decisions + Rationale (so we don't re-litigate)
7. Open Questions / Blockers
8. Gotchas & Landmines (what broke or wasted time)
9. Files Modified (one-line each)
10. Env / Config / Dependency changes (.env, package.json, Airtable, Vercel)
11. Commands to Resume (exact shell commands)
12. Context the Summary Would Lose (almost-decisions, paths not taken, intuitions — write like emailing your amnesiac future self)

═══ TASK 3: Commit & push ═══
Run git status. Stage everything including untracked files. Commit with a clear session-summary message. Push to origin. If push is rejected, pull --rebase and retry. Show git log -1 to confirm.
(Note: the ClaudeCodex workspace ROOT is not a git repo — run git inside the specific subfolder/repo we worked in, not the root.)

═══ FINALLY ═══
Output the exact one-line bootstrap prompt for the new session, e.g.:
"Read the newest file in ./docs/handoffs/ fully, confirm understanding, then continue with [next priority]."
