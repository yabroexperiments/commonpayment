# External Code Vetting Protocol (ECVP)

**Established 2026-07-21 (Albert's directive).** This is the mandatory
protocol for bringing ANY external artifact into our environment:
skills, plugins, MCP servers, prompts, workflows, agents, npm/pip
packages, scripts, templates, or copy-pasted code from the internet.

**Prime directive: no single check is ever a green light.** In June
2026 a fake AI-agent skill *passed automated security scans* and
reached ~26,000 agents ([The Hacker News](https://thehackernews.com/2026/06/fake-ai-agent-skill-passed-security.html)).
Snyk's ToxicSkills study found **36.8% of public agent skills have at
least one security flaw and 13.4% carry a critical issue**, with 1,467
malicious payloads found on ClawHub/skills.sh alone. Scanners are one
layer. The protocol is defense-in-depth: every phase must pass.

**Who does what:** Albert (non-technical) only ever reads plain-English
verdicts and makes go/no-go calls. The agent (Claude/Codex) performs
every technical step. Albert never needs to read code.

---

## The pipeline: SCAN → ANALYZE → QUARANTINE → MERGE → MONITOR

Invoke via the `/vet <url-or-name>` command (`.claude/commands/vet.md`).

### Phase 0 — INTAKE (source trust, before anything is downloaded)

1. **Resolve the TRUE owner.** Follow redirects to the canonical repo.
   Check the owner is the real org (verified badge / known account),
   not a typosquat (`nvidla`, `anthropic-labs`, `vercel-ai-official`).
   Brand name in the repo title means nothing; the OWNER is identity.
2. **Ignore star counts as proof.** Stars are gameable — we have
   personally observed absurdly inflated counts in GitHub search
   results (2026-07-21). Weigh instead: real commit history (age,
   cadence, multiple contributors), real issues/PRs from real users,
   a recognizable author, a real license.
3. **Trust tiers** (record in the verdict):
   - **T1 — Official/first-party:** Anthropic, the tool's own vendor
     (e.g. Figma's MCP for Figma), major orgs (NVIDIA, Google, Vercel,
     Microsoft). Still scan, lighter analysis.
   - **T2 — Known community:** established author, months of history,
     used by others we can see. Full pipeline.
   - **T3 — Unknown/new:** anonymous or fresh account, <3 months old,
     no track record. Full pipeline + default-deny posture: needs a
     strong reason to proceed at all.
4. Anything failing intake (typosquat, deceptive owner, no license) →
   **RED, stop, do not download.**

### Phase 1 — SCAN (automated tooling; pick by artifact type)

Run in an ISOLATED session/container, never on a machine holding
production secrets. Scanners read the artifact; they do not run it.

| Artifact | Primary scanner | Notes |
|---|---|---|
| Agent skill (SKILL.md + files) | **NVIDIA SkillSpector** ([NVIDIA/SkillSpector](https://github.com/NVIDIA/SkillSpector), Apache-2.0, ~13.5k★) | 68 static patterns / 17 categories + optional LLM stage. Start static-only (no API key, nothing leaves the machine). Vetted by us 2026-07-21. |
| MCP server | **mcp-scan** (Invariant Labs → Snyk, most-adopted MCP scanner) | Detects tool poisoning, prompt injection, cross-origin escalation, rug pulls. Also has a runtime-proxy mode for Phase 3/5. |
| npm / pip package | **Socket.dev** (behavioral: what the package DOES on install/runtime — catches exfiltration CVE scanners miss; free for OSS) + **OSV-Scanner** (Google, Apache-2.0; known-CVE lookup) | Socket = behavior, OSV = advisories. They cover different failure modes; run both when a lockfile changes. |
| Skill quality (not security) | skillspector-quality (community layer on SkillSpector) | Optional; quality score only. |

Reference roster for new tools/attacks: [awesome-agent-skills-security](https://github.com/LLMSecurity/awesome-agent-skills-security).
Also notable (enterprise/alternative): Snyk Agent Scan, Cisco Skill
Scanner. Re-check this table ~quarterly; the field moves fast.

Any HIGH/CRITICAL finding → **RED** (stop) unless the agent can prove a
false positive in Phase 2 with file-level evidence.

### Phase 2 — ANALYZE (manual + LLM review; the scanner-bypass net)

Because scanners are bypassable (multimodal/hidden-instruction attacks
are documented — [arXiv 2606.18198](https://arxiv.org/pdf/2606.18198)),
the agent reads **every file** and reports:

1. **Instruction layer** (all `.md`, prompts, tool descriptions): any
   directive to run shell commands, read env/secrets/credentials,
   fetch remote URLs, "ignore previous instructions", base64/hex
   blobs, zero-width or non-ASCII obfuscation, instructions hidden in
   images or HTML comments.
2. **Code layer** (every script): what it executes, reads, writes,
   and *where it sends anything*. The kill-pattern is
   **file/secret read + network write in the same artifact** — the
   exfiltration shape.
3. **Capability honesty:** does it need everything it asks for? A
   design skill wanting network access or an auth login is a mismatch
   → at minimum YELLOW with the mismatch named.
4. **Update surface:** does anything fetch remote code at runtime
   (curl|bash, auto-updaters, unpinned "latest")? That defeats
   pinning → YELLOW/RED depending on what it fetches.

Output: **GREEN / YELLOW (usable with named conditions) / RED**, in
plain language, with the evidence. Albert decides on YELLOW.

### Phase 3 — QUARANTINE TEST (watch it behave before it touches anything real)

1. **Environment:** a throwaway cloud session or container with
   **zero real secrets** (no `.env.local`, no payment/DB/API keys, no
   `RECOVERY/`), scope-locked to a dummy or empty repo. Never test
   first-runs inside a real project repo.
2. **Exercise it** on a realistic dummy task (for a design skill:
   generate a page in a scratch project).
3. **Observe:** unexpected network calls, reads outside its working
   dir, spawned processes, files written outside scope. For MCP
   servers, run behind mcp-scan's proxy mode and read the traffic log.
4. Any surprise → RED, discard the session, nothing real was exposed.

### Phase 4 — MERGE (pin, vendor, record)

Only after Phases 0–3 pass and Albert approves:

1. **Pin the exact reviewed version** — commit SHA or exact release,
   never "latest"/floating tags/auto-update.
2. **Vendor when practical** (commit the reviewed copy into our repo)
   so the running copy IS the audited copy and every future change is
   a visible git diff.
3. **Record it in `docs/vetted-external-code.md`** (the registry):
   name, source URL, pinned SHA/version, trust tier, scanners run,
   verdict, date, session. Unregistered external code = unvetted, no
   exceptions.
4. **Least privilege:** grant only the permissions it demonstrably
   needs (Phase 3 evidence is the reference).

### Phase 5 — MONITOR (trust decays; rug pulls are a real attack class)

1. **Updates are new vettings.** Never blind-update. Diff pinned SHA →
   new version; re-run Phase 1 scans on the diff; small diffs get a
   quick pass, big ones the full pipeline. (A "rug pull" = benign at
   review time, malicious in a later update — this is why we pin.)
2. **Periodic sweep** (~monthly, or at session start when the registry
   is stale): for each registry entry, check the upstream repo still
   exists, hasn't changed owners, and has no security advisories/
   issues reporting compromise.
3. **Incident rule:** if anything vetted is later reported malicious →
   remove immediately, rotate any secret the artifact could have seen
   (see `RECOVERY/` worksheet), note it in the registry, write it into
   CLAUDE.md if a durable lesson emerges.

---

## Hard rules (non-negotiable)

- **No scanner verdict is a green light by itself.** All phases, every time.
- **Secrets and unvetted code never meet.** First contact is always in
  a disposable, secret-free environment.
- **RED on any single phase = stop.** Phases are AND-ed, not averaged.
- **T3 (unknown author) + wants network/auth/secrets = automatic RED.**
  No amount of scanning rescues that combination.
- **The registry is the whitelist.** In the environment but not in the
  registry → treat as unvetted, vet or remove.
- **100% certainty does not exist.** The protocol's job is to make
  residual risk small, understood, and reversible — not zero.

## Sources (research pass 2026-07-21)

- [NVIDIA SkillSpector](https://github.com/NVIDIA/SkillSpector) · [mcp-scan review](https://appsecsanta.com/mcp-scan) · [MCP security tools roundup](https://www.akto.io/blog/mcp-security-tools)
- [Snyk ToxicSkills study](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/) · [Unit 42: Trust No Skill](https://unit42.paloaltonetworks.com/ai-agent-supply-chain-risks/)
- [Fake skill passed scans, reached 26k agents](https://thehackernews.com/2026/06/fake-ai-agent-skill-passed-security.html) · [Scanner-bypass research](https://arxiv.org/pdf/2606.18198) · [SkillSieve triage framework](https://arxiv.org/pdf/2604.06550)
- [awesome-agent-skills-security](https://github.com/LLMSecurity/awesome-agent-skills-security) · [Socket alternatives comparison](https://appsecsanta.com/sca-tools/socket-alternatives)
