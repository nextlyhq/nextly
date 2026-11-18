// @vitest-environment jsdom

/**
 * A region of the page's layout edited in place on the canvas: drawn from the
 * live document being edited, its blocks addressed as a page's are, while the
 * page and the other region stay drawn, out of reach and hidden from
 * assistive technology. And the ways in from a region: a double-click, or
 * Enter on one already selected.
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  createStandaloneContext,
  NODE_ID_ATTRIBUTE,
} from "@nextlyhq/blocks-react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { CHROME_ATTRIBUTE, CONDITIONED_ATTRIBUTE, Canvas } from "./canvas";
import { CANVAS_FRAME_SHEET } from "./canvas-frame-sheet";
import type { CanvasProps } from "./canvas-props";
import { REGION_ATTRIBUTE, type CanvasRegion } from "./canvas-regions";

afterEach(cleanup);

/** How often the async block has run, across every draw. */
const lateRuns = { count: 0 };

beforeAll(() => {
  registerBlocks(
    [
      {
        name: "acme/text",
        version: 1,
        description: "A block.",
        example: { props: {} },
        render: ({
          className,
          props,
        }: {
          className: string;
          props: { text?: string };
        }) => createElement("p", { className }, props.text),
      },
      {
        name: "acme/late",
        version: 1,
        description: "A block that draws after a promise, as an image does.",
        example: { props: {} },
        render: async ({ className }: { className: string }) => {
          lateRuns.count += 1;
          await Promise.resolve();
          return createElement("img", { className, alt: "Logo" });
        },
      },
    ] as never,
    { source: "canvas-region-editing-test" }
  );
});

afterAll(clearBlocks);

function textDoc(
  kind: "page" | "component",
  nodes: readonly [string, string][]
): BlockDocument {
  return {
    formatVersion: 1,
    kind,
    nodes: nodes.map(([id, text]) => ({
      id,
      type: "acme/text",
      version: 1,
      props: { text },
    })),
  } as BlockDocument;
}

// The page and the header share an id on purpose: ids are unique within a
// document, not across the page and its layout.
const page = textDoc("page", [["t", "Page body"]]);

function regionOf(area: "header" | "footer", text: string): CanvasRegion {
  const name = area === "header" ? "Site header" : "Site footer";
  return {
    area,
    document: textDoc("component", [["t", text]]),
    label: `${name}, from the Main header & footer`,
    badge: `${name} · Main`,
    name,
  };
}

const regions = [
  regionOf("header", "Published top"),
  regionOf("footer", "Bottom"),
];

const sheet = { breakpoints: { viewport: [], container: [] } };

function renderCanvas(more: Partial<CanvasProps> = {}) {
  const props: CanvasProps = {
    document: page,
    siteStyles: sheet as never,
    regions,
    render: { styleContext: sheet } as never,
    ...more,
  };
  const view = render(<Canvas {...props} />);
  return {
    ...view,
    redraw: (next: Partial<CanvasProps>) =>
      view.rerender(<Canvas {...props} {...next} />),
  };
}

/** The drawn element holding `text`. */
function drawn(text: string): HTMLElement {
  return screen.getByText(text);
}

/** The region frame drawn for `area`. */
function frameOf(area: "header" | "footer"): HTMLElement {
  const frame = document.querySelector(`[${REGION_ATTRIBUTE}="${area}"]`);
  if (!(frame instanceof HTMLElement)) throw new Error(`no ${area} frame`);
  return frame;
}

const editingHeader = {
  area: "header" as const,
  document: textDoc("component", [
    ["t", "Draft top"],
    ["nav", "Navigation"],
  ]),
};

