/**
 * That `@nextlyhq/builder/ops` is reachable from a server, and stays that way.
 *
 * The subpath exists so a server action or an agent can apply the same ops the
 * canvas applies. Two things have to hold for that, and neither is visible from
 * reading `ops.ts`:
 *
 * - the export map has to ADVERTISE it, and the build has to PRODUCE what is
 *   advertised. `@nextlyhq/ui` records the failure this prevents: a map naming
 *   an artifact no config emitted, whose only consumer worked because it
 *   resolved the package through a tsconfig path mapping to source and never
 *   loaded the published entry at all.
 * - the module has to stay free of React. It is built by the server-safe
 *   config, which adds no `"use client"` banner, so an import of React reaching
 *   it would not fail the build — it would produce an entry a Server Component
 *   loads and React refuses at runtime.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { importedSpecifiers } from "@nextlyhq/module-specifiers";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");

const read = (rel: string) => readFileSync(join(pkgRoot, rel), "utf8");

/** The package's own export map. */
const exportMap = JSON.parse(read("package.json")).exports as Record<
  string,
  { types?: string; import?: string } | string
>;

/** Entries the server-safe tsup config builds. */
function serverSafeEntries(): string[] {
  const config = read("tsup.server-safe.config.ts");
  const block = /entry:\s*\[([^\]]*)\]/.exec(config);
  return [...(block?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

describe("the ops subpath is published", () => {
  it("is advertised in the export map", () => {
    // The control: a subpath the package does not publish must not appear, so
    // this is a statement about `./ops` rather than about a map that would
    // accept any key.
    expect(exportMap["./no-such-subpath"]).toBeUndefined();

    expect(exportMap["./ops"]).toEqual({
      types: "./dist/ops.d.ts",
      import: "./dist/ops.mjs",
      default: "./dist/ops.mjs",
    });
  });

  it("is built by the config that adds no client banner", () => {
    // The whole point of the subpath. Built by the ROOT config it would inherit
    // the shell's `"use client"` banner, and a Server Component could not apply
    // an op — for no reason other than how the bundle was assembled.
    expect(serverSafeEntries()).toContain("src/ops.ts");

    const clientConfig = read("tsup.config.ts");
    expect(clientConfig).not.toContain("src/ops.ts");
  });
});

describe("the ops module stays server-safe", () => {
  it("imports the engine and nothing else", () => {
    // Asserted as the WHOLE import list rather than as "no react". A module
    // that grew an import of the design system, the plugin SDK or a DOM helper
    // would satisfy a react-only check and still be unloadable on a server.
    const specifiers = [...importedSpecifiers(read("src/ops.ts"), "ops.ts")];

    expect(specifiers).toEqual(["@nextlyhq/blocks-engine"]);
  });
});
