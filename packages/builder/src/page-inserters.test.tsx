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
  beforeEach,
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
import { componentTitles, type ComponentTitleOf } from "./layers";
import { PageInserters } from "./page-inserters";

afterEach(cleanup);

/**
 * The layout boxes an element generates, in the shape `getClientRects`
 * returns them: an array carrying `item`, which satisfies `DOMRectList`.
 */
function rectsOf(rects: readonly DOMRect[]): DOMRectList {
  const list = [...rects];
  return Object.assign(list, {
    item: (index: number): DOMRect | null => list[index] ?? null,
  });
}

/** Nodes, by id, that generate no box, as one hidden on this device. */
const boxless = new Set<string>();

// jsdom lays nothing out, so every element generates one box unless a case
// says it generates none.
beforeEach(() => {
  boxless.clear();
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
    this: Element
  ) {
    const id = this.getAttribute("data-nx-node");
    return rectsOf(id !== null && boxless.has(id) ? [] : [new DOMRect()]);
  });
});
afterEach(() => vi.restoreAllMocks());

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
    componentTitle?: ComponentTitleOf;
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
            {...(props.componentTitle === undefined
              ? {}
              : { componentTitle: props.componentTitle })}
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

  it("speaks of blocks, not of a page, in an empty component", async () => {
    // A component is not a page and has no sections: its card says what an
    // author adds to it.
    mount({ formatVersion: 1, kind: "component", nodes: [] } as never);
    await act(async () => undefined);
    expect(screen.queryByText("Start your page")).toBeNull();
    expect(screen.getByText("Add the first block")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add block" })).toBeTruthy();
  });

  it.each(["pattern", "region", "template"])(
    "speaks of blocks in an empty %s, which has no sections either",
    async kind => {
      // Only a page is built of sections; every other kind of document holds
      // blocks at its top level.
      mount({ formatVersion: 1, kind, nodes: [] } as never);
      await act(async () => undefined);
      expect(screen.queryByText("Start your page")).toBeNull();
      expect(screen.getByText("Add the first block")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Add block" })).toBeTruthy();
    }
  );

  it.each(["a-future-kind", "toString"])(
    "speaks of blocks in a document of a kind it does not know (%s)",
    async kind => {
      // A stored document can carry a kind newer than this editor: the
      // engine's forgiving read lets it through, and the card still draws.
      mount({ formatVersion: 1, kind, nodes: [] } as never);
      await act(async () => undefined);
      expect(screen.getByText("Add the first block")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Add block" })).toBeTruthy();
    }
  );

  it("follows the scroller when it scrolls the empty page", async () => {
    // The scroller around the canvas is outside it, and its scroll reaches no
    // listener on the canvas: the card is re-centred on what it now shows.
    let shownTop = 0;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 1000, 800);
        }
        if (this.classList.contains("nx-canvas")) {
          return new DOMRect(0, -shownTop, 1000, 2000);
        }
        return new DOMRect(0, 0, 0, 0);
      }
    );
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
    expect(card?.style.top).toBe("400px");
    shownTop = 600;
    const scroller = document.querySelector("[data-scroller]");
    if (scroller === null) throw new Error("no scroller");
    fireEvent.scroll(scroller);
    await act(async () => undefined);
    expect(card?.style.top).toBe("1000px");
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

  it("leaves out a section hidden on this device, with no box to be beside", async () => {
    boxless.add("team");
    mount(THREE);
    await act(async () => undefined);
    expect(
      gapButtons().map(button => button.getAttribute("aria-label"))
    ).toEqual(["Add a section after Our story"]);
  });

  it("puts the gap after every part a component placement draws", async () => {
    // A placement whose definition has two top-level nodes draws two
    // elements, both carrying its address. The gap after it is below the
    // second; measured from the first alone it would sit inside the placement.
    const doc = page([
      section("story", "Our story"),
      {
        id: "promo",
        type: "acme/leaf",
        version: 1,
        props: {},
        name: "Promo",
      } as BlockNode,
      section("contact", "Contact"),
    ]);
    const tops: Record<string, [number, number]> = {
      story: [0, 24],
      "promo-a": [24, 24],
      "promo-b": [48, 24],
      contact: [72, 24],
    };
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const id = this.getAttribute("data-nx-node");
        const at = id === null ? undefined : tops[id];
        return at === undefined
          ? new DOMRect(0, 0, 1000, 96)
          : new DOMRect(0, at[0], 1000, at[1]);
      }
    );
    mount(doc);
    await act(async () => undefined);
    // The placement's two parts in place of the leaf's one element.
    const leaf = document.querySelector('[data-nx-node="promo"]');
    if (leaf === null) throw new Error("no placement element");
    for (const part of ["promo-a", "promo-b"]) {
      const element = document.createElement("div");
      element.setAttribute("data-nx-node", part);
      element.setAttribute("data-nx-instance", "promo");
      leaf.before(element);
    }
    leaf.remove();
    await act(async () => undefined);

    const root = document.querySelector(".nx-canvas");
    if (root === null) throw new Error("no canvas");
    const near = () =>
      gapButtons().map(button => button.closest("[data-near]") !== null);
    // At the placement's bottom, 72: the gap after it.
    fireEvent.pointerMove(root, { clientX: 500, clientY: 72 });
    expect(near()).toEqual([false, true]);
    // Inside it, between its parts at 60: no gap there.
    fireEvent.pointerMove(root, { clientX: 500, clientY: 60 });
    expect(near()).toEqual([false, false]);
  });

  it("measures a section drawn with display: contents by what it draws", async () => {
    // A section styled `display: contents` generates no box of its own, and
    // its children are still on the page: the gap after it is still there.
    mount(THREE);
    await act(async () => undefined);
    const team = document.querySelector<HTMLElement>('[data-nx-node="team"]');
    if (team === null) throw new Error("no team section");
    team.style.display = "contents";
    team.append(document.createElement("p"));
    boxless.add("team");
    // Anything re-measures; a mutation inside the canvas does.
    team.append(document.createElement("span"));
    await act(async () => undefined);
    expect(
      gapButtons().map(button => button.getAttribute("aria-label"))
    ).toEqual([
      "Add a section after Our story",
      "Add a section after Our team",
    ]);
  });

  it("measures a display: contents section where the engine says it has no box", async () => {
    // jsdom has no `checkVisibility`; a browser's answers false for an
    // element that generates no box, `display: contents` included. Given the
    // browser's answer, the section still counts by what its children draw.
    Object.defineProperty(Element.prototype, "checkVisibility", {
      configurable: true,
      value(this: Element): boolean {
        const id = this.getAttribute("data-nx-node");
        return id === null || !boxless.has(id);
      },
    });
    try {
      mount(THREE);
      await act(async () => undefined);
      const team = document.querySelector<HTMLElement>('[data-nx-node="team"]');
      if (team === null) throw new Error("no team section");
      team.style.display = "contents";
      team.append(document.createElement("p"));
      boxless.add("team");
      team.append(document.createElement("span"));
      await act(async () => undefined);
      expect(
        gapButtons().map(button => button.getAttribute("aria-label"))
      ).toEqual([
        "Add a section after Our story",
        "Add a section after Our team",
      ]);
    } finally {
      Reflect.deleteProperty(Element.prototype, "checkVisibility");
    }
  });

  it("names the gap after a component placement with the component's title", async () => {
    const doc = page([
      {
        id: "hero",
        type: "nextly/component-instance",
        version: 1,
        props: { componentId: "cmp-hero" },
      } as BlockNode,
      section("contact", "Contact"),
    ]);
    mount(doc, {
      componentTitle: componentTitles([
        { id: "cmp-hero", title: "Hero banner" },
      ]),
    });
    await act(async () => undefined);
    if (document.querySelector('[data-nx-node="hero"]') === null) {
      // A placement with no definition draws nothing here: stand in for it.
      const contact = document.querySelector('[data-nx-node="contact"]');
      const part = document.createElement("div");
      part.setAttribute("data-nx-node", "hero");
      contact?.before(part);
      await act(async () => undefined);
    }
    expect(
      gapButtons().map(button => button.getAttribute("aria-label"))
    ).toEqual(["Add a section after Hero banner"]);
  });

  it("keeps gaps apart whatever their sections' ids hold", async () => {
    // Ids are any non-empty string: joined with a separator they collide,
    // so "a" then "b|c" and "a|b" then "c" would be one gap twice.
    const tops: Record<string, number> = { a: 0, "b|c": 24, "a|b": 48, c: 72 };
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const id = this.getAttribute("data-nx-node");
        return id !== null && id in tops
          ? new DOMRect(0, tops[id], 1000, 24)
          : new DOMRect(0, 0, 1000, 96);
      }
    );
    mount(
      page([
        section("a", "A"),
        section("b|c", "BC"),
        section("a|b", "AB"),
        section("c", "C"),
      ])
    );
    await act(async () => undefined);
    const root = document.querySelector(".nx-canvas");
    if (root === null) throw new Error("no canvas");
    // At the first gap, 24: only that one shows.
    fireEvent.pointerMove(root, { clientX: 500, clientY: 24 });
    expect(
      gapButtons().map(button => button.closest("[data-near]") !== null)
    ).toEqual([true, false, false]);
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
