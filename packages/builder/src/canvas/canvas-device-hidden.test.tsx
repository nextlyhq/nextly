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
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { Canvas } from "./canvas";
import { CanvasMarks } from "./canvas-marks";
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

// The blocks the canvas tests draw: an image among them, drawn bare.
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
        // Drawn as a bare image, as an Image with no caption or link is.
        name: "acme/picture",
        version: 1,
        description: "An image.",
        example: { props: {} },
        render: ({ className }: { className: string }) =>
          createElement("img", { className, alt: "" }),
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

describe("the breakpoints a hidden block is read against", () => {
  // The route's own set, where Mobile stops at 300px: at 400px the page
  // would be read as Tablet, where the block shows.
  const ROUTE: BreakpointSet = {
    viewport: [
      { id: "tablet", label: "Tablet", maxWidth: 1023 },
      { id: "mobile", label: "Mobile", maxWidth: 300 },
    ],
    container: [],
  };

  /** The canvas at 400px, the breakpoints handed as `site` and `route`. */
  async function drawWith(site?: BreakpointSet, route?: BreakpointSet) {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 400,
    });
    const view = render(
      <Canvas
        document={PAGE}
        siteStyles={
          {
            css: "",
            classes: {},
            ...(site === undefined ? {} : { breakpoints: site }),
          } as never
        }
        render={
          (route === undefined
            ? {}
            : { styleContext: { breakpoints: route } }) as never
        }
      />
    );
    await act(async () => undefined);
    return view.container
      .querySelector(`[${NODE_ID_ATTRIBUTE}="box"]`)
      ?.getAttribute(DEVICE_HIDDEN_ATTRIBUTE);
  }

  it("are the site's, where only its styles state them", async () => {
    expect(await drawWith(SITE)).toBe(TAG);
  });

  it("are the site's over the route's, as the page's rules are compiled", async () => {
    expect(await drawWith(SITE, ROUTE)).toBe(TAG);
    // CONTROL: the route's set alone reads 400px as Tablet, where it shows.
    cleanup();
    expect(await drawWith(undefined, ROUTE)).toBeNull();
  });
});

describe("the stripes over a hidden block", () => {
  // Drawn by the editor's marks over the canvas, never by an overlay inside
  // the block: an image takes none, and any other block would have to hold
  // one, which moves what its fixed or absolutely placed blocks are laid out
  // against.
  const PICTURE = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "pic",
        type: "acme/picture",
        version: 1,
        props: {},
        visibility: { devices: { mobile: false } },
      },
      { id: "plain", type: "acme/leaf", version: 1, props: {} },
    ],
  } as unknown as BlockDocument;

  beforeEach(() => {
    // A layout box for every element, which jsdom does not give.
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => {
      const rects = [new DOMRect(0, 0, 100, 50)];
      return Object.assign(rects, {
        item: (index: number) => rects[index] ?? null,
      }) as unknown as DOMRectList;
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 400,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("stripe and tag a block drawn as an image", async () => {
    const { container } = render(
      <Canvas
        document={PICTURE}
        siteStyles={{ css: "", classes: {} } as never}
        render={{ styleContext: { breakpoints: SITE } } as never}
        overlay={<CanvasMarks />}
      />
    );
    await act(async () => undefined);
    const marks = () =>
      [
        ...container.querySelectorAll<HTMLElement>(
          '.nx-canvas-mark[data-mark="device-hidden"]'
        ),
      ].map(mark => mark.getAttribute("data-device-tag"));
    await waitFor(() => expect(marks()).toEqual([TAG]));
  });

  /** The tags the stripes over the canvas carry, `document` drawn at 400px. */
  function drawStripes(document: BlockDocument, breakpoints = SITE) {
    const canvas = (set: BreakpointSet) => (
      <Canvas
        document={document}
        siteStyles={{ css: "", classes: {} } as never}
        render={{ styleContext: { breakpoints: set } } as never}
        overlay={<CanvasMarks />}
      />
    );
    const view = render(canvas(breakpoints));
    const tags = () =>
      [
        ...view.container.querySelectorAll<HTMLElement>(
          '.nx-canvas-mark[data-mark="device-hidden"]'
        ),
      ].map(mark => mark.getAttribute("data-device-tag"));
    return {
      tags,
      redraw: (set: BreakpointSet) => view.rerender(canvas(set)),
    };
  }

  it("stripe and tag every other hidden block too, a section among them", async () => {
    const { tags } = drawStripes(PAGE);
    await act(async () => undefined);
    await waitFor(() => expect(tags()).toEqual([TAG]));
  });

  it("follow the tag when only its words change, the box staying put", async () => {
    const { tags, redraw } = drawStripes(PAGE);
    await act(async () => undefined);
    await waitFor(() => expect(tags()).toEqual([TAG]));
    // Mobile renamed: the same box, at the same place, says "Phone".
    redraw({
      ...SITE,
      viewport: SITE.viewport.map(tier =>
        tier.id === "mobile" ? { ...tier, label: "Phone" } : tier
      ),
    });
    await act(async () => undefined);
    await waitFor(() =>
      expect(tags()).toEqual(["Hidden on Phone · still here in the builder"])
    );
  });
});
