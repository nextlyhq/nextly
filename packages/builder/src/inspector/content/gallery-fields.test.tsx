// @vitest-environment jsdom

/**
 * A Gallery in the settings panel, and a picture inside one, with the real
 * editor and the core blocks:
 *
 * - Pictures › "+ Add images" opens the library to pick several, and adds
 *   one Image per pick, in pick order, as one step to undo;
 * - Layout › "Columns" and "On mobile" tiles write the gallery's own style
 *   values, read 3 and 1 with nothing stored, and are held by a design lock;
 *   "When clicked: Nothing / Enlarge" follows them in the same section;
 * - a picture's "When clicked" reads "Same as the gallery (Enlarge)" while
 *   it says nothing itself, and choosing that again clears its own choice;
 * - a picture's panel is titled "Picture N · in <gallery>", with
 *   "← Back to the gallery".
 *
 * @module gallery-fields.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  findNode,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ContentServices, MediaPickerProps } from "./content-services";
import { useEditorState, type EditorState } from "../../editor-state";
import { InspectorPanel } from "../inspector-panel";
import { readStyleValue } from "../../style-values";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  (window as unknown as Record<string, unknown>).ResizeObserver ??=
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

beforeEach(() => registerBlocks(coreBlocks as never, { source: "core" }));
afterEach(() => {
  cleanup();
  clearBlocks();
  picker = null;
});

const SITE: BreakpointSet = {
  viewport: [
    { id: "md", label: "Tablet", maxWidth: 1024 },
    { id: "sm", label: "Mobile", maxWidth: 640 },
  ],
  container: [],
};

/** The host's picker: records how it was opened, and picks when told. */
let picker: MediaPickerProps | null = null;
function FakePicker(props: MediaPickerProps): React.JSX.Element {
  picker = props;
  return <div role="dialog" aria-label={props.title} />;
}
const SERVICES: ContentServices = { MediaPicker: FakePicker };

const picture = (
  id: string,
  props: Record<string, unknown> = {}
): BlockNode => ({
  id,
  type: "core/image",
  version: 1,
  props: { mediaId: `media-${id}`, ...props },
});

function gallery(
  children: BlockNode[],
  extra: Partial<BlockNode> = {}
): BlockNode {
  return {
    id: "g",
    type: "core/gallery",
    version: 1,
    props: { as: "div" },
    slots: { children },
    ...extra,
  };
}

const page = (...nodes: BlockNode[]): BlockDocument => ({
  formatVersion: 1,
  kind: "page",
  nodes,
});

let editorRef: EditorState | null = null;
function editor(): EditorState {
  if (editorRef === null) throw new Error("no editor rendered");
  return editorRef;
}

function Host({
  document,
  breakpoints = SITE,
}: {
  document: BlockDocument;
  breakpoints?: BreakpointSet;
}): React.JSX.Element {
  const state = useEditorState({ initialDocument: document });
  editorRef = state;
  return (
    <InspectorPanel
      editor={state}
      contentServices={SERVICES}
      breakpoints={breakpoints}
    />
  );
}

/** Mount the panel over `document` with `selected` selected. */
function mount(
  document: BlockDocument,
  selected: string,
  breakpoints?: BreakpointSet
) {
  render(
    <Host
      document={document}
      {...(breakpoints === undefined ? {} : { breakpoints })}
    />
  );
  act(() => editor().select(selected));
}

const galleryNode = () => findNode(editor().document.nodes, "g");
const pictures = () => galleryNode()?.slots?.children ?? [];
const templateAt = (breakpoint: string) =>
  readStyleValue(galleryNode()?.styles, {
    state: "base",
    breakpoint,
    property: "gridTemplateColumns",
    path: [],
  });

/** A radio group of the Content tab by its name, hidden or not. */
function group(name: string): HTMLElement {
  return screen.getByRole("radiogroup", { name, hidden: true });
}
function radio(groupName: string, name: string): HTMLElement {
  return within(group(groupName)).getByRole("radio", { name, hidden: true });
}

