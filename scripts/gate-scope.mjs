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

import { pnpmInvocation } from "./pnpm-invocation.mjs";

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
    // A directory is enough to be KEPT. An entry whose manifest omits `name`
    // cannot produce a filter, but dropping it made its paths ownerless and
    // rootless too, so a change inside it derived an empty scope and the hook
    // skipped its tests entirely. Kept, it is refused instead.
    .filter(w => w.dir.length > 0)
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
export function filtersFor(paths, workspaces, deleted = new Set()) {
  const roots = workspaceRootsOf(workspaces);
  const names = new Set();
  const unlisted = new Set();

  for (const raw of paths) {
    const verdict = classify(String(raw), workspaces, roots, deleted);
    if (verdict.name !== null) names.add(verdict.name);
    if (verdict.missing !== null) unlisted.add(verdict.missing);
  }

  return {
    filters: [...names].sort(),
    unreadable: [...unlisted].sort(),
  };
}

/**
 * What one path contributes: a workspace to gate, a workspace that is gone, or
 * neither.
 *
 * Exactly one of the two can be set. A path a workspace claims is gated and is
 * never also reported missing; a path no workspace claims cannot name a filter.
 */
function classify(path, workspaces, roots, deleted) {
  const owner = ownerOf(path, workspaces);
  // A workspace with no usable name cannot be gated: a `--filter` built from
  // an empty string matches nothing, so it would shrink the gate while reading
  // as coverage. Reported instead, under the directory that does identify it.
  if (owner !== undefined)
    return owner.name.length > 0
      ? { name: owner.name, missing: null }
      : { name: null, missing: owner.dir };
  const missing =
    removedWorkspaceDir(path, deleted, roots) ??
    missingWorkspaceDir(path, roots);
  return { name: null, missing };
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
 * The workspace a diff REMOVED, read from the manifest it deleted, or null.
 *
 * The root-based check below cannot see this one. Roots are derived from the
 * workspaces pnpm currently lists, so removing the LAST workspace under a root
 * — or the bare `e2e` entry, which contributes no root at all — takes the root
 * away with it. The paths then match nothing, and a workspace-removal diff
 * passes with neither a filter nor a refusal: precisely the diff the refusal
 * exists for.
 *
 * A manifest survives that, because deleting a workspace deletes its
 * `package.json` and the diff therefore names it. Rename detection is off, so
 * a workspace MOVED reports its old manifest as a deletion too.
 *
 * Consulted only for a path no workspace claims, so a manifest nested inside a
 * live workspace — a fixture, say — is owned before it reaches here.
 */
function removedWorkspaceDir(path, deleted, roots) {
  if (!deletedManifest(path, deleted)) return null;
  if (!underDeclaredRoot(path, roots)) return null;
  const dir = path.slice(0, -MANIFEST.length);
  return dir.length > 0 ? dir : null;
}

/** The file a workspace is declared by, wherever it sits. */
const MANIFEST = "/package.json";

/**
 * Whether a path is a manifest this diff DELETED.
 *
 * Presence alone says nothing about direction: a manifest ADDED outside every
 * workspace — a fixture, a scaffold template — looks identical to one removed
 * from inside a workspace, and reporting the first as a removal refused a push
 * that was perfectly valid.
 */
function deletedManifest(path, deleted) {
  return path.endsWith(MANIFEST) && deleted.has(path);
}

/**
 * Whether a path sits under a root pnpm STILL declares.
 *
 * Deletion does not say the directory was ever a workspace, so
 * `docs/example/package.json` must not be read as one.
 *
 * A bare workspace removed outright is not lost by this. Its entry has to
 * leave `pnpm-workspace.yaml` too, and that file redefines the graph — so the
 * unfiltered path claims the diff before scope is narrowed at all.
 */
function underDeclaredRoot(path, roots) {
  return roots.some(root => path.startsWith(`${root}/`));
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

/**
 * The files that define the workspace or task graph for EVERY package.
 *
 * A change to one of these cannot be narrowed to the packages it appears
 * beside. `pnpm-workspace.yaml` decides what a workspace IS — removing an
 * entry detaches a directory that still exists, and the only changed path is
 * the YAML itself, so nothing names the workspace that just lost its gate.
 * `turbo.jsonc` defines the tasks every workspace runs, so a filtered run
 * exercises the new definition for one package and none of the others.
 */
const ROOT_WIDE_FILES = new Set([
  "pnpm-workspace.yaml",
  "turbo.json",
  "turbo.jsonc",
]);

/**
 * The graph-defining files a change touches.
 *
 * Reported rather than silently widened, because widening is a decision the
 * runner makes and this module only derives. A caller that cannot narrow
 * safely should run the root gates unfiltered.
 */
export function rootWideChanges(paths) {
  const hits = paths.map(String).filter(path => ROOT_WIDE_FILES.has(path));
  return [...new Set(hits)].sort();
}

/** Whether a change reaches the root `scripts/` task, which `turbo run test` does not. */
export function touchesScripts(paths) {
  return paths.some(path => String(path).split("/")[0] === "scripts");
}

/** The human-readable report. */
export function report({ filters, unreadable, scripts, rootWide = [] }) {
  const sections = [
    rootWideSection(rootWide),
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

function rootWideSection(rootWide) {
  if (rootWide.length === 0) return "";
  return [
    "Root gates only, UNFILTERED — these define the graph for every package:",
    ...rootWide.map(f => `  ${f}`),
  ].join("\n");
}

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
  /*
   * Through the shared invocation, because `pnpm` on Windows is a `.cmd`
   * shim and `execFileSync` cannot spawn one without `shell: true` — it
   * fails with ENOENT, which this script reports as an underivable scope
   * and the hook turns into a refused push. The `git` call below needs no
   * such care: it is a real executable.
   */
  const { command, args, shell } = pnpmInvocation([
    "list",
    "-r",
    "--depth",
    "-1",
    "--json",
  ]);
  const out = execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 32,
    shell,
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
/**
 * What `--filters` tells its caller, as an exit status.
 *
 * Three outcomes, not two. A caller that can only distinguish "worked" from
 * "failed" has to treat "this change cannot be narrowed" as a failure, and
 * that is what made a `pnpm-workspace.yaml` edit unpushable.
 */
export const EXIT = {
  /** Filters on stdout, possibly none. Gate what they name. */
  filters: 0,
  /** A workspace could not be named. Do not gate; the scope would be wrong. */
  refuse: 1,
  /** The change redefines the graph. Gate everything, unfiltered. */
  unfiltered: 2,
};

/** Why a caller should widen rather than narrow. */
export function unfilteredReason(rootWide) {
  return (
    "gate-scope: " +
    rootWide.join(", ") +
    " defines the workspace or task graph for every package — run the root " +
    "gates UNFILTERED rather than narrowing."
  );
}

export function noWorkspacesRefusal(workspaces) {
  if (workspaces.length > 0) return null;
  return (
    "gate-scope: pnpm reported no usable workspace — refusing to report an " +
    "empty scope, which would run no gates at all."
  );
}

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
  const workspaces = workspacesFrom(pnpmWorkspaces(cwd), cwd);
  const { filters, unreadable } = filtersFor(
    paths,
    workspaces,
    new Set(deletedPaths(cwd, base))
  );
  const rootWide = rootWideChanges(paths);

  if (args.includes("--filters"))
    emitFilters(filters, unreadable, rootWide, workspaces);
  else
    console.log(
      report({ filters, unreadable, rootWide, scripts: touchesScripts(paths) })
    );
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

/**
 * The paths this branch DELETED, which is what names a removed workspace.
 *
 * Separate from the full list because presence in a diff says nothing about
 * direction: a manifest ADDED outside every workspace looks identical to one
 * removed from inside a workspace, and reporting the first as a removal
 * refused a push that was valid.
 */
export function deletedPaths(cwd, base) {
  const mergeBase = git(cwd, ["merge-base", base, "HEAD"]).trim();
  return nulPaths(
    git(cwd, [
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      "--diff-filter=D",
      mergeBase,
    ])
  );
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
function emitFilters(filters, unreadable, rootWide, workspaces) {
  const outcome = filtersOutcome({ filters, unreadable, rootWide, workspaces });
  if (outcome.stdout) console.log(outcome.stdout);
  if (outcome.stderr) console.error(outcome.stderr);
  process.exitCode = outcome.status;
}

/**
 * What `--filters` should print and exit with, as a value.
 *
 * Separated from printing it so the decision is assertable rather than only
 * demonstrable: the exit status is what a hook acts on, and a hook is not a
 * thing a unit test can observe.
 *
 * Ordered by how much it overrides. An unusable workspace list makes every
 * later answer meaningless; a graph-defining change makes any narrowing wrong
 * whatever the filters say.
 */
export function filtersOutcome({ filters, unreadable, rootWide, workspaces }) {
  return (
    refuseWithoutWorkspaces(workspaces) ??
    widenForGraphChange(rootWide) ??
    narrowToFilters(filters, unreadable)
  );
}

/** Nothing later means anything if the workspace list itself is unusable. */
function refuseWithoutWorkspaces(workspaces) {
  const reason = noWorkspacesRefusal(workspaces);
  if (reason === null) return null;
  return { stdout: "", stderr: reason, status: EXIT.refuse };
}

/**
 * A graph-defining change makes any narrowing wrong, whatever the filters say.
 *
 * Its own status rather than a refusal. Refusing made these files impossible
 * to push: the hook runs under `set -e`, so it died before testing anything,
 * and no retry could clear it because running the root gates by hand does not
 * change the diff. The only escape was bypassing the hook, which is worse than
 * the narrowing this guards against.
 */
function widenForGraphChange(rootWide) {
  if (rootWide.length === 0) return null;
  return {
    stdout: "",
    stderr: unfilteredReason(rootWide),
    status: EXIT.unfiltered,
  };
}

/** The ordinary answer: gate what the filters name, unless one cannot be named. */
function narrowToFilters(filters, unreadable) {
  const refusal = filtersRefusal(unreadable);
  if (refusal !== null)
    return { stdout: "", stderr: refusal, status: EXIT.refuse };
  return { stdout: filterArguments(filters), stderr: "", status: EXIT.filters };
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
