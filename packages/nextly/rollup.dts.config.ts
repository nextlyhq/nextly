/// <reference types="node" />
/**
 * Rollup DTS Config — Plan 23 Phase 10
 *
 * Bundles one `.d.ts` per package.json "exports" entry.
 *
 * Pipeline:
 *   1. `tsc -p tsconfig.dts.json` emits per-file `.d.ts` into
 *      `dist/_intermediate_dts/` (intermediate, cleaned up after bundling).
 *   2. This rollup config reads those pre-emitted `.d.ts` files and bundles
 *      them with `rollup-plugin-dts`, writing one bundled `.d.ts` per
 *      package.json "exports" entry plus any shared chunks under
 *      `dist/_dts-chunks/`.
 *
 * Why pre-emit? Running `rollup-plugin-dts` directly against `.ts` sources
 * forces it to re-resolve the full 140k-line type graph for every entry,
 * OOMs the default Node heap, and takes minutes. Reading pre-emitted `.d.ts`
 * is pure declaration merging: no type resolution, no OOM, seconds per entry.
 *
 * Entries are derived from `package.json` so the two lists never drift.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin, type RollupOptions } from "rollup";
import dts from "rollup-plugin-dts";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = __dirname;
const packageJsonPath = resolve(packageRoot, "package.json");
const tsconfigPath = resolve(packageRoot, "tsconfig.json");

/**
 * Directory where `tsc -p tsconfig.dts.json` writes per-file `.d.ts`. Must
 * match `compilerOptions.outDir` in `tsconfig.dts.json`.
 */
const INTERMEDIATE_DTS_DIR = "dist/_intermediate_dts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PackageExportValue {
  types?: string;
  import?: string;
}

interface PackageJson {
  exports?: Record<string, PackageExportValue>;
}

interface TsConfig {
  compilerOptions?: {
    paths?: Record<string, string[]>;
  };
}

// ---------------------------------------------------------------------------
// Entry derivation
// ---------------------------------------------------------------------------

/**
 * Convert a package.json "exports" key to a rollup input NAME. The `[name]`
 * placeholder in `output.entryFileNames` is replaced by this value, so it
 * must match the directory layout expected by the package's `types` field.
 */
