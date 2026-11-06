/**
 * The version of a package as the app at `appRoot` would import it, or null
 * when the app cannot resolve it.
 *
 * Read through the package's main entry, which every package exports, and the
 * nearest `package.json` above it on disk, never through the
 * `<name>/package.json` subpath: a package whose `exports` map leaves that
 * subpath out (older drizzle-orm lines, for one) throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED there, and the version is what the caller
 * needs to check.
 *
 * @module shared/lib/installed-package-version
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export function installedPackageVersion(
  appRoot: string,
  name: string
): string | null {
  const appRequire = createRequire(`${appRoot}/package.json`);
  let entry: string;
  try {
    entry = appRequire.resolve(name);
  } catch {
    // Not resolvable from the app root: the app does not have it.
    return null;
  }
  // Walk up from the resolved entry file to the package's own package.json.
  let dir = dirname(entry);
  for (let i = 0; i < 20; i++) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8")
      ) as { name?: string; version?: string };
      if (pkg.name === name) return pkg.version ?? null;
    } catch {
      // No package.json here (or unreadable): keep climbing.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
