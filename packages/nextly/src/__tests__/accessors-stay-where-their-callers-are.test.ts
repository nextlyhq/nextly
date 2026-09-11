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

/**
 * Whether a sentence forbids using the function it documents.
 *
 * A prohibition is a MODAL or IMPERATIVE negation attached to a usage verb, in
 * either voice, or one of the stock phrasings that forbid without a verb. The
 * modal is what separates a ban from a description: "must not be used by
 * plugins" forbids, "is not used until boot completes" describes what happens
 * at runtime and forbids nobody. So a bare `not` is not in the list, and
 * `cannot` is, disarmed by the verb requirement rather than by its absence:
 * "it cannot wait" describes the synchronous sibling, "callers cannot use
 * this" is exactly the sentence this docblock must never carry.
 *
 * Module-scoped and exercised directly below, because the docblock it guards
 * is clean and therefore exercises none of its branches. A predicate tested
 * only against a passing input would let every alternative in it be misspelled
 * without anything going red.
 */
function prohibits(line: string): boolean {
  return (
    /\b(do not|don't|must not|should not|cannot|can't|may not|never)\s+(be\s+)?(use|used|call|called|invoke|invoked|reach for|reached for|rely on|relied on)\b/i.test(
      line
    ) ||
    /\b(internal use only|not for (user|plugin|application|external)|not intended for)\b/i.test(
      line
    )
  );
}

describe("what counts as forbidding a caller", () => {
  it("catches a prohibition in either voice and any modal", () => {
    // The positive control the docblock check cannot provide, since the real
    // docblock is clean. Each of these must be caught, or the alternative it
    // exercises could be misspelled with nothing going red.
    for (const sentence of [
      "Plugins should not call this.",
      "Plugin callers cannot use this function.",
      "This function cannot be used by plugin callers.",
      "It must not be called from a plugin.",
      "Never rely on this from a plugin.",
      "User code may not invoke this.",
      "Do not use this in user code.",
      "Internal use only.",
      "Not intended for application code.",
      "This is not for plugin code.",
    ]) {
      expect(prohibits(sentence), sentence).toBe(true);
    }
  });

  it("lets a factual negation through", () => {
    // A description of runtime behaviour is not a ban, and a check that
    // rejected these would refuse ordinary documentation. The difference is
    // the modal: none of these tells anyone what they may do.
    for (const sentence of [
      "It cannot wait, so it asserts instead.",
      "The cached instance is not used until boot completes.",
      "This is not called on the request path.",
      "The fallback is not invoked when a config is supplied.",
      "The result is not relied on for caching.",
      "Plugins reach for this when there is no ctx.",
    ]) {
      expect(prohibits(sentence), sentence).toBe(false);
    }
  });
});

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
    const doc = docblockFor(
      initSource,
      "export async function getCachedNextly"
    );

    expect(doc).toContain("plugin code doing server work outside a route");
  });

  it("does not forbid the callers it names, however the prohibition is worded", () => {
    // A list of forbidden phrasings is the wrong shape for this. "must not
    // call" was covered and "should not call" was not, and the next wording
    // nobody anticipates passes just as easily. So it is structural instead.
    //
    // Two properties, checked separately because either alone can be
    // satisfied by a docblock that contradicts itself. The audience must be
    // named, so the positive claim exists to contradict. And NO sentence may
    // forbid use, whether or not it names who: "Internal use only." names
    // nobody and forbids everybody, so filtering to audience sentences first
    // would discard it unexamined.
    const doc = docblockFor(
      initSource,
      "export async function getCachedNextly"
    );

    const sentences = doc
      .replace(/^\s*\*+ ?/gm, "")
      .split(/(?<=[.:])\s+/)
      .map(line => line.trim())
      .filter(line => line.length > 0);

    const namesAudience = sentences.filter(line =>
      /plugin|user code|caller/i.test(line)
    );
    // The control. With no audience sentence the check below has nothing to
    // contradict, and would stay green through a docblock that never says who
    // this is for.
    expect(namesAudience.length).toBeGreaterThan(0);

    expect(sentences.filter(prohibits)).toEqual([]);
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
