---
name: backtowork
description: Bootstrap a fresh session from the last handoff — pull, read state, brief me
---

Bootstrap this session from the last one:
0. FIRST, before reading ANY git state: if `git rev-parse --is-shallow-repository`
   says `true`, run `git fetch --unshallow --tags && git fetch --prune`. A shallow
   clone (fresh cloud sessions clone `--depth 50`) truncates history at graft points,
   so git cannot find the true merge-base and REPORTS FICTION: a phantom
   `forced update`, invented ahead/behind, `merge-base --is-ancestor` answering NO
   for a plain ancestor, `branch -r --contains` finding nothing. Measured on famchat
   2026-09-04: "ahead 78, behind 51, divergent" was really `ahead 0, behind 57` with
   nothing lost. **NEVER `reset --hard`, force-push, or "recover" a branch in response
   to apparent divergence in a fresh session.** Unshallow, re-measure, and if it still
   looks divergent STOP and ask AC — do not repair it.
1. `git pull` origin on the current branch. If there are uncommitted local changes,
   they may belong to a PARALLEL session: check mtimes (seconds old = someone is
   typing) before touching them. stash → pull --rebase → unstash, and flag conflicts.
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
