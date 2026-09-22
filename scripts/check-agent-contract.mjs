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
 * Rules AGENTS.md promises are loaded in EVERY session, named individually.
 *
 * 🔴 The anchor above accepts any file under `.claude/rules`, so either of
 * these could be deleted while the other kept the directory non-empty and the
 * check stayed green. AGENTS.md names them because their loading behaviour is
 * the point — one prevents a failure that arrives before any file is read, the
 * other is path-scoped — so membership of the directory is not what has to
 * hold. Their exact presence is.
 */
/**
 * The one file the guidance scan does not read: its own test.
 *
 * That test necessarily contains guidance paths that do NOT resolve — fixtures
 * asserting the scanner reports a dead citation. Reading them makes the check
 * fail on the evidence that it works, which is the instrument treating its own
 * test data as its subject.
 *
 * The cost is stated rather than hidden: a genuinely stale citation written in
 * this one file would be missed. It is the file whose maintainer is by
 * definition looking at the scanner, and every other test file — including the
 * `.test.ts` where one of the original four stale citations actually lived —
 * is still read.
 */
export const GUIDANCE_SCAN_EXCLUDES = ["scripts/check-agent-contract.test.mjs"];

export const REQUIRED_RULES = [
  ".claude/rules/whole-file-writes.md",
  ".claude/rules/integration-tests.md",
];

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
  // The OPEN fence, or null. Markdown allows `~~~` as well as backticks, and a
  // block opened with one is not closed by the other — so tracking a boolean
  // "are we fenced" misreads both. A tilde-fenced block was invisible to this
  // reader entirely, which meant a stale command inside one passed CI.
  let fence = null;
  for (const line of text.split("\n")) {
    const match = /^\s*(`{3,}|~{3,})/.exec(line);
    if (match) {
      const char = match[1][0];
      const length = match[1].length;
      if (fence === null) {
        fence = { char, length };
        continue;
      }
      // A closing fence uses the same character and is at least as long as the
      // one that opened the block; anything else is content inside it.
      if (char === fence.char && length >= fence.length) {
        fence = null;
        continue;
      }
    }
    if (fence !== null) {
      spans.push(line);
      continue;
    }
    for (const span of line.matchAll(/`([^`]+)`/g)) spans.push(span[1]);
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
    // A shell comment is not part of the command. `pnpm --filter <pkg>... build
    // # trailing ... includes <pkg>` otherwise reads "trailing" as a subcommand.
    const words = match[1].split("#")[0].trim().split(/\s+/).filter(Boolean);
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
    // Words after the script name. `pnpm --filter playground nextly
    // generate:types` runs the `nextly` launcher and then a CLI subcommand
    // this module cannot check: subcommands belong to the tool, and listing
    // them here would be a second copy of the tool's own command table — the
    // recomputation `derived-checks` exists to prevent. So the subcommand is
    // REPORTED as unverified rather than silently passing, because silence
    // from a checker reads as coverage.
    const subcommand = words.slice(i + 1).find(word => /^[a-z][a-z0-9:-]*$/.test(word)) ?? null;
    found.set(`${filter ?? ""}\u0000${cleaned}`, { filter, name: cleaned, subcommand });
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

/**
 * Whether an unresolved BARE filename is a claim about a file that should exist.
 *
 * Requiring a `/` was the first rule, and it discarded `context7.json`,
 * `AGENTS.measured.md`, `docker-compose.test.yml` and `.nvmrc` — concrete
 * repository files that could be renamed away while the check stayed green.
 *
 * Dropping the requirement outright is worse. Measured over the instruction
 * files as they stand, it reports 20 references that are all perfectly valid:
 * workflow names like `ci.yml` and `labeler.yml`, component basenames like
 * `FieldRenderer.tsx`, and bare suffixes like `.md` and `.test.mjs` that name
 * no file at all.
 *
 * What separates them is whether ANY file in the repository carries that
 * basename. `ci.yml` does, at `.github/workflows/ci.yml`, so the reference is
 * live. A deleted `context7.json` would carry none, which is exactly the
 * staleness worth reporting. Measured against the same corpus: 0 false
 * positives, and all three probe deletions reported.
 */
export function claimsBareFile(name, basenames, rootFiles) {
  // A dot-led token is a suffix pattern (`.test.mjs`) unless it is a real root
  // file (`.fallowrc.jsonc`), and a suffix names nothing to check.
  if (name.startsWith(".") && !rootFiles.has(name)) return false;
  return !basenames.has(name);
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
  const present = new Set(files);
  return [
    ...ANCHORS.filter(
      anchor => !files.some(file => file === anchor || file.startsWith(`${anchor}/`))
    ),
    ...REQUIRED_RULES.filter(rule => !present.has(rule)),
  ];
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

/**
 * References to agent-guidance files made ANYWHERE in the repository.
 *
 * 🔴 Moving a rule into a skill left four citations of the old rules path
 * behind, all of them in .ts source comments. The cleanup that missed them
 * searched only Markdown and .mjs files and then reported "none" — a
 * population that excluded every file carrying the problem, answering
 * confidently about a set it never read.
 *
 * Note that this comment names no path in backticks, deliberately: the scanner
 * below reads code spans, so an example written as a citation becomes a
 * finding about itself.
 *
 * So this scans EVERY tracked file rather than the instruction files, and
 * looks only for `.claude/...` paths. Narrow subject, complete population:
 * the opposite trade from the rest of this module, and the right one here
 * because the citation is unambiguous wherever it appears.
 */
export function guidanceReferences(text) {
  const found = new Set();
  for (const match of text.matchAll(/`(\.claude\/[A-Za-z0-9._/-]+)`/g)) {
    found.add(match[1].replace(/[.,;:)]+$/, ""));
  }
  return found;
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

  // Every basename in the repository, so a bare reference can be told from a
  // stale one. Read once rather than per file.
  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const basenames = new Set(tracked.map(path => path.split("/").pop()));
  const rootFiles = new Set(tracked.filter(path => !path.includes("/")));

  const scripts = new Set(
    Object.keys(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {})
  );
  const byWorkspace = workspaceScripts();

  const findings = [];
  // Claims this module can see but cannot decide. Kept apart from findings:
  // an advisory check must not report what it could not check as a failure,
  // and must not let its silence imply it checked.
  const unverified = [];

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
    for (const { filter, name, subcommand } of pnpmScriptsIn(text)) {
      if (subcommand !== null) {
        unverified.push({ file, claim: `pnpm ${filter ? `--filter ${filter} ` : ""}${name} ${subcommand}` });
      }
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
    const unresolved = [...pathsIn(text)].filter(path => {
      if (existsSync(join(root, path)) || existsSync(join(near, path))) return false;
      return path.includes("/")
        ? claimsRepoRoot(path, topLevel)
        : claimsBareFile(path, basenames, rootFiles);
    });
    const ignored = gitIgnored(unresolved);
    for (const path of unresolved) {
      if (ignored.has(path)) continue;
      findings.push({ file, kind: "path", claim: path });
    }
  }

  // Every tracked file, for the narrow `.claude/...` scan above.
  const guidanceMisses = new Map();
  for (const file of tracked) {
    if (GUIDANCE_SCAN_EXCLUDES.includes(file)) continue;
    let text;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue; // binary, or removed since `git ls-files` ran
    }
    for (const reference of guidanceReferences(text)) {
      if (existsSync(join(root, reference))) continue;
      if (!guidanceMisses.has(reference)) guidanceMisses.set(reference, []);
      guidanceMisses.get(reference).push(file);
    }
  }
  // Asked once for the whole set: a gitignored path is not a claim that a file
  // exists, and `.claude/settings.local.json` is written per worktree.
  const ignoredGuidance = gitIgnored([...guidanceMisses.keys()]);
  for (const [reference, files] of guidanceMisses) {
    if (ignoredGuidance.has(reference)) continue;
    for (const file of files) findings.push({ file, kind: "guidance", claim: reference });
  }

  if (asJson) {
    console.log(JSON.stringify({ files: files.length, findings, unverified }, null, 2));
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

  if (unverified.length > 0) {
    console.log(`\n${unverified.length} reference(s) name a tool subcommand this does not check:`);
    for (const { file, claim } of unverified) console.log(`  ${file}: ${claim}`);
    console.log("  The launcher script is checked; the subcommand belongs to that tool.");
  }

  process.exit(findings.length > 0 ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith("check-agent-contract.mjs")) {
  main();
}
