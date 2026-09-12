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
 * root graph reaches twelve Node built-ins. Both are recorded as
 * `finding:page-builder-root-is-not-isomorphic`.
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

  it("CONTROL: the reader would SEE the banned import if it came back", () => {
    // The must-be-found half, on the exact specifier this guards. A file that
    // does import it reads as importing it, so the assertion above is a fact
    // about plugin.ts rather than about the regex.
    expect(topLevelImports("library-route.ts")).toContain("nextly/runtime");
  });
});
