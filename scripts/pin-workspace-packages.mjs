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
    const { name, peerDependencies, peerDependenciesMeta } = JSON.parse(
      readFileSync(join(scratch, "package", "package.json"), "utf-8")
    );
    // OPTIONAL peers are excluded. `nextly` declares all three database adapters as optional
    // peers, and a scaffolded app installs exactly the one it was generated for. Adding the other
    // two would not merely bloat the install: it would let an accidental import of an adapter the
    // app never declared COMPILE, so the leg would pass on code a real user's install cannot run -
    // the check weakened by the thing meant to repair it.
    const required = Object.keys(peerDependencies ?? {}).filter(
      peer => peerDependenciesMeta?.[peer]?.optional !== true
    );
    map[name] = { spec: `file:${tarball}`, peers: required };
  }
  return map;
}

const packed = readPackedNames(packsDir);
const names = Object.keys(packed);
const overrides = Object.fromEntries(
  names.map(name => [name, packed[name].spec])
);

if (names.length === 0) {
  console.error(`No .tgz files in ${packsDir} — nothing was packed.`);
  process.exit(1);
}

const manifestPath = join(projectDir, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

let pinned = 0;
// `optionalDependencies` is listed with the other two because it is the third place a manifest
// can name a package, and a spec left unpinned there resolves from the registry exactly as an
// unpinned dependency would.
for (const [name, spec] of Object.entries(overrides)) {
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    if (manifest[field]?.[name]) {
      manifest[field][name] = spec;
      pinned += 1;
    }
  }
}

// A packed package that is only ever a PEER of another packed package is named by neither the
// manifest nor the pin loop above, and an override alone does not put it in the tree. Under npm's
// hoisted layout that goes unnoticed; under pnpm's isolated one the dependent cannot resolve it,
// which is a build failure that reads as a missing export rather than as a missing install.
//
// The override makes it worse rather than better: it rewrites the peer RANGE to the `file:` spec,
// and no resolved semver version satisfies one, so pnpm reports the peer unmet even when a correct
// copy is present. Adding a direct dependency is what puts the package in the tree regardless of
// whether its range can ever be satisfied.
//
// Derived from the tarballs rather than listed here, for the reason this file already gives about
// package names: the manifests answer it, and a list would be a second answer that has to be kept
// in step. `peerDependenciesMeta` is read alongside, so an OPTIONAL peer is never added - see the
// note in `readPackedNames`.
// Walked from what this manifest ACTUALLY installs, rather than unioned across every tarball.
// A union adds a peer because SOME packed package wants it: a blank scaffold, which installs no
// plugin, gained `@nextlyhq/plugin-sdk` because `plugin-form-builder` declares it. That is the
// same failure as adding an optional adapter - it lets an accidental import compile in a project
// whose real install would reject it, so the leg passes on code a user cannot run.
//
// Transitive, because a peer that gets added brings its own required peers with it, and stopping
// at one level would leave the second unresolvable for exactly the reason the first was.
const declared = name =>
  Boolean(
    manifest.dependencies?.[name] ||
      manifest.devDependencies?.[name] ||
      manifest.optionalDependencies?.[name]
  );

const reachable = new Set(names.filter(declared));
const frontier = [...reachable];
const needed = new Set();
while (frontier.length > 0) {
  const name = frontier.pop();
  for (const peer of packed[name]?.peers ?? []) {
    // A peer that was not packed is left to the registry, which is where it would come from
    // in a real install too.
    if (!names.includes(peer)) continue;
    if (reachable.has(peer) || needed.has(peer)) continue;
    needed.add(peer);
    frontier.push(peer);
  }
}

let added = 0;
for (const peer of needed) {
  if (declared(peer)) continue;
  manifest.dependencies = { ...manifest.dependencies, [peer]: overrides[peer] };
  added += 1;
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
