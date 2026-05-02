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
// How this fixes it: we use esbuild directly (ESM output) and load
// the compiled bundle via `new Function("path", "return import(path)")`.
// The Function-constructor wrapper is opaque to Turbopack's static
// analyzer — the dynamic `import(path)` inside the string body is never
// seen by Turbopack's tree-shaker, so it does not emit "Cannot find
// module as expression is too dynamic". At runtime the import() call
// resolves normally through Node.js's ESM loader.
//
// Why ESM (not CJS as in the original bundleAndRequire):
//   Workspace packages (@revnixhq/*) are published as ESM-only — their
//   exports maps have only an "import" condition, no "require". When the
//   config file imports e.g. `@revnixhq/nextly/config`, those imports are
//   left as external specifiers in the bundle. A CJS bundle resolves them
//   via require(), which fails with ERR_PACKAGE_PATH_NOT_EXPORTED because
//   the "require" condition is missing. An ESM bundle resolves them via
//   import, which correctly follows the "import" condition. Switching to
//   ESM format fixes this without any change to the workspace packages.
//
// All non-relative, non-absolute imports are externalized (same behavior
// as bundle-require's externalPlugin with externalNodeModules=true), so
// esbuild never tries to crawl node_modules dependency trees. The bundle
// written to disk is minimal — only the user's config file and any
// relative imports it makes are compiled; everything else is an ESM
// specifier that Node.js resolves at load time from the cache directory
// (which sits inside the project's node_modules, so all deps are
// reachable).
//
// What this drops: `bundle-require`'s convenience features we did
// not actually use (filesystem watcher, multi-format guessing,
// preserveTemporaryFiles). The result is ~80 lines of focused code
// over a 400-line dependency that was the source of a
// silent-failure pipeline blocker.

import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, basename, extname } from "node:path";
import { pathToFileURL } from "node:url";

import { build, type Plugin } from "esbuild";

// Turbopack-bypass: the Function constructor body is a string — Turbopack's
// static analyzer never sees the `import(path)` call inside it, so it
// cannot emit "Cannot find module as expression is too dynamic". At runtime
// the returned function performs a real dynamic ESM import.
const opaqueImport = new Function(
  "path",
  "return import(path)"
) as (path: string) => Promise<unknown>;

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
 * Compiles `filepath` (TS or JS) to a temporary ESM file via esbuild,
 * then loads it via a Function-constructor-wrapped `import()` so the
 * dynamic load is invisible to Turbopack's static analyzer.
 *
 * ESM (not CJS) because workspace packages export only an "import"
 * condition; require() fails for them. ESM import() resolves "import"
 * conditions correctly.
 *
 * The temp file is written inside the project's node_modules/.cache so
 * that relative specifiers in the bundle resolve against the project's
 * own dep tree rather than the OS temp dir.
 */
export async function bundleAndRequire(
  options: BundleConfigOptions
): Promise<BundleConfigResult> {
  const { filepath } = options;
  const projectRoot = options.cwd ?? dirname(filepath);

  // Writing the bundle inside the project's node_modules/.cache anchors
  // ESM import resolution against the project's dep tree. The OS tmpdir
  // has no node_modules above it so anything external would fail.
  const cacheRoot = join(projectRoot, "node_modules", ".cache", "nextly");
  await mkdir(cacheRoot, { recursive: true });

  const ext = extname(filepath);
  const baseNoExt = basename(filepath, ext);
  // Per-call UUID keeps concurrent / repeat loads (HMR cycles) from
  // colliding on the same outFile.
  const outFile = join(cacheRoot, `${baseNoExt}.${randomUUID()}.mjs`);

  // Mirrors bundle-require's externalPlugin with externalNodeModules=true:
  // mark every non-relative, non-absolute import as external so esbuild
  // never tries to crawl workspace or node_modules dependency trees.
  // Without this, `@revnixhq/nextly/config` triggers esbuild to bundle
  // the entire nextly tree, which transitively pulls in jsdom → undici
  // subpath exports that esbuild cannot resolve.
  const nodeModulesExternalPlugin: Plugin = {
    name: "external-node-modules",
    setup(b) {
      b.onResolve({ filter: /.*/ }, args => {
        if (
          args.kind === "entry-point" ||
          args.path.startsWith(".") ||
          args.path.startsWith("/")
        ) {
          return undefined;
        }
        return { path: args.path, external: true };
      });
    },
  };

  try {
    const result = await build({
      entryPoints: [filepath],
      bundle: true,
      platform: "node",
      target: "node20",
      format: "esm",
      outfile: outFile,
      external: options.external,
      sourcemap: false,
      metafile: true,
      logLevel: "silent",
      plugins: [nodeModulesExternalPlugin],
      // absWorkingDir lets esbuild resolve relative imports from
      // the user's project, not nextly's package directory.
      absWorkingDir: options.cwd,
    });

    // Use a file:// URL so Node.js treats the bundle as an ES module
    // regardless of the project's "type" field.
    const mod = (await opaqueImport(pathToFileURL(outFile).toString())) as {
      default?: unknown;
    } & Record<string, unknown>;

    const dependencies = result.metafile
      ? Object.keys(result.metafile.inputs)
      : [];

    return { mod, dependencies };
  } finally {
    // Best-effort cleanup of the per-call output file. The
    // node_modules/.cache/nextly directory stays for future loads.
    try {
      await rm(outFile, { force: true });
    } catch {
      // intentionally ignored: temp file lifecycle is non-critical
    }
  }
}
