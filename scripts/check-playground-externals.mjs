#!/usr/bin/env node
/**
 * Fails when a package the playground's server keeps external would be
 * bundled under `next dev --webpack` after all.
 *
 * Under webpack, Next keeps a package external only when the app's own folder
 * resolves it to the same file the importing package does; otherwise it
 * bundles it, and a package that cannot be bundled (drizzle-kit, esbuild)
 * answers every request with a 500. So a package fails two ways: it cannot be
 * found from the playground at all, or the playground finds a different copy
 * from the one nextly or an adapter loads (another version, under pnpm).
 * Turbopack does not ask, so the playground worked there while webpack broke,
 * and nothing said so. A version range cannot show the second way: the
 * workspace's overrides rewrite the playground's ranges, so the copies are
 * compared, not their specifiers.
 *
 * Which packages stay external is read, not listed here: every entry of the
 * playground's `serverExternalPackages`, under both its development and its
 * production configuration, and every package on Next's own list of server
 * externals that nextly depends on, which Next keeps external the same way.
 * Which packages import them is read too: the workspace packages the
 * playground loads, each against the externals its manifest declares. So a
 * package added to either side is checked the day it is added.
 *
 *   node scripts/check-playground-externals.mjs
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playground = join(root, "apps/playground");

/**
 * The real folder of the copy of `pkg` found from `fromDir` as Next's
 * resolver finds it, or `null`: a `node_modules/<pkg>` in the folder or one
 * above it. Node would also look in `NODE_PATH` and the global folders, which
 * pnpm's script shims and a machine's own installs fill; the bundler looks in
 * neither, so neither counts. Real, so two links to one store copy are one
 * copy, and two versions are two.
 */
export function packageDirFrom(fromDir, pkg) {
  for (let dir = resolve(fromDir); ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", pkg);
    if (existsSync(join(candidate, "package.json"))) {
      return realpathSync(candidate);
    }
    if (dirname(dir) === dir) return null;
  }
}

/** The package names in Next's `server-external-packages.jsonc`. */
export function parseNextExternals(text) {
  const withoutComments = text
    .split("\n")
    .filter(line => !line.trim().startsWith("//"))
    .join("\n");
  return [...withoutComments.matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

/** Every package a manifest declares it may load at runtime. */
export function runtimeDependencies(manifest) {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ];
}

/**
 * The packages one configuration of the playground's server keeps external:
 * its own list, and the part of Next's list nextly depends on.
 */
export function externalPackages({ configured, nextExternals, nextlyRuntime }) {
  const nextKeeps = nextExternals.filter(pkg => nextlyRuntime.includes(pkg));
  return [...new Set([...configured, ...nextKeeps])].sort();
}

/**
 * The workspace packages webpack bundles into the playground's server, each
 * with its folder and the packages its manifest declares: the playground's
 * workspace dependencies and theirs, followed through the workspace. An
 * external one is left out with everything reached only through it: webpack
 * never reads inside it, so its imports are Node's to resolve at runtime and
 * no copy of theirs can be bundled.
 */
export function loadedWorkspace(appManifest, workspace, externals) {
  const loaded = new Map();
  const pending = runtimeDependencies(appManifest);
  while (pending.length > 0) {
    const name = pending.pop();
    const pkg = workspace.get(name);
    if (!pkg || loaded.has(name) || externals.includes(name)) continue;
    const declares = runtimeDependencies(pkg.manifest);
    loaded.set(name, { name, dir: pkg.dir, declares });
    pending.push(...declares);
  }
  return [...loaded.values()];
}

/**
 * Every external the playground would bundle: of those a bundled workspace
 * package declares, one the playground cannot find, and one it finds as a
 * different copy from the one that package loads.
 */
export function bundledExternals({ appDir, packages, loaders }) {
  const found = [];
  for (const pkg of packages) {
    // Only what bundled code loads can be bundled: a listed external nothing
    // here declares has no importer for webpack to resolve it from.
    const declarers = loaders.filter(loader => loader.declares.includes(pkg));
    if (declarers.length === 0) continue;
    const own = packageDirFrom(appDir, pkg);
    if (own === null) {
      found.push({
        pkg,
        reason: `cannot be found from the playground, though ${declarers.map(l => l.name).join(", ")} loads it`,
      });
      continue;
    }
    for (const loader of declarers) {
      const theirs = packageDirFrom(loader.dir, pkg);
      if (theirs !== null && theirs !== own) {
        found.push({
          pkg,
          reason: `is ${relative(root, own)} from the playground but ${relative(root, theirs)} from ${loader.name}`,
        });
      }
    }
  }
  return found;
}

/** Every workspace package by name, with its folder and manifest. */
function workspacePackages() {
  const all = new Map();
  for (const group of ["packages", "apps"]) {
    for (const entry of readdirSync(join(root, group))) {
      const file = join(root, group, entry, "package.json");
      if (!existsSync(file)) continue;
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      if (manifest.name)
        all.set(manifest.name, { dir: dirname(file), manifest });
    }
  }
  return all;
}

/** The playground's `serverExternalPackages` with NODE_ENV set to `env`. */
async function configuredFor(env) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = env;
  try {
    // A query per environment, so each import evaluates the file afresh.
    const url = `${pathToFileURL(join(playground, "next.config.ts")).href}?env=${env}`;
    const config = (await import(url)).default;
    return config.serverExternalPackages ?? [];
  } finally {
    process.env.NODE_ENV = previous;
  }
}

async function main() {
  const next = dirname(
    createRequire(join(playground, "package.json")).resolve("next/package.json")
  );
  const read = file => JSON.parse(readFileSync(file, "utf8"));
  const nextExternals = parseNextExternals(
    readFileSync(join(next, "dist/lib/server-external-packages.jsonc"), "utf8")
  );
  const nextlyRuntime = runtimeDependencies(
    read(join(root, "packages/nextly/package.json"))
  );
  const appManifest = read(join(playground, "package.json"));
  const workspace = workspacePackages();

  // Each configuration on its own: what one keeps external another bundles
  // (nextly itself, transpiled under development), so the importers differ.
  const lines = new Set();
  let checked = 0;
  for (const env of ["development", "production"]) {
    const packages = externalPackages({
      configured: await configuredFor(env),
      nextExternals,
      nextlyRuntime,
    });
    const loaders = loadedWorkspace(appManifest, workspace, packages);
    checked += packages.length;
    for (const { pkg, reason } of bundledExternals({
      appDir: playground,
      packages,
      loaders,
    })) {
      lines.add(`  ${pkg} ${reason} (${env})`);
    }
  }
  if (lines.size > 0) {
    console.error(
      "next dev --webpack would bundle packages the playground keeps external:"
    );
    for (const line of lines) console.error(line);
    console.error(
      "Give the playground the copy its workspace packages load (its package.json, or a hoist), or stop keeping the package external."
    );
    process.exit(1);
  }
  console.log(
    `Every package the playground keeps external (${checked} across development and production) resolves from apps/playground to the copy the code it bundles loads.`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
