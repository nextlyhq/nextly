// @vitest-environment jsdom

/**
 * A block the page hides on the device the canvas shows: drawn anyway and
 * marked to be striped with where it is hidden, at that device only, and
 * never while the page is shown as a visitor gets it.
 *
 * @module canvas-device-hidden.test
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { Canvas } from "./canvas";
import {
  DEVICE_HIDDEN_ATTRIBUTE,
  deviceHiddenDrawing,
} from "./canvas-device-hidden";

const SITE: BreakpointSet = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 1023 },
    { id: "mobile", label: "Mobile", maxWidth: 767 },
  ],
  container: [],
};

const TAG = "Hidden on Mobile · still here in the builder";

const PAGE = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "box",
      type: "acme/box",
      version: 1,
      props: {},
      visibility: { devices: { mobile: false } },
      slots: {
        children: [{ id: "inside", type: "acme/leaf", version: 1, props: {} }],
      },
    },
    { id: "shown", type: "acme/leaf", version: 1, props: {} },
  ],
} as unknown as BlockDocument;

describe("deviceHiddenDrawing", () => {
  it("lifts the hiding of each block hidden on the device, and tags it", () => {
    const { document, marks } = deviceHiddenDrawing(PAGE, SITE, "mobile");
    // The block alone: what it holds is drawn inside its stripes, unmarked.
    expect([...marks]).toEqual([["box", TAG]]);
    // Drawn: its device hiding lifted in the document the canvas draws.
    expect(
      (document.nodes[0] as { visibility?: unknown }).visibility
    ).toBeUndefined();
    // The page the editor saves keeps it.
    expect((PAGE.nodes[0] as { visibility?: unknown }).visibility).toEqual({
      devices: { mobile: false },
    });
  });

  it("leaves the page as it is on a device nothing is hidden on", () => {
    for (const device of ["base", "tablet"]) {
      const drawing = deviceHiddenDrawing(PAGE, SITE, device);
      expect(drawing.document, device).toBe(PAGE);
      expect(drawing.marks.size, device).toBe(0);
    }
  });
});

describe("the canvas at each device", () => {
  beforeAll(() => {
    clearBlocks();
    registerBlocks(
      [
        {
          name: "acme/leaf",
          version: 1,
          description: "A block.",
          example: { props: {} },
          render: ({ className }: { className: string }) =>
            createElement("div", { className }),
        },
        {
          name: "acme/box",
          version: 1,
          description: "A container.",
          example: { props: {} },
          render: ({ className }: { className: string }) =>
            createElement("div", { className }),
        },
      ] as never,
      { source: "canvas-device-hidden-test" }
    );
  });
  afterAll(() => clearBlocks());
  afterEach(cleanup);

  /** The canvas drawn in a window `width` wide. */
  async function drawAt(width: number, asVisitor = false) {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    });
    const view = render(
      <Canvas
        document={PAGE}
        siteStyles={{ css: "", classes: {} } as never}
        render={{ styleContext: { breakpoints: SITE } } as never}
        {...(asVisitor
          ? {
              conditionsApplied: {
                document: PAGE,
                shown: new Set<string>(),
                hidden: [],
                unjudged: false,
                byEntry: false,
              } as never,
            }
          : {})}
      />
    );
    await act(async () => undefined);
    const element = (id: string) =>
      view.container.querySelector(`[${NODE_ID_ATTRIBUTE}="${id}"]`);
    return { ...view, element };
  }

  it("marks a block hidden on Mobile with its tag, at Mobile", async () => {
    const { element } = await drawAt(400);
    expect(element("box")?.getAttribute(DEVICE_HIDDEN_ATTRIBUTE)).toBe(TAG);
    // CONTROL: a block shown everywhere is not marked.
    expect(element("shown")?.hasAttribute(DEVICE_HIDDEN_ATTRIBUTE)).toBe(false);
  });

  it.each([
    ["Desktop", 1280],
    ["Tablet", 900],
  ])("marks nothing at %s, where the block shows", async (_device, width) => {
    const { container } = await drawAt(width);
    expect(container.querySelector(`[${DEVICE_HIDDEN_ATTRIBUTE}]`)).toBeNull();
  });

  it("marks nothing while the page is shown as a visitor gets it", async () => {
    const { container } = await drawAt(400, true);
    expect(container.querySelector(`[${DEVICE_HIDDEN_ATTRIBUTE}]`)).toBeNull();
  });
});
