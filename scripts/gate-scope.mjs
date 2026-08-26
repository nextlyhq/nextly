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
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * The workspace directory a path belongs to, for each declared root.
 *
 * The roots are READ from `pnpm-workspace.yaml` rather than assumed to be
 * `packages/`. This repository declares `apps/*`, `packages/*` and a bare
 * `e2e` — a browser suite that is under neither — so a mapper that knew only
 * `packages/` would drop a change to an app or to that suite in silence, which
 * is the exact failure this module exists to remove.
 */
export function workspaceDirsOf(paths, globs) {
  const dirs = paths.map(path => workspaceDirOf(String(path), globs));
  return [...new Set(dirs.filter(dir => dir !== null))].sort();
}

/** The one workspace directory a path names, or null. */
function workspaceDirOf(path, globs) {
  const segments = path.split("/");
  for (const glob of globs) {
    const dir = matchGlob(segments, glob);
    if (dir !== null) return dir;
  }
  return null;
}

/**
 * A path's directory under one workspace glob, or null.
 *
 * Two forms, because those are the two pnpm declares here, and each is its own
 * decision: a wildcard root matches one directory beneath it, and a literal
 * entry matches that directory itself.
 */
function matchGlob(segments, glob) {
  return glob.endsWith("/*")
    ? matchWildcardRoot(segments, glob.slice(0, -2))
    : matchLiteralDir(segments, glob);
}

/**
 * `<root>/*` — one directory beneath a root.
 *
 * Requires a segment AFTER that directory, since a path naming the directory
 * alone names no file inside it and so names no manifest to gate.
 */
function matchWildcardRoot(segments, root) {
  if (segments[0] !== root) return null;
  if (segments.length < 3 || !segments[1]) return null;
  return `${root}/${segments[1]}`;
}

/** A bare `<dir>` entry — the directory itself, which is its own package. */
function matchLiteralDir(segments, dir) {
  if (segments[0] !== dir || segments.length < 2) return null;
  return dir;
}

/**
 * Kept as the narrow form for callers that only care about published packages.
 *
 * Expressed through {@link workspaceDirsOf} rather than reimplemented, so the
 * two cannot disagree about what a package directory is.
 */
export function changedPackageDirs(paths) {
  return workspaceDirsOf(paths, ["packages/*"]).map(dir => dir.split("/")[1]);
}

/**
 * The pnpm filter for each directory, read from its own manifest.
 *
 * A directory whose manifest cannot be read is REPORTED rather than skipped.
 * Skipping it would shrink the gate silently, which is the failure this whole
 * module exists to prevent — and the likeliest cause is a package deleted in
 * the diff, which the author should see rather than have hidden.
 */
export function packageFilters(dirs, readManifest) {
  const named = dirs.map(dir => ({ dir, name: manifestName(dir, readManifest) }));
  return {
    filters: named.filter(e => e.name !== null).map(e => e.name),
    unreadable: named.filter(e => e.name === null).map(e => e.dir),
  };
}

/** One directory's package name, or null when the manifest cannot answer. */
function manifestName(dir, readManifest) {
  try {
    return usableName(readManifest(dir));
  } catch {
    return null;
  }
}

/**
 * The name a manifest supplies, or null.
 *
 * An empty name is null rather than the empty string: a `--filter` built from
 * one matches nothing, so it would shrink the gate while reading as coverage.
 */
function usableName(manifest) {
  const name = manifest?.name;
  return typeof name === "string" && name.length > 0 ? name : null;
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
    ...unreadable.map(d => `  packages/${d}`),
  ].join("\n");
}

/** The workspace globs pnpm declares, so the roots are read rather than assumed. */
export function workspaceGlobs(yaml) {
  return yaml
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith("- "))
    .map(line => line.slice(2).trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/** Read the manifest of one workspace directory. */
function manifestReader(cwd) {
  return dir => JSON.parse(readFileSync(`${cwd}/${dir}/package.json`, "utf8"));
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function main() {
  const base = process.argv[2] ?? "origin/main";
  const cwd = process.cwd();

  // The MERGE BASE, and a two-dot diff against the WORKING TREE.
  //
  // `base...HEAD` compares two commits, so everything still uncommitted is
  // invisible — and this runs before a commit, which is exactly when the files
  // being gated are uncommitted. It fails in the dangerous direction: it names
  // FEWER packages than the branch touches, for precisely the files under
  // active edit, while reading as though it ran.
  //
  // Diffing `base` directly instead over-reports: it sweeps in everything the
  // base gained since this branch left it, which on a busy day is dozens of
  // other lanes' packages.
  const mergeBase = git(cwd, ["merge-base", base, "HEAD"]).trim();
  // Tracked changes AND untracked additions. `git diff` reports neither an
  // untracked file nor its directory, and a NEW file is what a new module or a
  // new test is — so a branch that only ADDS files would derive an empty scope
  // and gate nothing, while printing a report that reads as though it looked.
  const paths = [
    ...git(cwd, ["diff", "--name-only", mergeBase]).split("\n"),
    ...git(cwd, ["ls-files", "--others", "--exclude-standard"]).split("\n"),
  ].filter(Boolean);

  const globs = workspaceGlobs(
    readFileSync(`${cwd}/pnpm-workspace.yaml`, "utf8")
  );
  const dirs = workspaceDirsOf(paths, globs);
  const { filters, unreadable } = packageFilters(dirs, manifestReader(cwd));
  console.log(report({ filters, unreadable, scripts: touchesScripts(paths) }));
}

// Compared as a normalised file URL. Interpolating the raw path leaves any
// character the URL form percent-encodes — a space in the checkout path is
// enough — so the comparison is false, `main()` never runs, and the command
// exits 0 having printed nothing. A gate that silently becomes a no-op is
// worse than one that fails, because its silence reads as "no packages
// changed".
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
