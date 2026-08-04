/**
 * Build the declarations the surface guard reads.
 *
 * `ui-surface.test.ts` asserts that release tags survive the declaration
 * bundler, which it can only do against the files in `dist`. Skipping when
 * those are missing is the exact failure the guard exists to catch, so they are
 * generated instead.
 *
 * Every published entry point is built, not just the barrel: `index.d.ts` comes
 * from the default config, and `utils.d.ts` and `tailwind-preset.d.ts` only
 * from the server-safe one. Building one of the two leaves the guard asserting
 * against files that were never written.
 *
 * ## It builds every time, on purpose
 *
 * An earlier version computed whether `dist` was stale — walking the tsconfig
 * `extends` chain, resolving bare and relative specifiers, reading manifest
 * `tsconfig` fields and `exports` maps, timestamping the workspace lockfile.
 * That is re-implementing a build system's dependency tracking inside a test
 * helper, and it does not converge: TypeScript's config resolution is a deep
 * enough spec that each correction uncovered another case it answered wrongly,
 * and every one of those was a case where stale declarations passed.
 *
 * Turbo already tracks this properly — `packages/ui/turbo.json` makes `test`
 * depend on this package's own `build`, with real input hashing — so the only
 * caller the hand-rolled version ever served was a direct
 * `pnpm --filter @nextlyhq/ui test`, which AGENTS.md already says not to rely
 * on. Rebuilding unconditionally costs about two seconds and is correct by
 * construction rather than by exhaustive case analysis. Turbo caches the whole
 * `test` task, so the repeated runs that would notice the cost never reach here.
 *
 * Deliberately NOT `build:js`: that begins with `rimraf dist`, and in the
 * parallel task graph other packages read this package's `dist` while their own
 * tests run. Removing it mid-run makes them fail for a reason of our making.
 * `tsup` alone rewrites the files in place.
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");

/**
 * Every declaration a published entry point resolves to.
 *
 * Both module systems, because `package.json` gives each entry point an
 * `import.types` AND a `require.types` condition. Listing only the ESM `.d.ts`
 * left the files served to CommonJS consumers unbuilt and unchecked for release
 * tags, so `dist/index.d.cts` could be missing or untagged while every
 * assertion here stayed green.
 */
export const DECLARATION_ENTRIES = [
  "index.d.ts",
  "utils.d.ts",
  "tailwind-preset.d.ts",
  "index.d.cts",
  "utils.d.cts",
  "tailwind-preset.d.cts",
];

/** Each declaration's current mtime, or `undefined` where it does not exist. */
function declarationMtimes(): Map<string, number | undefined> {
  return new Map(
    DECLARATION_ENTRIES.map(entry => {
      try {
        return [entry, statSync(join(pkgRoot, "dist", entry)).mtimeMs];
      } catch {
        return [entry, undefined];
      }
    })
  );
}

export function ensureDeclarations(): void {
  // Read before the build and compared after. Existence alone cannot tell an
  // emitted file from a left-over one: both configs set `clean: false`, so an
  // entry point dropped from one leaves its previous declaration in `dist`,
  // present and stale. Asking whether each file CHANGED answers that directly,
  // and needs none of the input resolution this file used to carry.
  const before = declarationMtimes();
  execFileSync("npx", ["tsup"], { cwd: pkgRoot, stdio: "inherit" });
  execFileSync("npx", ["tsup", "--config", "tsup.server-safe.config.ts"], {
    cwd: pkgRoot,
    stdio: "inherit",
  });

  const after = declarationMtimes();
  const missing = DECLARATION_ENTRIES.filter(entry => {
    const now = after.get(entry);
    return now === undefined || now === before.get(entry);
  });
  if (missing.length > 0) {
    throw new Error(
      `The declaration build did not produce: ${missing.join(", ")}. ` +
        "Every entry in DECLARATION_ENTRIES is a published entry point, so " +
        "one the current tsup config no longer emits would otherwise be " +
        "checked in its previous form. Add the entry back, or remove it here " +
        "and from the package's `exports` together."
    );
  }
}
