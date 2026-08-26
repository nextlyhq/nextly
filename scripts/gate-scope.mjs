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

/** Where workspace packages live, and the segment index their directory sits at. */
const PACKAGE_ROOT = "packages";

/**
 * The package directories a set of changed paths touches.
 *
 * Paths outside `packages/` are dropped rather than mapped to a nearest
 * package: a change to `scripts/` or `.github/` belongs to a root task, and
 * inventing a package for it would gate the wrong thing while reporting
 * coverage.
 */
export function changedPackageDirs(paths) {
  const dirs = paths.map(packageDirOf).filter(dir => dir !== null);
  return [...new Set(dirs)].sort();
}

/**
 * The package directory one path names, or null when it names none.
 *
 * A path of exactly `packages/x` is a directory entry rather than a file inside
 * a package, so it names no manifest and answers null like any other miss.
 */
function packageDirOf(path) {
  const segments = String(path).split("/");
  if (segments[0] !== PACKAGE_ROOT) return null;
  if (segments.length < 3) return null;
  return segments[1] || null;
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

/** Read the manifest of one package directory. */
function manifestReader(cwd) {
  return dir =>
    JSON.parse(readFileSync(`${cwd}/${PACKAGE_ROOT}/${dir}/package.json`, "utf8"));
}

function main() {
  const base = process.argv[2] ?? "origin/main";
  const cwd = process.cwd();
  const output = execFileSync(
    "git",
    ["diff", "--name-only", `${base}...HEAD`],
    { cwd, encoding: "utf8" }
  );
  const paths = output.split("\n").filter(Boolean);
  const dirs = changedPackageDirs(paths);
  const { filters, unreadable } = packageFilters(dirs, manifestReader(cwd));
  console.log(report({ filters, unreadable, scripts: touchesScripts(paths) }));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
