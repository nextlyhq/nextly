/**
 * What the package ROOT may pull into a browser bundle.
 *
 * `src/index.ts` exports `pageBuilder` from `./plugin`, so everything
 * `plugin.ts` imports at module scope is in the module graph of every consumer
 * that imports so much as `isBlocksField` from the package root — including the
 * canvas bundle the admin ships to the browser.
 *
 * `nextly/runtime` aggregates the Next.js request lifecycle. Measured on its
 * built entry, its graph reaches `async_hooks`, `crypto`, `fs`, `fs/promises`,
 * `module`, `path`, `util` and `ws` — none of which a browser can resolve or
 * run. The plugin resolves it at CALL time instead, inside the server-only job
 * and health paths, which is the same remedy the preview-viewport reader in the
 * same file already uses for the Direct API.
 *
 * ## What this does NOT claim
 *
 * That the root entry is isomorphic. It is not, today, for two reasons that are
 * older than this guard and are not `plugin.ts`'s to fix: `library-route.ts`
 * imports `nextly/runtime` at module scope, and `@nextlyhq/plugin-sdk` — a
 * static import here since long before — re-exports from `nextly`, whose own
 * root graph reaches twelve Node built-ins. Whether that root is meant to be
 * isomorphic at all is an SDK-level question, since the SDK's re-export is the
 * blocker and no change to this package can remove it.
 *
 * So this pins ONE edge: the one a change to this file can add back by hand,
 * against a comment three lines above it that says not to. A guard that refused
 * everything would have to be suppressed on the day it was written.
 *
 * @module plugin-entry-graph.test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Every module-scope specifier a source file imports, type-only included. */
function topLevelImports(file: string): string[] {
  const source = readFileSync(join(SRC_DIR, file), "utf8");
  // Module scope only: a specifier inside `await import(...)` is resolved when
  // the server path runs it and is exactly what this guard asks for instead.
  return [...source.matchAll(/^import\s[^;]*?from\s*"([^"]+)";/gms)].map(
    match => match[1] as string
  );
}

describe("what the package root pulls into a browser bundle", () => {
  it("does not import nextly/runtime at module scope from plugin.ts", () => {
    expect(topLevelImports("plugin.ts")).not.toContain("nextly/runtime");
  });

  it("CONTROL: the reader finds the module-scope imports plugin.ts does have", () => {
    // Without this, a regex that matched nothing at all would satisfy the
    // assertion above for ever — and an import guard that cannot see any import
    // is the one failure mode that looks exactly like compliance.
    const found = topLevelImports("plugin.ts");

    expect(found).toContain("@nextlyhq/blocks-engine");
    expect(found).toContain("@nextlyhq/plugin-sdk");
    expect(found).toContain("./library-route");
    expect(found.length).toBeGreaterThan(10);
  });

  it("loads the import's provisional variables at call time, wherever the root reaches them", () => {
    // `provisional-variables` imports `node:async_hooks`. The root reaches
    // `plugin.ts`, the import route and the blocks field at module scope, so
    // each loads it with `await import(...)` and imports no `node:` module.
    for (const file of [
      "plugin.ts",
      "transfer/import-route.ts",
      "fields/blocksField.ts",
    ]) {
      const found = topLevelImports(file);
      expect(found.filter(specifier => specifier.startsWith("node:"))).toEqual(
        []
      );
      expect(
        found.filter(specifier => specifier.endsWith("provisional-variables"))
      ).toEqual([]);
    }
    // CONTROL: the reader sees the Node import the module does have.
    expect(topLevelImports("transfer/provisional-variables.ts")).toContain(
      "node:async_hooks"
    );
  });

  it("CONTROL: the reader would SEE the banned import if it came back", () => {
    // The must-be-found half, on the exact specifier this guards. A file that
    // does import it reads as importing it, so the assertion above is a fact
    // about plugin.ts rather than about the regex.
    expect(topLevelImports("library-route.ts")).toContain("nextly/runtime");
  });
});
