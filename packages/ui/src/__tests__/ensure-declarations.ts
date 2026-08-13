/**
 * Build the declarations the surface guard reads, into a directory of its own.
 *
 * `ui-surface.test.ts` asserts that release tags survive the declaration
 * bundler, which it can only do against built files. Skipping when they are
 * missing is the exact failure the guard exists to catch, so they are
 * generated instead.
 *
 * ## Not into `dist`, and that matters
 *
 * `dist` is what every other package imports this one through. Turbo runs
 * `@nextlyhq/ui#test` and `@nextlyhq/admin#test` concurrently — both depend on
 * `@nextlyhq/ui#build`, neither depends on the other, and admin has no path
 * alias for this package, so its Vitest run resolves the workspace import
 * through `dist`. Rebuilding there would rewrite the bundle while another
 * package's tests are reading it, and the resulting failure would appear in a
 * suite that did nothing wrong.
 *
 * Writing somewhere private removes the shared resource rather than trying to
 * schedule around it, and it costs nothing: the guard needs to INSPECT a
 * declaration build, never to replace the shipped one.
 *
 * ## The directory is emptied first, so presence proves emission
 *
 * Both tsup configs set `clean: false`. Against `dist` that made existence
 * meaningless — an entry point dropped from a config leaves its previous
 * declaration behind, present and stale, so the guard would check a file
 * nothing had produced. Starting from an empty directory answers the same
 * question exactly, and without comparing timestamps around the build.
 *
 * ## It builds every time, on purpose
 *
 * An earlier version computed whether the output was stale — walking the
 * tsconfig `extends` chain, resolving bare and relative specifiers, reading
 * manifest `tsconfig` fields and `exports` maps, timestamping the workspace
 * lockfile. That is a build system's dependency tracking, re-implemented in a
 * test helper, and it did not converge: each correction uncovered another case
 * it answered wrongly, and every one of those was a case where stale
 * declarations passed. Rebuilding unconditionally costs about two seconds and
 * is correct by construction.
 *
 * Deliberately NOT `build:js`: that begins by removing `dist`, which is the
 * shared directory this exists to stay out of.
 */
import { execFileSync } from "node:child_process";
import { declarationFiles } from "../../scripts/published-entries.js";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");

/**
 * Where the guard's own declaration build lands.
 *
 * Under `node_modules` so it is already ignored by git and by every tool that
 * walks the package, and outside `dist` so no consumer can resolve into it.
 */
const OUT_DIR = join(pkgRoot, "node_modules", ".cache", "surface-declarations");

/**
 * Every declaration a published entry point resolves to, derived from the export map.
 *
 * Derived rather than listed, because a hand-written copy is unprotected by default for anything
 * added after it: a new subpath is simply absent, every assertion here stays green, and nothing
 * says the new entry point is unchecked.
 */
export const DECLARATION_ENTRIES: string[] = declarationFiles();

/**
 * Build the declarations and return the directory holding them.
 *
 * Callers read from the returned path rather than assuming one, so the guard
 * and the build cannot disagree about where the files are.
 */
export function ensureDeclarations(): string {
  rmSync(OUT_DIR, { recursive: true, force: true });

  const run = (args: string[]) =>
    execFileSync("npx", ["tsup", ...args, "--out-dir", OUT_DIR], {
      cwd: pkgRoot,
      stdio: "inherit",
    });
  run([]);
  run(["--config", "tsup.server-safe.config.ts"]);

  const missing = DECLARATION_ENTRIES.filter(
    entry => !existsSync(join(OUT_DIR, entry))
  );
  if (missing.length > 0) {
    throw new Error(
      `The declaration build did not produce: ${missing.join(", ")}. ` +
        "Every entry in DECLARATION_ENTRIES is a published entry point, so " +
        "one the current tsup config no longer emits would otherwise be " +
        "checked in its previous form. Add the entry back, or remove it here " +
        "and from the package's `exports` together."
    );
  }
  return OUT_DIR;
}
