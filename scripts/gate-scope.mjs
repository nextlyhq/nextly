#!/usr/bin/env node

/**
 * The packages a branch must gate, derived from what it actually changes.
 *
 * A gate list typed by hand is a CLAIM about the diff. It is written once, from
 * the packages the author expected to touch, and nothing tells them when a
 * later commit reaches a package the list does not name. The run stays green
 * because it never looked.
 *
 * Measured: a page-builder branch gated with
 * `pnpm --filter @nextlyhq/plugin-page-builder exec vitest` also changed
 * `packages/plugin-sdk/src/index.ts`. `plugin-sdk`'s public-surface snapshot
 * test never ran on any pass, four names reached a published index unguarded,
 * and `main` went red for every open PR — that check runs against each PR's
 * synthetic merge, so every author inherits a failure they did not write.
 *
 * The failure is hard to suspect because a filtered gate reads as MORE careful
 * than an unfiltered one. A vague scope invites a second look; a precise one
 * closes the question.
 *
 * There is no structural protection to fall back on. Root `test`, `lint` and
 * `check-types` are each `turbo run <task>`, so they are broad only when run
 * that way — breadth is a property of the command typed, not of the tool. And
 * `turbo run test` does not reach `scripts/`, which has its own root task.
 *
 * Both sides are DERIVED rather than restated: the package set comes from the
 * diff, and each filter comes from that package's own manifest `name`, so a
 * rename cannot leave a filter pointing at nothing.
 *
 * Usage:
 *   node scripts/gate-scope.mjs [base]      # base defaults to origin/main
 *
 * @module scripts/gate-scope
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every workspace this repository declares, as `{ name, dir }`.
 *
 * ASKED of pnpm rather than derived from `pnpm-workspace.yaml`. Deriving it
 * meant reimplementing a YAML reader, and the hand-rolled one answered wrongly
 * for a valid document: `- "apps/*" # application workspaces` kept the comment
 * as part of the glob, after which no app path matched any root and the gate
 * omitted every app change in silence.
 *
 * pnpm resolves that same file to decide what a workspace IS, so asking it is
 * the only answer that cannot disagree with the tool these filters are handed
 * to. It also supplies each package's NAME, which is what a filter needs — the
 * per-directory manifest read this replaces derived the same fact a second
 * time, and disagreed with itself about where a directory was rooted.
 *
 * Sorted LONGEST DIRECTORY FIRST so a nested workspace wins over one that
 * merely shares its prefix. The repository root is dropped: its directory is a
 * prefix of every path, so keeping it would match everything and collapse the
 * scope to a single filter.
 */
export function workspacesFrom(entries, rootDir) {
  const listed = Array.isArray(entries) ? entries : [];
  return listed
    .map(entry => oneWorkspace(entry, rootDir))
    .filter(w => w.name.length > 0 && w.dir.length > 0)
    .sort((a, b) => b.dir.length - a.dir.length);
}

/** One pnpm entry as `{ name, dir }`, with anything unusable emptied. */
function oneWorkspace(entry, rootDir) {
  return { name: entryName(entry), dir: entryDir(entry, rootDir) };
}

/**
 * An entry's package name, or the empty string.
 *
 * Empty rather than absent, because a `--filter` built from an empty name
 * matches nothing: it would shrink the gate while reading as coverage.
 */
function entryName(entry) {
  const name = entry?.name;
  return typeof name === "string" ? name : "";
}

/** An entry's directory relative to the repository root, or the empty string. */
function entryDir(entry, rootDir) {
  const path = entry?.path;
  return typeof path === "string" ? relativeDir(rootDir, path) : "";
}

/** One workspace's directory, relative to the repository root, with `/` separators. */
function relativeDir(rootDir, absolute) {
  const rel = relative(rootDir, absolute).split(sep).join("/");
  return rel === "." ? "" : rel;
}

