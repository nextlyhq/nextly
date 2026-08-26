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
  const dirs = new Set();
  for (const path of paths) {
    const segments = String(path).split("/");
    if (segments[0] !== PACKAGE_ROOT) continue;
    const dir = segments[1];
    // A path of exactly `packages/x` with nothing after it is a directory
    // entry rather than a file in a package, and names no manifest.
    if (!dir || segments.length < 3) continue;
    dirs.add(dir);
  }
  return [...dirs].sort();
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
  const filters = [];
  const unreadable = [];
  for (const dir of dirs) {
    let name;
    try {
      name = readManifest(dir)?.name;
    } catch {
      name = undefined;
    }
    if (typeof name === "string" && name.length > 0) filters.push(name);
    else unreadable.push(dir);
  }
  return { filters, unreadable };
}

/** Whether a change reaches the root `scripts/` task, which `turbo run test` does not. */
export function touchesScripts(paths) {
  return paths.some(path => String(path).split("/")[0] === "scripts");
}

/** The human-readable report. */
export function report({ filters, unreadable, scripts }) {
  const lines = [];
  // The nothing-to-report case has to account for every branch below it, or a
  // diff that DELETES a package reports "nothing changed" while holding an
  // unreadable directory it was supposed to surface.
  if (filters.length === 0 && unreadable.length === 0 && !scripts) {
    lines.push("No workspace package changed. Root gates only.");
    return lines.join("\n");
  }
  if (filters.length > 0) {
    lines.push("Gate these packages:");
    for (const name of filters) lines.push(`  --filter ${name}`);
  }
  if (unreadable.length > 0) {
    lines.push("");
    lines.push("Directories with no readable manifest (deleted, or renamed):");
    for (const dir of unreadable) lines.push(`  packages/${dir}`);
  }
  if (scripts) {
    lines.push("");
    lines.push(
      "Also run `pnpm test:scripts` — `turbo run test` does not reach scripts/."
    );
  }
  return lines.join("\n");
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
