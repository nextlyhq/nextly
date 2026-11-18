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
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

import { CHROME_ATTRIBUTE, Canvas } from "./canvas";
import { CANVAS_FRAME_SHEET } from "./canvas-frame-sheet";
import type { CanvasProps } from "./canvas-props";
import { REGION_ATTRIBUTE, type CanvasRegion } from "./canvas-regions";

afterEach(cleanup);

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

  it("draws the page exactly as before when no region is edited", () => {
    renderCanvas();
    expect(drawn("Page body").getAttribute(NODE_ID_ATTRIBUTE)).toBe("t");
    expect(drawn("Page body").closest("[inert]")).toBeNull();
    expect(drawn("Page body").closest('[aria-hidden="true"]')).toBeNull();
  });
});
