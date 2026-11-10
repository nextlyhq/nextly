// @vitest-environment jsdom

/**
 * The layers panel, driven through a host that renders it against a real editor.
 *
 * What is only true HERE is the part `layers.ts` cannot decide: which branches
 * are open, and who is allowed to close them. The tree, its labels and its
 * filter are asserted there, without a DOM.
 *
 * The expansion rules are the reason this file exists. Each of the three things
 * that open a branch — the author, a selection, a search — is correct alone and
 * wrong when they share one derived set, and the failure is not visible from
 * either module's own tests.
 *
 * @module layers-panel.test
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { renderToStaticMarkup } from "react-dom/server";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";

import { PreviewedEntryProvider } from "./previewed-entry";
import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { keyHint } from "./key-hint";
import { MOVE_KEYS } from "./keyboard-actions";
import { LAYERS_DEPTH_PX } from "./layers-drop";
import { LayersPanel } from "./layers-panel";
import { useEditorState, type EditorState } from "./editor-state";

afterEach(() => {
  cleanup();
  clearBlocks();
});

beforeAll(() => {
  // The tree virtualizes, so it measures its scroll container and observes
  // resizes. jsdom provides neither, and without them the render throws before
  // any assertion runs.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  // Every element reports zero size in jsdom, and a virtualizer told its
  // viewport is zero pixels tall renders no rows at all — so the panel would
  // be empty for a reason that has nothing to do with the panel.
  Object.defineProperty(window.HTMLElement.prototype, "clientHeight", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 800,
  });
});

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

function register() {
  if (hasBlock("core/heading")) return;
  registerBlocks(
    [
      {
        ...base,
        name: "core/heading",
        editor: { label: "Heading", icon: "heading" },
      },
      {
        ...base,
        name: "core/box",
        editor: { label: "Box", icon: "container" },
        slots: { children: {} },
      },
    ] as never,
    { source: "layers-panel-test" }
  );
}

function node(
  id: string,
  type: string,
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id, type, version: 1, props: {}, ...extra } as BlockNode;
}

/** A box holding a heading, plus a sibling heading at the top level. */
function nestedDocument(): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      node("box", "core/box", {
        name: "Hero",
        slots: { children: [node("inner", "core/heading", { name: "Title" })] },
      }),
      node("loose", "core/heading", { name: "Footnote" }),
    ],
  } as BlockDocument;
}

let editorRef: EditorState | null = null;

function Host({
  document,
  keys = "bound",
  regions,
  componentTitle,
}: {
  document: BlockDocument;
  keys?: "bound" | "disabled" | "absent";
  regions?: React.ComponentProps<typeof LayersPanel>["regions"];
  componentTitle?: React.ComponentProps<typeof LayersPanel>["componentTitle"];
}): React.JSX.Element {
  const editor = useEditorState({ initialDocument: document });
  editorRef = editor;
  /*
   * No shortcut provider around it, deliberately.
   *
   * This component is exported and a host may mount it on its own, so it must
   * render without one. A harness that always supplied a provider could not
   * tell that apart from a panel that requires one.
   */
  return (
    <LayersPanel
      editor={editor}
      moveHints={keys === "bound"}
      regions={regions}
      componentTitle={componentTitle}
    />
  );
}

function renderPanel(
  document: BlockDocument = nestedDocument(),
  keys: "bound" | "disabled" | "absent" = "bound"
) {
  register();
  return render(<Host document={document} keys={keys} />);
}

/**
 * The legend, found the way assistive technology finds it.
 *
 * Through the tree's own `aria-describedby` rather than by a known id: the id
 * is per instance now, so a fixed one would be a second answer to which element
 * describes this tree — and looking it up by that fixed name is exactly what
 * would keep passing if the wiring broke.
 */
function hintFor(tree: HTMLElement): HTMLElement | null {
  const id = tree.getAttribute("aria-describedby");
  return id === null ? null : window.document.getElementById(id);
}

/** The rows currently on screen, by their accessible name. */
function rows(): string[] {
  return screen
    .queryAllByRole("treeitem")
    .map(element => element.textContent ?? "");
}

