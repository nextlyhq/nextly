/**
 * Bring the built declarations up to date with the source, if they are behind.
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
 * Deliberately NOT `build:js`: that begins with `rimraf dist`, and in the
 * parallel task graph other packages read this package's `dist` while their own
 * tests run. Removing it mid-run makes them fail for a reason of our making.
 * `tsup` alone rewrites the files in place.
 *
 * Exported rather than inlined into the global setup because Vitest initialises
 * a global setup once per project, not once per run — so a watch rerun after an
 * edit would otherwise compare against declarations built before it. The suite
 * that depends on these calls this too, where it is re-evaluated every run.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");

/**
 * Every declaration a published entry point resolves to.
 *
 * Both module systems, because `package.json` gives each entry point an
 * `import.types` AND a `require.types` condition. Listing only the ESM `.d.ts`
 * left the files served to CommonJS consumers unbuilt, unchecked for freshness
 * and unchecked for release tags — so `dist/index.d.cts` could be missing or
 * untagged while every assertion here stayed green.
 */
export const DECLARATION_ENTRIES = [
  "index.d.ts",
  "utils.d.ts",
  "tailwind-preset.d.ts",
  "index.d.cts",
  "utils.d.cts",
  "tailwind-preset.d.cts",
];

/**
 * The non-source files the declaration output also depends on.
 *
 * A tsup or tsconfig change alters what the bundler emits — which entry points
 * exist, and whether doc comments survive at all — without touching anything
 * under `src`. Judging freshness on `src` alone meant such a change left the
 * old artifacts in place and the guard asserting against declarations the
 * current configuration would not produce. `package.json` is included because
 * the bundler version lives there.
 */
const BUILD_INPUTS = [
  "tsup.config.ts",
  "tsup.server-safe.config.ts",
  "tsconfig.json",
  "package.json",
];

/**
 * Every tsconfig in the `extends` chain, the package's own included.
 *
 * The local file is four lines of overrides; the options that actually decide
 * what the declaration bundler emits live in the shared configs it inherits
 * (`@nextlyhq/tsconfig/react-library-bundler.json` and the two beneath it).
 * Timestamping only the local file therefore watched the one member of the
 * chain least likely to change.
 *
 * Resolved with the compiler's own parser rather than `JSON.parse`, because a
 * tsconfig may carry comments and trailing commas, and `extends` may be a
 * single specifier or an array of them.
 */
function tsconfigChain(entry: string): string[] | undefined {
  const seen = new Set<string>();
  const chain: string[] = [];

  const visit = (file: string): boolean => {
    if (seen.has(file)) return true;
    seen.add(file);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return false;
    }
    chain.push(file);
    const parsed = ts.parseConfigFileTextToJson(file, text).config as
      | { extends?: string | string[] }
      | undefined;
    const extend = parsed?.extends;
    if (extend === undefined) return true;
    const req = createRequire(file);
    for (const spec of Array.isArray(extend) ? extend : [extend]) {
      let target: string;
      try {
        // A relative specifier resolves against the file that names it; a bare
        // one is a package export, which is how the shared configs are reached.
        target = spec.startsWith(".")
          ? resolve(dirname(file), spec)
          : req.resolve(spec);
      } catch {
        return false;
      }
      if (!visit(target)) return false;
    }
    return true;
  };

  // A chain that cannot be followed is reported as unknown rather than as the
  // part of it that was readable, so the caller can refuse instead of trusting
  // a partial answer.
  return visit(entry) ? chain : undefined;
}

/**
 * The newest of the declaration build's inputs outside `src`.
 *
 * A MISSING input reads as infinitely new rather than as zero. Every entry
 * here is required to produce the declarations, so one that is absent means
 * `dist` was built by a configuration that no longer exists — the strongest
 * possible reason to distrust it, and treating it as "nothing changed" left
 * the guard asserting happily against artifacts nothing could reproduce.
 * Forcing the rebuild surfaces it as the bundler's own error about the config
 * it cannot find, which says more than any check here could.
 */
function newestBuildInputMtime(): number {
  const chain = tsconfigChain(join(pkgRoot, "tsconfig.json"));
  // An unfollowable chain is treated like a missing input, for the same reason:
  // the declarations were produced by a configuration this cannot account for.
  if (chain === undefined) return Number.POSITIVE_INFINITY;
  const files = [
    ...BUILD_INPUTS.map(name => join(pkgRoot, name)),
    // The local tsconfig is in both lists; `seen` above and `Math.max` here
    // both make that harmless.
    ...chain,
  ];
  let newest = 0;
  for (const file of files) {
    try {
      newest = Math.max(newest, statSync(file).mtimeMs);
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }
  return newest;
}

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

/** The oldest declaration, or 0 when any of them is missing entirely. */
function oldestDeclarationMtime(): number {
  let oldest = Number.POSITIVE_INFINITY;
  for (const entry of DECLARATION_ENTRIES) {
    try {
      oldest = Math.min(oldest, statSync(join(pkgRoot, "dist", entry)).mtimeMs);
    } catch {
      return 0;
    }
  }
  return oldest === Number.POSITIVE_INFINITY ? 0 : oldest;
}

/**
 * The newest thing the declarations are built FROM.
 *
 * Exported so the staleness assertion and this rebuild decide freshness from
 * the same set of inputs. Two definitions would drift, and the one in the test
 * is the one that would silently keep passing.
 */
export function newestDeclarationInputMtime(): number {
  return Math.max(
    newestSourceMtime(join(pkgRoot, "src")),
    newestBuildInputMtime()
  );
}

export function ensureDeclarations(): void {
  const inputs = newestDeclarationInputMtime();
  if (oldestDeclarationMtime() > inputs) return;
  execFileSync("npx", ["tsup"], { cwd: pkgRoot, stdio: "inherit" });
  execFileSync("npx", ["tsup", "--config", "tsup.server-safe.config.ts"], {
    cwd: pkgRoot,
    stdio: "inherit",
  });

  // Running the bundler is not the same as producing the files. Both configs
  // set `clean: false`, so an entry point dropped from one of them leaves its
  // previous declaration in `dist`, older than the config that no longer emits
  // it and looking exactly like a file that was simply not touched this run.
  // Asserting the OUTCOME rather than the action is what tells those apart.
  const stale = DECLARATION_ENTRIES.filter(entry => {
    try {
      return statSync(join(pkgRoot, "dist", entry)).mtimeMs <= inputs;
    } catch {
      return true;
    }
  });
  if (stale.length > 0) {
    throw new Error(
      `The declaration build did not produce: ${stale.join(", ")}. ` +
        "Every entry in DECLARATION_ENTRIES is a published entry point, so " +
        "one the current tsup config no longer emits would otherwise be " +
        "checked in its previous form. Add the entry back, or remove it here " +
        "and from the package's `exports` together."
    );
  }
}
