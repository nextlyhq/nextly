/**
 * Resolving a project's plugins loads no token library, and only the parts of
 * semver it calls.
 *
 * The CLI's config loader resolves the plugins, so every command that reads a
 * project loads the resolver. It reserves one sign-in challenge's id, which
 * lives in a module of its own: read from the module that mints tokens, the
 * id brought the library that signs them into every such command. semver's
 * root loads every function it has.
 *
 * What would separate a light resolver from a heavy one:
 * - an import, however many modules away, of the token library or semver's root;
 * - a walk that reads nothing, which the controls show.
 */
import { expect, it } from "vitest";

import { runtimeImportsOf } from "../../cli/__tests__/helpers/runtime-imports";

/** The packages `entry` loads. */
async function packagesOf(entry: string): Promise<string[]> {
  return [...(await runtimeImportsOf(entry)).packages.keys()];
}

it("resolving plugins loads no token library", async () => {
  const { packages } = await runtimeImportsOf("plugins/resolve.ts");
  expect(packages.get("jose")?.join(" > ")).toBeUndefined();
});

it("the token module loads it, so its absence above is the resolver's own", async () => {
  expect(await packagesOf("auth/pipeline/pending-token.ts")).toContain("jose");
});

it("resolving plugins loads the parts of semver it calls, not its root", async () => {
  const packages = await packagesOf("plugins/resolve.ts");
  expect(packages.filter(name => /^semver(\/|$)/.test(name)).sort()).toEqual([
    "semver/functions/satisfies.js",
    "semver/ranges/valid.js",
  ]);
});
