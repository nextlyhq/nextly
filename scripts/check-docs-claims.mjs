#!/usr/bin/env node

/**
 * Documentation and README claims must match what the repository actually ships.
 *
 * The failure this guards against is not carelessness. It is that a fact about the product —
 * "plugins are not ready", "the builder is called X", "this file lives on branch Y" — gets
 * written down in more than one place, and only some of the copies get updated. Every defect
 * this checks for was found in the repository, not imagined: a published package whose README
 * told npm visitors not to use it, nine published packages missing from the root README, four
 * links to a branch that no longer exists, and one product name written three different ways.
 *
 * A SCRIPT rather than a test, matching `check-comment-convention.mjs`: the rule spans docs,
 * package manifests and READMEs, so a test rooted in any one package would read as repository
 * coverage while checking a fraction of it.
 *
 * Usage:
 *   node scripts/check-docs-claims.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", ".next", ".turbo", ".changeset", "coverage",
]);

/**
 * Phrases that state a shipped thing is unavailable.
 *
 * A CURATED LIST is the mechanism here, unlike `dead-branch-link` below, which resolves what it
 * checks. There is no way to ask the repository whether a sentence is true, so the list names
 * the specific shapes that have gone stale, and the allowlist carries the ones that are
 * genuinely accurate. That difference is deliberate, not an inconsistency between the checks.
 */
const FORBIDDEN_PHRASES = [
  "coming soon",
  "not ready for use",
  "not yet available",
  "plugins are not ready",
];

/** The whole positioning failure traces to one overloaded word; this is what stops it recurring. */
const BARE_VISUAL_BUILDER = /(?<!schema )(?<!page )\bvisual builder\b/gi;

const REPO_LINK = /github\.com\/nextlyhq\/nextly\/(?:blob|tree|raw)\/([^/\s)]+)\//g;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** Files whose prose is a claim about the product. CHANGELOGs are excluded everywhere: they are
 *  Changesets' historical record, and rewriting history to satisfy a lint is worse than the lint. */
function proseFiles(repoRoot) {
  return walk(repoRoot)
    .filter(f => {
      if (basename(f) === "CHANGELOG.md") return false;
      const ext = extname(f);
      const rel = relative(repoRoot, f);
      if (ext === ".md" || ext === ".mdx") return true;
      return (
        (ext === ".ts" || ext === ".tsx" || ext === ".mjs") &&
        rel.split(sep)[0] === "packages"
      );
    });
}

function publishedPackages(repoRoot) {
  const pkgDir = join(repoRoot, "packages");
  if (!existsSync(pkgDir)) return [];
  const out = [];
  for (const name of readdirSync(pkgDir)) {
    const manifest = join(pkgDir, name, "package.json");
    if (!existsSync(manifest)) continue;
    let json;
    try {
      json = JSON.parse(readFileSync(manifest, "utf-8"));
    } catch {
      continue;
    }
    if (json.private) continue;
    out.push({ name: json.name, dir: join(pkgDir, name) });
  }
  return out;
}

/**
 * Resolve a git ref against the remote.
 *
 * `git ls-remote` rather than `rev-parse`, because CI clones shallow: a ref that exists is
 * absent from a depth-1 local clone, and a check that goes red on a correct tree teaches people
 * to ignore it. Returns null — not false — when the remote cannot be reached, so "I could not
 * tell" never masquerades as "it does not exist".
 */
