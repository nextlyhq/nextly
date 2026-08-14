#!/usr/bin/env node

/**
 * Point a scaffolded project at packed workspace packages instead of the registry.
 *
 * A scaffold installs `nextly` and its siblings by version, so a CI job that
 * scaffolds and builds is testing the LAST PUBLISHED release rather than the
 * commit under review. That is the wrong question for a change that spans a
 * template and the core it depends on: the template is merged with core changes
 * the published packages do not have, so the leg fails for a reason that is not
 * a defect — and after release it would pass while a core regression went
 * untested.
 *
 * Usage:
 *   node scripts/pin-workspace-packages.mjs <packs-dir> <npm|pnpm> [project-dir]
 *
 * Both a direct pin and an override are written, because they answer different
 * halves:
 *
 * - The DIRECT dependencies must name the tarball. npm refuses an override that
 *   disagrees with a direct spec (`EOVERRIDE`), so redirecting `nextly` while
 *   the manifest still asks for `^0.0.2-alpha.x` aborts the install.
 * - The OVERRIDE covers the same packages when they appear transitively. pnpm's
 *   layout is not hoisted, so `nextly`'s own dependency on an adapter resolves
 *   from the registry unless it is overridden — and `pnpm pack` rewrites
 *   `workspace:*` to the concrete published version, which exists on npm, so
 *   nothing about the tarball's own manifest prevents that.
 *
 * The package names are read from the tarballs rather than listed here. A list
 * in this file would be a second answer to a question the manifests already
 * answer, and the two agree only until someone adds a package.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [packsDirArg, packageManager, projectDirArg = "."] = process.argv.slice(2);

if (!packsDirArg || !["npm", "pnpm"].includes(packageManager ?? "")) {
  console.error(
    "usage: pin-workspace-packages.mjs <packs-dir> <npm|pnpm> [project-dir]"
  );
  process.exit(1);
}

const packsDir = resolve(packsDirArg);
const projectDir = resolve(projectDirArg);

/** Every packed tarball, mapped from the package name it declares. */
function readPackedNames(dir) {
  const map = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".tgz")) continue;
    const tarball = join(dir, file);
    const scratch = mkdtempSync(join(tmpdir(), "pin-"));
    // Only the manifest is extracted: the name is what identifies the package,
    // and a filename is the packer's spelling of it rather than the thing itself
    // (a scope becomes a dash, so `@nextlyhq/ui` and `nextlyhq-ui` differ).
    execFileSync("tar", ["-xzf", tarball, "-C", scratch, "package/package.json"]);
    const { name } = JSON.parse(
      readFileSync(join(scratch, "package", "package.json"), "utf-8")
    );
    map[name] = `file:${tarball}`;
  }
  return map;
}

const overrides = readPackedNames(packsDir);
const names = Object.keys(overrides);

if (names.length === 0) {
  console.error(`No .tgz files in ${packsDir} — nothing was packed.`);
  process.exit(1);
}

const manifestPath = join(projectDir, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

let pinned = 0;
for (const [name, spec] of Object.entries(overrides)) {
  if (manifest.dependencies?.[name]) {
    manifest.dependencies[name] = spec;
    pinned += 1;
  }
  if (manifest.devDependencies?.[name]) {
    manifest.devDependencies[name] = spec;
    pinned += 1;
  }
}

if (packageManager === "pnpm") {
  manifest.pnpm = { ...manifest.pnpm };
  manifest.pnpm.overrides = { ...manifest.pnpm.overrides, ...overrides };
} else {
  manifest.overrides = { ...manifest.overrides, ...overrides };
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// A control on the rewrite. Overriding packages the project never depended on
// would leave the install pulling the registry copies while this script reports
// success, so the count of DIRECT dependencies actually repointed has to be
// non-zero.
console.log(`packed packages found: ${names.length} (${names.join(", ")})`);
console.log(`direct dependencies repointed at a tarball: ${pinned}`);
if (pinned === 0) {
  console.error(
    "None of the packed packages are dependencies of this project — the " +
      "override would have no effect and the build would test the registry."
  );
  process.exit(1);
}