/**
 * The roots a workspace may live under, derived from the workspaces themselves.
 *
 * Needed to tell "a path in no workspace" apart from "a path in a workspace
 * that is GONE". `scripts/x.mjs` is the first and gates nothing extra;
 * `packages/deleted/x.ts` is the second and must be refused rather than
 * dropped, because dropping it shrinks the gate for the very change that
 * removed a package.
 *
 * Derived rather than read back from the globs, so this cannot disagree with
 * the list above about where workspaces live. A workspace declared as a bare
 * directory contributes no root and needs none: it matches itself directly.
 */
export function workspaceRootsOf(workspaces) {
  const roots = workspaces
    .map(w => (w.dir.includes("/") ? w.dir.slice(0, w.dir.lastIndexOf("/")) : null))
    .filter(root => root !== null);
  return [...new Set(roots)].sort();
}

/**
 * The filter for every workspace a change reaches, plus the ones it cannot name.
 *
 * A path under a known root that belongs to no listed workspace is REPORTED
 * rather than skipped, because the likeliest cause is a package the diff
 * deleted or renamed — which the author should see rather than have hidden
 * behind a smaller gate.
 */
export function filtersFor(paths, workspaces) {
  const roots = workspaceRootsOf(workspaces);
  const names = new Set();
  const unlisted = new Set();

  for (const raw of paths) {
    const path = String(raw);
    const owner = ownerOf(path, workspaces);
    if (owner !== undefined) names.add(owner.name);
    else {
      const missing = missingWorkspaceDir(path, roots);
      if (missing !== null) unlisted.add(missing);
    }
  }

  return {
    filters: [...names].sort(),
    unreadable: [...unlisted].sort(),
  };
}

/**
 * The workspace a path lies inside, or undefined.
 *
 * A segment AFTER the directory is required: a path naming the workspace
 * directory alone names no file inside it, so there is nothing to gate.
 */
function ownerOf(path, workspaces) {
  return workspaces.find(w => path.startsWith(`${w.dir}/`));
}

/**
 * The workspace directory a path names but no workspace claims, or null.
 *
 * A second segment is required: `packages/README.md` sits under a root without
 * naming a workspace directory, so nothing is missing.
 */
function missingWorkspaceDir(path, roots) {
  const root = roots.find(r => path.startsWith(`${r}/`));
  if (root === undefined) return null;
  const end = path.indexOf("/", root.length + 1);
  return end === -1 ? null : path.slice(0, end);
}

/** Whether a change reaches the root `scripts/` task, which `turbo run test` does not. */
export function touchesScripts(paths) {
  return paths.some(path => String(path).split("/")[0] === "scripts");
}

/** The human-readable report. */
export function report({ filters, unreadable, scripts }) {
  const sections = [
    filterSection(filters),
    unreadableSection(unreadable),
    scripts ? SCRIPTS_NOTE : "",
  ].filter(Boolean);

  // The nothing-to-report case is derived from the sections rather than
  // restated as its own condition. Restating it is how a diff that DELETES a
  // package came to report "nothing changed" while holding an unreadable
  // directory it was supposed to surface.
  return sections.length === 0
    ? "No workspace package changed. Root gates only."
    : sections.join("\n\n");
}

/** `turbo run test` has its own task list and does not reach `scripts/`. */
const SCRIPTS_NOTE =
  "Also run `pnpm test:scripts` — `turbo run test` does not reach scripts/.";

function filterSection(filters) {
  if (filters.length === 0) return "";
  return ["Gate these packages:", ...filters.map(n => `  --filter ${n}`)].join(
    "\n"
  );
}

function unreadableSection(unreadable) {
  if (unreadable.length === 0) return "";
  return [
    "Directories with no readable manifest (deleted, or renamed):",
    // Rendered as derived. Re-rooting it here produced `packages/packages/ui`
    // and `packages/apps/playground` — nonexistent paths, in the one message
    // whose whole job is to name the workspace that could not be gated.
    ...unreadable.map(d => `  ${d}`),
  ].join("\n");
}

/**
 * Every workspace pnpm resolves, as it resolves them.
 *
 * A subprocess, and worth its cost: it is the only source that cannot disagree
 * with the runner the derived filters are handed to.
 */
