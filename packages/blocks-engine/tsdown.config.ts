import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { defineConfig, type Rolldown } from "tsdown";

type OutputBundle = Parameters<
  NonNullable<Extract<Rolldown.Plugin["writeBundle"], Function>>
>[1];
type OutputChunk = Extract<OutputBundle[string], { type: "chunk" }>;

/** A path from the package root, with forward slashes on every platform. */
const fromPackage = (path: string) =>
  relative(process.cwd(), path).split("\\").join("/");

/** One output file as esbuild's metafile records it. */
function describeChunk(chunk: OutputChunk, bundle: OutputBundle, dir: string) {
  const edge = (path: string, kind: string) =>
    path in bundle
      ? { path: fromPackage(join(dir, path)), kind }
      : { path, kind, external: true };
  return {
    bytes: Buffer.byteLength(chunk.code),
    imports: [
      ...chunk.imports.map(path => edge(path, "import-statement")),
      ...chunk.dynamicImports.map(path => edge(path, "dynamic-import")),
    ],
    inputs: Object.fromEntries(
      Object.entries(chunk.modules).map(([id, module]) => [
        fromPackage(id),
        { bytesInOutput: module.renderedLength },
      ])
    ),
  };
}

/**
 * Writes the module graph this build emitted, in the shape of esbuild's
 * metafile: per output file its size, the files and packages it imports with
 * the kind of each edge, and the source modules bundled into it.
 *
 * Written after the bundles are on disk, so a `dist` newer than the record
 * means the record is stale.
 */
function metafile(): Rolldown.Plugin {
  return {
    name: "nextly:metafile",
    writeBundle(options, bundle) {
      const dir = options.dir ?? "dist";
      const chunks = Object.values(bundle).filter(
        (file): file is OutputChunk =>
          file.type === "chunk" && !file.fileName.endsWith(".d.ts")
      );
      const outputs = Object.fromEntries(
        chunks.map(chunk => [
          fromPackage(join(dir, chunk.fileName)),
          describeChunk(chunk, bundle, dir),
        ])
      );
      const format = options.format === "cjs" ? "cjs" : "esm";
      writeFileSync(
        join(dir, `metafile-${format}.json`),
        JSON.stringify({ outputs }, null, 2)
      );
    },
  };
}

// The engine is runtime-free by contract: it ships no dependencies and must
// stay importable from Node scripts, edge runtimes, and the browser alike, so
// it bundles nothing and targets plain ESM.
export default defineConfig({
  entry: ["src/index.ts", "src/format.ts"],
  format: ["esm"],
  // Declarations without a type check: `check-types` is the type check.
  dts: { sourcemap: false, compilerOptions: { noCheck: true } },
  clean: true,
  sourcemap: true,
  treeshake: true,
  // The module graph the bundler actually built, written beside the bundles.
  //
  // `format-boundary.test.ts` reads it because a graph OBSERVED by importing an
  // entry point only contains what initialisation resolved: a dynamic import
  // behind a function is a real edge to a real dependency that nothing asks the
  // resolver for until it is called. The metafile records every edge with its
  // kind, deferred ones included, from the tool that emitted the code.
  //
  // Kept out of the published package by the `files` negation in package.json:
  // it describes a build rather than shipping with one.
  plugins: [metafile()],
  // Keep the file names the exports map already publishes.
  outExtensions() {
    return { js: ".mjs", dts: ".d.ts" };
  },
});
