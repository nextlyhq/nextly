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
 * ## The build is a TASK, not something a test hook pays for
 *
 * It used to run inside `beforeAll` with a 120-second budget. The work is about
 * two seconds; the budget is wall-clock, and on a runner already executing the
 * rest of the turbo graph it was exceeded — so the suite failed with
 * `Hook timed out in 120000ms` on branches that had not touched this package,
 * and it reddened `main` itself. Raising the number only moves where that
 * happens.
 *
 * So the build is a turbo task the test DEPENDS on. Turbo schedules it, caches
 * it against declared inputs, and imposes no deadline on it. The suite then
 * only reads.
 *
 * ## Staleness is asked, coarsely and fail-CLOSED
 *
 * An earlier version computed staleness precisely — walking the tsconfig
 * `extends` chain, resolving bare and relative specifiers, reading manifest
 * `tsconfig` fields and `exports` maps, timestamping the workspace lockfile.
 * That is a build system's dependency tracking re-implemented in a test helper,
 * and it did not converge: every correction uncovered another case it answered
 * wrongly, and each of those was a case where stale declarations PASSED.
 *
 * The question here is smaller and does converge: has anything in this package
 * changed since the build ran? No graph is resolved, and the only way to be
 * wrong is to claim staleness that a rebuild then disproves — which costs two
 * seconds and never passes a stale guard. Turbo answers the same question
 * properly for a `turbo test` run; this covers someone running `vitest`
 * directly after an edit, where nothing else would.
 *
 * Deliberately NOT `build:js`: that begins by removing `dist`, which is the
 * shared directory this exists to stay out of.
 */
import { execFileSync } from "node:child_process";
import { declarationFiles } from "../../scripts/published-entries.js";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
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
 * Run by the `build:surface-declarations` script, which the test task depends
 * on. Callers read from the returned path rather than assuming one, so the
 * guard and the build cannot disagree about where the files are.
 */
export function buildDeclarations(): string {
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

/** What the declaration build reads, for deciding whether it is out of date. */
const BUILD_INPUTS = [
  "src",
  "tsup.config.ts",
  "tsup.server-safe.config.ts",
  "tsconfig.json",
  "package.json",
];

/** The newest modification time anywhere under a path, or 0 if it is absent. */
function newestUnder(path: string): number {
  if (!existsSync(path)) return 0;
  const info = statSync(path);
  if (!info.isDirectory()) return info.mtimeMs;
  let newest = info.mtimeMs;
  for (const entry of readdirSync(path)) {
    newest = Math.max(newest, newestUnder(join(path, entry)));
  }
  return newest;
}

/**
 * The directory holding the built declarations, or a refusal saying what to do.
 *
 * Never builds. Reporting what is wrong is the point: a guard that quietly
 * rebuilt would be paying for a build inside a test again, and one that quietly
 * read whatever was there would pass against declarations nothing produced.
 */
export function declarationsDir(): string {
  const missing = DECLARATION_ENTRIES.filter(
    entry => !existsSync(join(OUT_DIR, entry))
  );
  if (missing.length > 0) {
    throw new Error(
      `The surface declarations are not built: ${missing.join(", ")} is absent. ` +
        "Run `pnpm --filter @nextlyhq/ui build:surface-declarations`, or run " +
        "the suite through `turbo test`, which depends on that task."
    );
  }

  const built = Math.min(
    ...DECLARATION_ENTRIES.map(entry => statSync(join(OUT_DIR, entry)).mtimeMs)
  );
  const changed = Math.max(
    ...BUILD_INPUTS.map(input => newestUnder(join(pkgRoot, input)))
  );
  if (changed > built) {
    throw new Error(
      "The surface declarations are older than this package's sources, so the " +
        "guard would describe code that is no longer here. Run " +
        "`pnpm --filter @nextlyhq/ui build:surface-declarations`, or run the " +
        "suite through `turbo test`."
    );
  }
  return OUT_DIR;
}
