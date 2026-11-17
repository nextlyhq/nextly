// @vitest-environment jsdom

/**
 * The controls that add a block to the page: the start card an empty page
 * shows, and the "+" in each gap between blocks: between top-level blocks,
 * after the last one, and between the selected block's children.
 *
 * jsdom lays nothing out, so where a "+" is drawn is the browser's question;
 * here it is which gaps get one, what each says and reports, and which show.
 *
 * @module page-inserters.test
 */
import {
  act,
  cleanup,
  createEvent,
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
import {
  componentTitles,
  type ComponentTitleOf,
} from "../panels/layers/layers";
import { PageInserters } from "./page-inserters";
import type { StarterPage } from "./page-start-area";

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
    onStart?: (control: HTMLElement) => void;
    onSavedSection?: () => void;
    title?: string;
    starters?: readonly StarterPage[];
    onStarter?: (id: string) => void;
    dragging?: boolean;
    onAddAfter?: (id: string, control: HTMLElement) => void;
    componentTitle?: ComponentTitleOf;
    selectedId?: string | null;
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
            {...(props.selectedId === undefined
              ? {}
              : { selectedId: props.selectedId })}
            {...(props.dragging === undefined
              ? {}
              : { dragging: props.dragging })}
            start={{
              onStart: props.onStart ?? (() => undefined),
              ...(props.onSavedSection === undefined
                ? {}
                : { onSavedSection: props.onSavedSection }),
              ...(props.title === undefined ? {} : { title: props.title }),
              ...(props.starters === undefined
                ? {}
                : { starters: props.starters }),
              ...(props.onStarter === undefined
                ? {}
                : { onStarter: props.onStarter }),
            }}
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
  screen.queryAllByRole("button", { name: /^Add a block (between|after) / });

const gapNames = () =>
  gapButtons().map(button => button.getAttribute("aria-label"));

describe("an empty page", () => {
  it("greets a page by its title, with both ways in and the line about dragging", async () => {
    const onStart = vi.fn();
    const onSavedSection = vi.fn();
    mount(page([]), { onStart, onSavedSection, title: "About us" });
    await act(async () => undefined);
    expect(
      screen.getByRole("heading", { name: "Start building About us" })
    ).toBeTruthy();
    expect(screen.getByText("or drag a block here")).toBeTruthy();
    const add = screen.getByRole("button", { name: "Add a block" });
    fireEvent.click(add);
    expect(onStart).toHaveBeenCalledWith(add);
    fireEvent.click(
      screen.getByRole("button", { name: "Insert a saved section" })
    );
    expect(onSavedSection).toHaveBeenCalledTimes(1);
    expect(gapButtons()).toHaveLength(0);
    // None of the old card's words.
    expect(screen.queryByText("Start your page")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add section" })).toBeNull();
  });

  it("greets a page with no title yet as your page", async () => {
    mount(page([]));
    await act(async () => undefined);
    expect(
      screen.getByRole("heading", { name: "Start building your page" })
    ).toBeTruthy();
  });

  it.each(["component", "pattern", "template", "a-future-kind", "toString"])(
    "heads an empty %s with Add the first block",
    async kind => {
      // Only a page has a title to build; every other document starts with
      // its first block. A kind newer than this editor reads the same.
      mount({ formatVersion: 1, kind, nodes: [] } as never, {
        title: "Ignored",
      });
      await act(async () => undefined);
      expect(
        screen.getByRole("heading", { name: "Add the first block" })
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Add a block" })).toBeTruthy();
    }
  );

  it("offers no saved section where the host offers none", async () => {
    mount({ formatVersion: 1, kind: "component", nodes: [] } as never);
    await act(async () => undefined);
    expect(
      screen.queryByRole("button", { name: "Insert a saved section" })
    ).toBeNull();
  });

  it("draws starter pages under their heading, and none with none", async () => {
    const onStarter = vi.fn();
    const { unmount } = mount(page([]), { starters: [] });
    await act(async () => undefined);
    expect(screen.queryByText("or start from a page")).toBeNull();
    unmount();
    mount(page([]), {
      starters: [
        { id: "home", title: "Home" },
        { id: "landing", title: "Landing page" },
      ],
      onStarter,
    });
    await act(async () => undefined);
    expect(screen.getByText("or start from a page")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Landing page" }));
    expect(onStarter).toHaveBeenCalledWith("landing");
  });

  it("sits near the top of the body, under the header, and holds the body open", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.getAttribute("data-nx-region") === "header") {
          return new DOMRect(0, 0, 1000, 120);
        }
        return new DOMRect(0, 0, 1000, 400);
      }
    );
    mount(page([]));
    await act(async () => undefined);
    const root = document.querySelector<HTMLElement>(".nx-canvas");
    if (root === null) throw new Error("no canvas");
    const header = document.createElement("div");
    header.setAttribute("data-nx-region", "header");
    root.prepend(header);
    await act(async () => undefined);
    const area = document.querySelector<HTMLElement>(".nx-page-start");
    // Centred across the page, 32px under the header's bottom edge.
    expect(area?.style.left).toBe("500px");
    expect(area?.style.top).toBe("152px");
    // The body is held open by the area and its room above and below, in
    // the page's own pixels (jsdom draws the area 0px tall).
    expect(root.style.getPropertyValue("--nx-start-room")).toBe("64px");
  });

  it("lets go of the body once the page has a block", async () => {
    const view = mount(page([]));
    await act(async () => undefined);
    const root = document.querySelector<HTMLElement>(".nx-canvas");
    expect(root?.style.getPropertyValue("--nx-start-room")).not.toBe("");
    view.unmount();
    expect(root?.style.getPropertyValue("--nx-start-room")).toBe("");
  });

  it("stays while a block is dragged, drawn as where it drops", async () => {
    mount(page([]), { dragging: true });
    await act(async () => undefined);
    const area = document.querySelector(".nx-page-start");
    expect(area?.hasAttribute("data-drop-target")).toBe(true);
  });

  it("draws nothing where the host offers no adding", async () => {
    mount(page([]), { hidden: true });
    await act(async () => undefined);
    expect(document.querySelector(".nx-page-start")).toBeNull();
  });
});