describe("a Gallery's Pictures", () => {
  it("opens the library to pick several, and adds one Image per pick, in pick order, as one step", () => {
    mount(page(gallery([picture("p1")])), "g");
    fireEvent.click(
      screen.getByRole("button", { name: "Add images", hidden: true })
    );
    expect(picker?.mode).toBe("multi");
    expect(picker?.accept).toBe("image/*");
    act(() => picker?.onSelect([{ id: "m3" }, { id: "m1" }, { id: "m2" }]));
    expect(pictures().map(each => each.props.mediaId)).toEqual([
      "media-p1",
      "m3",
      "m1",
      "m2",
    ]);
    expect(
      pictures()
        .slice(1)
        .every(each => each.type === "core/image")
    ).toBe(true);
    // One undo takes the whole add back.
    act(() => {
      void editor().undo();
    });
    expect(pictures().map(each => each.props.mediaId)).toEqual(["media-p1"]);
  });
});

describe("a Gallery's Layout", () => {
  it("reads Columns 3 and On mobile 1 with nothing stored, and has When clicked as Nothing / Enlarge beside them", () => {
    mount(page(gallery([])), "g");
    expect(radio("Columns", "3").getAttribute("aria-checked")).toBe("true");
    expect(radio("On mobile", "1").getAttribute("aria-checked")).toBe("true");
    const clicked = group("When clicked");
    expect(
      within(clicked)
        .getAllByRole("radio", { hidden: true })
        .map(each => each.textContent)
    ).toEqual(["Nothing", "Enlarge"]);
    // All three in one section, Layout.
    const section = clicked.closest("[data-section]");
    expect(section).not.toBeNull();
    expect(section?.contains(group("Columns"))).toBe(true);
  });

  it("writes Columns at the base values with On mobile's 1 at the phone tier as one step, and On mobile at the phone tier", () => {
    mount(page(gallery([])), "g");
    fireEvent.click(radio("Columns", "4"));
    expect(templateAt(BASE_BREAKPOINT)).toBe("repeat(4, minmax(0, 1fr))");
    expect(templateAt("sm")).toBe("repeat(1, minmax(0, 1fr))");
    expect(radio("Columns", "4").getAttribute("aria-checked")).toBe("true");
    act(() => {
      void editor().undo();
    });
    expect(templateAt(BASE_BREAKPOINT)).toBeUndefined();
    expect(templateAt("sm")).toBeUndefined();

    fireEvent.click(radio("On mobile", "2"));
    expect(templateAt("sm")).toBe("repeat(2, minmax(0, 1fr))");
    expect(templateAt(BASE_BREAKPOINT)).toBeUndefined();
  });

  it("offers no On mobile where the site has no tier at a phone's width", () => {
    mount(page(gallery([])), "g", {
      viewport: [{ id: "md", label: "Tablet", maxWidth: 1024 }],
      container: [],
    });
    expect(group("Columns")).toBeTruthy();
    expect(
      screen.queryByRole("radiogroup", { name: "On mobile", hidden: true })
    ).toBeNull();
  });

  it("writes nothing while a lock holds the gallery's design", () => {
    mount(page(gallery([], { locked: true } as Partial<BlockNode>)), "g");
    // Drawn held, pointing at the reason, and refused by the store too.
    expect(radio("Columns", "2").closest("fieldset[disabled]")).not.toBeNull();
    expect(
      radio("On mobile", "2").closest("fieldset[disabled]")
    ).not.toBeNull();
    fireEvent.click(radio("Columns", "2"));
    expect(galleryNode()?.styles).toBeUndefined();
  });
});

