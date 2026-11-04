// @vitest-environment jsdom

/**
 * The controls that add a section to the page: the start card an empty page
 * shows, and the "+" in each gap between two top-level sections.
 *
 * jsdom lays nothing out, so where a "+" is drawn is the browser's question;
 * here it is which gaps get one, what each says and reports, and which show.
 *
 * @module page-inserters.test
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import * as React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { Canvas } from "./canvas";
import { HoveredBlockProvider, useHoveredBlockSetter } from "./hovered-block";
import { PageInserters } from "./page-inserters";

afterEach(cleanup);

beforeAll(() => {
  clearBlocks();
  registerBlocks(
    [
      {
        name: "acme/section",
        version: 1,
        description: "A section with a region.",
        example: { props: {} },
        editor: { label: "Section" },
        slots: { children: {} },
        render: ({
          className,
          renderSlot,
        }: {
          className: string;
          renderSlot: (name: string) => ReactNode;
        }) => createElement("section", { className }, renderSlot("children")),
      },
      {
        name: "acme/leaf",
        version: 1,
        description: "A block.",
        example: { props: {} },
        editor: { label: "Leaf" },
        render: ({ className }: { className: string }) =>
          createElement("p", { className }, "words"),
      },
    ] as never,
    { source: "page-inserters-test" }
  );
});
afterAll(clearBlocks);

function section(id: string, name: string, children: BlockNode[] = []) {
  return {
    id,
    type: "acme/section",
    version: 1,
    props: {},
    name,
    slots: { children },
  } as BlockNode;
}

function page(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

const THREE = page([
  section("story", "Our story", [
    { id: "story-text", type: "acme/leaf", version: 1, props: {} } as BlockNode,
  ]),
  section("team", "Our team"),
  section("contact", "Contact"),
]);

/** Points the editor's hovered block at a block, as the canvas pointer does. */
function PointAt({ id }: { id: string | null }) {
  const point = useHoveredBlockSetter();
  React.useEffect(() => point(id), [id, point]);
  return null;
}

function mount(
  document: BlockDocument,
  props: {
    hidden?: boolean;
    hovered?: string | null;
    onStart?: () => void;
    onAddAfter?: (id: string) => void;
  } = {}
) {
  return render(
    <HoveredBlockProvider>
      <PointAt id={props.hovered ?? null} />
      <Canvas
        document={document}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        overlay={
          <PageInserters
            document={document}
            {...(props.hidden === undefined ? {} : { hidden: props.hidden })}
            onStart={props.onStart ?? (() => undefined)}
            onAddAfter={props.onAddAfter ?? (() => undefined)}
          />
        }
      />
    </HoveredBlockProvider>
  );
}

const gapButtons = () =>
  screen.queryAllByRole("button", { name: /^Add a section after/ });

describe("an empty page", () => {
  it("offers a start card whose button starts the page", async () => {
    const onStart = vi.fn();
    mount(page([]), { onStart });
    await act(async () => undefined);
    expect(screen.getByText("Start your page")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(gapButtons()).toHaveLength(0);
  });

  it("centres the start card on the part of the page on screen", async () => {
    // An empty page's root is only as tall as nothing in it, so the card is
    // placed in the middle of what the scroller shows, not of the root.
    const boxes = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 1000, 800);
        }
        if (this.classList.contains("nx-canvas")) {
          return new DOMRect(0, 0, 1000, 40);
        }
        return new DOMRect(0, 0, 0, 0);
      });
    try {
      render(
        <div data-scroller="" style={{ overflowY: "auto" }}>
          <Canvas
            document={page([])}
            siteStyles={{ breakpoints: { viewport: [], container: [] } }}
            overlay={
              <PageInserters
                document={page([])}
                onStart={() => undefined}
                onAddAfter={() => undefined}
              />
            }
          />
        </div>
      );
      await act(async () => undefined);
      const card = screen.getByText("Start your page").parentElement;
      expect(card?.style.left).toBe("500px");
      expect(card?.style.top).toBe("400px");
    } finally {
      boxes.mockRestore();
    }
  });

  it("draws nothing while a block is dragged, so the drop line shows", async () => {
    mount(page([]), { hidden: true });
    await act(async () => undefined);
    expect(screen.queryByText("Start your page")).toBeNull();
  });
});

describe("the + between sections", () => {
  it("is in each gap between two sections, naming the one above", async () => {
    mount(THREE);
    await act(async () => undefined);
    expect(
      gapButtons().map(button => button.getAttribute("aria-label"))
    ).toEqual([
      "Add a section after Our story",
      "Add a section after Our team",
    ]);
    // Not on a page that has sections.
    expect(screen.queryByText("Start your page")).toBeNull();
  });

  it("reports the section above the gap when pressed", async () => {
    const onAddAfter = vi.fn();
    mount(THREE, { onAddAfter });
    await act(async () => undefined);
    const [, second] = gapButtons();
    if (second === undefined) throw new Error("no second gap");
    fireEvent.click(second);
    expect(onAddAfter).toHaveBeenCalledWith("team");
  });

  it("shows only near its gap, never under the middle of a short block", async () => {
    // jsdom lays nothing out, so the sections' boxes are given: 24px each, a
    // line of text, stacked from the top. A gap's middle is a section's edge.
    const tops: Record<string, number> = { story: 0, team: 24, contact: 48 };
    const boxes = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const id = this.getAttribute("data-nx-node");
        if (id !== null && id in tops) {
          return new DOMRect(0, tops[id], 1000, 24);
        }
        return new DOMRect(0, 0, 1000, 72);
      });
    try {
      mount(THREE);
      await act(async () => undefined);
      const root = document.querySelector(".nx-canvas");
      if (root === null) throw new Error("no canvas");
      const near = () =>
        gapButtons().map(button => button.closest("[data-near]") !== null);

      // 3px from the edge between the first two: that gap's "+" shows.
      fireEvent.pointerMove(root, { clientX: 500, clientY: 27 });
      expect(near()).toEqual([true, false]);
      // The middle of the second, 12px from either edge: none shows, so a
      // press there is the block's.
      fireEvent.pointerMove(root, { clientX: 500, clientY: 36 });
      expect(near()).toEqual([false, false]);
      // Leaving the canvas lets it go.
      fireEvent.pointerMove(root, { clientX: 500, clientY: 47 });
      expect(near()).toEqual([false, true]);
      fireEvent.pointerLeave(root);
      expect(near()).toEqual([false, false]);
    } finally {
      boxes.mockRestore();
    }
  });

  it("shows nothing while a block is dragged", async () => {
    mount(THREE, { hidden: true, hovered: "team" });
    await act(async () => undefined);
    expect(gapButtons()).toHaveLength(0);
  });
});
