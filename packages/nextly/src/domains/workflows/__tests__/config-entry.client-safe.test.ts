/**
 * The client-safe `nextly/config` entry, which now exports `defineWorkflow`
 * and `reviewWorkflow`, reaches no Node built-in.
 *
 * A collection file imports `defineWorkflow` beside `defineCollection`, and a
 * browser bundle that loads it loads this whole graph. The check bundles the
 * entry the way a browser build would and reads the imports it reached, so it
 * holds for whatever the resolver follows, as the `defineCollection` check in
 * `validate-config.client-safe.test.ts` does for its own graph. The
 * definition hash, which needs `node:crypto`, stays outside it.
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

describe("the nextly/config entry is client-safe with workflows in it", () => {
  it("reaches no Node built-in", async () => {
    expect(await nodeBuiltinsReachedFrom("../../../config.ts")).toEqual([]);
  });

  it("is a check that sees a Node built-in when one is reached", async () => {
    // The control: the hash module reaches `node:crypto`, so an instrument
    // that reported nothing for every graph would fail here.
    // The path is reported relative to where the run started, so only its
    // end is compared.
    const reached = await nodeBuiltinsReachedFrom("../hash.ts");
    expect(reached).toHaveLength(1);
    expect(reached[0]).toMatch(
      /^node:crypto <- .*src\/domains\/workflows\/hash\.ts$/
    );
  });
});