function makeRefResolver(repoRoot) {
  const cache = new Map();
  return ref => {
    if (/^[0-9a-f]{7,40}$/i.test(ref)) return true;
    if (cache.has(ref)) return cache.get(ref);
    let result;
    try {
      const out = execFileSync(
        "git",
        ["ls-remote", "--heads", "--tags", "origin", ref],
        { cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
      );
      result = out.trim().length > 0;
    } catch {
      result = null;
    }
    cache.set(ref, result);
    return result;
  };
}

/** A page is reachable when its own directory's meta.json lists it. A directory with no
 *  meta.json is auto-included by fumadocs, so nothing there can be orphaned. */
function metaReachability(repoRoot, findings) {
  const docsDir = join(repoRoot, "docs");
  if (!existsSync(docsDir)) return;
  const byDir = new Map();
  for (const file of walk(docsDir)) {
    if (extname(file) !== ".mdx") continue;
    const dir = dirname(file);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(file);
  }
  for (const [dir, files] of byDir) {
    const metaPath = join(dir, "meta.json");
    if (!existsSync(metaPath)) continue;
    let pages;
    try {
      pages = JSON.parse(readFileSync(metaPath, "utf-8")).pages ?? [];
    } catch {
      continue;
    }
    const listed = new Set(pages.map(p => String(p).replace(/^\.\//, "")));
    for (const file of files) {
      const slug = basename(file, ".mdx");
      if (!listed.has(slug)) {
        findings.push({
          check: "meta-reachable",
          file: relative(repoRoot, file),
          line: null,
          message: `not listed in ${relative(repoRoot, metaPath)}; nextly-site's build fails on an unreachable page`,
        });
      }
    }
  }
}

export async function runChecks({ repoRoot, allowlist = {}, resolveRef }) {
  const findings = [];
  const unverifiable = [];
  const resolve = resolveRef ?? makeRefResolver(repoRoot);
  const allowed = check =>
    new Set(Object.keys(allowlist[check] ?? {}).map(p => p.split("/").join(sep)));

  // --- readme-present + root-readme-lists-package ---
  const packages = publishedPackages(repoRoot);
  const rootReadmePath = join(repoRoot, "README.md");
  const rootReadme = existsSync(rootReadmePath)
    ? readFileSync(rootReadmePath, "utf-8")
    : null;

  for (const pkg of packages) {
    if (!existsSync(join(pkg.dir, "README.md"))) {
      findings.push({
        check: "readme-present",
        file: relative(repoRoot, join(pkg.dir, "README.md")),
        line: null,
        message: `${pkg.name} is published but has no README, so its npm page is blank`,
      });
    }
    if (rootReadme !== null && !rootReadme.includes(pkg.name)) {
      findings.push({
        check: "root-readme-lists-package",
        file: "README.md",
        line: null,
        message: `${pkg.name} is published but is not named in the root README`,
      });
    }
  }

  // --- per-line prose checks ---
  const phraseAllowed = allowed("forbidden-status-phrase");
  const namingAllowed = allowed("naming-rule");
  const linkAllowed = allowed("dead-branch-link");

  for (const file of proseFiles(repoRoot)) {
    const rel = relative(repoRoot, file);
    let text;
    try {
      text = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    const isProse = rel.endsWith(".md") || rel.endsWith(".mdx");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      // Prose only. A "Coming soon" badge in admin UI or an API placeholder string is a
      // fact about the running product, not a claim about what the project ships.
      if (isProse && !phraseAllowed.has(rel)) {
        for (const phrase of FORBIDDEN_PHRASES) {
          if (lower.includes(phrase)) {
            findings.push({
              check: "forbidden-status-phrase",
              file: rel,
              line: i + 1,
              message: `"${phrase}" — say what ships today, or allowlist this line if it is accurate`,
            });
            break;
          }
        }
      }

      if (!namingAllowed.has(rel)) {
        BARE_VISUAL_BUILDER.lastIndex = 0;
        if (BARE_VISUAL_BUILDER.test(line)) {
          findings.push({
            check: "naming-rule",
            file: rel,
            line: i + 1,
            message: `bare "Visual Builder" — write "Visual Schema Builder" or "Visual Page Builder"`,
          });
        }
      }

      if (!linkAllowed.has(rel)) {
        REPO_LINK.lastIndex = 0;
        let match;
        while ((match = REPO_LINK.exec(line)) !== null) {
          const ref = match[1];
          const resolved = resolve(ref);
          if (resolved === null) {
            unverifiable.push({ check: "dead-branch-link", file: rel, line: i + 1, ref });
          } else if (resolved === false) {
            findings.push({
              check: "dead-branch-link",
              file: rel,
              line: i + 1,
              message: `links to ref "${ref}", which does not resolve on origin`,
            });
          }
        }
      }
    }
  }

  metaReachability(repoRoot, findings);

  return { findings, unverifiable };
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("check-docs-claims.mjs");

if (invokedDirectly) {
  const repoRoot = process.cwd();
  const allowlistPath = join(repoRoot, "scripts", "docs-claims-allowlist.json");
  const allowlist = existsSync(allowlistPath)
    ? JSON.parse(readFileSync(allowlistPath, "utf-8"))
    : {};

  const { findings, unverifiable } = await runChecks({ repoRoot, allowlist });

  if (unverifiable.length > 0) {
    console.warn(
      `${unverifiable.length} link ref(s) could not be resolved against origin (offline?). Not counted as failures.`
    );
  }

  if (findings.length === 0) {
    console.log("docs claims: no findings.");
    process.exit(0);
  }

  const byCheck = new Map();
  for (const f of findings) {
    if (!byCheck.has(f.check)) byCheck.set(f.check, []);
    byCheck.get(f.check).push(f);
  }
  for (const [check, items] of byCheck) {
    console.error(`\n${check} (${items.length}):`);
    for (const item of items) {
      console.error(`  ${item.file}${item.line ? `:${item.line}` : ""} — ${item.message}`);
    }
  }
  console.error(`\n${findings.length} finding(s).`);
  process.exit(1);
}
