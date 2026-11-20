// @vitest-environment jsdom

/**
 * The regions of a page's Layout on the canvas: drawn around the page, their
 * content out of reach, and selected as a whole, with marks drawn inside.
 */
import {
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { useBlockEnvironment } from "@nextlyhq/blocks-react/environment";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement, useLayoutEffect, useRef } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { labelNotInName } from "../label-in-name.fixture";
import { CHROME_ATTRIBUTE, CONDITIONED_ATTRIBUTE, Canvas } from "./canvas";
import { CANVAS_FRAME_SHEET } from "./canvas-frame-sheet";
import type { CanvasProps } from "./canvas-props";
import { CANVAS_REGION_CLASS, type CanvasRegion } from "./canvas-regions";

afterEach(cleanup);

/** How often the async block has run, across every draw. */
const lateRenders = { count: 0 };

/** How often the counting block has been drawn, across every draw. */
const countedDraws = { count: 0 };

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
          props: { text?: string; href?: string };
        }) =>
          props.href === undefined
            ? createElement("p", { className }, props.text)
            : createElement("a", { className, href: props.href }, props.text),
      },
      {
        name: "acme/late",
        version: 1,
        description: "A block that draws after a promise, as an image does.",
        example: { props: {} },
        render: async ({ className }: { className: string }) => {
          lateRenders.count += 1;
          await Promise.resolve();
          return createElement("img", { className, alt: "Logo" });
        },
      },
      {
        name: "acme/counted",
        version: 1,
        description: "A block that counts how often it is drawn.",
        example: { props: {} },
        render: ({ className }: { className: string }) => {
          countedDraws.count += 1;
          return createElement("span", { className });
        },
      },
      {
        name: "acme/where",
        version: 1,
        description: "A block that reads where it is drawn.",
        example: { props: {} },
        render: () => createElement(WhereReader),
      },
    ] as never,
    { source: "canvas-regions-test" }
  );
});

/**
 * A block that says whether it was told the document it is drawn in: the
 * canvas's frame, rather than the admin's own globals.
 */
function WhereReader() {
  const environment = useBlockEnvironment();
  const own = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = own.current;
    if (element === null) return;
    element.dataset.ownDocument = String(
      environment?.document === element.ownerDocument
    );
  });
  return createElement("span", { ref: own, "data-where": "" });
}

afterAll(clearBlocks);

const page: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    { id: "p", type: "acme/text", version: 1, props: { text: "Page body" } },
  ],
} as BlockDocument;

function regionOf(
  area: "header" | "footer",
  text: string,
  extra: Partial<CanvasRegion> = {}
): CanvasRegion {
  const componentId = `${area}-component`;
  return {
    area,
    document: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: `nextly-region-${area}`,
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId },
        },
      ],
    } as BlockDocument,
    definitions: new Map([
      [
        componentId,
        {
          formatVersion: 1,
          kind: "component",
          nodes: [
            {
              id: "t",
              type: "acme/text",
              version: 1,
              props: { text, href: "/elsewhere" },
            },
          ],
        } as unknown as BlockDocument,
      ],
    ]),
    label: `${siteName(area)}, from the Main header & footer`,
    badge: `${siteName(area)} · Main`,
    name: siteName(area),
    ...extra,
  };
}

/** What a region is called on the canvas, as a host says it. */
function siteName(area: "header" | "footer"): string {
  return area === "header" ? "Site header" : "Site footer";
}

const sheet = { breakpoints: { viewport: [], container: [] } };

function renderCanvas(
  regions: readonly CanvasRegion[] | undefined,
  onSelect = vi.fn(),
  more: Pick<CanvasProps, "onSelectRegion" | "selectedRegion"> = {}
) {
  render(
    <Canvas
      document={page}
      siteStyles={sheet as never}
      regions={regions}
      onSelect={onSelect}
      render={{ styleContext: sheet } as never}
      {...more}
    />
  );
  return onSelect;
}

