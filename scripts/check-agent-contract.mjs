#!/usr/bin/env node

/**
 * Agent instructions name commands and files. This asserts those still exist.
 *
 * The failure it exists to stop was measured: `AGENTS.md` recorded that
 * `pnpm docker:test` does NOT start the integration containers — it probes the
 * DEV stack's `postgres` service — while
 * `.claude/skills/writing-integration-tests/SKILL.md` and
 * `.claude/rules/integration-tests.md` both told the reader to start them with
 * it. An agent following either walked into the exact trap `AGENTS.md`
 * documents, and nothing in the repository could tell the three apart. One
 * operational fact in three places drifted in two of them.
 *
 * This cannot check that prose is TRUE. What it can check is that every command
 * and path the prose names still resolves, which is the half that rots on its
 * own as scripts are renamed and files move.
 *
 * ⚠️ ADVISORY, deliberately. Per `derived-checks.md`, a check whose miss costs
 * only the defect it failed to report must prefer the miss: a guard that fires
 * on correct prose gets suppressed and takes its true positives with it. So the
 * SUPPRESSING conditions below are wide — globs, placeholders, URLs and
 * anything ambiguous are skipped — and the reporting predicate is narrow.
 *
 * Usage:
 *   node scripts/check-agent-contract.mjs
 *   node scripts/check-agent-contract.mjs --json
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The files whose claims are checked, and the anchors that must be among them.
 *
 * ANCHORS is the population assertion `derived-checks.md` asks for: an empty or
 * under-collected file set reports zero findings, which is byte-identical to a
 * clean run. Asserting a nonzero COUNT would not separate them either — a
 * collector that dropped `AGENTS.md` and picked up three skills matches any
 * total. So membership is what gets asserted, by name.
 */
export const ANCHORS = ["AGENTS.md", ".claude/rules", ".claude/skills"];

/**
 * `pnpm <word>` that is not a script: pnpm's own verbs, and the binaries the
 * workspace exposes through its dependencies. A name here is never reported.
 */
export const PNPM_BUILTINS = new Set([
  "add", "audit", "bin", "config", "create", "dedupe", "deploy", "dlx", "env",
  "exec", "fetch", "i", "import", "init", "install", "licenses", "link", "list",
  "ls", "outdated", "pack", "patch", "patch-commit", "prune", "publish",
  "rebuild", "recursive", "remove", "rm", "root", "run", "server", "setup",
  "start", "store", "unlink", "update", "why",
  // Binaries reached through the workspace rather than through a script.
  "turbo", "vitest", "eslint", "prettier", "tsc", "changeset", "sherif",
  "playwright", "fallow",
]);

/** Extensions that make a backticked token a file reference rather than prose. */
const PATH_EXTENSIONS = [
  ".ts", ".tsx", ".mjs", ".cjs", ".js", ".json", ".jsonc", ".yml", ".yaml",
  ".md", ".mdx", ".sh", ".css", ".toml",
];

/**
 * The inline code spans and fenced-block lines of a Markdown document.
 *
 * Claims about commands and files are made in code formatting; prose that
 * merely mentions pnpm is not an invocation. Measured on `AGENTS.md`, reading
 * the raw text instead reported `pnpm settings`, `pnpm reads` and `pnpm a` from
 * three ordinary English sentences — the advisory false positives this module's
 * header says to prefer missing.
 */
