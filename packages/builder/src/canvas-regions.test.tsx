// @vitest-environment jsdom

/**
 * The regions of a page's Layout on the canvas: drawn around the page, locked,
 * and telling the author where they come from.
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

import { CHROME_ATTRIBUTE, Canvas } from "./canvas";
import type { CanvasRegion } from "./canvas-regions";

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
          props: { text?: string; href?: string };
        }) =>
          props.href === undefined
            ? createElement("p", { className }, props.text)
            : createElement("a", { className, href: props.href }, props.text),
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
    label: `${area === "header" ? "Header" : "Footer"}, from Layout Main`,
    badge: `${area === "header" ? "Header" : "Footer"} · from Layout`,
    edit: {
      href: "/admin/collections/layouts/main",
      text: "Edit Layout ↗",
      name: "Edit Layout Main (opens in a new tab)",
    },
    ...extra,
  };
}

const sheet = { breakpoints: { viewport: [], container: [] } };

function renderCanvas(
  regions: readonly CanvasRegion[] | undefined,
  onSelect = vi.fn()
) {
  render(
    <Canvas
      document={page}
      siteStyles={sheet as never}
      regions={regions}
      onSelect={onSelect}
      render={{ styleContext: sheet } as never}
    />
  );
  return onSelect;
}

describe("the regions of a page's Layout on the canvas", () => {
  it("draws the header before the page and the footer after it", () => {
    renderCanvas([regionOf("header", "Top"), regionOf("footer", "Bottom")]);
    const text = document.body.textContent ?? "";
    expect(text.indexOf("Top")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Top")).toBeLessThan(text.indexOf("Page body"));
    expect(text.indexOf("Bottom")).toBeGreaterThan(text.indexOf("Page body"));
  });

  it("emits the site sheet once, from the first part drawn", () => {
    renderCanvas([regionOf("header", "Top"), regionOf("footer", "Bottom")]);
    const sheets = document.querySelectorAll("style[data-nx-site-sheet]");
    expect(sheets).toHaveLength(1);
    const header = screen.getByRole("group", {
      name: "Header, from Layout Main",
    });
    expect(header.contains(sheets[0]!)).toBe(true);
  });

  it("is chrome: not selectable, its content inert, no node of the page", () => {
    const onSelect = renderCanvas([regionOf("header", "Top")]);
    const header = screen.getByRole("group", {
      name: "Header, from Layout Main",
    });
    expect(header.hasAttribute(CHROME_ATTRIBUTE)).toBe(true);
    expect(header.querySelector(`[${NODE_ID_ATTRIBUTE}]`)).toBeNull();
    // The region's own link cannot be reached or followed.
    const link = screen.getByText("Top").closest("a");
    expect(link?.closest("[inert]")).not.toBeNull();
    fireEvent.click(header);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows its tag on a click, with the Edit link opening a new tab", () => {
    renderCanvas([regionOf("header", "Top")]);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(
      screen.getByRole("group", { name: "Header, from Layout Main" })
    );
    const tag = screen.getByRole("status");
    expect(tag.textContent).toContain("Header, from Layout Main");
    const edit = screen.getByRole("link", {
      name: "Edit Layout Main (opens in a new tab)",
    });
    expect(edit.getAttribute("href")).toBe("/admin/collections/layouts/main");
    expect(edit.getAttribute("target")).toBe("_blank");
    expect(edit.textContent).toBe("Edit Layout ↗");
  });

  it("opens by keyboard, and Escape closes it and returns focus to the region", () => {
    renderCanvas([regionOf("header", "Top")]);
    const header = screen.getByRole("group", {
      name: "Header, from Layout Main",
    });
    expect(header.tabIndex).toBe(0);
    header.focus();
    fireEvent.keyDown(header, { key: "Enter" });
    const edit = screen.getByRole("link", {
      name: "Edit Layout Main (opens in a new tab)",
    });
    edit.focus();
    fireEvent.keyDown(edit, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.activeElement).toBe(header);
  });

  it("offers no Edit link to someone who may not update the Layout", () => {
    renderCanvas([regionOf("header", "Top", { edit: undefined })]);
    fireEvent.click(
      screen.getByRole("group", { name: "Header, from Layout Main" })
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Header, from Layout Main"
    );
    expect(screen.queryByRole("link", { name: /Edit Layout/ })).toBeNull();
  });

  it("says which part has changes a visitor does not see yet", () => {
    renderCanvas([
      regionOf("header", "Top", {
        note: "Draft changes not live: Layout Main",
      }),
    ]);
    fireEvent.click(
      screen.getByRole("group", { name: "Header, from Layout Main" })
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Draft changes not live: Layout Main"
    );
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

  it("draws the page alone, as before, with no regions", () => {
    renderCanvas(undefined);
    expect(screen.queryByRole("group")).toBeNull();
    expect(
      document.querySelectorAll("style[data-nx-site-sheet]").length
    ).toBeLessThanOrEqual(1);
  });
});