describe("a region edited in place", () => {
  it("draws the region from the live document, its blocks addressed and reachable", () => {
    renderCanvas({ editingRegion: editingHeader });
    // The draft being edited, not the published header.
    expect(screen.queryByText("Published top")).toBeNull();
    const nav = drawn("Navigation");
    expect(nav.getAttribute(NODE_ID_ATTRIBUTE)).toBe("nav");
    expect(nav.closest("[inert]")).toBeNull();
    expect(nav.closest(`[${CHROME_ATTRIBUTE}]`)).toBeNull();
    expect(nav.closest('[aria-hidden="true"]')).toBeNull();
    // No longer a button that selects the region as a whole.
    expect(frameOf("header").getAttribute("role")).toBeNull();
  });

  it("drops the region's own ring and pointer while it is edited", () => {
    renderCanvas({ editingRegion: editingHeader });
    expect(frameOf("header").hasAttribute("data-nx-region-edited")).toBe(true);
    expect(CANVAS_FRAME_SHEET).toMatch(
      /\.nx-canvas-region\[data-nx-region-edited\]::after\s*\{\s*display:\s*none;/
    );
    // The page's part lays out as if it were not there, in the frame too.
    expect(CANVAS_FRAME_SHEET).toMatch(
      /\.nx-canvas-page-part\s*\{\s*display:\s*contents;/
    );
  });

  it("keeps the page one stacking context on the site's ground inside its part", () => {
    // The page sits in its part whenever regions are drawn, so the rules
    // that read the page as the root's child read it there too.
    expect(CANVAS_FRAME_SHEET).toMatch(
      /> \.nx-canvas-page-part > \.nx-pb-page[^{]*\{\s*isolation: isolate;/
    );
    expect(CANVAS_FRAME_SHEET).toMatch(
      /\[data-nx-site-ground-opaque\] > \.nx-canvas-page-part > \.nx-pb-page\)\s*\{\s*background-color/
    );
  });

  it("keeps the page and the other region drawn, inert, hidden from assistive technology and unaddressed", () => {
    renderCanvas({ editingRegion: editingHeader });
    for (const text of ["Page body", "Bottom"]) {
      const element = drawn(text);
      expect(element.closest("[inert]"), text).not.toBeNull();
      expect(element.closest('[aria-hidden="true"]'), text).not.toBeNull();
    }
    // The page's block carries no address, so nothing can select it, nor
    // mistake it for the header's block of the same id.
    expect(drawn("Page body").hasAttribute(NODE_ID_ATTRIBUTE)).toBe(false);
    expect(
      document.querySelectorAll(`[${NODE_ID_ATTRIBUTE}="t"]`)
    ).toHaveLength(1);
  });

  it("selects a block of the region on a click, as a page's block is", () => {
    const onSelect = vi.fn();
    renderCanvas({ editingRegion: editingHeader, onSelect });
    fireEvent.click(drawn("Navigation"));
    expect(onSelect).toHaveBeenCalledWith("nav", "replace");
  });

  it("draws the page as before once the editing ends, and gives the region back its focus", () => {
    const view = renderCanvas({ editingRegion: editingHeader });
    view.redraw({ editingRegion: undefined });
    expect(drawn("Published top")).toBeTruthy();
    expect(drawn("Page body").getAttribute(NODE_ID_ATTRIBUTE)).toBe("t");
    expect(drawn("Page body").closest("[inert]")).toBeNull();
    expect(drawn("Page body").closest('[aria-hidden="true"]')).toBeNull();
    // Back to the header, where the author went in.
    expect(document.activeElement).toBe(frameOf("header"));
  });

  it("asks to edit a region on a double-click", () => {
    const onEditRegion = vi.fn();
    renderCanvas({ onEditRegion, onSelectRegion: vi.fn() });
    fireEvent.doubleClick(frameOf("footer"));
    expect(onEditRegion).toHaveBeenCalledWith("footer");
  });

  it("selects a region on Enter, and asks to edit it on Enter again", () => {
    const onEditRegion = vi.fn();
    const onSelectRegion = vi.fn();
    const view = renderCanvas({ onEditRegion, onSelectRegion });
    fireEvent.keyDown(frameOf("header"), { key: "Enter" });
    expect(onSelectRegion).toHaveBeenCalledWith("header");
    expect(onEditRegion).not.toHaveBeenCalled();

    view.redraw({ selectedRegion: "header" });
    fireEvent.keyDown(frameOf("header"), { key: "Enter" });
    expect(onEditRegion).toHaveBeenCalledWith("header");
  });

  it("keeps what the page's async blocks drew while the region is edited", async () => {
    const withLogo = {
      ...page,
      nodes: [
        ...page.nodes,
        { id: "logo", type: "acme/late", version: 1, props: {} },
      ],
    } as BlockDocument;
    // One context for the canvas's life, as a host hands it: what async
    // blocks drew is kept per context.
    const context = createStandaloneContext();
    const view = renderCanvas({
      document: withLogo,
      editingRegion: editingHeader,
      render: { styleContext: sheet, context } as never,
    });
    await act(async () => undefined);
    const runs = lateRuns.count;
    expect(runs).toBeGreaterThan(0);
    // An edit in the header: new render inputs of the same values, and the
    // region's next document. The page under the dim is not run again.
    view.redraw({
      document: withLogo,
      render: { styleContext: sheet, context } as never,
      editingRegion: {
        ...editingHeader,
        document: textDoc("component", [["nav", "Navigation, edited"]]),
      },
    });
    await act(async () => undefined);
    expect(lateRuns.count).toBe(runs);
  });

  it("draws a conditioned block of the region, marked, and keeps the page's marks off it", async () => {
    // The page's block "t" is conditioned; the header's "t" is not, and its
    // "deal" is.
    const conditioned = { conditions: [[{ field: "tier", op: "exists" }]] };
    const conditionedPage = {
      ...page,
      nodes: [{ ...page.nodes[0], visibility: conditioned }],
    } as BlockDocument;
    renderCanvas({
      document: conditionedPage,
      editingRegion: {
        area: "header",
        document: {
          ...textDoc("component", [
            ["t", "Draft top"],
            ["deal", "Members' deal"],
          ]),
          nodes: [
            textDoc("component", [["t", "Draft top"]]).nodes[0],
            {
              ...textDoc("component", [["deal", "Members' deal"]]).nodes[0],
              visibility: conditioned,
            },
          ],
        } as BlockDocument,
      },
    });
    await act(async () => undefined);
    // Drawn whoever a visitor is, so the author can see and select it.
    const deal = drawn("Members' deal");
    expect(deal.getAttribute(NODE_ID_ATTRIBUTE)).toBe("deal");
    expect(deal.hasAttribute(CONDITIONED_ATTRIBUTE)).toBe(true);
    // The header's own "t" carries none of the page's "t" marks.
    expect(drawn("Draft top").hasAttribute(CONDITIONED_ATTRIBUTE)).toBe(false);
  });

  it("draws the page exactly as before when no region is edited", () => {
    renderCanvas();
    expect(drawn("Page body").getAttribute(NODE_ID_ATTRIBUTE)).toBe("t");
    expect(drawn("Page body").closest("[inert]")).toBeNull();
    expect(drawn("Page body").closest('[aria-hidden="true"]')).toBeNull();
  });
});
