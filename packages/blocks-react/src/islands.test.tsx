/**
 * Which blocks on a page need JavaScript, answered from the stored document.
 *
 * The question `"use client"` cannot answer. A directive is a fact about a
 * MODULE that a bundler can see; a page is stored as JSON naming block types,
 * and this package has to answer without importing every block in the library
 * or inspecting how one was compiled.
 *
 * The last case in this file is the one Plan 03 wanted and could not write: the
 * core library adds no JavaScript of its own. It is asserted here at the unit
 * level and measured nightly in a real browser, and the two answer different
 * halves — this one cannot see bytes, and the browser cannot say WHICH block
 * was responsible.
 *
 * @module islands.test
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument } from "@nextlyhq/blocks-engine";

import { coreBlocks } from "./blocks";
import { createBlockResolver } from "./resolver";
import { islandsFor } from "./styles";

import type { AnyBlockDefinition } from "@nextlyhq/blocks-engine";

const ticker = {
  name: "test/ticker",
  version: 1,
  description: "A block that counts down.",
  example: { props: {} },
  island: { reason: "counts down to a date the server cannot know." },
  render: () => null,
} as unknown as AnyBlockDefinition;

const still = {
  name: "test/still",
  version: 1,
  description: "A block that draws and stops.",
  example: { props: {} },
  render: () => null,
} as unknown as AnyBlockDefinition;

const blocks = createBlockResolver([ticker, still]);

function page(...types: string[]): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: types.map((type, index) => ({
      id: `n${index}`,
      type,
      version: 1,
      props: {},
    })),
  } as unknown as BlockDocument;
}

describe("the islands a stored page contains", () => {
  it("names the interactive block and carries its reason", () => {
    expect(islandsFor(page("test/ticker"), blocks)).toEqual({
      "test/ticker": {
        reason: "counts down to a date the server cannot know.",
      },
    });
  });

  it("is EMPTY for a page whose blocks all draw and stop", () => {
    // The claim Plan 03 wanted to make. Empty means the page needs no
    // JavaScript OF ITS OWN — not that it ships no script, which is a fact
    // about the host framework and not about blocks.
    expect(islandsFor(page("test/still"), blocks)).toEqual({});
  });

  it("ignores a block type the page does not use", () => {
    // The control the emptiness assertion needs: a reader that answered from
    // the REGISTRY rather than the document would report the ticker on a page
    // that never places one, and the assertion above would still pass.
    expect(islandsFor(page("test/still"), blocks)).not.toHaveProperty(
      "test/ticker"
    );
  });

  it("reports one entry however many times a block is placed", () => {
    expect(
      Object.keys(islandsFor(page("test/ticker", "test/ticker"), blocks))
    ).toEqual(["test/ticker"]);
  });
});

describe("the core block library", () => {
  it("declares no islands, so a page of core blocks adds no JavaScript", () => {
    // Plan 03 criterion 8, in the form that is actually true and testable. The
    // nightly Lighthouse budget measures the BYTES on a real page in a real
    // browser; this says which blocks would be responsible if that number ever
    // moved, which the browser cannot.
    const declared = (coreBlocks as AnyBlockDefinition[])
      .filter(block => block.island !== undefined)
      .map(block => block.name);

    expect(declared).toEqual([]);
  });

  it("was actually reading the library, not an empty list", () => {
    // Without this the assertion above passes on a `coreBlocks` that failed to
    // import — the emptiness it asserts is the same emptiness a broken import
    // produces.
    expect((coreBlocks as AnyBlockDefinition[]).length).toBeGreaterThan(10);
  });
});
