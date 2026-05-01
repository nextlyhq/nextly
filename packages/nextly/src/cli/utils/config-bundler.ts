// What: a Turbopack-safe replacement for `bundle-require`.
//
// Why this exists: the previous loader used `bundle-require`, which
// internally calls `(file) => import(file)` on a dynamic path. When
// nextly is loaded inside a Next.js dev server and the application
// has not added `bundle-require` to `serverExternalPackages`,
// Turbopack analyzes that dynamic import statically, fails with
// "Cannot find module as expression is too dynamic", and the whole
// config load throws. End user impact: code-first HMR + boot-time
// schema apply silently no-op, schema renames in `nextly.config.ts`
// never propagate to the actual `dc_<slug>` table column. That is
// exactly the user's reported repro: "edit excerpt -> summary in
// Posts collection in p42, no DB column change even after restart".
//
// How this fixes it: we use esbuild directly and load the compiled
// output via `createRequire(import.meta.url)`. `createRequire` is a
// documented Node-builtin escape hatch that Turbopack treats as a
// runtime require anchored to the calling source file's URL, so the
// static analyzer does not interfere with it. Same pattern as
// `database/drizzle-kit-lazy.ts` (PR #110) which fixed the
// equivalent dynamic-import problem for `drizzle-kit/api`.
//
// What this drops: `bundle-require`'s convenience features we did
// not actually use (filesystem watcher, multi-format guessing,
// preserveTemporaryFiles). The result is ~80 lines of focused code
// over a 400-line dependency that was the source of a
// silent-failure pipeline blocker.

import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, basename, extname } from "node:path";

import { build, type Plugin } from "esbuild";

// Turbopack-bypass: createRequire anchors module resolution to the
// calling source URL. Turbopack treats createRequire output as a
// Node-builtin runtime require and does not statically analyze the
// path argument. This is the same anchor pattern PR #110 uses for
// drizzle-kit/api to escape the same class of bundler failure.
const nodeRequire = createRequire(import.meta.url);

export interface BundleConfigResult {
  // The default-or-namespace export of the compiled config module.
  mod: { default?: unknown } & Record<string, unknown>;
  // Absolute paths of every file esbuild followed during the bundle.
  // Used by the file watcher in dev mode.
  dependencies: string[];
}

export interface BundleConfigOptions {
  filepath: string;
  // Working directory for resolving relative imports. Defaults to
  // dirname(filepath).
  cwd?: string;
  // Module specifiers esbuild should NOT bundle. The list mirrors
  // the previous `bundle-require` external list to preserve the
  // existing user-config-import contract.
  external?: string[];
}

/**
 * Compiles `filepath` (TS or JS) to a temporary CommonJS file via
 * esbuild, then loads it via `createRequire(import.meta.url)` so the
 * dynamic load is invisible to Turbopack's static analyzer.
 *
 * CommonJS (not ESM) because:
 *   1. CJS lets us use createRequire — the Turbopack escape hatch.
 *   2. ESM dynamic `import(file)` is what triggered the original
 *      failure inside bundle-require.
 *   3. TS source `export default` compiles cleanly to CJS
 *      `module.exports.default`, which we read at the call site.
 *
 * The temp directory is removed on every load attempt (success or
 * failure) so repeated reloads do not accumulate orphan files in
 * the OS temp dir.
 */
export async function bundleAndRequire(
  options: BundleConfigOptions
): Promise<BundleConfigResult> {
  const { filepath } = options;
  const projectRoot = options.cwd ?? dirname(filepath);

  // The compiled CJS bundle has external require() calls for the
  // user's deps (drizzle-orm/pg-core, next, etc.). CommonJS resolves
  // those from the file's own __dirname walking up looking for
  // node_modules. The OS tmpdir has no node_modules above it, so
  // anything external would fail with "Cannot find module".
  // Writing the bundle inside the project's node_modules/.cache
  // anchors the require resolution against the project's deps tree
  // and works without intruding on the user's source directory.
  const cacheRoot = join(projectRoot, "node_modules", ".cache", "nextly");
  await mkdir(cacheRoot, { recursive: true });

  const ext = extname(filepath);
  const baseNoExt = basename(filepath, ext);
  // Per-call unique id keeps concurrent / repeat loads from
  // colliding on the same outFile (HMR cycles can overlap).
  const outFile = join(cacheRoot, `${baseNoExt}.${randomUUID()}.cjs`);

  // Plugin to strip the dotenv side-effect import that some
  // user configs include. Re-running dotenv at config-load time
  // is a footgun (overwrites already-set env vars from the
  // shell + Next.js runtime). The original bundle-require call
  // had no equivalent guard, so omit for now and revisit if a
  // real config relies on dotenv being side-effect-imported here.
  const sideEffectGuards: Plugin[] = [];

  try {
    const result = await build({
      entryPoints: [filepath],
      bundle: true,
      platform: "node",
      target: "node20",
      format: "cjs",
      outfile: outFile,
      external: options.external,
      sourcemap: false,
      metafile: true,
      logLevel: "silent",
      plugins: sideEffectGuards,
      // absWorkingDir lets esbuild resolve relative imports from
      // the user's project, not nextly's package directory.
      absWorkingDir: options.cwd,
    });

    // Ensure a fresh load even if a previous load happened in the
    // same process (HMR cycle re-entries do this).
    delete nodeRequire.cache[outFile];

    const mod = nodeRequire(outFile) as {
      default?: unknown;
    } & Record<string, unknown>;

    const dependencies = result.metafile
      ? Object.keys(result.metafile.inputs)
      : [];

    return { mod, dependencies };
  } finally {
    // Best-effort cleanup of the per-call output file. The
    // node_modules/.cache/nextly directory itself stays for
    // future loads (cheap to keep, expensive to recreate per call).
    try {
      await rm(outFile, { force: true });
    } catch {
      // intentionally ignored: temp file lifecycle is non-critical
    }
  }
}