describe("LayersPanel", () => {
  it("names a component placement by its component's title, and finds it by it", () => {
    register();
    render(
      <Host
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [
              node("hero", "nextly/component-instance", {
                props: { componentId: "cmp-hero" },
              }),
              node("other", "nextly/component-instance", {
                props: { componentId: "cmp-gone" },
              }),
            ],
          } as BlockDocument
        }
        componentTitle={id => (id === "cmp-hero" ? "Hero banner" : undefined)}
      />
    );

    // Named, and marked as a component in words as well as by its mark, so the
    // title is not mistaken for a block's own name. The fallback is already
    // the word, so it carries no second one.
    const label = (id: string) =>
      window.document.querySelector(`[data-nx-layer="${id}"]`)?.textContent;
    const tags = () =>
      [...window.document.querySelectorAll(".nx-layer-row__tag")].map(
        tag => tag.textContent
      );
    expect(label("hero")).toBe("Hero banner");
    expect(label("other")).toBe("Component");
    expect(tags()).toEqual(["component"]);
    expect(
      window.document.querySelectorAll(".nx-layer-row[data-component]")
    ).toHaveLength(2);

    React.act(() => {
      fireEvent.change(screen.getByLabelText("Search layers"), {
        target: { value: "hero" },
      });
    });
    expect(screen.getAllByRole("treeitem")).toHaveLength(1);
    expect(label("hero")).toBe("Hero banner");
  });

  it("says how to reorder, in the keys this platform carries", () => {
    /*
     * The bindings already work while this panel holds focus — the tree takes
     * the keystroke and the editor acts on the selection — so what was missing
     * was never the capability, only any way to find it.
     */
    renderPanel();

    const hint = hintFor(screen.getByRole("tree"));
    expect(hint).not.toBeNull();
    // The DESCRIPTION every binding already carries, not a second wording.
    expect(hint?.textContent).toContain("Move the selected block up");
    expect(hint?.textContent).toContain("Move the selected block out of its");
  });

  it("derives the hint from the bindings rather than restating them", () => {
    /*
     * The property that matters, and the one a fixed string cannot have: every
     * binding the editor registers is named here, and nothing else is. A
     * retyped legend passes an assertion about its own text on the day it is
     * written and teaches a dead keystroke the day someone rebinds one.
     */
    renderPanel();

    const hint = hintFor(screen.getByRole("tree"));
    const rendered = Array.from(
      hint?.querySelectorAll(".nx-layers-panel__hint-row") ?? []
    );
    expect(rendered).toHaveLength(MOVE_KEYS.length);
    MOVE_KEYS.forEach(({ keys, description }, index) => {
      const shown = keyHint(keys, false);
      expect(shown).not.toBeNull();
      const row = rendered[index];
      /*
       * The KEY as drawn, beside its own description. Asserting only that the
       * descriptions appear leaves the keystrokes unchecked, so a legend that
       * iterated these bindings and printed fixed labels beside them would
       * pass — which is the exact implementation this claims not to be.
       */
      expect(
        row?.querySelector(".nx-layers-panel__hint-key")?.textContent
      ).toBe(shown);
      expect(row?.textContent).toContain(description);
    });
    // As many keystrokes drawn as there are bindings, so a binding added to the
    // table cannot quietly go unmentioned here.
    expect(hint?.querySelectorAll(".nx-layers-panel__hint-key").length).toBe(
      MOVE_KEYS.length
    );
  });

  it("emits no keystroke at all in a SERVER render", () => {
    /*
     * The hydration case, and the only place it is observable.
     *
     * `detectApplePlatform` reads `navigator`, which a server does not have, so
     * it answers false there — a server would emit `Alt` and the first browser
     * render `⌥`, React would find markup it did not produce, and it would
     * throw the subtree away.
     *
     * No test in this file can see that: jsdom always HAS a `navigator`, so
     * resolving the platform during render gives the same answer as resolving
     * it after mounting, and every case above passes either way. Rendering to
     * a string is what removes the browser from the question — effects do not
     * run there, which is exactly the condition the server is in.
     */
    register();
    const html = renderToStaticMarkup(<Host document={nestedDocument()} />);

    expect(html).not.toContain("Move up");
    expect(html).not.toContain("Alt");
    expect(html).not.toContain("\u2325");
  });

  it("gives each panel its own description to point at", () => {
    /*
     * A host can mount two editors on one page. With a fixed id both trees
     * point at the same element and the lookup is ambiguous, so assistive
     * technology can read one panel's tree the OTHER panel's description —
     * which is worse than no description, because it is confidently wrong.
     *
     * Two panels is the whole of the case: one panel with a fixed id behaves
     * perfectly, which is why a single-panel fixture cannot see this.
     */
    register();
    /*
     * BOTH bound. With one panel unbound its description is absent, so the
     * comparison is against a `null` that differs from anything — green with a
     * shared constant id, which is the regression this is for.
     */
    render(
      <>
        <Host document={nestedDocument()} keys="bound" />
        <Host document={nestedDocument()} keys="bound" />
      </>
    );

    const [first, second] = screen.getAllByRole("tree");
    if (first === undefined || second === undefined) {
      throw new Error("expected two trees");
    }
    const firstId = first.getAttribute("aria-describedby");
    const secondId = second.getAttribute("aria-describedby");
    expect(firstId).not.toBeNull();
    expect(secondId).not.toBeNull();
    expect(firstId).not.toBe(secondId);
    // And each id resolves to a legend inside ITS OWN panel — two different
    // strings alone do not establish that either points at the right element.
    for (const tree of [first, second]) {
      const hint = hintFor(tree);
      expect(hint).not.toBeNull();
      expect(hint?.closest(".nx-layers-panel")).toBe(
        tree.closest(".nx-layers-panel")
      );
    }
  });

  it("says nothing about keys nothing is listening for", () => {
    /*
     * A host may mount this panel with no bindings above it at all. Advertising
     * the keystrokes there is not a cosmetic slip — it is the editor telling an
     * author to press something that does nothing, which is worse than the
     * silence this replaced, because silence at least does not mislead.
     */
    renderPanel(nestedDocument(), "absent");

    expect(hintFor(screen.getByRole("tree"))).toBeNull();
    expect(
      screen.getByRole("tree").getAttribute("aria-describedby")
    ).toBeNull();
  });

  it("says nothing while the bindings are turned off", () => {
    /*
     * The other way the same claim goes false, and the one a presence check
     * alone would miss: the provider IS above this, and a host has disabled it
     * because something modal is over the canvas. The keystrokes reach nothing
     * until it closes.
     */
    renderPanel(nestedDocument(), "disabled");

    expect(hintFor(screen.getByRole("tree"))).toBeNull();
  });

  it("makes the hint the tree's own description", () => {
    /*
     * Text near the tree is read by whoever can see it. As the tree's
     * description it is announced on entering the tree, which is the moment an
     * author asks the question it answers.
     */
    renderPanel();

    const tree = screen.getByRole("tree");
    const id = tree.getAttribute("aria-describedby");
    expect(id).not.toBeNull();
    // It points at an element that EXISTS and is the legend, which a bare
    // string comparison against a known id never established.
    expect(
      hintFor(tree)?.querySelectorAll(".nx-layers-panel__hint-row").length
    ).toBe(MOVE_KEYS.length);
  });

  it("shows the top level, and hides what is inside a collapsed block", () => {
    // The precondition for everything below. An assertion that a nested row is
    // ABSENT is satisfied by a panel that renders nothing at all, so the rows
    // that must be present are asserted first.
    renderPanel();

    expect(rows().some(text => text.includes("Hero"))).toBe(true);
    expect(rows().some(text => text.includes("Footnote"))).toBe(true);
    expect(rows().some(text => text.includes("Title"))).toBe(false);
  });

  it("draws each row the mark ITS OWN block declares", () => {
    /*
     * A layer node carries the block's type and nothing about its definition,
     * so the panel resolves the mark through the registry. The property that
     * separates a working resolution from a broken one is that two rows of
     * DIFFERENT types draw DIFFERENT marks — every row drawing the fallback
     * satisfies any count of marks, and a count is what a first draft of this
     * test asserted.
     *
     * Population first: both rows are on screen before either mark is judged.
     */
    renderPanel();
    const hero = screen
      .queryAllByRole("treeitem")
      .find(row => (row.textContent ?? "").includes("Hero"));
    const footnote = screen
      .queryAllByRole("treeitem")
      .find(row => (row.textContent ?? "").includes("Footnote"));
    expect(hero).toBeDefined();
    expect(footnote).toBeDefined();

    const markOf = (row: Element | undefined): string =>
      row?.querySelector(".nx-block-icon svg")?.getAttribute("class") ?? "";

    // `core/box` names "container" and `core/heading` names "heading", so the
    // two rows cannot be drawing the same glyph unless the lookup failed.
    expect(markOf(hero)).not.toBe("");
    expect(markOf(footnote)).not.toBe("");
    expect(markOf(hero)).not.toBe(markOf(footnote));

    // And neither is the fallback, which is what a lookup that found nothing
    // would draw for BOTH — indistinguishable from the above if the two blocks
    // had happened to name one concept.
    expect(markOf(hero)).not.toContain("lucide-blocks");
    expect(markOf(footnote)).not.toContain("lucide-blocks");
  });

  it("opens a selection's ancestors so a canvas click is visible here", () => {
    // A block selected on the canvas inside a collapsed container would
    // otherwise be highlighted in a tree showing none of it, which reads as the
    // panel ignoring the click.
    renderPanel();

    React.act(() => {
      editorRef?.select("inner");
    });

    expect(rows().some(text => text.includes("Title"))).toBe(true);
  });

  it("lets the author close a branch the SELECTION opened", () => {
    // THE case. Merging the selection's ancestors into the expanded set at
    // render makes this impossible: the author collapses the branch, the next
    // render puts it straight back, and an ancestor of the selected block can
    // never be closed.
    renderPanel();
    React.act(() => {
      editorRef?.select("inner");
    });
    expect(rows().some(text => text.includes("Title"))).toBe(true);

    // Two presses, which is what a keyboard user does. The tab stop follows the
    // SELECTION, so the first Left climbs from the selected child to its parent
    // — the APG move for a row with no children — and the second collapses it.
    // One press would leave the branch open and the test would be asserting
    // that the wrong row did nothing.
    const tree = screen.getByRole("tree");
    React.act(() => {
      fireEvent.keyDown(tree, { key: "ArrowLeft" });
    });
    React.act(() => {
      fireEvent.keyDown(tree, { key: "ArrowLeft" });
    });

    expect(rows().some(text => text.includes("Title"))).toBe(false);
  });

  it("selects the editor's node when a row is chosen", () => {
    renderPanel();

    const footnote = screen
      .getAllByRole("treeitem")
      .find(element => (element.textContent ?? "").includes("Footnote"));
    if (footnote === undefined) throw new Error("the Footnote row is missing");
    React.act(() => {
      fireEvent.click(footnote);
    });

    expect(editorRef?.selectedId).toBe("loose");
  });

  it("reveals a buried match while searching, and hides it again after", () => {
    // Search is a way of LOOKING. Storing the branches it opens would leave the
    // tree rearranged by a query the author has already cleared.
    renderPanel();
    const search = screen.getByLabelText("Search layers");

    React.act(() => {
      fireEvent.change(search, { target: { value: "Title" } });
    });
    expect(rows().some(text => text.includes("Title"))).toBe(true);

    React.act(() => {
      fireEvent.change(search, { target: { value: "" } });
    });
    expect(rows().some(text => text.includes("Title"))).toBe(false);
  });

  it("does not bake a search's branches into what the author has open", () => {
    // The case the test above CANNOT reach. The temporary branches are dropped
    // when the tree reports a new expanded set, and it only reports one when the
    // author toggles something — so a search followed by no interaction never
    // exercises the filter at all. Here the author collapses an unrelated branch
    // during the search, which is what makes the tree report, and the assertion
    // is that clearing the query still closes what only the search had opened.
    renderPanel();
    const search = screen.getByLabelText("Search layers");

    React.act(() => {
      fireEvent.change(search, { target: { value: "Title" } });
    });
    expect(rows().some(text => text.includes("Title"))).toBe(true);

    // Any author-driven expansion change while the query stands.
    const tree = screen.getByRole("tree");
    React.act(() => {
      fireEvent.keyDown(tree, { key: "*" });
    });

    React.act(() => {
      fireEvent.change(search, { target: { value: "" } });
    });

    expect(rows().some(text => text.includes("Title"))).toBe(false);
  });

  it("says so when nothing matches, rather than showing an empty tree", () => {
    renderPanel();

    React.act(() => {
      fireEvent.change(screen.getByLabelText("Search layers"), {
        target: { value: "zzzz" },
      });
    });

    // `getByText` throws when absent, so reaching the assertion is the
    // evidence; the assertion pins that it is the panel note rather than a row.
    expect(screen.getByText(/no blocks match/i).className).toContain(
      "nx-layers-panel__note"
    );
  });

  it("names a locked block as locked, in text rather than by an icon alone", () => {
    // An icon with no accessible name announces as an image called nothing, so
    // the badge ships the word and clips it visually.
    render(
      <Host
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [node("a", "core/heading", { locked: true })],
          } as BlockDocument
        }
      />
    );
    register();

    expect(screen.getAllByRole("treeitem")[0]?.textContent ?? "").toMatch(
      /locked/i
    );
  });

  it("names a row inside a locked block as locked BY that block, quieter than its own", () => {
    // A lock covers everything inside the block: each row inside says so in
    // words, naming the block to unlock, and only the locked block's own row
    // carries the stronger badge.
    render(
      <Host
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [
              node("hero", "core/heading", {
                locked: true,
                name: "Hero",
                slots: {
                  children: [
                    node("inner", "core/heading", {
                      slots: { children: [node("deep", "core/heading")] },
                    }),
                  ],
                },
              }),
            ],
          } as BlockDocument
        }
      />
    );
    register();
    fireEvent.keyDown(screen.getAllByRole("treeitem")[0]!, { key: "*" });

    const [hero, inner] = screen.getAllByRole("treeitem");
    expect(hero?.querySelector('[data-lock="own"]')?.textContent).toBe(
      "Locked"
    );
    expect(inner?.textContent).toContain("Locked by Hero");
    expect(inner?.querySelector('[data-lock="own"]')).toBeNull();
    expect(inner?.querySelector('[data-lock="inherited"]')?.textContent).toBe(
      "Locked by Hero"
    );
  });

  it("offers to open only the rows that hold something", () => {
    // A row that opens onto nothing would show a twisty that does nothing,
    // and announce itself as a closed branch to a screen reader.
    renderPanel();
    const row = (name: string) =>
      screen
        .getAllByRole("treeitem")
        .find(element => element.textContent?.includes(name));
    expect(row("Hero")?.getAttribute("aria-expanded")).toBe("false");
    expect(row("Footnote")?.hasAttribute("aria-expanded")).toBe(false);
  });

  it("indents a level by exactly the distance a drag moves to nest one level", () => {
    // The drop line is drawn at a depth by the tree's indent, and the pointer
    // reaches that depth by the drag's step: two different numbers would put
    // the line a level away from where the hand is.
    renderPanel();
    // Selecting the inner block opens the box, so both rows are drawn.
    act(() => editorRef?.select("inner"));
    const padding = (name: string): number => {
      const row = screen
        .getAllByRole("treeitem")
        .find(element => element.textContent?.includes(name));
      return Number.parseFloat(row?.style.paddingLeft ?? "NaN");
    };
    expect(padding("Title") - padding("Hero")).toBe(LAYERS_DEPTH_PX);
  });

  it("points an empty document at the panel that fills it", () => {
    renderPanel({
      formatVersion: 1,
      kind: "page",
      nodes: [],
    } as BlockDocument);

    expect(screen.getByText(/no blocks yet/i).className).toContain(
      "nx-layers-panel__note"
    );
  });
});

