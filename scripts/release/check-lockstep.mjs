// Refuses a tree whose publishable packages do not all share one version.
//
// The packages version in lockstep, and the release's preflight refuses a
// train that is not. This runs the same test in CI on every pull request and
// every queued group, where the case that matters is a Version Packages pull
// request that went stale: a public package added to `main` after it was last
// refreshed keeps its old version while every other package takes the next
// one. The queue's combined tree then fails here, and the pull request cannot
// merge until a refresh versions the new package too, instead of merging and
// leaving its release unpublished.
//
// Exit codes: 0 = one version, 1 = more than one.

import { fileURLToPath } from "node:url";

import { classifyPreflight, getReleaseManifest } from "./lib.mjs";

/**
 * The packages off the train's version, as preflight decides it. Derived from
 * preflight's own classification rather than tested again here, so the two
 * cannot disagree; the version rule reads the manifests only, so no registry
 * is asked.
 */
export function lockstepMismatches(manifest) {
  return classifyPreflight(manifest, new Map(), manifest[0]?.version)
    .versionMismatch;
}

/** The packages at each version, most packages first, so a message shows the split at a glance. */
export function byVersion(manifest) {
  const groups = new Map();
  for (const { name, version } of manifest) {
    groups.set(version, [...(groups.get(version) ?? []), name]);
  }
  return [...groups].sort((a, b) => b[1].length - a[1].length);
}

/** What a failing run prints: the split, then what to do on a Version Packages pull request. */
export function lockstepFailure(manifest) {
  return [
    "check-lockstep: the publishable packages are not in lockstep",
    ...byVersion(manifest).map(
      ([version, names]) =>
        `  ${version} (${names.length}): ${names.join(", ")}`
    ),
    "On a Version Packages pull request this means a package was added after its last refresh:" +
      " run the Release workflow from main (Actions → Release → Run workflow) to refresh it.",
  ].join("\n");
}

function main() {
  const manifest = getReleaseManifest();
  if (lockstepMismatches(manifest).length === 0) {
    console.log(
      `check-lockstep: ${manifest.length} publishable packages at ${manifest[0]?.version}`
    );
    return;
  }
  console.error(lockstepFailure(manifest));
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
