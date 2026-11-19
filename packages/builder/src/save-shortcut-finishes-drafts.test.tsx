// @vitest-environment jsdom

/**
 * Save pressed from the keyboard with focus still in a field stores what the
 * author typed there, in the Advanced tab, in a list's query and in a Layers
 * rename, as it does in every other field of the block.
 *
 * The page's save asks the editor to finish the field being edited first
 * (`finishFieldEdit`), which writes its draft as leaving the field would, and
 * then reads the document. These fields kept drafts the editor did not know
 * about, so a save read the document without them and reported success.
 *
 * The save here is the host's: a `mod+s` binding on the shell's shortcut
 * manager that finishes the field and then takes the document, as
 * `use-host-commit.ts` does. The editor is the real one, so what a save takes
 * is what the page holds. Each case types without leaving the field and
 * checks that focus is still there after the save.
 *
 * @module save-shortcut-finishes-drafts.test
 */
import {
  clearBlocks,
  COLLECTION_LIST_TYPE,
  defineNamedQuery,
  DOCUMENT_FORMAT_VERSION,
  findNode,
  namedQueryDeclaration,
  param,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { ShortcutProvider, useShortcuts } from "@nextlyhq/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { LoopCollection } from "./inspector/content/content-controls";
import { useEditorState, type EditorState } from "./editor-state";
import { finishFieldEdit } from "./field-edit";
import { InspectorPanel } from "./inspector/inspector-panel";
import type { CustomSource } from "./inspector/content/named-query-model";
import { LayersPanel } from "./panels/layers/layers-panel";

beforeAll(() => {
  // Radix measures and scrolls, and the Layers tree virtualizes; jsdom has
  // no layout, so each is given what it reads.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  Object.defineProperty(window.HTMLElement.prototype, "clientHeight", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 800,
  });
});

afterEach(() => {
  cleanup();
  clearBlocks();
  saved.length = 0;
  editorRef = null;
});

let editorRef: EditorState | null = null;
const editor = (): EditorState => {
  if (editorRef === null) throw new Error("no editor rendered");
  return editorRef;
};

/** The documents each save took, in order. */
const saved: BlockDocument[] = [];

/**
 * The host's save: the field being edited finished, then the document
 * taken. Read through the ref, since the field's write lands in a render
 * this binding's closure predates.
 */
function SaveShortcut(): null {
  useShortcuts(
    [
      {
        keys: "mod+s",
        description: "Save",
        run: () => {
          finishFieldEdit();
          saved.push(editor().document);
        },
      },
    ],
    { name: "save-shortcut-test" }
  );
  return null;
}

/** An editor on `document`, with the save, drawing `children` for it. */
function Host({
  document,
  children,
}: {
  document: BlockDocument;
  children: (editor: EditorState) => React.ReactNode;
}): React.JSX.Element {
  const state = useEditorState({ initialDocument: document });
  editorRef = state;
  return (
    <ShortcutProvider>
      <SaveShortcut />
      {children(state)}
    </ShortcutProvider>
  );
}

/** Save from the keyboard, pressed in `field`. */
function pressSave(field: HTMLElement): void {
  // `mod` is Control off an Apple keyboard, which jsdom is not.
  act(() => {
    fireEvent.keyDown(field, { key: "s", ctrlKey: true });
  });
}

/** What the one save took. */
function theSave(): BlockDocument {
  expect(saved).toHaveLength(1);
  const [document] = saved;
  if (document === undefined) throw new Error("nothing saved");
  return document;
}

function coreNode(id: string, type: string, props = {}): BlockNode {
  const block = coreBlocks.find(each => each.name === type);
  if (block === undefined) throw new Error(`${type} is not a core block`);
  return { id, type, version: block.version, props } as BlockNode;
}

function page(...nodes: BlockNode[]): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  } as BlockDocument;
}

describe("the Advanced tab", () => {
  /** The section's Advanced tab, its HTML section open. */
  function advancedHtml(): HTMLElement {
    registerBlocks(coreBlocks as never, { source: "core" });
    render(
      <Host
        document={page(coreNode("hero", "core/section", { as: "section" }))}
      >
        {state => <InspectorPanel editor={state} />}
      </Host>
    );
    act(() => editor().select("hero"));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));
    const advanced = screen.getByRole("tabpanel", { name: "Advanced" });
    const header = advanced.querySelector<HTMLElement>(
      '[data-section="html"] [data-slot="accordion-trigger"]'
    );
    if (header !== null && header.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(header);
    }
    return within(advanced).getByRole("region", { name: /^HTML/ });
  }

  it("saves the anchor being typed", () => {
    const html = advancedHtml();
    const field = within(html).getByLabelText("Anchor (ID)");
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "pricing" } });
    pressSave(field);
    expect(findNode(theSave().nodes, "hero")?.cssId).toBe("pricing");
    expect(document.activeElement).toBe(field);
  });

  it("saves the CSS classes being typed", () => {
    const html = advancedHtml();
    const field = within(html).getByLabelText("CSS classes");
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "wide dark" } });
    pressSave(field);
    expect(findNode(theSave().nodes, "hero")?.cssClasses).toBe("wide dark");
    expect(document.activeElement).toBe(field);
  });

  it("saves the attribute being typed", () => {
    const html = advancedHtml();
    fireEvent.click(
      within(html).getByRole("button", { name: /Add attribute/ })
    );
    const name = within(html).getByLabelText("Name of attribute 1");
    act(() => name.focus());
    fireEvent.change(name, { target: { value: "data-track" } });
    const value = within(html).getByLabelText("Value of attribute 1");
    // Tab to the value: leaving the name settles the row as it stands.
    act(() => value.focus());
    fireEvent.change(value, { target: { value: "hero" } });
    pressSave(value);
    expect(findNode(theSave().nodes, "hero")?.attributes).toEqual({
      "data-track": "hero",
    });
    expect(document.activeElement).toBe(value);
  });
});