describe("the regions of the page's Layout in Layers", () => {
  function renderWithRegions() {
    register();
    const header = vi.fn();
    const footer = vi.fn();
    render(
      <Host
        document={nestedDocument()}
        regions={[
          {
            area: "footer",
            name: "Footer",
            origin: "from Layout Main",
            onActivate: footer,
          },
          {
            area: "header",
            name: "Header",
            origin: "from Layout Main",
            onActivate: header,
          },
        ]}
      />
    );
    return { header, footer };
  }

  it("shows the header above the page's blocks and the footer below them", () => {
    renderWithRegions();
    const header = screen.getByRole("button", {
      name: "Header, from Layout Main, locked",
    });
    const footer = screen.getByRole("button", {
      name: "Footer, from Layout Main, locked",
    });
    const tree = screen.getByRole("tree");
    expect(
      header.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      footer.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_PRECEDING
    ).toBeTruthy();
  });

  it("keeps them out of the tree: not rows that select, drag or lock", () => {
    renderWithRegions();
    expect(rows().some(row => row.includes("from Layout"))).toBe(false);
    const header = screen.getByRole("button", { name: /^Header/ });
    expect(header.closest("[role=tree]")).toBeNull();
    expect(header.getAttribute("draggable")).not.toBe("true");
  });

  it("shows the region on the canvas when activated", () => {
    const { header } = renderWithRegions();
    fireEvent.click(screen.getByRole("button", { name: /^Header/ }));
    expect(header).toHaveBeenCalledTimes(1);
  });
});

