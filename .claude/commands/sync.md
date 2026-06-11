---
name: sync
description: Quick machine-hop — commit & push everything, no full handoff ceremony
---

Quick sync (no handoff brief). I'm just hopping machines:
1. git status. Stage everything including untracked files.
2. Commit with a short summary of what's currently in progress.
3. Push to origin. If rejected, pull --rebase and retry.
4. Show git log -1 to confirm.
(Run git inside the specific repo subfolder we worked in, not the ClaudeCodex root.)
