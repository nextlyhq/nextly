/**
 * Which hidden blocks the canvas draws for a selection: the case that
 * separates it from a reading of the selected block alone is a visible
 * heading inside a section hidden on the device, which is drawn only if the
 * section is lifted too.
 */
import type { BlockDocument, BreakpointSet } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { revealedHidden } from "./reveal-hidden";

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