describe("a collection list's regions in Layers", () => {
  function listDocument(): BlockDocument {
    return {
      formatVersion: 1,
      kind: "page",
      nodes: [
        node("list", "core/collection-loop", {
          slots: {
            children: [node("card", "core/heading", { name: "Post card" })],
            empty: [],
          },
        }),
      ],
    } as BlockDocument;
  }

  function registerList(): void {
    register();
    if (hasBlock("core/collection-loop")) return;
    registerBlocks(
      [
        {
          ...base,
          name: "core/collection-loop",
          editor: { label: "Collection list", icon: "loop" },
          slots: { children: {}, empty: {} },
        },
      ] as never,
      { source: "layers-panel-test-list" }
    );
  }

  it("draws Each entry and When empty between the list and its blocks", async () => {
    registerList();
    render(<Host document={listDocument()} />);
    fireEvent.click(screen.getByRole("treeitem", { name: /Collection list/ }));
    fireEvent.keyDown(
      screen.getByRole("treeitem", { name: /Collection list/ }),
      {
        key: "ArrowRight",
      }
    );
    await waitFor(() =>
      expect(rows()).toEqual([
        "Collection list",
        "Each entry1 block",
        "When emptyempty",
      ])
    );
  });

  it("selects the list and shows its empty state when When empty is chosen", async () => {
    registerList();
    render(<Host document={listDocument()} />);
    const list = screen.getByRole("treeitem", { name: /Collection list/ });
    fireEvent.click(list);
    fireEvent.keyDown(list, { key: "ArrowRight" });
    const empty = await screen.findByRole("treeitem", { name: /When empty/ });
    fireEvent.click(empty);
    await waitFor(() => {
      expect(editorRef?.selectedId).toBe("list");
      expect([...(editorRef?.listsShowingEmpty ?? [])]).toEqual(["list"]);
    });
    fireEvent.click(screen.getByRole("treeitem", { name: /Each entry/ }));
    await waitFor(() => expect(editorRef?.listsShowingEmpty?.size).toBe(0));
  });

  it("opens the region a selection made elsewhere sits in", async () => {
    registerList();
    render(<Host document={listDocument()} />);
    act(() => editorRef?.select("card"));
    expect(
      await screen.findByRole("treeitem", { name: /Post card/ })
    ).toBeDefined();
  });

  it("shows a child's region on the canvas when the child is chosen in Layers", async () => {
    registerList();
    const document = listDocument();
    const list = document.nodes[0];
    if (list?.slots !== undefined) {
      list.slots.empty = [node("none", "core/heading", { name: "No posts" })];
    }
    render(<Host document={document} />);
    // Both regions opened, as a selection made elsewhere opens them.
    act(() => editorRef?.select("none"));
    act(() => editorRef?.select("card"));
    fireEvent.click(await screen.findByRole("treeitem", { name: /No posts/ }));
    await waitFor(() => {
      expect(editorRef?.selectedId).toBe("none");
      expect([...(editorRef?.listsShowingEmpty ?? [])]).toEqual(["list"]);
    });
    fireEvent.click(screen.getByRole("treeitem", { name: /Post card/ }));
    await waitFor(() => {
      expect(editorRef?.selectedId).toBe("card");
      expect(editorRef?.listsShowingEmpty?.size).toBe(0);
    });
  });

  it("selects a block whose id reads like a region row, not the list", async () => {
    registerList();
    // Any non-empty string is a valid id in a stored document, this one too.
    const tricky = "nx-slot:empty:list";
    const document = listDocument();
    const list = document.nodes[0];
    if (list?.slots !== undefined) {
      list.slots.empty = [node(tricky, "core/heading", { name: "Tricky" })];
    }
    render(<Host document={document} />);
    act(() => editorRef?.select(tricky));
    act(() => editorRef?.select("card"));
    fireEvent.click(await screen.findByRole("treeitem", { name: /Tricky/ }));
    await waitFor(() => expect(editorRef?.selectedId).toBe(tricky));
    // The region row is its own row still, and still selects the list.
    fireEvent.click(screen.getByRole("treeitem", { name: /When empty/ }));
    await waitFor(() => expect(editorRef?.selectedId).toBe("list"));
  });
});