describe("a list's query", () => {
  const POSTS: LoopCollection = {
    slug: "posts",
    label: "Posts",
    singular: "Post",
    fields: [{ name: "title", label: "Title", kind: "text" }],
    declared: ["id", "title"],
  };

  /** A custom source taking a typed input. */
  const UPCOMING: CustomSource = {
    declaration: namedQueryDeclaration(
      defineNamedQuery({
        name: "events.upcoming",
        label: "Upcoming events",
        description: "Events from today on, soonest first.",
        params: { city: param.text({ label: "City", required: true }) },
        reads: { collections: ["events"] },
        rows: { key: "id", fields: [{ name: "id", type: "text" }] },
        run: () => Promise.resolve({ rows: [] }),
      })
    ),
    readsHidden: [],
  };

  /** A collection list of posts, selected, its query in the Content tab. */
  function mountList(props: Record<string, unknown> = {}): void {
    registerBlocks(
      [
        {
          name: COLLECTION_LIST_TYPE,
          version: 1,
          description: "A list.",
          example: { props: {} },
          editor: { label: "Collection list" },
          props: {
            collection: {
              label: "Source",
              type: "text",
              display: "collection",
            },
            filters: { type: "array", display: "listFilters" },
            limit: { label: "How many", type: "number" },
            offset: { label: "Skip", type: "number" },
            namedQuery: { type: "object", display: "listNamedQuery" },
          },
          slots: { children: {}, empty: {} },
          render: () => null,
        },
      ] as never,
      { source: "save-shortcut-test" }
    );
    const list = {
      id: "list",
      type: COLLECTION_LIST_TYPE,
      version: 1,
      props,
      slots: { children: [], empty: [] },
    } as BlockNode;
    // One services object for the whole mount, as a host holds it: a new
    // one each render would read the collections again on every write.
    const services = {
      listLoopCollections: vi.fn(async () => [POSTS]),
      listCustomSources: vi.fn(async () => [UPCOMING]),
    };
    render(
      <Host document={page(list)}>
        {state => <InspectorPanel editor={state} contentServices={services} />}
      </Host>
    );
    act(() => editor().select("list"));
  }

  const listProps = (document: BlockDocument): Record<string, unknown> =>
    (findNode(document.nodes, "list")?.props ?? {}) as Record<string, unknown>;

  it("saves the number of entries being typed", async () => {
    mountList({ collection: "posts", limit: 6 });
    const field = await screen.findByLabelText("How many");
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "8" } });
    pressSave(field);
    expect(listProps(theSave()).limit).toBe(8);
    expect(document.activeElement).toBe(field);
  });

  it("saves the filter value being typed", async () => {
    mountList({
      collection: "posts",
      filters: [{ field: "title", op: "equals", value: "old" }],
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /^Title is “old”$/ })
    );
    const field = screen.getByRole("textbox", { name: /^Filter Title is/ });
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "new" } });
    pressSave(field);
    expect(listProps(theSave()).filters).toEqual([
      { field: "title", op: "equals", value: "new" },
    ]);
    expect(document.activeElement).toBe(field);
  });
  it("saves the value being added to an any-of filter", async () => {
    mountList({
      collection: "posts",
      filters: [{ field: "title", op: "in", value: ["news"] }],
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /^Title is any of/ })
    );
    const field = screen.getByPlaceholderText("Type a value, then Enter");
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "guides" } });
    pressSave(field);
    expect(listProps(theSave()).filters).toEqual([
      { field: "title", op: "in", value: ["news", "guides"] },
    ]);
  });

  it("saves the custom source's input being typed", async () => {
    mountList({
      namedQuery: { name: "events.upcoming", params: { city: "Lahore" } },
    });
    const field = await screen.findByRole("textbox", { name: "City" });
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "Karachi" } });
    pressSave(field);
    expect(listProps(theSave()).namedQuery).toEqual({
      name: "events.upcoming",
      params: { city: "Karachi" },
    });
    expect(document.activeElement).toBe(field);
  });
});

describe("a Layers rename", () => {
  it("saves the name being typed", () => {
    registerBlocks(coreBlocks as never, { source: "core" });
    render(
      <Host document={page(coreNode("a", "core/heading"))}>
        {state => <LayersPanel editor={state} />}
      </Host>
    );
    const row = document
      .querySelector('[data-nx-layer="a"]')
      ?.closest<HTMLElement>('[role="treeitem"]');
    if (row === null || row === undefined) throw new Error("no row");
    fireEvent.keyDown(row, { key: "F2" });
    const field = screen.getByRole("textbox", { name: /^Rename/ });
    fireEvent.change(field, { target: { value: "Hero title" } });
    pressSave(field);
    expect(findNode(theSave().nodes, "a")?.name).toBe("Hero title");
  });
});
