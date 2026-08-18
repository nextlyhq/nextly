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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

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
      { ...base, name: "core/heading", editor: { label: "Heading" } },
      {
        ...base,
        name: "core/box",
        editor: { label: "Box" },
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

function Host({ document }: { document: BlockDocument }): React.JSX.Element {
  const editor = useEditorState({ initialDocument: document });
  editorRef = editor;
  return <LayersPanel editor={editor} />;
}

function renderPanel(document: BlockDocument = nestedDocument()) {
  register();
  return render(<Host document={document} />);
}

/** The rows currently on screen, by their accessible name. */
function rows(): string[] {
  return screen
    .queryAllByRole("treeitem")
    .map(element => element.textContent ?? "");
}

describe("LayersPanel", () => {
  it("shows the top level, and hides what is inside a collapsed block", () => {
    // The precondition for everything below. An assertion that a nested row is
    // ABSENT is satisfied by a panel that renders nothing at all, so the rows
    // that must be present are asserted first.
    renderPanel();

    expect(rows().some(text => text.includes("Hero"))).toBe(true);
    expect(rows().some(text => text.includes("Footnote"))).toBe(true);
    expect(rows().some(text => text.includes("Title"))).toBe(false);
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
