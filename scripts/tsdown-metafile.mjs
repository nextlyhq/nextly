// A rolldown plugin that writes the module graph a build emitted, in the shape
// of esbuild's metafile, so the checks that read a package's artifacts keep one
// record format whichever bundler produced them.
//
// Per output file it records the bytes emitted, each file or package it
// imports with the kind of the edge (`external` for a package), and the source
// modules bundled into it. Declaration chunks are left out: the record
// describes the JavaScript a consumer runs.
//
// Written from `writeBundle`, after the files are on disk, so an output newer
// than the record means the record is stale. Named in the build inputs of each
// package that uses it, so editing it changes their turbo hashes.

import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/** A path from the package being built, with forward slashes on every platform. */
const fromPackage = path => relative(process.cwd(), path).split("\\").join("/");

/** One emitted chunk as esbuild's metafile records an output. */
function describeChunk(chunk, bundle, dir) {
  const edge = (path, kind) =>
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

/** Writes `metafile-esm.json` or `metafile-cjs.json` beside the bundles. */
export function metafile() {
  return {
    name: "nextly:metafile",
    writeBundle(options, bundle) {
      const dir = options.dir ?? "dist";
      const chunks = Object.values(bundle).filter(
        file => file.type === "chunk" && !/\.d\.[cm]?ts$/.test(file.fileName)
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
