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
import type { NodeRequire } from "node:module";
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
 * The workspace lockfile, which pins the compiler and bundler actually used.
 *
 * `typescript` and `tsup` are both caret ranges, so `pnpm update` can move the
 * installed version — and therefore the emitted declarations — without editing
 * this package's manifest at all. The lockfile is the only file that records
 * which versions produced `dist`.
 *
 * Found by walking up rather than by a fixed depth, so it survives the package
 * moving within the workspace.
 */
function workspaceLockfile(): string | undefined {
  let dir = pkgRoot;
  for (;;) {
    const candidate = join(dir, "pnpm-lock.yaml");
    try {
      statSync(candidate);
      return candidate;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
  }
}

/**
 * A relative `extends` target, trying the literal path then the `.json` form.
 *
 * `extends: "./base-bundler"` is valid and names `base-bundler.json`;
 * `path.resolve` alone yields a path that does not exist, which would read as
 * an unfollowable chain and force a rebuild on every run.
 */
function relativeExtends(fromDir: string, spec: string): string {
  const literal = resolve(fromDir, spec);
  try {
    statSync(literal);
    return literal;
  } catch {
    return `${literal}.json`;
  }
}

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
/**
 * A bare `extends` target, resolved the way TypeScript resolves one.
 *
 * TypeScript treats a bare PACKAGE NAME as naming that package's
 * `tsconfig.json`, while Node resolves it to the package's entry point. For a
 * config-only package there is no entry point and `require.resolve` throws; for
 * one that has both, Node returns the JavaScript entry and TypeScript would
 * have read the config. Either way, asking Node first answers a different
 * question.
 *
 * A specifier carrying a subpath (`@scope/pkg/base.json`) names the file
 * directly and needs no such treatment, which is the form this repository uses.
 */
/**
 * The nearest `package.json` at or above a directory.
 *
 * Read from the filesystem rather than through the module resolver, because
 * this exists precisely for packages whose `exports` map refuses
 * `./package.json` — the resolver is the thing that cannot see it.
 */
function nearestManifest(from: string): string | undefined {
  let dir = from;
  for (;;) {
    const candidate = join(dir, "package.json");
    try {
      statSync(candidate);
      return candidate;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
  }
}

function bareExtends(
  req: NodeRequire,
  spec: string,
  consulted: string[]
): string {
  const segments = spec.split("/");
  const isPackageName = segments.length === (spec.startsWith("@") ? 2 : 1);
  // A specifier carrying a subpath names the file directly. Its manifest is
  // still consulted, because an `exports` map can redirect that subpath.
  const manifest = ((): string | undefined => {
    try {
      return req.resolve(
        `${segments.slice(0, spec.startsWith("@") ? 2 : 1).join("/")}/package.json`
      );
    } catch {
      // Encapsulated by an `exports` map; resolution below does not need it.
      return undefined;
    }
  })();
  // A manifest that SELECTS the target is an input in its own right: changing
  // its `tsconfig` field or its `exports` map points the chain at a different
  // file, and if that file predates `dist` nothing else would notice.
  if (manifest !== undefined) consulted.push(manifest);

  // Recorded even when the manifest is UNREACHABLE. A package can export its
  // config while encapsulating `./package.json`, and that same `exports` map is
  // what chose the config — so discarding it would leave the file doing the
  // choosing untracked. The manifest is recovered from the resolved config's
  // own directory instead of through the resolver that refuses it.
  const track = (target: string): string => {
    if (manifest === undefined) {
      const owner = nearestManifest(dirname(target));
      if (owner !== undefined) consulted.push(owner);
    }
    return target;
  };

  if (!isPackageName) return track(req.resolve(spec));

  // The three forms a package can name its config, in TypeScript's order. Each
  // is attempted independently, because an `exports` map may expose one and
  // encapsulate another.
  for (const attempt of [
    (): string | undefined => {
      if (manifest === undefined) return undefined;
      const declared = (
        JSON.parse(readFileSync(manifest, "utf8")) as { tsconfig?: unknown }
      ).tsconfig;
      return typeof declared === "string"
        ? resolve(dirname(manifest), declared)
        : undefined;
    },
    () => req.resolve(`${spec}/tsconfig.json`),
    // The root export, which is how an `exports`-mapped config package is
    // reached. Accepted only when it names a config: resolving a package's
    // JavaScript entry and timestamping that is a wrong answer wearing the
    // shape of a right one.
    () => {
      const target = req.resolve(spec);
      return target.endsWith(".json") ? target : undefined;
    },
  ]) {
    try {
      const target = attempt();
      if (target !== undefined) return track(target);
    } catch {
      // Try the next form.
    }
  }
  throw new Error(`Cannot resolve tsconfig for "${spec}"`);
}

function tsconfigChain(entry: string): string[] | undefined {
  const seen = new Set<string>();
  const chain: string[] = [];
  // Manifests read to CHOOSE a config. They are not configs themselves, but
  // editing one repoints the chain, so they are inputs.
  const consulted: string[] = [];

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
        // TypeScript appends `.json` when the relative form has no extension,
        // so `"./base-bundler"` is a valid config this must follow rather than
        // a path that happens not to exist.
        target = spec.startsWith(".")
          ? relativeExtends(dirname(file), spec)
          : bareExtends(req, spec, consulted);
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
  return visit(entry) ? [...chain, ...consulted] : undefined;
}

/**
 * Every file the declarations are built FROM, outside `src`.
 *
 * Exported so the watch triggers are generated from this list rather than
 * restated as globs beside it. A hand-written second list is how the freshness
 * check came to know about the inherited tsconfigs while the watcher did not.
 */
export function declarationBuildInputs(): string[] | undefined {
  const chain = tsconfigChain(join(pkgRoot, "tsconfig.json"));
  // An unfollowable chain is reported as unknown, for the same reason a missing
  // file is: the declarations came from a configuration this cannot account for.
  if (chain === undefined) return undefined;
  const lockfile = workspaceLockfile();
  // Absent is UNKNOWN, not absent-and-fine. A workspace always has a lockfile,
  // so failing to find one means this cannot say which compiler produced
  // `dist` — the same position a missing config leaves it in, and treated the
  // same way rather than by quietly dropping the input.
  if (lockfile === undefined) return undefined;
  return [
    ...BUILD_INPUTS.map(name => join(pkgRoot, name)),
    // The local tsconfig appears in both; `seen` in the walk and `Math.max`
    // below make the duplicate harmless.
    ...chain,
    lockfile,
  ];
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
  const files = declarationBuildInputs();
  if (files === undefined) return Number.POSITIVE_INFINITY;
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
  if (oldestDeclarationMtime() > newestDeclarationInputMtime()) return;
  // Read BEFORE the build, and compared against afterwards. Comparing the
  // output to the input timestamp instead would collapse two different
  // questions into one: an unknown input reads as `Infinity` to force this
  // rebuild, and every file is older than `Infinity`, so a perfectly good
  // build would then be reported as having produced nothing.
  const before = declarationMtimes();
  execFileSync("npx", ["tsup"], { cwd: pkgRoot, stdio: "inherit" });
  execFileSync("npx", ["tsup", "--config", "tsup.server-safe.config.ts"], {
    cwd: pkgRoot,
    stdio: "inherit",
  });

  // Running the bundler is not the same as producing the files. Both configs
  // set `clean: false`, so an entry point dropped from one of them leaves its
  // previous declaration in `dist`, looking exactly like a file that was
  // simply not touched this run. Asking whether each file CHANGED answers that
  // directly, and does not depend on clock granularity the way comparing
  // against a wall-clock reading taken here would.
  const after = declarationMtimes();
  const stale = DECLARATION_ENTRIES.filter(entry => {
    const now = after.get(entry);
    if (now === undefined) return true;
    return now === before.get(entry);
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

/**
 * Every source file the declarations are built from.
 *
 * Exported for the watcher: these are read from the filesystem to decide
 * freshness, so a deleted one leaves `dist` describing a surface that no longer
 * exists — and nothing in Vitest's module graph knows that, because the guard
 * reads them rather than importing them.
 */
export function declarationSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
  };
  walk(join(pkgRoot, "src"));
  return out;
}
