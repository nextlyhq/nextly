// @vitest-environment jsdom

/**
 * Which hidden blocks the canvas draws for a selection: the case that
 * separates it from a reading of the selected block alone is a visible
 * heading inside a section hidden on the device, which is drawn only if the
 * section is lifted too.
 */
import type { BlockDocument, BreakpointSet } from "@nextlyhq/blocks-engine";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { revealedHidden, useReveal } from "./reveal-hidden";

const SITE: BreakpointSet = {
  viewport: [{ id: "tablet", label: "Tablet", maxWidth: 1024 }],
  container: [],
};

const page = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "section",
      type: "core/section",
      version: 1,
      props: {},
      visibility: { devices: { tablet: false } },
      slots: {
        children: [
          { id: "title", type: "core/heading", version: 1, props: {} },
        ],
      },
    },
    { id: "free", type: "core/heading", version: 1, props: {} },
    {
      id: "hidden",
      type: "core/heading",
      version: 1,
      props: {},
      visibility: { devices: { tablet: false } },
    },
  ],
} as unknown as BlockDocument;

describe("revealedHidden", () => {
  it("lifts the hidden block around a selected block, and says the selected one is shown", () => {
    expect(revealedHidden(page, ["title"], SITE, "tablet")).toEqual({
      lifted: ["section"],
      shown: ["title"],
    });
  });

  it("lifts a selected hidden block itself", () => {
    expect(revealedHidden(page, ["hidden"], SITE, "tablet")).toEqual({
      lifted: ["hidden"],
      shown: ["hidden"],
    });
  });

  it("lifts nothing for a visible block, on another device, or for an absent one", () => {
    expect(revealedHidden(page, ["free"], SITE, "tablet")).toEqual({
      lifted: [],
      shown: [],
    });
    expect(revealedHidden(page, ["title"], SITE, "base")).toEqual({
      lifted: [],
      shown: [],
    });
    expect(revealedHidden(page, ["gone"], SITE, "tablet")).toEqual({
      lifted: [],
      shown: [],
    });
  });
});

describe("revealedHidden on a large selection", () => {
  it("reads the document once, not once per selected block", () => {
    // Three thousand blocks, every one selected, as a Shift-range selection
    // of a long page makes. A path search per block rebuilds the tree three
    // thousand times; one walk is a few milliseconds. The bound is two orders
    // of magnitude above the one walk, so it reads the shape of the work, not
    // the machine.
    const nodes = Array.from({ length: 3000 }, (_, index) => ({
      id: `n${index}`,
      type: "core/heading",
      version: 1,
      props: {},
      ...(index % 2 === 0
        ? { visibility: { devices: { tablet: false } } }
        : {}),
    }));
    const big = {
      formatVersion: 1,
      kind: "page",
      nodes,
    } as unknown as BlockDocument;
    const started = performance.now();
    const result = revealedHidden(
      big,
      nodes.map(node => node.id),
      SITE,
      "tablet"
    );
    const took = performance.now() - started;
    expect(result.shown).toHaveLength(1500);
    expect(took).toBeLessThan(1000);
  });
});

describe("useReveal", () => {
  it("keeps an id holding a newline or a NUL whole", () => {
    // Ids are any non-empty string, so a join and a split on either would
    // turn this one id into two that name nothing.
    const odd = "a\nb\u0000c";
    const oddPage = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: odd,
          type: "core/heading",
          version: 1,
          props: {},
          visibility: { devices: { tablet: false } },
        },
      ],
    } as unknown as BlockDocument;
    const { result } = renderHook(() =>
      useReveal(oddPage, [odd], SITE, "tablet")
    );
    expect(result.current.ids).toEqual([odd]);
    expect(result.current.document.nodes[0]?.visibility).toBeUndefined();
  });

  it("answers the same document while nothing is lifted", () => {
    const { result } = renderHook(() =>
      useReveal(page, ["free"], SITE, "tablet")
    );
    expect(result.current.document).toBe(page);
  });
});