/** The drawn region an author reaches by this name. */
function regionNamed(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

/** The frame sheet's rules for a header or footer's marks. */
function regionRules(): string {
  const at = CANVAS_FRAME_SHEET.indexOf(".nx-canvas-region {");
  expect(at).toBeGreaterThan(-1);
  return CANVAS_FRAME_SHEET.slice(at);
}

describe("the regions of a page's Layout on the canvas", () => {
  it("draws the header before the page and the footer after it", () => {
    renderCanvas([regionOf("header", "Top"), regionOf("footer", "Bottom")]);
    const text = document.body.textContent ?? "";
    expect(text.indexOf("Top")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Top")).toBeLessThan(text.indexOf("Page body"));
    expect(text.indexOf("Bottom")).toBeGreaterThan(text.indexOf("Page body"));
  });

  it("keeps the page's condition badges off a region whose block shares a page block's id", async () => {
    // Ids are unique within a document, not across the page and its Layout:
    // the header's block is "t", and so is the page's conditioned one.
    render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [
              {
                id: "t",
                type: "acme/text",
                version: 1,
                props: { text: "Conditioned body" },
                visibility: {
                  conditions: [[{ field: "tier", op: "exists" }]],
                },
              },
            ],
          } as unknown as BlockDocument
        }
        siteStyles={sheet as never}
        regions={[regionOf("header", "Top")]}
        render={{ styleContext: sheet } as never}
      />
    );
    await act(async () => undefined);
    const marked = Array.from(
      document.querySelectorAll(`[${CONDITIONED_ATTRIBUTE}]`)
    );
    // CONTROL: the page's own block is marked.
    expect(marked).toHaveLength(1);
    expect(marked[0]?.closest(`.${CANVAS_REGION_CLASS}`)).toBeNull();
  });

  it("draws and marks a conditioned block inside a placed component's definition", async () => {
    // The page places a component; the component's own block has conditions,
    // and only appears once the definition is composed into the page.
    render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [
              {
                id: "card",
                type: COMPONENT_INSTANCE_TYPE,
                version: 1,
                props: { componentId: "promo" },
              },
            ],
          } as BlockDocument
        }
        siteStyles={sheet as never}
        render={
          {
            styleContext: sheet,
            definitions: new Map([
              [
                "promo",
                {
                  formatVersion: 1,
                  kind: "component",
                  nodes: [
                    {
                      id: "inner",
                      type: "acme/text",
                      version: 1,
                      props: { text: "Members only" },
                      visibility: {
                        conditions: [[{ field: "tier", op: "exists" }]],
                      },
                    },
                  ],
                } as unknown as BlockDocument,
              ],
            ]),
          } as never
        }
      />
    );
    await act(async () => undefined);
    // Drawn, where the published page's gating used to leave it out.
    expect(document.body.textContent).toContain("Members only");
    const marked = Array.from(
      document.querySelectorAll(`[${CONDITIONED_ATTRIBUTE}]`)
    );
    expect(marked).toHaveLength(1);
    expect(marked[0]?.textContent).toContain("Members only");
  });

  it("emits the site sheet once, from the first part drawn", () => {
    renderCanvas([regionOf("header", "Top"), regionOf("footer", "Bottom")]);
    const sheets = document.querySelectorAll("style[data-nx-site-sheet]");
    expect(sheets).toHaveLength(1);
    const header = regionNamed("Site header, from the Main header & footer");
    expect(header.contains(sheets[0]!)).toBe(true);
  });

  it("is chrome: no node of the page, its content inert; a click selects the region, never a block", () => {
    const onSelectRegion = vi.fn();
    const onSelect = renderCanvas([regionOf("header", "Top")], vi.fn(), {
      onSelectRegion,
    });
    const header = regionNamed("Site header, from the Main header & footer");
    expect(header.hasAttribute(CHROME_ATTRIBUTE)).toBe(true);
    expect(header.querySelector(`[${NODE_ID_ATTRIBUTE}]`)).toBeNull();
    // The region's own link cannot be reached or followed.
    const link = screen.getByText("Top").closest("a");
    expect(link?.closest("[inert]")).not.toBeNull();
    fireEvent.click(screen.getByText("Top"));
    expect(onSelectRegion).toHaveBeenCalledWith("header");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("is named by its own hidden text, not a label over the header it draws", () => {
    renderCanvas([regionOf("header", "Top")], vi.fn());
    const header = regionNamed("Site header, from the Main header & footer");
    // A label over the region would have to hold every word its content
    // draws, the site's own header included, which is a picture here, not
    // its name. So the drawn content is hidden from a screen reader and the
    // region is named by one hidden text inside it.
    expect(header.getAttribute("aria-label")).toBeNull();
    expect(labelNotInName(header)).toBeNull();
    const content = screen
      .getByText("Top")
      .closest(".nx-canvas-region__content");
    expect(content?.getAttribute("aria-hidden")).toBe("true");
    // That text is hidden on screen by the frame's own sheet, since the
    // editor's styles do not reach the canvas.
    expect(CANVAS_FRAME_SHEET).toMatch(
      /\.nx-canvas-region__name\s*\{[^}]*position:\s*absolute;[^}]*clip-path:\s*inset\(50%\);/
    );
  });

  it("is one Tab stop named for it, which Enter or Space selects", () => {
    const onSelectRegion = vi.fn();
    renderCanvas(
      [regionOf("header", "Top"), regionOf("footer", "Bottom")],
      vi.fn(),
      {
        onSelectRegion,
      }
    );
    const header = regionNamed("Site header, from the Main header & footer");
    const footer = regionNamed("Site footer, from the Main header & footer");
    expect(header.tabIndex).toBe(0);
    expect(footer.tabIndex).toBe(0);
    // Nothing inside either is a stop of its own: no lock, and its content's
    // links are inert.
    const stops = header.querySelectorAll("button, a[href], [tabindex]");
    expect(
      Array.from(stops).filter(stop => stop.closest("[inert]") === null)
    ).toHaveLength(0);
    expect(header.getAttribute("aria-pressed")).toBe("false");
    fireEvent.keyDown(header, { key: "Enter" });
    expect(onSelectRegion).toHaveBeenLastCalledWith("header");
    fireEvent.keyDown(footer, { key: " " });
    expect(onSelectRegion).toHaveBeenLastCalledWith("footer");
    // Any other key is left to the editor.
    fireEvent.keyDown(header, { key: "Delete" });
    expect(onSelectRegion).toHaveBeenCalledTimes(2);
  });

  it("shows it is selected with its name as the tag, and its badge as the tag at rest", () => {
    const props = {
      document: page,
      siteStyles: sheet as never,
      regions: [regionOf("header", "Top"), regionOf("footer", "Bottom")],
      onSelect: vi.fn(),
      onSelectRegion: vi.fn(),
      render: { styleContext: sheet } as never,
    };
    const { rerender } = render(<Canvas {...props} selectedRegion={null} />);
    const header = regionNamed("Site header, from the Main header & footer");
    const tag = header.querySelector(".nx-canvas-region__tag");
    // The tag repeats the name the region is announced by, so it is hidden
    // from a screen reader.
    expect(tag?.getAttribute("aria-hidden")).toBe("true");
    expect(tag?.textContent).toBe("Site header · Main");
    expect(header.hasAttribute("data-selected")).toBe(false);
    rerender(<Canvas {...props} selectedRegion="header" />);
    expect(header.getAttribute("aria-pressed")).toBe("true");
    expect(header.hasAttribute("data-selected")).toBe(true);
    expect(tag?.textContent).toBe("Site header");
    const footer = regionNamed("Site footer, from the Main header & footer");
    expect(footer.hasAttribute("data-selected")).toBe(false);
    // A click on the selected region asks nothing again.
    fireEvent.click(header);
    expect(props.onSelectRegion).not.toHaveBeenCalled();
  });

  it("draws its outline and tag inside its own box, with nothing hanging over the page", () => {
    renderCanvas([regionOf("header", "Top")]);
    const header = regionNamed("Site header, from the Main header & footer");
    // Its marks are its own children: the tag, and the outline as the
    // region's own pseudo-element, both placed in its box.
    expect(header.querySelector(".nx-canvas-region__lock")).toBeNull();
    const tag = header.querySelector(".nx-canvas-region__tag");
    expect(tag?.parentElement).toBe(header);
    const rules = regionRules();
    // Nothing of the region is placed past its own edges.
    expect(rules).not.toMatch(/top:\s*100%|bottom:\s*100%/);
    expect(rules).not.toMatch(/outline-offset:\s*[1-9]/);
    // The outline is drawn inside, over the content, and takes no pointer.
    expect(rules).toMatch(
      /\.nx-canvas-region::after\s*\{[^}]*inset:\s*0;[^}]*pointer-events:\s*none;/
    );
    // The tag takes no pointer, so the pointer leaving the region over the
    // tag is the pointer leaving the region.
    expect(rules).toMatch(
      /\.nx-canvas-region__tag\s*\{[^}]*position:\s*absolute;[^}]*pointer-events:\s*none;/
    );
    // In a region too short for it the tag keeps its size, for the next
    // measure, but is not seen.
    expect(rules).toMatch(
      /\.nx-canvas-region__tag\[data-placement="none"\]\s*\{\s*visibility:\s*hidden;/
    );
    // Hover is the stylesheet's alone: no React state for the pointer.
    expect(rules).toMatch(/\.nx-canvas-region:hover::after/);
    expect(rules).toMatch(/\.nx-canvas-region\[data-selected\]::after/);
  });

  it("takes the select hue for the page's ground, as the block marks do", () => {
    renderCanvas([regionOf("header", "Top")]);
    const header = regionNamed("Site header, from the Main header & footer");
    // jsdom paints no ground, so the page reads as light.
    expect(header.getAttribute("data-nx-page-scheme")).toBe("light");
    const rules = regionRules();
    expect(rules).toMatch(
      /\.nx-canvas-region\s*\{[^}]*--nx-region-mark:\s*var\(--nx-builder-select-on-light\);[^}]*--nx-region-mark-text:\s*var\(--nx-builder-select-text-on-light\);/
    );
    expect(rules).toMatch(
      /\.nx-canvas-region\[data-nx-page-scheme="dark"\]\s*\{[^}]*--nx-region-mark:\s*var\(--nx-builder-select-on-dark\);[^}]*--nx-region-mark-text:\s*var\(--nx-builder-select-text-on-dark\);/
    );
  });

  it("counts the tag's inset when it judges whether the tag fits a short region", () => {
    // A 20px header with an 18px tag set 4px in: it would reach 2px past the
    // header's foot, over the page.
    const box = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("nx-canvas")) {
          return DOMRect.fromRect({ width: 1280, height: window.innerHeight });
        }
        if (this.classList.contains("nx-canvas-region")) {
          return DOMRect.fromRect({ x: 0, y: 0, width: 1280, height: 20 });
        }
        if (this.classList.contains("nx-canvas-region__tag")) {
          return DOMRect.fromRect({ x: 8, y: 4, width: 120, height: 18 });
        }
        return DOMRect.fromRect();
      });
    try {
      renderCanvas([regionOf("header", "Top")]);
      expect(
        document
          .querySelector(".nx-canvas-region__tag")
          ?.getAttribute("data-placement")
      ).toBe("none");
      cleanup();
      // CONTROL: with room for the inset as well, the tag shows at the top.
      box.mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("nx-canvas")) {
          return DOMRect.fromRect({ width: 1280, height: window.innerHeight });
        }
        if (this.classList.contains("nx-canvas-region")) {
          return DOMRect.fromRect({ x: 0, y: 0, width: 1280, height: 26 });
        }
        if (this.classList.contains("nx-canvas-region__tag")) {
          return DOMRect.fromRect({ x: 8, y: 4, width: 120, height: 18 });
        }
        return DOMRect.fromRect();
      });
      renderCanvas([regionOf("header", "Top")]);
      expect(
        document
          .querySelector(".nx-canvas-region__tag")
          ?.getAttribute("data-placement")
      ).toBe("top");
    } finally {
      box.mockRestore();
    }
  });

  it("places its tag at the top left inside, and at the bottom left where the top is off screen", () => {
    // A footer scrolled so its top edge is above the canvas.
    const box = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        // The canvas, as tall as the window: what of it is on screen.
        if (this.classList.contains("nx-canvas")) {
          return DOMRect.fromRect({ width: 1280, height: window.innerHeight });
        }
        if (this.classList.contains("nx-canvas-region")) {
          return DOMRect.fromRect({ x: 0, y: -200, width: 1280, height: 400 });
        }
        // Drawn at its top left, 4px in, before it is placed.
        if (this.classList.contains("nx-canvas-region__tag")) {
          return DOMRect.fromRect({ x: 8, y: -196, width: 120, height: 24 });
        }
        return DOMRect.fromRect();
      });
    try {
      renderCanvas([regionOf("footer", "Bottom")]);
      const tag = document.querySelector(".nx-canvas-region__tag");
      expect(tag?.getAttribute("data-placement")).toBe("bottom");
      cleanup();
      // CONTROL: the same footer with its top on screen keeps the top.
      box.mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("nx-canvas")) {
          return DOMRect.fromRect({ width: 1280, height: window.innerHeight });
        }
        if (this.classList.contains("nx-canvas-region")) {
          return DOMRect.fromRect({ x: 0, y: 200, width: 1280, height: 400 });
        }
        if (this.classList.contains("nx-canvas-region__tag")) {
          return DOMRect.fromRect({ x: 8, y: 204, width: 120, height: 24 });
        }
        return DOMRect.fromRect();
      });
      renderCanvas([regionOf("footer", "Bottom")]);
      expect(
        document
          .querySelector(".nx-canvas-region__tag")
          ?.getAttribute("data-placement")
      ).toBe("top");
    } finally {
      box.mockRestore();
    }
  });

  it("tells a region's blocks the frame the canvas draws in, as the page's", async () => {
    // Drawn inside a frame, so the canvas's own document differs from the
    // admin's globals that a block outside the provider would be handed.
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const inner = frame.contentDocument;
    if (inner === null) throw new Error("the frame has no document");
    const container = inner.createElement("div");
    inner.body.append(container);
    const where = (area: "header" | "footer"): CanvasRegion => {
      const region = regionOf(area, area);
      const componentId = `${area}-component`;
      return {
        ...region,
        definitions: new Map([
          [
            componentId,
            {
              formatVersion: 1,
              kind: "component",
              nodes: [{ id: "w", type: "acme/where", version: 1, props: {} }],
            } as unknown as BlockDocument,
          ],
        ]),
      };
    };
    const onPage: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "w", type: "acme/where", version: 1, props: {} }],
    } as BlockDocument;
    render(
      <Canvas
        document={onPage}
        siteStyles={sheet as never}
        regions={[where("header"), where("footer")]}
        onSelect={vi.fn()}
        render={{ styleContext: sheet } as never}
      />,
      { container }
    );
    await waitFor(() => {
      const readers = [...inner.querySelectorAll("[data-where]")];
      // The page's reader and one in each region.
      expect(readers).toHaveLength(3);
      for (const reader of readers) {
        expect((reader as HTMLElement).dataset.ownDocument).toBe("true");
      }
    });
    frame.remove();
  });

  it("keeps a region's async blocks drawn, without running them again, when the page changes", async () => {
    const header = regionOf("header", "Top");
    const component = [...(header.definitions?.values() ?? [])][0];
    const withLogo: CanvasRegion = {
      ...header,
      definitions: new Map([
        [
          "header-component",
          {
            ...component,
            nodes: [
              { id: "logo", type: "acme/late", version: 1, props: {} },
              { id: "count", type: "acme/counted", version: 1, props: {} },
            ],
          } as BlockDocument,
        ],
      ]),
    };
    const regions = [withLogo];
    const render1 = { styleContext: sheet };
    const canvasOf = (document: BlockDocument, rendered: object) => (
      <Canvas
        document={document}
        siteStyles={sheet as never}
        regions={regions}
        onSelect={vi.fn()}
        render={rendered as never}
      />
    );
    const view = await act(async () => render(canvasOf(page, render1)));
    // Hidden from a screen reader with the rest of the region's content.
    const logo = screen.getByRole("img", { name: "Logo", hidden: true });
    const before = lateRenders.count;
    expect(before).toBeGreaterThan(0);
    const drawn = countedDraws.count;
    expect(drawn).toBeGreaterThan(0);
    // An insert on the page, and the canvas's inputs handed again as a new
    // object with the same values, as the editor does after an edit.
    const inserted = {
      ...page,
      nodes: [
        ...page.nodes,
        { id: "q", type: "acme/text", version: 1, props: { text: "New" } },
      ],
    } as BlockDocument;
    await act(async () => {
      view.rerender(canvasOf(inserted, { ...render1 }));
    });
    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Logo", hidden: true })).toBe(logo);
    expect(lateRenders.count).toBe(before);
    // Nor was the header drawn again at all: its inputs held the same values.
    expect(countedDraws.count).toBe(drawn);
  });

  it("draws a region's async blocks again when the region's own content changes", async () => {
    const header = regionOf("header", "Top");
    const component = [...(header.definitions?.values() ?? [])][0];
    const regionWith = (alt: string): CanvasRegion => ({
      ...header,
      definitions: new Map([
        [
          "header-component",
          {
            ...component,
            nodes: [
              { id: "logo", type: "acme/late", version: 1, props: { alt } },
            ],
          } as BlockDocument,
        ],
      ]),
    });
    const canvasOf = (region: CanvasRegion) => (
      <Canvas
        document={page}
        siteStyles={sheet as never}
        regions={[region]}
        onSelect={vi.fn()}
        render={{ styleContext: sheet } as never}
      />
    );
    const view = await act(async () => render(canvasOf(regionWith("a"))));
    const before = lateRenders.count;
    await act(async () => {
      view.rerender(canvasOf(regionWith("b")));
    });
    expect(lateRenders.count).toBe(before + 1);
  });

  it("draws the page alone, as before, with no regions", () => {
    renderCanvas(undefined);
    expect(document.querySelector(`.${CANVAS_REGION_CLASS}`)).toBeNull();
    expect(
      document.querySelectorAll("style[data-nx-site-sheet]").length
    ).toBeLessThanOrEqual(1);
  });
});