describe("an Entry content block's row", () => {
  const collection = (fields: readonly { name: string; label: string }[]) => ({
    slug: "posts",
    singular: "post",
    plural: "Posts",
    blocksFields: fields,
    fieldLabel: (name: string) =>
      fields.find(each => each.name === name)?.label ?? `Words for ${name}`,
    entryHref: (id: string) => `/admin/collections/posts/${id}`,
  });

  function template(): BlockDocument {
    return {
      formatVersion: 1,
      kind: "template",
      nodes: [
        node("ec", "core/entry-content", { props: { field: "body" } }),
        node("loose", "core/heading", { name: "Footnote" }),
      ],
    } as BlockDocument;
  }

  it("names the field it draws, and no problem while the collection has it", () => {
    register();
    render(
      <PreviewedEntryProvider
        value={{ kind: "none", reason: "empty" }}
        collection={collection([{ name: "body", label: "Body" }])}
      >
        <Host document={template()} />
      </PreviewedEntryProvider>
    );
    const row = window.document.querySelector(
      '[data-nx-layer="ec"]'
    )?.parentElement;
    expect(row?.querySelector(".nx-layer-row__tag")?.textContent).toBe("Body");
    expect(row?.querySelector("[data-problem]")).toBeNull();
    // The control: the heading's row names no field.
    const other = window.document.querySelector(
      '[data-nx-layer="loose"]'
    )?.parentElement;
    expect(other?.querySelector(".nx-layer-row__tag")).toBeNull();
  });

  it("marks a problem, in words, where the collection no longer has the field", () => {
    register();
    render(
      <PreviewedEntryProvider
        value={{ kind: "none", reason: "empty" }}
        collection={collection([{ name: "sidebar", label: "Sidebar" }])}
      >
        <Host document={template()} />
      </PreviewedEntryProvider>
    );
    const row = window.document.querySelector(
      '[data-nx-layer="ec"]'
    )?.parentElement;
    const problem = row?.querySelector("[data-problem]");
    expect(problem?.textContent).toBe(
      "Words for body no longer exists in this collection"
    );
    expect(row?.querySelector(".nx-layer-row__tag")).toBeNull();
  });
});
