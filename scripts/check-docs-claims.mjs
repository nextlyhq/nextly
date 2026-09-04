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
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";

/**
 * Files come from git's index, not from a directory walk.
 *
 * A walk reads whatever is on disk, and what is on disk differs per machine: `.internal-docs/`
 * is gitignored and present in some checkouts, so the same commit reported 0 findings in a fresh
 * worktree and 33 in a working clone. Extending an ignore list cannot close that — the next
 * ignored directory reopens it. Tracked-ness is the property that actually distinguishes
 * authored content from whatever a build or a local habit left behind, and it is the same
 * choice `check-comment-convention.mjs` makes for the same reason.
 */
function trackedFiles(repoRoot) {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: repoRoot,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

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

/**
 * Captures everything after `blob|tree|raw`, because the ref is not one segment. A branch may
 * contain slashes (`feature/docs-refresh`), and git accepts it: `git check-ref-format --branch
 * feature/docs-refresh` exits 0. Splitting on the first slash would read the ref as `feature`
 * and report a live branch as dead, which is the failure mode this whole check exists to avoid.
 */
const REPO_LINK = /github\.com\/nextlyhq\/nextly\/(?:blob|tree|raw)\/([^\s)\]"'`]+)/g;

const HEX_REF = /^[0-9a-f]{7,40}$/i;

/** Markdown links pointing inside the docs site, e.g. `[Preview](/docs/preview)`. */
const INTERNAL_DOCS_LINK = /\]\((\/docs\/[^)\s]*)\)/g;

/**
 * Split a link's tail into the ref and the path under it.
 *
 * The ref boundary is not derivable from the string, so it is resolved against the refs the
 * remote actually has: the longest leading run of segments that names a real ref wins. A ref
 * shaped like a commit is handed back for object lookup instead.
 */
export function splitRefAndPath(tail, remoteRefs) {
  const segments = tail.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  if (remoteRefs) {
    for (let take = Math.min(segments.length, 8); take >= 1; take--) {
      const candidate = segments.slice(0, take).join("/");
      if (remoteRefs.has(candidate)) {
        return { ref: candidate, resolved: true };
      }
    }
  }
  // Nothing matched. A single segment shaped like a commit is a pinned link, judged separately;
  // otherwise report the longest plausible ref rather than the first segment, so the message
  // names what was actually looked for.
  return { ref: segments[0], resolved: false };
}

/** Files whose prose is a claim about the product. CHANGELOGs are excluded everywhere: they are
 *  Changesets' historical record, and rewriting history to satisfy a lint is worse than the lint. */
function proseFiles(tracked) {
  return tracked.filter(rel => {
    if (basename(rel) === "CHANGELOG.md") return false;
    const ext = extname(rel);
    if (ext === ".md" || ext === ".mdx") return true;
    return (
      (ext === ".ts" || ext === ".tsx" || ext === ".mjs") && rel.split("/")[0] === "packages"
    );
  });
}

/**
 * A manifest that will not parse is reported rather than skipped. Skipping drops the package
 * from every other check here, so a syntax error would quietly buy an exemption from all of
 * them — the check would go green precisely because something was broken.
 */
function publishedPackages(repoRoot, findings) {
  const pkgDir = join(repoRoot, "packages");
  if (!existsSync(pkgDir)) return [];
  const out = [];
  for (const name of readdirSync(pkgDir)) {
    const manifest = join(pkgDir, name, "package.json");
    if (!existsSync(manifest)) continue;
    let json;
    try {
      json = JSON.parse(readFileSync(manifest, "utf-8"));
    } catch (error) {
      findings.push({
        check: "unreadable-manifest",
        file: relative(repoRoot, manifest),
        line: null,
        message: `cannot be parsed, so this package is invisible to every other check: ${error.message}`,
      });
      continue;
    }
    if (json.private) continue;
    out.push({ name: json.name, dir: join(pkgDir, name) });
  }
  return out;
}

