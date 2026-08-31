#!/usr/bin/env node
// dep-vet-guard.mjs — CI-side ECVP guard: fails when a push/PR ADDS a dependency
// whose name is not in the repo's own docs/vetted-external-code.md registry.
//
// This is the server-side twin of the local ecvp-install-gate.sh (which cloud /
// Codex sessions never inherit — hooks don't travel, CI does; same doctrine as
// the secret guard, workspace rule 12). Existing deps are grandfathered: only
// names ADDED in the examined range trigger. Adding a dep therefore requires
// adding its registry row in the same push — which is exactly the visibility
// the 2026-08-31 ingestion incident lacked (RCA:
// yabro-hq/docs/security/2026-08-31-ecvp-ingestion-rca.md).
//
// Usage: node scripts/dep-vet-guard.mjs <BASE_SHA> <HEAD_SHA>
//   BASE may be invalid (all-zero on branch creation) → falls back to HEAD^;
//   no parent at all (initial commit) → exits 0 with a loud note.
// Covers: package.json (deps/devDeps/optionalDeps/peerDeps, any dir outside
// node_modules), requirements*.txt, pyproject.toml (crude added-string scan —
// stated, not hidden). git+ deps on github.com/yabroexperiments auto-pass
// (our own shared packages, governed by their own repos' vetting).

import { execFileSync } from "node:child_process";

const [, , baseArg, headArg] = process.argv;
const HEAD = headArg || "HEAD";

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function resolveBase(candidate) {
  if (candidate && !/^0+$/.test(candidate) && git("cat-file", "-e", `${candidate}^{commit}`) !== null) return candidate;
  if (git("cat-file", "-e", `${HEAD}^`) !== null) return `${HEAD}^`;
  return null;
}

const BASE = resolveBase(baseArg);
if (!BASE) {
  console.log("DEP-VET-GUARD: no diff base (initial commit?) — cannot diff; run /vet on the full manifest set manually.");
  process.exit(0);
}

const changed = (git("diff", "--name-only", BASE, HEAD) || "")
  .split("\n")
  .filter(Boolean)
  .filter((p) => !p.includes("node_modules/"))
  .filter((p) => /(^|\/)package\.json$|(^|\/)requirements[^/]*\.txt$|(^|\/)pyproject\.toml$/.test(p));

if (changed.length === 0) {
  console.log("DEP-VET-GUARD: no dependency manifests changed. OK");
  process.exit(0);
}

const show = (ref, path) => git("show", `${ref}:${path}`); // null when absent at ref

function npmDeps(jsonText) {
  const out = new Map(); // name -> spec
  if (!jsonText) return out;
  let j;
  try { j = JSON.parse(jsonText); } catch { return out; }
  for (const k of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [name, spec] of Object.entries(j[k] || {})) out.set(name, String(spec));
  }
  return out;
}

function pipDeps(text) {
  const out = new Set();
  if (!text) return out;
  for (let line of text.split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
    if (m) out.add(m[1].toLowerCase());
  }
  return out;
}

function pyprojectNames(text) {
  const out = new Set();
  if (!text) return out;
  // crude: quoted requirement strings anywhere in the file
  for (const m of text.matchAll(/"([A-Za-z0-9][A-Za-z0-9._-]*)\s*[<>=!~[;"]/g)) out.add(m[1].toLowerCase());
  return out;
}

const added = []; // {name, spec, file}
for (const f of changed) {
  const oldT = show(BASE, f);
  const newT = show(HEAD, f);
  if (!newT) continue; // deleted manifest = nothing added
  if (f.endsWith("package.json")) {
    const o = npmDeps(oldT), n = npmDeps(newT);
    for (const [name, spec] of n) if (!o.has(name)) added.push({ name, spec, file: f });
  } else if (/requirements[^/]*\.txt$/.test(f)) {
    const o = pipDeps(oldT), n = pipDeps(newT);
    for (const name of n) if (!o.has(name)) added.push({ name, spec: "", file: f });
  } else if (f.endsWith("pyproject.toml")) {
    const o = pyprojectNames(oldT), n = pyprojectNames(newT);
    for (const name of n) if (!o.has(name)) added.push({ name, spec: "", file: f });
  }
}

if (added.length === 0) {
  console.log("DEP-VET-GUARD: manifests changed but no dependency names added. OK");
  process.exit(0);
}

const OWN_ORG = /github\.com[:/]yabroexperiments\//;
const registry = show(HEAD, "docs/vetted-external-code.md");
const regLower = (registry || "").toLowerCase();

const violations = [];
for (const a of added) {
  if (OWN_ORG.test(a.spec)) {
    console.log(`DEP-VET-GUARD: allow ${a.name} (own-org git dep) [${a.file}]`);
    continue;
  }
  if (registry && regLower.includes(a.name.toLowerCase())) {
    console.log(`DEP-VET-GUARD: allow ${a.name} (found in registry) [${a.file}]`);
    continue;
  }
  violations.push(a);
}

if (violations.length) {
  console.error("");
  console.error("DEP-VET-GUARD: FAILED — dependency additions with no row in docs/vetted-external-code.md:");
  for (const v of violations) console.error(`  ✗ ${v.name}${v.spec ? " @ " + v.spec : ""}  (${v.file})`);
  console.error("");
  console.error(registry === null
    ? "This repo has NO docs/vetted-external-code.md at all — create it (ECVP Phase 4)."
    : "ECVP: every new dependency needs /vet + AC approval + a registry row IN THE SAME PUSH.");
  console.error("Spec: docs/external-code-vetting-protocol.md (Phase 2 item 6).");
  process.exit(1);
}
console.log("DEP-VET-GUARD: all dependency additions accounted for in the registry. OK");