function exportKeyToInputName(key: string, importPath: string): string {
  if (key === ".") return "index";
  const stripped = key.replace(/^\.\//, "");
  if (importPath.endsWith("/index.mjs")) return `${stripped}/index`;
  return stripped;
}

/**
 * Map a package.json `import` path (e.g. `./dist/api/health.mjs`) to the
 * matching pre-emitted `.d.ts` under INTERMEDIATE_DTS_DIR.
 */
function importPathToIntermediateDts(importPath: string): string {
  const distRelative = importPath.replace(/^\.\//, "").replace(/^dist\//, "");
  const dtsRelative = distRelative.replace(/\.mjs$/, ".d.ts");
  return `${INTERMEDIATE_DTS_DIR}/${dtsRelative}`;
}

function loadInputMap(): Record<string, string> {
  const raw = readFileSync(packageJsonPath, "utf-8");
  const pkg = JSON.parse(raw) as PackageJson;
  const exportsField = pkg.exports;
  if (!exportsField) {
    throw new Error(
      "rollup.dts.config.ts: package.json has no 'exports' field"
    );
  }

  const inputs: Record<string, string> = {};
  for (const [key, value] of Object.entries(exportsField)) {
    const importPath = value.import;
    if (!importPath) continue;
    const name = exportKeyToInputName(key, importPath);
    inputs[name] = importPathToIntermediateDts(importPath);
  }
  return inputs;
}

// ---------------------------------------------------------------------------
// Path alias resolution
// ---------------------------------------------------------------------------

/**
 * Parse tsconfig.json `compilerOptions.paths` so we can redirect
 * `@nextly/*` path-alias imports (preserved verbatim by tsc in emitted
 * `.d.ts` files) to the corresponding intermediate `.d.ts`.
 *
 * Bare JSON.parse is sufficient — the nextly tsconfig is a plain JSON
 * file without comments or trailing commas.
 */
function loadTsConfigPaths(): Array<{
  aliasPrefix: string;
  targetPrefix: string;
  isWildcard: boolean;
}> {
  const raw = readFileSync(tsconfigPath, "utf-8");
  const tsconfig = JSON.parse(raw) as TsConfig;
  const paths = tsconfig.compilerOptions?.paths ?? {};

  const rules: Array<{
    aliasPrefix: string;
    targetPrefix: string;
    isWildcard: boolean;
  }> = [];

  for (const [aliasPattern, targets] of Object.entries(paths)) {
    const firstTarget = targets[0];
    if (!firstTarget) continue;

    // "@nextly/services/*": ["./src/services/*"]
    if (aliasPattern.endsWith("/*") && firstTarget.endsWith("/*")) {
      rules.push({
        aliasPrefix: aliasPattern.slice(0, -2),
        targetPrefix: firstTarget.slice(0, -2).replace(/^\.\//, ""),
        isWildcard: true,
      });
      continue;
    }

    // "@nextly/errors": ["./src/errors/index.ts"]
    rules.push({
      aliasPrefix: aliasPattern,
      targetPrefix: firstTarget.replace(/^\.\//, "").replace(/\.ts$/, ""),
      isWildcard: false,
    });
  }

  return rules;
}

/**
 * Inline rollup plugin: resolves `@nextly/*` imports to the pre-emitted
 * intermediate `.d.ts` files.
 *
 * We do not use `@rollup/plugin-alias` because it does not append extensions
 * or try fallbacks (bare alias vs `/index`). This plugin handles both, using
 * the tsconfig `paths` as the source of truth.
 */
function resolveNextlyAliases(): Plugin {
  const rules = loadTsConfigPaths();

  return {
    name: "resolve-nextly-aliases",
    resolveId(source) {
      if (!source.startsWith("@nextly/")) return null;

      for (const rule of rules) {
        if (!rule.isWildcard && source === rule.aliasPrefix) {
          // Exact alias: e.g. "@nextly/errors" → intermediate/errors/index.d.ts
          const targetSrcRelative = rule.targetPrefix.replace(/^src\//, "");
          const candidates = [
            `${INTERMEDIATE_DTS_DIR}/${targetSrcRelative}.d.ts`,
            `${INTERMEDIATE_DTS_DIR}/${targetSrcRelative}/index.d.ts`,
          ];
          for (const candidate of candidates) {
            const absolute = resolve(packageRoot, candidate);
            if (existsSync(absolute)) return absolute;
          }
          continue;
        }

        if (rule.isWildcard && source.startsWith(`${rule.aliasPrefix}/`)) {
          // Wildcard alias: e.g. "@nextly/services/foo/bar"
          //   → intermediate/services/foo/bar.d.ts
          //   or intermediate/services/foo/bar/index.d.ts
          const suffix = source.slice(rule.aliasPrefix.length + 1);
          const targetSrcRelative = rule.targetPrefix.replace(/^src\//, "");
          const candidates = [
            `${INTERMEDIATE_DTS_DIR}/${targetSrcRelative}/${suffix}.d.ts`,
            `${INTERMEDIATE_DTS_DIR}/${targetSrcRelative}/${suffix}/index.d.ts`,
          ];
          for (const candidate of candidates) {
            const absolute = resolve(packageRoot, candidate);
            if (existsSync(absolute)) return absolute;
          }
        }
      }

      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// Chunk extension rewrite
// ---------------------------------------------------------------------------

/**
 * Inline rollup plugin: rewrites relative import/export specifiers from
 * `.js` (rollup's default ES module extension) to `.d.ts` so bundled
 * declaration files correctly reference their shared chunks.
 *
 * rollup chooses `.js` in import specifiers because the ES module format
 * assumes JS, even when `output.chunkFileNames` produces `.d.ts` on disk.
 * `rollup-plugin-dts` does not rewrite these specifiers when the input
 * files are already `.d.ts`.
 */
function rewriteDtsChunkExtensions(): Plugin {
  return {
    name: "rewrite-dts-chunk-extensions",
    renderChunk(code) {
      // Match: from "./foo.js", from '../foo.js', import "./foo.js", etc.
      // Only rewrite relative specifiers (not bare package names).
      const rewritten = code.replace(
        /((?:from|import|export\s*\*\s*from|export\s*\{[^}]*\}\s*from)\s*['"])(\.{1,2}\/[^'"]+)\.js(['"])/g,
        "$1$2.d.ts$3"
      );
      return rewritten === code ? null : { code: rewritten, map: null };
    },
  };
}

// ---------------------------------------------------------------------------
// External resolution
// ---------------------------------------------------------------------------

/**
 * Treat any non-relative, non-absolute import as external so rollup-plugin-dts
 * does not inline types from `node_modules`. Path aliases from tsconfig.json
 * are resolved upstream by `resolveNextlyAliases` before this predicate sees
 * them.
 */
function isExternal(id: string): boolean {
  if (id.startsWith(".") || isAbsolute(id)) return false;
  if (id.startsWith("@nextly/")) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const config: RollupOptions = {
  input: loadInputMap(),
  output: {
    dir: "dist",
    format: "es",
    entryFileNames: "[name].d.ts",
    chunkFileNames: "_dts-chunks/[name]-[hash].d.ts",
  },
  plugins: [
    resolveNextlyAliases(),
    dts({
      respectExternal: false,
    }),
    rewriteDtsChunkExtensions(),
  ],
  external: isExternal,
};

export default defineConfig(config);