/**
 * Every ref the remote has, read in one call.
 *
 * `git ls-remote` rather than `rev-parse`, because CI clones shallow: a ref that exists is
 * absent from a depth-1 local clone, and a check that goes red on a correct tree teaches people
 * to wave reds through. One call rather than one per link, because the longest-prefix match in
 * `splitRefAndPath` needs the whole set to decide where a ref ends.
 *
 * Returns null — not an empty set — when the remote cannot be reached, so "I could not tell"
 * never masquerades as "it does not exist".
 */
function listRemoteRefs(repoRoot) {
  try {
    const out = execFileSync("git", ["ls-remote", "--heads", "--tags", "origin"], {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const refs = new Set();
    for (const line of out.split("\n")) {
      const name = line.split("\t")[1];
      if (!name) continue;
      refs.add(name.replace(/^refs\/(heads|tags)\//, "").replace(/\^\{\}$/, ""));
    }
    return refs.size > 0 ? refs : null;
  } catch {
    return null;
  }
}

/**
 * Whether a commit-shaped ref names an object this clone holds.
 *
 * A shallow clone genuinely cannot answer this, and `ls-remote` cannot be asked about an
 * arbitrary sha. So a miss is reported as unverifiable rather than dead: the alternative,
 * accepting every hex string, made pinned links a blind spot in the one check meant to cover
 * them.
 */
function makeCommitProbe(repoRoot) {
  const cache = new Map();
  return sha => {
    if (cache.has(sha)) return cache.get(sha);
    let present;
    try {
      execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
        cwd: repoRoot,
        stdio: ["ignore", "ignore", "ignore"],
      });
      present = true;
    } catch {
      present = false;
    }
    cache.set(sha, present);
    return present;
  };
}

/** Matches `digestOffences` in check-comment-convention.mjs so the two allowlists read alike. */
export function digestLine(line) {
  return createHash("sha256")
    .update(line.trim().replace(/\s+/g, " "))
    .digest("hex")
    .slice(0, 16);
}

/** A page is reachable when its own directory's meta.json lists it. A directory with no
 *  meta.json is auto-included by fumadocs, so nothing there can be orphaned. */
function metaReachability(repoRoot, tracked, findings) {
  // Navigation files are consulted only when git tracks them, for the same reason the file list
  // comes from the index: an untracked meta.json sitting in a working tree would satisfy the
  // reachability check locally and be absent from the clone that builds the site.
  const trackedMeta = new Set(
    tracked.filter(rel => basename(rel) === "meta.json").map(rel => join(repoRoot, rel))
  );
  const byDir = new Map();
  for (const rel of tracked) {
    if (extname(rel) !== ".mdx") continue;
    if (rel.split("/")[0] !== "docs") continue;
    const dir = dirname(join(repoRoot, rel));
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(join(repoRoot, rel));
  }
  for (const [dir, files] of byDir) {
    const metaPath = join(dir, "meta.json");
    if (!trackedMeta.has(metaPath)) continue;
    let pages;
    try {
      pages = JSON.parse(readFileSync(metaPath, "utf-8")).pages ?? [];
    } catch (error) {
      // Unreadable navigation metadata is a deploy failure waiting to happen: the docs site
      // parses this file to build its sidebar. Skipping it would report success on a tree that
      // cannot render.
      findings.push({
        check: "unreadable-meta",
        file: relative(repoRoot, metaPath),
        line: null,
        message: `cannot be parsed, so the docs navigation cannot be built: ${error.message}`,
      });
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

/**
 * Every `/docs/...` link resolves to a page that exists.
 *
 * Cross-links are how a reader moves between capabilities, and a moved or renamed page
 * breaks them silently: the build still succeeds and the sidebar still renders, so nothing
 * reports it until a reader hits a 404. The set of pages is derived from the same tracked
 * list everything else here reads, so a link to a page that exists only locally fails too.
 */
function internalLinks(repoRoot, tracked, findings) {
  const pages = new Set(tracked.filter(rel => rel.endsWith(".mdx")));
  const resolves = target => {
    const path = target.split("#")[0].replace(/\/+$/, "");
    if (path === "/docs") return true;
    const rel = `docs${path.slice("/docs".length)}`;
    return pages.has(`${rel}.mdx`) || pages.has(`${rel}/index.mdx`);
  };

  for (const rel of tracked) {
    if (!rel.endsWith(".mdx") && !rel.endsWith(".md")) continue;
    if (basename(rel) === "CHANGELOG.md") continue;
    let text;
    try {
      text = readFileSync(join(repoRoot, rel), "utf-8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      INTERNAL_DOCS_LINK.lastIndex = 0;
      let match;
      while ((match = INTERNAL_DOCS_LINK.exec(lines[i])) !== null) {
        if (!resolves(match[1])) {
          findings.push({
            check: "internal-docs-link",
            file: rel,
            line: i + 1,
            message: `links to ${match[1]}, which is not a docs page`,
          });
        }
      }
    }
  }
}

/**
 * Every published README carries the same four load-bearing sections.
 *
 * These are long-form by decision, which means the same facts are restated in twenty files —
 * and a restated fact is one that can go stale in nineteen of them. The four checked here are
 * the ones whose absence is visible on npm and whose presence cannot be inferred: what state
 * the package is in, how to install it, what it relates to, and its licence. Depth below them
 * stays a human judgement and is not checked.
 *
 * Headings are matched loosely because the house style is not uniform — `Install`,
 * `Installation`, `Quickstart` and `Usage` all answer the same question, and `See also` is
 * `Related packages` under another name. Enforcing one spelling would be a rename, not a check.
 */
const README_SECTIONS = [
  {
    key: "status",
    label: "an alpha or stability note, or a Status/Stability section",
    // Either a note in prose OR a section carrying one. Matching only the phrase
    // "in alpha" rejected `## Stability` / "Alpha." — a correct statement several
    // packages already used — and would go on to reject an accurate "Beta" or
    // "Stable" note later, which turns the check into a demand for boilerplate.
    test: /in alpha|@?experimental|^##\s+(status|stability)/im,
  },
  {
    key: "install",
    label: "an Install, Installation, Quickstart or Usage section",
    test: /^##\s+(install|installation|quick\s*start|usage)/im,
  },
  {
    key: "related",
    label: "a Related packages or See also section",
    test: /^##\s+(related packages|see also)/im,
  },
  { key: "license", label: "a License section", test: /^##\s+licen[sc]e/im },
];

/**
 * Drop what npm will not render as prose before looking for these sections.
 *
 * A fenced example showing a README skeleton, or a commented-out block, contains the
 * very headings this checks for — so testing the raw source would pass a package
 * whose only `## Install` is inside a code sample. The check would then be satisfied
 * by the appearance of the thing rather than the thing.
 */
export function renderedProse(markdown) {
  return markdown
    .replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1[^\n]*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function readmeSkeleton(repoRoot, packages, findings) {
  for (const pkg of packages) {
    const readme = join(pkg.dir, "README.md");
    if (!existsSync(readme)) continue; // readme-present already reports this
    let text;
    try {
      text = readFileSync(readme, "utf-8");
    } catch {
      continue;
    }
    const prose = renderedProse(text);
    for (const section of README_SECTIONS) {
      if (!section.test.test(prose)) {
        findings.push({
          check: "readme-skeleton",
          file: relative(repoRoot, readme),
          line: null,
          message: `${pkg.name} is published but its README has no ${section.label}`,
        });
      }
    }
  }
}

export async function runChecks({
  repoRoot,
  allowlist = {},
  remoteRefs,
  hasLocalCommit,
  files,
}) {
  const findings = [];
  const unverifiable = [];
  const tracked = files ?? trackedFiles(repoRoot);
  if (tracked === null) {
    throw new Error(
      `cannot list tracked files in ${repoRoot}; this check reads git's index, not the filesystem`
    );
  }
  const refs = remoteRefs === undefined ? listRemoteRefs(repoRoot) : remoteRefs;
  const commitPresent = hasLocalCommit ?? makeCommitProbe(repoRoot);

  /**
   * An exemption covers ONE claim, not one file.
   *
   * Keying only by path would silence every line in an exempt file, so an accurate "coming soon"
   * on one line would also let an inaccurate one elsewhere in the same file through — a
   * file-wide bypass wearing the shape of a single exception. Digests are per-line and match
   * `comment-convention-allowlist.json`.
   */
  const exemption = check => {
    const forCheck = allowlist[check] ?? {};
    const byPath = new Map();
    for (const [path, entry] of Object.entries(forCheck)) {
      byPath.set(path.split("/").join(sep), new Set(entry.digests ?? []));
    }
    return (relPath, line) => {
      const digests = byPath.get(relPath);
      return digests ? digests.has(digestLine(line)) : false;
    };
  };

  // --- readme-present + root-readme-lists-package ---
  const packages = publishedPackages(repoRoot, findings);
  const rootReadmePath = join(repoRoot, "README.md");
  const rootReadme = existsSync(rootReadmePath)
    ? readFileSync(rootReadmePath, "utf-8")
    : null;

  if (rootReadme === null && packages.length > 0) {
    // Treating the root README as optional let the whole root-readme check disappear the moment
    // the file did. This job is the guard for exactly that file.
    findings.push({
      check: "root-readme-present",
      file: "README.md",
      line: null,
      message: `absent, but ${packages.length} package(s) are published and must be listed in it`,
    });
  }

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
  const phraseExempt = exemption("forbidden-status-phrase");
  const namingExempt = exemption("naming-rule");
  const linkExempt = exemption("dead-branch-link");

  for (const rel of proseFiles(tracked)) {
    let text;
    try {
      text = readFileSync(join(repoRoot, rel), "utf-8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    const isProse = rel.endsWith(".md") || rel.endsWith(".mdx");
    const isChangeset = rel.startsWith(".changeset/");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      // Prose only, and never a changeset. A "Coming soon" badge in admin UI or an API
      // placeholder string is a fact about the running product, not a claim about what the
      // project ships; and a changeset routinely QUOTES the false claim a change removed,
      // which reads identically to making one. The naming rule still applies to changesets,
      // because they become CHANGELOG entries and the product's name has one spelling.
      if (isProse && !isChangeset && !phraseExempt(rel, line)) {
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

      if (!namingExempt(rel, line)) {
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

      if (!linkExempt(rel, line)) {
        REPO_LINK.lastIndex = 0;
        let match;
        while ((match = REPO_LINK.exec(line)) !== null) {
          if (refs === null) {
            unverifiable.push({
              check: "dead-branch-link",
              file: rel,
              line: i + 1,
              ref: match[1],
            });
            continue;
          }
          const split = splitRefAndPath(match[1], refs);
          if (split === null || split.resolved) continue;

          if (HEX_REF.test(split.ref)) {
            // A pinned commit. `ls-remote` cannot be asked about an arbitrary sha, and a shallow
            // clone may not hold the object, so a miss is unverifiable rather than dead.
            if (!commitPresent(split.ref)) {
              unverifiable.push({
                check: "dead-branch-link",
                file: rel,
                line: i + 1,
                ref: split.ref,
              });
            }
            continue;
          }

          findings.push({
            check: "dead-branch-link",
            file: rel,
            line: i + 1,
            message: `links to ref "${split.ref}", which does not resolve on origin`,
          });
        }
      }
    }
  }

  readmeSkeleton(repoRoot, packages, findings);
  internalLinks(repoRoot, tracked, findings);
  metaReachability(repoRoot, tracked, findings);

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