function pnpmWorkspaces(cwd) {
  const out = execFileSync("pnpm", ["list", "-r", "--depth", "-1", "--json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 32,
  });
  return JSON.parse(out);
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/**
 * The filter arguments a task runner needs, one per line.
 *
 * Emitted on request so a hook can CONSUME the derivation rather than print it
 * at someone. A scope that is only ever read by a human is advisory, and the
 * failure this module exists to prevent is precisely someone not remembering to
 * look.
 */
/**
 * Why the filter list must not be trusted, or null when it can be.
 *
 * Separated from printing it so the decision is assertable rather than only
 * demonstrable — the exit status is what a hook acts on, and a hook is not a
 * thing a unit test can observe.
 */
export function filtersRefusal(unreadable) {
  if (unreadable.length === 0) return null;
  return (
    "gate-scope: no readable manifest for " +
    unreadable.join(", ") +
    " — refusing to report a scope that would silently omit it."
  );
}

export function filterArguments(filters) {
  return filters.map(name => `--filter=${name}`).join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const base = args.find(arg => !arg.startsWith("--")) ?? "origin/main";
  const cwd = process.cwd();
  const paths = changedPaths(cwd, base);
  const { filters, unreadable } = filtersFor(
    paths,
    workspacesFrom(pnpmWorkspaces(cwd), cwd)
  );

  if (args.includes("--filters")) emitFilters(filters, unreadable);
  else
    console.log(report({ filters, unreadable, scripts: touchesScripts(paths) }));
}

/**
 * Everything this branch changes: tracked edits AND untracked additions.
 *
 * The MERGE BASE, and a two-dot diff against the WORKING TREE. `base...HEAD`
 * compares two commits, so everything still uncommitted is invisible — and
 * this runs before a commit, which is exactly when the files being gated are
 * uncommitted. Diffing `base` directly instead over-reports by everything the
 * base gained since this branch left it.
 *
 * `git diff` reports neither an untracked file nor its directory, so a branch
 * that only ADDS files would derive an empty scope and gate nothing.
 */
export function changedPaths(cwd, base) {
  const mergeBase = git(cwd, ["merge-base", base, "HEAD"]).trim();
  return [
    // `-z` because Git QUOTES a path containing non-ASCII or other special
    // characters under the default `core.quotePath`, and a quoted path starts
    // with `"` — so it matched no workspace and the only changed package was
    // dropped in silence. NUL-delimited output is neither quoted nor escaped.
    //
    // `--no-renames` because rename detection reports a move as the
    // DESTINATION alone. A file moved out of a workspace then left that
    // workspace ungated, having lost the file. Off, Git reports the delete and
    // the add separately, which is both sides.
    ...nulPaths(
      git(cwd, ["diff", "--name-only", "-z", "--no-renames", mergeBase])
    ),
    ...nulPaths(git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"])),
  ];
}

/** Paths from a NUL-delimited Git listing. */
function nulPaths(out) {
  return out.split("\0").filter(Boolean);
}

/**
 * The consumed form: filters on stdout, the reason to refuse on stderr.
 *
 * Split from the report so the two audiences stay separate — one is spliced
 * into a command, the other is read by a person — and so the refusal is not
 * buried in a branch of a function that mostly formats prose.
 */
function emitFilters(filters, unreadable) {
  const line = filterArguments(filters);
  if (line) console.log(line);
  const refusal = filtersRefusal(unreadable);
  if (refusal === null) return;
  console.error(refusal);
  process.exitCode = 1;
}

/**
 * Whether this module was the thing invoked, rather than imported.
 *
 * Compared as REAL paths. Node resolves `import.meta.url` through symlinks
 * while `process.argv[1]` keeps the link it was called by, so comparing them
 * directly answered false whenever the script was launched through a symlink —
 * and a false answer here is silent: `main()` never runs, nothing is printed,
 * and the exit status is 0, so the hook reads a no-op as an empty scope.
 */
function invokedDirectly() {
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)) ===
      realpathSync(process.argv[1] ?? "")
    );
  } catch {
    return false;
  }
}

if (invokedDirectly()) main();
