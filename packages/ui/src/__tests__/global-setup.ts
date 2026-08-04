/**
 * Make sure the built declarations exist before any suite reads them.
 *
 * `ui-surface.test.ts` asserts that release tags survive the declaration
 * bundler, which it can only do against `dist/index.d.ts`. Skipping when that
 * file is missing is what the guard exists to prevent, so it is generated
 * instead — and generated here, because a global setup is the one place every
 * entry point passes through, including watch, UI and coverage.
 *
 * Deliberately NOT `build:js`: that begins with `rimraf dist`, and in the
 * parallel task graph other packages read this package's `dist` while their own
 * tests run. Removing it mid-run makes them fail for a reason that has nothing
 * to do with them. `tsup` alone rewrites the files in place.
 *
 * Skips entirely when the declarations are newer than every source file, which
 * is the normal case under turbo, where `test` already depends on `build`.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const declarations = join(pkgRoot, "dist", "index.d.ts");

function newestSourceMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestSourceMtime(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    newest = Math.max(newest, statSync(full).mtimeMs);
  }
  return newest;
}

export default function setup(): void {
  let builtAt = 0;
  try {
    builtAt = statSync(declarations).mtimeMs;
  } catch {
    builtAt = 0;
  }
  if (builtAt > newestSourceMtime(join(pkgRoot, "src"))) return;
  execFileSync("npx", ["tsup"], { cwd: pkgRoot, stdio: "inherit" });
}
