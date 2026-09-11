/**
 * Each way of reaching an instance is published where its callers can import it.
 *
 * `getCachedNextly` and `requireNextly` both read an already-booted runtime
 * rather than starting one, so they look like a pair that belongs on one entry.
 * They do not, and the reason is invisible from either function.
 *
 * `nextly/runtime` is the entry allowed to import `next/*`. Importing it pulls
 * Next.js into the module graph, and the async accessor's callers include a
 * plugin whose code is bundled for the browser and a CLI that runs outside any
 * request. So the async one is published from the Node-safe root, and the
 * synchronous one, which is only correct inside a request lifecycle, is not.
 *
 * The separation has to hold in BOTH directions to mean anything: an entry that
 * published both would satisfy every presence check here while erasing it.
 *
 * The plugin-facing half of the arrangement is asserted in `plugin-sdk`'s own
 * surface snapshot rather than here. This package cannot import that one: the
 * dependency runs the other way, and reaching for it to make an assertion would
 * invert it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** The docblock attached to a named export, without the ones before it. */
function docblockFor(source: string, declaration: string): string {
  const at = source.indexOf(declaration);
  expect(at, `${declaration} not found`).toBeGreaterThan(-1);
  const opens = source.lastIndexOf("/**", at);
  expect(opens, `${declaration} carries no docblock`).toBeGreaterThan(-1);
  // Sliced from the LAST opener before the declaration, so a claim made in some
  // earlier block in the file cannot satisfy an assertion about this one.
  return source.slice(opens, at);
}

const initSource = readFileSync(
  fileURLToPath(new URL("../init.ts", import.meta.url)),
  "utf8"
);

describe("instance accessors are published where their callers can reach them", () => {
  it("publishes the async accessor from the root and NOT from runtime", async () => {
    const root = (await import("../index")) as Record<string, unknown>;
    const runtime = (await import("../runtime")) as Record<string, unknown>;

    expect(typeof root.getCachedNextly).toBe("function");
    // The direction a presence check cannot cover. Re-exporting it from
    // `nextly/runtime` while keeping the root export is the most plausible way
    // to attempt the relocation, and it would leave every other assertion here
    // green while the boundary this file describes had stopped existing.
    expect(runtime.getCachedNextly).toBeUndefined();
  });

  it("publishes the sync accessor from runtime and NOT from the root", async () => {
    const root = (await import("../index")) as Record<string, unknown>;
    const runtime = (await import("../runtime")) as Record<string, unknown>;

    expect(typeof runtime.requireNextly).toBe("function");
    expect(root.requireNextly).toBeUndefined();
  });

  it("keeps the initialiser on the root beside the async accessor", async () => {
    // The one an application reaches for. Asserted here so a change that moves
    // either half of the root's pair is visible in this file.
    const root = (await import("../index")) as Record<string, unknown>;

    expect(typeof root.getNextly).toBe("function");
  });

  it("documents the async accessor as available to plugins", () => {
    // The claim this file protects is an argument, and an argument lives in
    // prose. Read from source because the sentence it replaced said the
    // opposite and was wrong for as long as it stood.
    //
    // Asserted as a positive sentence and nothing else. Whether some other
    // sentence in the block FORBIDS the same callers is a question about
    // English, and a pattern asked to answer it either misses the next wording
    // ("must never be used by") or catches a description ("is never used
    // before boot"). The audience claim is a string, and a string is decidable.
    // A block that named plugins and then banned them would pass here; that is
    // a contradiction a reader sees, not a shape a test can be trusted to.
    const doc = docblockFor(
      initSource,
      "export async function getCachedNextly"
    );

    expect(doc).toContain("plugin code doing server work outside a route");
  });

  it("does not claim the root avoids the Next peer dependency", () => {
    // It does not, and saying so promised an isolation the resolver never
    // provides: `next` is the one peer this package leaves non-optional, so a
    // consumer installs it whichever subpath they import. The boundary is what
    // a module graph pulls in.
    const doc = docblockFor(
      initSource,
      "export async function getCachedNextly"
    );

    expect(doc).not.toMatch(/avoid\w*\s+(a\s+)?`?next`?\s+peer/i);
    expect(doc).toContain("module graph");
  });
});
