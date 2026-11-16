/**
 * Whether a package is installed for an app, as the app's own imports find it.
 *
 * Asked from the app's root, never from this package's folder: in this
 * monorepo every package can reach every other, so an answer read from here
 * would say yes for a package the app never installed. The generated files
 * import packages from the app, so the app's layout is what decides.
 *
 * Two ways of finding one, since package managers lay an install out in two:
 *
 * - A `node_modules` folder on the way up from the app's root, as npm, pnpm
 *   and Yarn's `node-modules` linker leave it, and as TypeScript and Node
 *   both look. Read from the disk, so a package whose build is missing still
 *   counts as installed.
 * - Under Yarn Plug'n'Play only (`process.versions.pnp`), Node's resolver
 *   from the app's `package.json`: Plug'n'Play keeps no `node_modules` and
 *   answers through the resolver it patches into the process `yarn` runs.
 *   Never otherwise, because Node's resolver also reads `NODE_PATH`, which
 *   `pnpm` sets for every script it runs to its store's hoisted folder: a
 *   package found there is one the app's own imports cannot reach.
 *
 * Under Plug'n'Play, only a resolver that says the package is not there
 * reads as not installed. Any other failure (a package that exports no root,
 * an error this cannot place) reads as installed and keeps the import the
 * generator always wrote, since leaving it out of an app that has the
 * package would stop that app registering what it has.
 *
 * @module plugins/codegen/installed-package
 */

import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

/** Whether package `name` is installed for the app whose root is `cwd`. */
export function packageInstalled(name: string, cwd: string): boolean {
  if (findPackageDir(name, cwd) !== undefined) return true;
  if (process.versions.pnp === undefined) return false;
  try {
    createRequire(join(resolve(cwd), "package.json")).resolve(name);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND";
  }
}

/** The folder of package `name` in the nearest `node_modules` from `cwd` up. */
function findPackageDir(name: string, cwd: string): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (isFile(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
