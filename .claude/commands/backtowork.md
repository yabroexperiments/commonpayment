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
5. Codex PR review findings. The ChatGPT Codex GitHub app (`chatgpt-codex-connector[bot]`,
   enabled on yabro-hq since 2026-10-13) reviews every PR — but `/wrap` merges in the same
   minute, so its findings land on already-merged PRs where nobody reads them. List the ones
   nobody has handled yet (no reply, no 👍/👎 reaction) on the last 10 merged PRs:
   ```bash
   repo=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null) || echo "codex-findings: SKIPPED (gh unavailable or no GitHub remote)"
   for n in $(gh pr list --state merged --limit 10 --json number -q '.[].number' 2>/dev/null); do
     gh api "repos/$repo/pulls/$n/comments" | jq -r --arg n "$n" '. as $all | .[]
       | select(.user.login=="chatgpt-codex-connector[bot]" and .in_reply_to_id==null)
       | select(.reactions["+1"]==0 and .reactions["-1"]==0) | . as $c
       | select([$all[] | select(.in_reply_to_id==$c.id)] | length==0)
       | "PR #\($n) \(.path):\(.line // .original_line) — \(.body | split("\n")[0] | gsub("<[^>]*>|!\\[[^]]*\\]\\([^)]*\\)|\\*\\*";"") | ltrimstr("  "))"'
   done
   ```
   Empty output = nothing owed (most repos: the app is only on yabro-hq). Each line is an
   in-flight item for the brief; it is closed by replying on the PR comment or reacting
   👍/👎 to it, never by ignoring it. A finding is a claim — verify it against the repo
   before acting (two of the first five were right, one proposed the wrong fix).
6. Brief me in 5 lines max: where we left off, what's in flight (per the freshest
   source, including step 5's findings), and the #1 next step. Then wait for my go.
(A handoff brief is producer reasoning — never paste it into a qa-verifier work order.)