describe("a picture inside a gallery", () => {
  it("reads When clicked as Same as the gallery (Enlarge) while it says nothing itself, and chooses back to it", () => {
    mount(
      page(
        gallery([picture("p1"), picture("p2")], {
          props: { as: "div", whenClicked: "enlarge" },
        })
      ),
      "p2"
    );
    const follow = radio("When clicked", "Same as the gallery (Enlarge)");
    expect(follow.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(radio("When clicked", "Nothing"));
    expect(findNode(editor().document.nodes, "p2")?.props.whenClicked).toBe(
      "nothing"
    );
    expect(
      radio("When clicked", "Same as the gallery (Enlarge)").getAttribute(
        "aria-checked"
      )
    ).toBe("false");
    fireEvent.click(radio("When clicked", "Same as the gallery (Enlarge)"));
    expect(
      Object.hasOwn(
        findNode(editor().document.nodes, "p2")?.props ?? {},
        "whenClicked"
      )
    ).toBe(false);
  });

  it("reads Same as the gallery (Nothing) in a gallery that says nothing, and a linked picture still reads Link", () => {
    mount(
      page(gallery([picture("p1"), picture("p2", { href: "/about" })])),
      "p1"
    );
    expect(
      radio("When clicked", "Same as the gallery (Nothing)").getAttribute(
        "aria-checked"
      )
    ).toBe("true");
    act(() => editor().select("p2"));
    expect(radio("When clicked", "Link").getAttribute("aria-checked")).toBe(
      "true"
    );
  });

  it("offers no Same as the gallery to a picture holding a link it would follow, by address or by entry", () => {
    mount(
      page(
        gallery(
          [
            picture("p1", { href: "/about" }),
            picture("p2", { entryCollection: "posts", entryId: "post-1" }),
            picture("p3"),
          ],
          { props: { as: "div", whenClicked: "enlarge" } }
        )
      ),
      "p1"
    );
    const choices = () =>
      within(group("When clicked"))
        .getAllByRole("radio", { hidden: true })
        .map(each => each.textContent);
    expect(choices()).toEqual(["Nothing", "Link", "Enlarge"]);
    expect(radio("When clicked", "Link").getAttribute("aria-checked")).toBe(
      "true"
    );
    act(() => editor().select("p2"));
    expect(choices()).toEqual(["Nothing", "Link", "Enlarge"]);
    expect(radio("When clicked", "Link").getAttribute("aria-checked")).toBe(
      "true"
    );
    // The control: one with no link is offered it, first.
    act(() => editor().select("p3"));
    expect(choices()).toEqual([
      "Same as the gallery (Enlarge)",
      "Nothing",
      "Link",
      "Enlarge",
    ]);
  });

  it("offers no Same as the gallery to a linked picture that chose Enlarge, since clearing it would read as Link", () => {
    mount(
      page(
        gallery([picture("p1", { href: "/about", whenClicked: "enlarge" })], {
          props: { as: "div", whenClicked: "enlarge" },
        })
      ),
      "p1"
    );
    expect(
      within(group("When clicked"))
        .getAllByRole("radio", { hidden: true })
        .map(each => each.textContent)
    ).toEqual(["Nothing", "Link", "Enlarge"]);
  });

  it("is titled Picture N · in the gallery, with a way back to the gallery", () => {
    mount(
      page(gallery([picture("p1"), picture("p2")], { name: "Team photos" })),
      "p2"
    );
    const card = document.querySelector("[data-block-card]");
    expect(card?.querySelector("h2")?.textContent).toBe(
      "Picture 2 · in Team photos"
    );
    fireEvent.click(
      screen.getByRole("button", { name: "← Back to the gallery" })
    );
    expect(editor().selectedId).toBe("g");
    // The gallery's own card, by its own name.
    expect(document.querySelector("[data-block-card] h2")?.textContent).toBe(
      "Team photos · Gallery"
    );
  });

  it("keeps an Image outside a gallery titled as an Image, with no way back", () => {
    mount(page(picture("lone")), "lone");
    expect(document.querySelector("[data-block-card] h2")?.textContent).toBe(
      "Image"
    );
    expect(
      screen.queryByRole("button", { name: "← Back to the gallery" })
    ).toBeNull();
  });
});