export function codeSpans(text) {
  const spans = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      spans.push(line);
      continue;
    }
    for (const match of line.matchAll(/`([^`]+)`/g)) spans.push(match[1]);
  }
  return spans;
}

/**
 * Every `pnpm ...` invocation in the text, reduced to the script it names.
 *
 * `--filter <pkg>` and `run` are stepped over so the script name is reached in
 * either spelling. A flag-led invocation (`pnpm -r ...`) yields nothing rather
 * than guessing.
 */
export function pnpmScriptsIn(text) {
  const found = new Map();
  for (const span of codeSpans(text)) {
    const match = /^\s*pnpm\s+(.*)$/.exec(span);
    if (!match) continue;
    const words = match[1].trim().split(/\s+/);
    let i = 0;
    let filter = null;
    while (i < words.length) {
      const word = words[i];
      if (word === "--filter" || word === "-F") {
        // `<pkg>...`, `<pkg>^...` and a bare name all name the same workspace.
        filter = (words[i + 1] ?? "").replace(/\^?\.{3}$/, "");
        i += 2;
        continue;
      }
      if (word === "run" || word === "-r" || word === "--recursive") {
        i += 1;
        continue;
      }
      break;
    }
    const name = words[i];
    if (!name) continue;
    // A trailing `...` is pnpm's "and its dependents" selector in a filter and
    // an ellipsis in prose; neither is part of the script name.
    const cleaned = name.replace(/\.{3}$/, "").replace(/[.,;:)]+$/, "");
    if (!/^[a-z][a-z0-9:-]*$/.test(cleaned)) continue;
    if (PNPM_BUILTINS.has(cleaned)) continue;
    found.set(`${filter ?? ""}\u0000${cleaned}`, { filter, name: cleaned });
  }
  return [...found.values()];
}

/**
 * The scripts each workspace declares, keyed by the name a `--filter` would use.
 *
 * A filter naming a workspace this cannot find yields no entry, and the caller
 * skips rather than reporting — the advisory polarity again. A placeholder like
 * `<pkg>` is exactly that case.
 */
export function workspaceScripts(base = root) {
  const byName = new Map();
  for (const dir of ["packages", "apps"]) {
    const full = join(base, dir);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full)) {
      const manifest = join(full, entry, "package.json");
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      const names = new Set(Object.keys(pkg.scripts ?? {}));
      byName.set(pkg.name, names);
      byName.set(entry, names);
    }
  }
  return byName;
}

/**
 * Backticked tokens that name a file in this repository.
 *
 * Everything ambiguous is dropped rather than guessed at, which is the advisory
 * polarity: a glob, a placeholder, a URL, an absolute path and a home-relative
 * path are all legitimate in prose and none of them is a claim about a file
 * that exists at a fixed location.
 */
export function pathsIn(text) {
  const found = new Set();
  for (const token of codeSpans(text).map(span => span.trim())) {
    if (!token.includes("/")) continue;
    if (/[*?[\]{}<>()\s|$]/.test(token)) continue;
    if (token.startsWith("/") || token.startsWith("~") || token.startsWith("@")) continue;
    if (/^[a-z]+:\/\//.test(token)) continue;
    // A path with a line or symbol suffix (`file.ts:42`) still names a file.
    const path = token.split(":")[0];
    if (!PATH_EXTENSIONS.some(ext => path.endsWith(ext))) continue;
    found.add(path);
  }
  return found;
}

/**
 * Whether a path that did not resolve is a CLAIM about this repository.
 *
 * Instruction files cite fragments constantly — `src/config.ts` inside
 * `packages/nextly/AGENTS.md` means that package's file, and
 * `collections/fields/catalog.ts` in a skill is a tail of a longer path the
 * surrounding prose supplies. Neither names a location this can check, so
 * neither is reported. Only a path whose first segment is a real top-level
 * directory is asserting where it lives.
 */
export function claimsRepoRoot(path, topLevel) {
  return topLevel.has(path.split("/")[0]);
}

/** Every `.md` under a directory, recursively. */
function markdownUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...markdownUnder(full));
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}

/** The instruction files this repository ships, as repo-relative paths. */
export function instructionFiles(base = root) {
  const files = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    if (existsSync(join(base, name))) files.push(name);
  }
  for (const dir of ["packages", "apps"]) {
    const full = join(base, dir);
    if (!existsSync(full)) continue;
    for (const pkg of readdirSync(full)) {
      const nested = join(full, pkg, "AGENTS.md");
      if (existsSync(nested)) files.push(`${dir}/${pkg}/AGENTS.md`);
    }
  }
  for (const dir of [".claude/rules", ".claude/skills"]) {
    for (const found of markdownUnder(join(base, dir))) {
      files.push(found.slice(base.length + 1));
    }
  }
  return files;
}

/**
 * Which anchors the collected file set actually covers.
 *
 * Returns the MISSING ones, so the caller refuses on a set that cannot have
 * found anything rather than reporting its emptiness as a pass.
 */
export function missingAnchors(files) {
  return ANCHORS.filter(anchor =>
    !files.some(file => file === anchor || file.startsWith(`${anchor}/`))
  );
}

/**
 * The skills AGENTS.md routes to, and the skills that exist, must be one set.
 *
 * The router table is a derived view of `.claude/skills/`, and a derived view
 * drifts — which this repository has a rule about. Both directions matter and
 * they fail differently: a routed skill that does not exist sends a reader to
 * nothing, and a skill absent from the router is knowledge that loads only if
 * its description happens to win, with no fallback.
 */
export function routerDisagreements(routed, present) {
  return [
    ...[...routed].filter(name => !present.has(name)).map(name => ({ name, side: "routed but absent from .claude/skills" })),
    ...[...present].filter(name => !routed.has(name)).map(name => ({ name, side: "present in .claude/skills but not routed by AGENTS.md" })),
  ];
}

/** Skill names the AGENTS.md router table names, read from its rows. */
export function routedSkills(agentsMd) {
  const names = new Set();
  for (const row of agentsMd.matchAll(/^\|\s*`([a-z][a-z0-9-]*)`\s*\|/gm)) {
    names.add(row[1]);
  }
  return names;
}

/**
 * Paths git is told to ignore, out of a candidate list.
 *
 * A gitignored path is not a claim that a file exists — `.claude/settings.
 * local.json` is written per worktree and is absent from a fresh clone by
 * design, so reporting it is a finding against correct prose. `check-ignore`
 * is asked rather than `.gitignore` re-parsed, because the rules compose
 * across files, negations and precedence, and a second reader of them would be
 * the recomputation this repository has a rule about.
 */
export function gitIgnored(paths, cwd = root) {
  if (paths.length === 0) return new Set();
  try {
    const out = execFileSync("git", ["check-ignore", "--stdin"], {
      cwd,
      input: paths.join("\n"),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return new Set(out.split("\n").filter(Boolean));
  } catch (error) {
    // `check-ignore` exits 1 when NOTHING matched, which is an answer rather
    // than a failure; anything else means git could not be asked, and an
    // unavailable answer must not read as "nothing is ignored".
    if (error.status === 1) return new Set(String(error.stdout ?? "").split("\n").filter(Boolean));
    throw new Error(`agent-contract: could not ask git which paths are ignored: ${error.message}`);
  }
}

function main() {
  const asJson = process.argv.includes("--json");
  const files = instructionFiles();

  const absent = missingAnchors(files);
  if (absent.length > 0) {
    console.error(
      `agent-contract: no instruction files found under ${absent.join(", ")} — ` +
        `NOT CHECKABLE, which is not clean`
    );
    process.exit(2);
  }

  // The real top-level directories, read rather than listed: a hand-kept list
  // is the recomputation this repository has a rule about.
  const topLevel = new Set(
    readdirSync(root).filter(entry => statSync(join(root, entry)).isDirectory())
  );

  const scripts = new Set(
    Object.keys(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {})
  );
  const byWorkspace = workspaceScripts();

  const findings = [];

  const skillsDir = join(root, ".claude/skills");
  const present = new Set(
    existsSync(skillsDir)
      ? readdirSync(skillsDir).filter(name =>
          existsSync(join(skillsDir, name, "SKILL.md"))
        )
      : []
  );
  const routed = routedSkills(readFileSync(join(root, "AGENTS.md"), "utf8"));
  for (const { name, side } of routerDisagreements(routed, present)) {
    findings.push({ file: "AGENTS.md", kind: "router", claim: `${name} — ${side}` });
  }

  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    for (const { filter, name } of pnpmScriptsIn(text)) {
      if (filter === null) {
        if (!scripts.has(name)) {
          findings.push({ file, kind: "script", claim: `pnpm ${name}` });
        }
        continue;
      }
      const declared = byWorkspace.get(filter);
      // An unknown filter is a placeholder, not a claim about a script.
      if (declared && !declared.has(name)) {
        findings.push({ file, kind: "script", claim: `pnpm --filter ${filter} ${name}` });
      }
    }
    // A nested AGENTS.md cites its own package's files relatively, so both
    // bases are tried before anything is reported.
    const near = dirname(join(root, file));
    const unresolved = [...pathsIn(text)].filter(
      path =>
        !existsSync(join(root, path)) &&
        !existsSync(join(near, path)) &&
        claimsRepoRoot(path, topLevel)
    );
    const ignored = gitIgnored(unresolved);
    for (const path of unresolved) {
      if (ignored.has(path)) continue;
      findings.push({ file, kind: "path", claim: path });
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ files: files.length, findings }, null, 2));
  } else if (findings.length > 0) {
    // The verdict first, because a refusal printed below a reader's `head` is
    // a refusal nobody saw — `derived-checks.md` on a gate's output.
    console.error(`agent-contract: FAIL — ${findings.length} stale reference(s)`);
    for (const { file, kind, claim } of findings) {
      console.error(`  ${file}: ${kind} '${claim}' does not resolve`);
    }
    console.error(`\nread ${files.length} instruction file(s)`);
  } else {
    console.log(`agent-contract: OK — ${files.length} instruction file(s), every reference resolves`);
  }

  process.exit(findings.length > 0 ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith("check-agent-contract.mjs")) {
  main();
}