describe("the + between sections", () => {
  it("is in each gap between two sections and after the last, saying where it adds", async () => {
    mount(THREE);
    await act(async () => undefined);
    expect(gapNames()).toEqual([
      "Add a block between Our story and Our team",
      "Add a block between Our team and Contact",
      "Add a block after Contact",
    ]);
    // Not on a page that has sections.
    expect(screen.queryByText("Start your page")).toBeNull();
  });

  it("leaves out a section hidden on this device, with no box to be beside", async () => {
    boxless.add("team");
    mount(THREE);
    await act(async () => undefined);
    expect(gapNames()).toEqual([
      "Add a block between Our story and Contact",
      "Add a block after Contact",
    ]);
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
    expect(near()).toEqual([false, true, false]);
    // Inside it, between its parts at 60: no gap there.
    fireEvent.pointerMove(root, { clientX: 500, clientY: 60 });
    expect(near()).toEqual([false, false, false]);
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
    expect(gapNames()).toEqual([
      "Add a block between Our story and Our team",
      "Add a block between Our team and Contact",
      "Add a block after Contact",
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
      expect(gapNames()).toEqual([
        "Add a block between Our story and Our team",
        "Add a block between Our team and Contact",
        "Add a block after Contact",
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
    expect(gapNames()).toEqual([
      "Add a block between Hero banner and Contact",
      "Add a block after Contact",
    ]);
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
    ).toEqual([true, false, false, false]);
  });

  it("reports the block before the gap and the + pressed, selecting nothing", async () => {
    const onAddAfter = vi.fn();
    mount(THREE, { onAddAfter });
    await act(async () => undefined);
    const [, second, last] = gapButtons();
    if (second === undefined || last === undefined) throw new Error("no gaps");
    fireEvent.click(second);
    expect(onAddAfter).toHaveBeenLastCalledWith("team", second);
    // After the last section: after it, at the end of the page.
    fireEvent.click(last);
    expect(onAddAfter).toHaveBeenLastCalledWith("contact", last);
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
      expect(near()).toEqual([true, false, false]);
      // The middle of the second, 12px from either edge: none shows, so a
      // press there is the block's.
      fireEvent.pointerMove(root, { clientX: 500, clientY: 36 });
      expect(near()).toEqual([false, false, false]);
      // The bottom of the last: the gap after it.
      fireEvent.pointerMove(root, { clientX: 500, clientY: 70 });
      expect(near()).toEqual([false, false, true]);
      // Leaving the canvas lets it go.
      fireEvent.pointerMove(root, { clientX: 500, clientY: 47 });
      expect(near()).toEqual([false, true, false]);
      fireEvent.pointerLeave(root);
      expect(near()).toEqual([false, false, false]);
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

describe("the + between the selected block's children", () => {
  /** Boxes, by id: x, y, width, height. Everything else is the page. */
  const BOXES: Record<string, [number, number, number, number]> = {
    hero: [0, 0, 1000, 100],
    pricing: [0, 100, 1000, 200],
    "box-a": [0, 120, 300, 160],
    "box-b": [350, 120, 300, 160],
    "box-c": [700, 120, 300, 160],
    contact: [0, 300, 1000, 100],
  };

  /** A page of three sections, the second holding a row of three Boxes. */
  const ROW = page([
    section("hero", "Hero"),
    section("pricing", "Pricing", [
      section("box-a", "Box A"),
      section("box-b", "Box B"),
      section("box-c", "Box C"),
    ]),
    section("contact", "Contact"),
  ]);

  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const id = this.getAttribute("data-nx-node");
        const box = id === null ? undefined : BOXES[id];
        return box === undefined
          ? new DOMRect(0, 0, 1000, 400)
          : new DOMRect(...box);
      }
    );
  });

  it("adds a gap down each line between Boxes in a row, in reading order", async () => {
    mount(ROW, { selectedId: "pricing" });
    await act(async () => undefined);
    // The page's gaps, the one after its last section, and two between the
    // Boxes, all in the order a reader meets them: so Tab meets them so too.
    expect(gapNames()).toEqual([
      "Add a block between Hero and Pricing",
      "Add a block between Box A and Box B",
      "Add a block between Box B and Box C",
      "Add a block between Pricing and Contact",
      "Add a block after Contact",
    ]);
    const between = gapButtons()[1]?.closest(".nx-page-inserters__gap");
    if (!(between instanceof HTMLElement)) throw new Error("no gap");
    // Down the line between the two Boxes, as tall as the row.
    expect(between.getAttribute("data-line")).toBe("down");
    expect(between.style.left).toBe("325px");
    expect(between.style.top).toBe("120px");
    expect(between.style.height).toBe("160px");
  });

  it("keeps a touch screen's + between blocks deeper than it", async () => {
    // Every block here is at least 100px deep, so a "+" centred on a line
    // leaves both middles clear: a touch screen keeps it shown.
    mount(ROW, { selectedId: "pricing" });
    await act(async () => undefined);
    expect(
      gapButtons().map(button => button.closest("[data-roomy]") !== null)
    ).toEqual([true, true, true, true, true]);
  });

  it("puts a reversed column's gap between the edges that face it", async () => {
    // Drawn in reverse order: the first child below the second.
    BOXES["box-a"] = [0, 220, 300, 60];
    BOXES["box-b"] = [0, 160, 300, 40];
    BOXES["box-c"] = [0, 100, 300, 40];
    try {
      mount(ROW, { selectedId: "pricing" });
      await act(async () => undefined);
      const between = screen
        .getByRole("button", { name: "Add a block between Box A and Box B" })
        .closest(".nx-page-inserters__gap");
      if (!(between instanceof HTMLElement)) throw new Error("no gap");
      // Between Box B's bottom (200) and Box A's top (220), not inside A.
      expect(between.style.top).toBe("210px");
    } finally {
      BOXES["box-a"] = [0, 120, 300, 160];
      BOXES["box-b"] = [350, 120, 300, 160];
      BOXES["box-c"] = [700, 120, 300, 160];
    }
  });

  it("offers no gap beside a child the selected block clips out of sight", async () => {
    // Pricing is cut to its first 100px: Box B and Box C, stacked under Box
    // A, are drawn outside it, and a "+" between them would float over the
    // next section.
    BOXES.pricing = [0, 100, 1000, 100];
    BOXES["box-a"] = [0, 100, 1000, 100];
    BOXES["box-b"] = [0, 200, 1000, 100];
    BOXES["box-c"] = [0, 300, 1000, 100];
    try {
      mount(ROW, { selectedId: "pricing" });
      await act(async () => undefined);
      const pricing = document.querySelector<HTMLElement>(
        '[data-nx-node="pricing"]'
      );
      if (pricing === null) throw new Error("no pricing");
      pricing.style.overflow = "hidden";
      pricing.append(document.createElement("span"));
      await act(async () => undefined);
      expect(gapNames()).not.toContain("Add a block between Box A and Box B");
      expect(gapNames()).not.toContain("Add a block between Box B and Box C");
    } finally {
      BOXES.pricing = [0, 100, 1000, 200];
      BOXES["box-a"] = [0, 120, 300, 160];
      BOXES["box-b"] = [350, 120, 300, 160];
      BOXES["box-c"] = [700, 120, 300, 160];
    }
  });

  it("keeps a touch screen's + pressable wherever on it a finger lands", async () => {
    // A tap far from the line, on a roomy "+" a touch screen keeps shown: it
    // must not let go, or the "+" stays drawn and takes no further tap.
    mount(ROW, { selectedId: "pricing" });
    await act(async () => undefined);
    const button = gapButtons()[0];
    if (button === undefined) throw new Error("no gap");
    const touch = createEvent.pointerMove(button, {
      clientX: 500,
      clientY: 390,
    });
    Object.defineProperty(touch, "pointerType", { value: "touch" });
    fireEvent(button, touch);
    expect(button.style.pointerEvents).not.toBe("none");
  });

  it("offers no children's gaps with nothing selected", async () => {
    mount(ROW);
    await act(async () => undefined);
    expect(gapNames()).toEqual([
      "Add a block between Hero and Pricing",
      "Add a block between Pricing and Contact",
      "Add a block after Contact",
    ]);
  });

  it("shows a row's + only beside its line, inside the row", async () => {
    mount(ROW, { selectedId: "pricing" });
    await act(async () => undefined);
    const root = document.querySelector(".nx-canvas");
    if (root === null) throw new Error("no canvas");
    const near = () =>
      gapButtons().map(button => button.closest("[data-near]") !== null);
    // 2px right of the line between Box A and Box B, in the row.
    fireEvent.pointerMove(root, { clientX: 327, clientY: 200 });
    expect(near()).toEqual([false, true, false, false, false]);
    // On the same line, but above the row, in Hero: not that gap.
    fireEvent.pointerMove(root, { clientX: 325, clientY: 50 });
    expect(near()).toEqual([false, false, false, false, false]);
  });

  it("reports the Box before the gap when its + is pressed", async () => {
    const onAddAfter = vi.fn();
    mount(ROW, { selectedId: "pricing", onAddAfter });
    await act(async () => undefined);
    const button = gapButtons()[2];
    if (button === undefined) throw new Error("no gap");
    fireEvent.click(button);
    expect(onAddAfter).toHaveBeenCalledWith("box-b", button);
  });

  it("runs a gap across a column of children for the column's width", async () => {
    // The same Boxes stacked: a gap across, as wide as the two it is between.
    BOXES["box-b"] = [0, 160, 300, 40];
    BOXES["box-a"] = [0, 120, 300, 40];
    BOXES["box-c"] = [0, 200, 300, 40];
    try {
      mount(ROW, { selectedId: "pricing" });
      await act(async () => undefined);
      const between = gapButtons()[1]?.closest(".nx-page-inserters__gap");
      if (!(between instanceof HTMLElement)) throw new Error("no gap");
      expect(between.getAttribute("data-line")).toBe("across");
      expect(between.style.top).toBe("160px");
      expect(between.style.width).toBe("300px");
    } finally {
      BOXES["box-a"] = [0, 120, 300, 160];
      BOXES["box-b"] = [350, 120, 300, 160];
      BOXES["box-c"] = [700, 120, 300, 160];
    }
  });
});

describe("the + between blocks drawn shorter than it", () => {
  // A line of text at a zoomed-out canvas: 10.8px tall, stacked from the top.
  const TOPS: Record<string, number> = { story: 0, team: 10.8, contact: 21.6 };

  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const id = this.getAttribute("data-nx-node");
        return id !== null && id in TOPS
          ? new DOMRect(0, TOPS[id], 1000, 10.8)
          : new DOMRect(0, 0, 1000, 32.4);
      }
    );
  });

  /**
   * A pointer move on the "+" itself, `offsetY` down from its middle: the
   * stub above draws every element that is not a block 32.4px tall from the
   * window's top, so the "+"'s middle is at 16.2.
   */
  function moveOnPlus(button: HTMLElement, offsetY: number): void {
    fireEvent.pointerMove(button, { clientX: 500, clientY: 16.2 + offsetY });
  }

  it("never shows over a short block's middle, only right at the line", async () => {
    mount(THREE);
    await act(async () => undefined);
    const root = document.querySelector(".nx-canvas");
    if (root === null) throw new Error("no canvas");
    const near = () =>
      gapButtons().map(button => button.closest("[data-near]") !== null);
    // The middle of the second block, 5.4px from either edge: not near, so a
    // press there selects the block.
    fireEvent.pointerMove(root, { clientX: 500, clientY: 16.2 });
    expect(near()).toEqual([false, false, false]);
    // 2px from the line between the first two: near.
    fireEvent.pointerMove(root, { clientX: 500, clientY: 12.8 });
    expect(near()).toEqual([true, false, false]);
  });

  it("lets go of the + as the pointer on it moves towards a block's middle", async () => {
    mount(THREE);
    await act(async () => undefined);
    const [first] = gapButtons();
    if (first === undefined) throw new Error("no gap");
    const shown = () => first.closest("[data-near]") !== null;
    // On the "+", by its line.
    moveOnPlus(first, 1);
    expect(shown()).toBe(true);
    // Further down the "+", over the next block's middle: let go.
    moveOnPlus(first, 6);
    expect(shown()).toBe(false);
  });

  it("keeps a touch screen's + only where the blocks beside it are as deep as it", async () => {
    mount(THREE);
    await act(async () => undefined);
    expect(
      gapButtons().map(button => button.closest("[data-roomy]") !== null)
    ).toEqual([false, false, false]);
  });
});
