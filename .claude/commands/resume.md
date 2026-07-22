---
name: resume
description: Bootstrap a fresh session from the last handoff — pull, read state, brief me
---

Bootstrap this session from the last one:
1. `git pull` origin on the current branch. If there are uncommitted local changes,
   stash → pull --rebase → unstash, and flag any conflicts.
2. Find the newest `handoff-*.md` directly inside `./docs/handoffs/` (ignore
   subdirectories) and read it fully.
3. Check `git log` for commits NEWER than that handoff — /sync commits, cloud-session
   commits, mission/standup auto-commits. Read their messages INCLUDING bodies (/sync
   stores in-flight state there). Where they contradict the handoff, the commits win —
   the handoff is stale.
4. If the working tree is dirty (including `.claude/agent-memory/`), flag it: that is
   unpersisted state from a session that never wrapped.
5. Brief me in 5 lines max: where we left off, what's in flight (per the freshest
   source), and the #1 next step. Then wait for my go.
(A handoff brief is producer reasoning — never paste it into a qa-verifier work order.)
