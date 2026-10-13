/**
 * `defineCollection`, and the validator it runs, reach no Node built-in.
 *
 * The client-safe `nextly/config` entry exports `defineCollection`, so a
 * browser bundle that defines a collection loads this graph. A Node built-in
 * anywhere in it cannot be resolved there. The check bundles the graph the way
 * a browser build would and reads the imports it reached, so it holds for
 * whatever the resolver follows, not for the import lines a reader expects.
 */
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

// A `node:` specifier, or a bare name Node also answers to.
const NODE_BUILTIN =
  /^node:|^(assert|async_hooks|buffer|child_process|crypto|events|fs|http|https|module|net|os|path|stream|tls|url|util|worker_threads|zlib)(\/.*)?$/;

async function nodeBuiltinsReachedFrom(entry: string): Promise<string[]> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    metafile: true,
    logLevel: "silent",
    // Other packages are their own entries' concern; this graph is ours.
    packages: "external",
    plugins: [
      {
        name: "mark-node-builtins",
        setup(context) {
          context.onResolve({ filter: NODE_BUILTIN }, args => ({
            path: args.path,
            external: true,
          }));
        },
      },
    ],
  });
  const reached = new Set<string>();
  for (const [file, input] of Object.entries(result.metafile.inputs)) {
    for (const imported of input.imports) {
      if (NODE_BUILTIN.test(imported.path)) {
        reached.add(`${imported.path} <- ${file}`);
      }
    }
  }
  return [...reached];
}

describe("defineCollection's graph is client-safe", () => {
  it("reaches no Node built-in, the db options check included", async () => {
    expect(await nodeBuiltinsReachedFrom("./define-collection.ts")).toEqual([]);
  });
});
