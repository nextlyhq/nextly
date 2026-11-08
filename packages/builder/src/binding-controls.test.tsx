// @vitest-environment jsdom

/**
 * A prop's binding controls in the inspector: a bind button named for its
 * prop, a picker offering only the fields that fit and saying in words which
 * visitors can't read and which hold a draft, a pick written as an edit, and
 * a bound prop's chip, whose unbind keeps what the host's plan says, and
 * whose menu opens the field's source where the host has a screen for it.
 * Props drawn inside a group (an image's source and alt text, a link) offer
 * the same button for each prop the group binds, and none for its qualifiers.
 */
import {
  bindablePropKind,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type BuilderOp,
} from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BindingFieldSource, UnbindPlanAnswer } from "./binding-services";
import type { ContentServices } from "./content-controls";
import type { EditorState } from "./editor-state";
import { inspectSelection } from "./inspector";
import { InspectorPanel } from "./inspector-panel";
import { propGroupsOf } from "./prop-groups";

afterEach(() => {
  cleanup();
  clearBlocks();
});

const SOURCES: readonly BindingFieldSource[] = [
  {
    binding: { source: "entry" },
    label: "Post",
    fields: [
      { name: "title", type: "text", public: true, preview: "Spring sale" },
      { name: "internalNote", type: "text", public: false },
      { name: "lede", type: "text", public: true, draft: true },
      // A date reaches text only through a format: offered with the one a
      // pick writes, named beside it.
      { name: "publishedOn", type: "date", public: true },
      // A relation itself can't fill text, but its own fields can.
      {
        name: "author",
        type: "relationship",
        relationTo: "users",
        public: true,
        fields: [{ name: "name", type: "text", public: true, preview: "Ada" }],
      },
    ],
  },
  {
    binding: { source: "site" },
    label: "Site",
    fields: [
      { name: "applicationName", type: "text", public: true },
      { name: "siteUrl", type: "url", label: "Site URL", public: true },
    ],
  },
];

function mount(
  bindings: BlockNode["bindings"],
  services: Partial<ContentServices> = {}
): EditorState {
  registerBlocks(
    [
      {
        name: "acme/badge",
        version: 1,
        description: "A badge.",
        example: { props: {} },
        editor: { label: "Badge" },
        props: { label: { label: "Text", role: "content", type: "text" } },
        defaultProps: {},
        render: () => null,
      },
    ] as never,
    { source: "binding-controls-test" }
  );
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "acme/badge",
        version: 1,
        props: { label: "Own" },
        ...(bindings === undefined ? {} : { bindings }),
      } as BlockNode,
    ],
  } as BlockDocument;
  const editor = {
    document,
    selectedId: "a",
    selection: { ids: ["a"], primary: "a" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    composed: () => undefined,
  } as unknown as EditorState;
  const contentServices = {
    listBindingFields: async () => SOURCES,
    ...services,
  };
  const view = render(
    <InspectorPanel editor={editor} contentServices={contentServices} />
  );
  // As the editor publishes an applied edit: a new document object, drawn.
  replaceDocument = next => {
    view.rerender(
      <InspectorPanel
        editor={{ ...editor, document: next } as EditorState}
        contentServices={contentServices}
      />
    );
  };
  return editor;
}

/** Draw the inspector again over a new document, as an applied edit does. */
let replaceDocument: (next: BlockDocument) => void = () => undefined;

/** The document's one block, with `changes` made to it. */
function withBlock(
  editor: EditorState,
  changes: Record<string, unknown>
): BlockDocument {
  const [block] = editor.document.nodes;
  return {
    ...editor.document,
    nodes: [{ ...block, ...changes } as BlockNode],
  };
}

describe("a prop's bind button", () => {
  it("is named for the prop, and drawn only where the host reads fields", () => {
    mount(undefined);
    expect(
      screen.getByRole("button", { name: "Bind Text to a field" })
    ).toBeTruthy();
    cleanup();
    clearBlocks();
    mount(undefined, { listBindingFields: undefined });
    expect(
      screen.queryByRole("button", { name: "Bind Text to a field" })
    ).toBeNull();
  });
});

describe("the field picker", () => {
  it("offers only fitting fields, by source, saying which are private or a draft", async () => {
    mount(undefined);
    fireEvent.click(
      screen.getByRole("button", { name: "Bind Text to a field" })
    );
    const list = await screen.findByRole("listbox", {
      name: "Fields for Text",
    });
    const entry = within(list).getByRole("group", { name: "This post" });
    const names = within(entry)
      .getAllByRole("option")
      .map(option => option.textContent);
    expect(names).toEqual([
      "TitleSpring sale",
      "Internal noteNot public",
      "LedeDraft",
      "Published onLong date",
      "Author › NameAda",
    ]);
    expect(within(list).getByRole("group", { name: "Site" })).toBeTruthy();
  });

  it("says which source could not be read, and lists the others", async () => {
    mount(undefined, {
      listBindingFields: async () => [
        ...SOURCES,
        {
          binding: { source: "single", sourceKey: "contact" },
          label: "Contact details",
          fields: [],
          readFailed: true,
        },
      ],
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Bind Text to a field" })
    );
    expect(
      (await screen.findByText(/^Could not read Contact details\./)).textContent
    ).toBe("Could not read Contact details. Close this and try again.");
    expect(screen.getByRole("option", { name: /^Title/ })).toBeTruthy();
  });

  it("names a field by the host's label where it gives one", async () => {
    mount(undefined);
    fireEvent.click(
      screen.getByRole("button", { name: "Bind Text to a field" })
    );
    const site = within(
      await screen.findByRole("group", { name: "Site" })
    ).getAllByRole("option");
    expect(site.map(option => option.textContent)).toContain("Site URL");
  });

  it("writes the pick as one edit of the block's bindings", async () => {
    const editor = mount(undefined);
    fireEvent.click(
      screen.getByRole("button", { name: "Bind Text to a field" })
    );
    const option = await screen.findByRole("option", { name: /^Title/ });
    fireEvent.click(option);
    const op = vi.mocked(editor.apply).mock.calls[0]?.[0] as BuilderOp;
    expect(op).toMatchObject({
      kind: "update",
      id: "a",
      patch: { bindings: { label: { $bind: "title" } } },
    });
  });
});

describe("a date or a number picked for a text prop", () => {
  it("is offered with the format a pick writes, named in the option", async () => {
    mount(undefined);
    fireEvent.click(
      screen.getByRole("button", { name: "Bind Text to a field" })
    );
    const date = await screen.findByRole("option", {
      name: /^Published on.*Long date$/,
    });
    expect(date).toBeTruthy();
    // The control: a text field fills the prop as it is, and names none.
    const title = screen.getByRole("option", { name: /^Title/ });
    expect(title.textContent).not.toMatch(/Long date|Number/);
  });

  it("previews a date's and a number's value in the format a pick writes", async () => {
    const UPDATED = "2026-11-08T12:00:00.000Z";
    mount(undefined, {
      listBindingFields: async () => [
        {
          binding: { source: "entry" },
          label: "Post",
          fields: [
            { name: "updatedAt", type: "date", public: true, preview: UPDATED },
            { name: "price", type: "number", public: true, preview: "1234.5" },
            // The control: text that looks like a date is shown as it is.
            { name: "code", type: "text", public: true, preview: "2026-11-08" },
          ],
        },
      ],
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Bind Text to a field" })
    );
    // As the browser's language and zone write them, which the picker uses.
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    const longDate = new Intl.DateTimeFormat(undefined, {
      dateStyle: "long",
      timeZone: zone,
    }).format(new Date(UPDATED));
    const date = await screen.findByRole("option", { name: /^Updated at/ });
    expect(date.textContent).toContain("Long date");
    expect(date.textContent).toContain(longDate);
    expect(date.textContent).not.toContain("2026-11-08T");
    const price = screen.getByRole("option", { name: /^Price/ });
    expect(price.textContent).toContain("Number");
    expect(price.textContent).toContain(new Intl.NumberFormat().format(1234.5));
    expect(screen.getByRole("option", { name: /^Code/ }).textContent).toBe(
      "Code2026-11-08"
    );
  });

  it("writes the binding with Long date, in one edit", async () => {
    const editor = mount(undefined);
    fireEvent.click(
      screen.getByRole("button", { name: "Bind Text to a field" })
    );
    fireEvent.click(
      await screen.findByRole("option", { name: /^Published on/ })
    );
    expect(vi.mocked(editor.apply)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(editor.apply).mock.calls[0]?.[0]).toEqual({
      kind: "update",
      id: "a",
      patch: {
        bindings: {
          label: {
            $bind: "publishedOn",
            format: { type: "date", options: { dateStyle: "long" } },
          },
        },
      },
    });
  });

  it("writes a number's binding with Number", async () => {
    const editor = mount(undefined, {
      listBindingFields: async () => [
        {
          binding: { source: "entry" },
          label: "Post",
          fields: [{ name: "price", type: "number", public: true }],
        },
      ],
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Bind Text to a field" })
    );
    fireEvent.click(
      await screen.findByRole("option", { name: /^Price.*Number$/ })
    );
    expect(vi.mocked(editor.apply).mock.calls[0]?.[0]).toMatchObject({
      patch: {
        bindings: { label: { $bind: "price", format: { type: "number" } } },
      },
    });
  });

  it("writes no format for a date filling a date prop", async () => {
    // The control: a date prop takes a date as it is, so nothing is added.
    registerBlocks(
      [
        {
          name: "acme/event",
          version: 1,
          description: "An event.",
          example: { props: {} },
          editor: { label: "Event" },
          props: { when: { label: "When", role: "content", type: "date" } },
          defaultProps: {},
          render: () => null,
        },
      ] as never,
      { source: "binding-controls-date-prop-test" }
    );
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "e", type: "acme/event", version: 1, props: {} }],
    } as BlockDocument;
    const apply = vi.fn((_op: BuilderOp) => document);
    render(
      <InspectorPanel
        editor={
          {
            document,
            selectedId: "e",
            selection: { ids: ["e"], primary: "e" },
            applyAll: vi.fn(() => document),
            select: vi.fn(),
            apply,
            undo: vi.fn(),
            redo: vi.fn(),
            canUndo: false,
            canRedo: false,
            undoDepth: 0,
            composed: () => undefined,
          } as unknown as EditorState
        }
        contentServices={{ listBindingFields: async () => SOURCES }}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Bind When to a field" })
    );
    const option = await screen.findByRole("option", {
      name: /^Published on/,
    });
    expect(option.textContent).not.toMatch(/Long date/);
    fireEvent.click(option);
    expect(apply.mock.calls[0]?.[0]).toEqual({
      kind: "update",
      id: "e",
      patch: { bindings: { when: { $bind: "publishedOn" } } },
    });
  });
});

describe("a bound prop", () => {
  it("shows a chip naming the field and its source in full", async () => {
    mount({ label: { $bind: "title", fallback: "Untitled" } });
    const chip = await screen.findByRole("button", {
      name: "Text: bound to Title of this post",
    });
    expect(chip.getAttribute("title")).toBe("Title of this post");
    expect((screen.getByLabelText("Fallback") as HTMLInputElement).value).toBe(
      "Untitled"
    );
  });

  it("unbinds as the host plans it, and says what was kept", async () => {
    const plan: UnbindPlanAnswer = {
      kept: { set: { label: "Spring sale" } },
      answer: {
        kept: "visitor",
        value: "Spring sale",
        reason: "The prop keeps what visitors saw.",
      },
    };
    const planUnbind = vi.fn(async () => plan);
    const editor = mount({ label: { $bind: "title" } }, { planUnbind });
    const chip = await screen.findByRole("button", { name: /^Text: bound to/ });
    fireEvent.keyDown(chip, { key: "Enter" });
    const unbind = await screen.findByRole("menuitem", {
      name: "Unbind, keep the text",
    });
    fireEvent.pointerUp(unbind, { pointerType: "mouse", button: 0 });
    await waitFor(() => expect(planUnbind).toHaveBeenCalled());
    await waitFor(() =>
      expect(vi.mocked(editor.apply)).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "update",
          id: "a",
          patch: { props: { label: "Spring sale" } },
        })
      )
    );
    // Said as the page changed, not in the API's words.
    expect((await screen.findByRole("status")).textContent).toBe(
      "Unbound. The badge keeps what visitors saw: “Spring sale”."
    );
  });
});

describe("a link's address bound inside its group", () => {
  /** A button whose link may point at an entry, as `core/button` declares it. */
  function mountButton(props: Record<string, unknown>): EditorState {
    registerBlocks(
      [
        {
          name: "acme/cta",
          version: 1,
          description: "A call to action.",
          example: { props: {} },
          editor: { label: "Call to action" },
          props: {
            label: { label: "Label", role: "content", type: "text" },
            href: { label: "Link", role: "content", type: "url" },
            entryCollection: { label: "Entry collection", type: "text" },
            entryId: { label: "Entry", type: "text" },
          },
          defaultProps: {},
          render: () => null,
        },
      ] as never,
      { source: "binding-controls-link-test" }
    );
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "b", type: "acme/cta", version: 1, props }],
    } as BlockDocument;
    const editor = {
      document,
      selectedId: "b",
      selection: { ids: ["b"], primary: "b" },
      applyAll: vi.fn(() => document),
      select: vi.fn(),
      apply: vi.fn(() => document),
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      composed: () => undefined,
    } as unknown as EditorState;
    render(
      <InspectorPanel
        editor={editor}
        contentServices={{
          listBindingFields: async () => [
            {
              binding: { source: "entry" },
              label: "Post",
              fields: [{ name: "website", type: "url", public: true }],
            },
          ],
        }}
      />
    );
    return editor;
  }

  /** Bind the link to the post's website through the picker. */
  async function bindLink(editor: EditorState): Promise<BuilderOp> {
    fireEvent.click(
      screen.getByRole("button", { name: "Bind Link to a field" })
    );
    fireEvent.click(await screen.findByRole("option", { name: /^Website/ }));
    expect(vi.mocked(editor.apply)).toHaveBeenCalledTimes(1);
    return vi.mocked(editor.apply).mock.calls[0]?.[0] as BuilderOp;
  }

  it("empties an entry the button pointed at, in the same edit as the binding", async () => {
    // A button follows a complete entry reference before its address, so a
    // bound address left beside one would never be followed.
    const editor = mountButton({
      label: "Read more",
      entryCollection: "posts",
      entryId: "p1",
    });
    const op = await bindLink(editor);
    expect(op).toEqual({
      kind: "update",
      id: "b",
      patch: {
        bindings: { href: { $bind: "website" } },
        props: { label: "Read more" },
      },
    });
  });

  it("writes the binding alone for a link that points at no entry", async () => {
    // The control: the same bind, with no reference to empty, leaves the
    // props as they are and out of the edit.
    const editor = mountButton({ label: "Read more" });
    const op = await bindLink(editor);
    expect(op).toEqual({
      kind: "update",
      id: "b",
      patch: { bindings: { href: { $bind: "website" } } },
    });
  });
});

describe("an image's alt text bound inside its group", () => {
  /** An image's alt text and its decorative mark, as `core/image` declares them. */
  function mountFigure(props: Record<string, unknown>): EditorState {
    registerBlocks(
      [
        {
          name: "acme/figure",
          version: 1,
          description: "A figure.",
          example: { props: {} },
          editor: { label: "Figure" },
          props: {
            alt: { label: "Alt text", role: "content", type: "text" },
            decorative: { label: "Decorative (no alt text)", type: "checkbox" },
          },
          defaultProps: {},
          render: () => null,
        },
      ] as never,
      { source: "binding-controls-alt-test" }
    );
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "f", type: "acme/figure", version: 1, props }],
    } as BlockDocument;
    const editor = {
      document,
      selectedId: "f",
      selection: { ids: ["f"], primary: "f" },
      applyAll: vi.fn(() => document),
      select: vi.fn(),
      apply: vi.fn(() => document),
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      composed: () => undefined,
    } as unknown as EditorState;
    render(
      <InspectorPanel
        editor={editor}
        contentServices={{ listBindingFields: async () => SOURCES }}
      />
    );
    return editor;
  }

  /** Bind the alt text to the post's title through the picker. */
  async function bindAlt(editor: EditorState): Promise<BuilderOp> {
    fireEvent.click(
      screen.getByRole("button", { name: "Bind Alt text to a field" })
    );
    fireEvent.click(await screen.findByRole("option", { name: /^Title/ }));
    expect(vi.mocked(editor.apply)).toHaveBeenCalledTimes(1);
    return vi.mocked(editor.apply).mock.calls[0]?.[0] as BuilderOp;
  }

  it("lifts the decorative mark in the same edit as the binding", async () => {
    // The block reads the mark before the alt text: left on, the bound words
    // would never reach a screen reader.
    const editor = mountFigure({ alt: "Kept", decorative: true });
    expect(await bindAlt(editor)).toEqual({
      kind: "update",
      id: "f",
      patch: {
        bindings: { alt: { $bind: "title" } },
        props: { alt: "Kept" },
      },
    });
  });

  it("writes the binding alone for an image that is not decorative", async () => {
    // The control: nothing to lift, so the props stay out of the edit.
    const editor = mountFigure({ alt: "Kept" });
    expect(await bindAlt(editor)).toEqual({
      kind: "update",
      id: "f",
      patch: { bindings: { alt: { $bind: "title" } } },
    });
  });
});

/** The inspector over one document, with the selected block and services given. */
function mountDocument(
  document: BlockDocument,
  selected: string,
  services: Partial<ContentServices> = {
    listBindingFields: async () => SOURCES,
  }
): void {
  render(
    <InspectorPanel
      editor={
        {
          document,
          selectedId: selected,
          selection: { ids: [selected], primary: selected },
          applyAll: vi.fn(() => document),
          select: vi.fn(),
          apply: vi.fn(() => document),
          undo: vi.fn(),
          redo: vi.fn(),
          canUndo: false,
          canRedo: false,
          undoDepth: 0,
          composed: () => undefined,
        } as unknown as EditorState
      }
      contentServices={services}
    />
  );
}

describe("a bound link's Fallback", () => {
  /** A block with a link prop and a yes-or-no, each bound. */
  function mountTeaser(): void {
    registerBlocks(
      [
        {
          name: "acme/teaser",
          version: 1,
          description: "A teaser.",
          example: { props: {} },
          editor: { label: "Teaser" },
          props: {
            more: { label: "More", role: "content", type: "link" },
            shown: { label: "Shown", role: "content", type: "checkbox" },
          },
          defaultProps: {},
          render: () => null,
        },
      ] as never,
      { source: "binding-controls-link-fallback-test" }
    );
    mountDocument(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "t",
            type: "acme/teaser",
            version: 1,
            props: {},
            bindings: {
              more: { $bind: "siteUrl", source: "site" },
              shown: { $bind: "featured" },
            },
          } as BlockNode,
        ],
      } as BlockDocument,
      "t"
    );
  }

  it("is offered for a link, whose value is an address", async () => {
    mountTeaser();
    const chip = await screen.findByRole("button", {
      name: /^More: bound to/,
    });
    const row = chip.closest(".nx-binding");
    expect(row?.querySelector("input")).not.toBeNull();
    expect(within(row as HTMLElement).getByLabelText("Fallback")).toBeTruthy();
  });

  it("is not offered for a yes-or-no, which text can't hold", async () => {
    // The control: the same block, a prop that isn't text.
    mountTeaser();
    const chip = await screen.findByRole("button", {
      name: /^Shown: bound to/,
    });
    const row = chip.closest(".nx-binding") as HTMLElement;
    expect(within(row).queryByLabelText("Fallback")).toBeNull();
  });
});

describe("an alt text bound in a contentOnly area", () => {
  /** A figure inside an area where its content may change and its design may not. */
  function mountInArea(figure: Partial<BlockNode>): void {
    registerBlocks(
      [
        {
          name: "acme/figure",
          version: 1,
          description: "A figure.",
          example: { props: {} },
          editor: { label: "Figure" },
          props: {
            alt: { label: "Alt text", role: "content", type: "text" },
            // Not content, so the area holds it.
            decorative: { label: "Decorative (no alt text)", type: "checkbox" },
          },
          defaultProps: {},
          render: () => null,
        },
        {
          name: "acme/area",
          version: 1,
          description: "An area whose blocks keep their design.",
          example: { props: {} },
          editor: { label: "Area" },
          props: {},
          slots: {
            children: {
              lock: "contentOnly",
              defaultBlock: [{ type: "acme/figure" }],
            },
          },
          render: () => null,
        },
      ] as never,
      { source: "binding-controls-area-test" }
    );
    mountDocument(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "area",
            type: "acme/area",
            version: 1,
            props: {},
            slots: {
              children: [
                {
                  id: "f",
                  type: "acme/figure",
                  version: 1,
                  props: {},
                  ...figure,
                } as BlockNode,
              ],
            },
          } as BlockNode,
        ],
      } as BlockDocument,
      "f",
      {
        listBindingFields: async () => SOURCES,
        planUnbind: async () => ({ refusal: "unused" }),
      }
    );
  }

  it("keeps a bound alt's fallback and unbind, and holds the change that would lift the mark", async () => {
    mountInArea({
      props: { decorative: true },
      bindings: { alt: { $bind: "title" } },
    });
    const chip = await screen.findByRole("button", {
      name: /^Alt text: bound to/,
    });
    expect(
      (screen.getByLabelText("Fallback") as HTMLInputElement).disabled
    ).toBe(false);
    fireEvent.keyDown(chip, { key: "Enter" });
    expect(
      await screen.findByRole("menuitem", { name: "Unbind, keep the alt text" })
    ).toBeTruthy();
    // A change of field would lift the decorative mark, which the area holds.
    expect(
      screen.queryByRole("menuitem", { name: "Change field…" })
    ).toBeNull();
  });

  it("holds a fresh bind that would lift the mark", () => {
    mountInArea({ props: { decorative: true } });
    expect(
      (
        screen.getByRole("button", {
          name: "Bind Alt text to a field",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("offers a fresh bind that would lift nothing", () => {
    // The control: the same area, no mark to lift, so the bind is offered.
    mountInArea({});
    expect(
      (
        screen.getByRole("button", {
          name: "Bind Alt text to a field",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });
});

describe("a bound prop's Open source", () => {
  /** The chip's menu, opened from the keyboard as a reader opens it. */
  async function openMenu(): Promise<void> {
    const chip = await screen.findByRole("button", { name: /^Text: bound to/ });
    fireEvent.keyDown(chip, { key: "Enter" });
    await screen.findByRole("menuitem", { name: "Change field…" });
  }

  it("opens the host's address for the source in a new tab, named with the field", async () => {
    const sourceHref = vi.fn(
      (_binding: unknown): string => "/admin/collections/posts/p1"
    );
    mount({ label: { $bind: "title" } }, { sourceHref });
    await openMenu();
    const item = screen.getByRole("menuitem", {
      name: "Open Title's source",
    });
    // A link, opened apart from the editor and with no hold on its window.
    expect(item.tagName).toBe("A");
    expect(item.getAttribute("href")).toBe("/admin/collections/posts/p1");
    expect(item.getAttribute("target")).toBe("_blank");
    expect(item.getAttribute("rel")?.split(" ")).toContain("noopener");
    // Asked about the binding the chip shows, not some other.
    expect(sourceHref).toHaveBeenCalledWith({ $bind: "title" });
  });

  it("is not offered where the host has no screen for the source", async () => {
    // The control for the test above: the same menu, its other items drawn,
    // and no Open source, whether the host answers nothing or has no answer.
    mount({ label: { $bind: "title" } }, { sourceHref: () => undefined });
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: /source$/ })).toBeNull();
    cleanup();
    clearBlocks();
    mount({ label: { $bind: "title" } });
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: /source$/ })).toBeNull();
  });
});

describe("an unbind that can't be applied as planned", () => {
  const openUnbind = async () => {
    const chip = await screen.findByRole("button", { name: /^Text: bound to/ });
    fireEvent.keyDown(chip, { key: "Enter" });
    fireEvent.pointerUp(
      await screen.findByRole("menuitem", { name: "Unbind, keep the text" }),
      { pointerType: "mouse", button: 0 }
    );
  };

  it("says so when the plan can't be read", async () => {
    const editor = mount(
      { label: { $bind: "title" } },
      {
        planUnbind: vi.fn(async () => {
          throw new Error("offline");
        }),
      }
    );
    await openUnbind();
    expect((await screen.findByRole("status")).textContent).toBe(
      "The unbind could not be planned. Try again."
    );
    expect(vi.mocked(editor.apply)).not.toHaveBeenCalled();
  });

  it("applies nothing where the binding changed while the plan was read", async () => {
    let answer: (plan: UnbindPlanAnswer) => void = () => undefined;
    const editor = mount(
      { label: { $bind: "title" } },
      {
        planUnbind: () =>
          new Promise<UnbindPlanAnswer>(resolve => {
            answer = resolve;
          }),
      }
    );
    await openUnbind();
    // Meanwhile the author binds the prop to another field: a new document.
    act(() => {
      replaceDocument(
        withBlock(editor, { bindings: { label: { $bind: "lede" } } })
      );
    });
    act(() => {
      answer({
        kept: { set: { label: "Spring sale" } },
        answer: { kept: "visitor", value: "Spring sale", reason: "" },
      });
    });
    expect((await screen.findByRole("status")).textContent).toMatch(
      /binding changed/
    );
    expect(vi.mocked(editor.apply)).not.toHaveBeenCalled();
  });

  it("keeps an edit made to the block while the plan was read", async () => {
    let answer: (plan: UnbindPlanAnswer) => void = () => undefined;
    const editor = mount(
      { label: { $bind: "title" } },
      {
        planUnbind: () =>
          new Promise<UnbindPlanAnswer>(resolve => {
            answer = resolve;
          }),
      }
    );
    await openUnbind();
    // Meanwhile another prop of the block is edited, the binding untouched.
    act(() => {
      replaceDocument(
        withBlock(editor, { props: { label: "Own", tone: "loud" } })
      );
    });
    act(() => {
      answer({
        kept: { set: { label: "Spring sale" } },
        answer: { kept: "visitor", value: "Spring sale", reason: "" },
      });
    });
    // Built from the document as it is now, the edit is in the unbind's patch;
    // from the snapshot taken when the unbind began, it would be reverted.
    await waitFor(() =>
      expect(vi.mocked(editor.apply)).toHaveBeenCalledWith(
        expect.objectContaining({
          patch: { props: { label: "Spring sale", tone: "loud" } },
        })
      )
    );
  });

  it("offers no field change where the host lists no fields", async () => {
    mount({ label: { $bind: "title" } }, { listBindingFields: undefined });
    const chip = await screen.findByRole("button", { name: /^Text: bound to/ });
    fireEvent.keyDown(chip, { key: "Enter" });
    await screen.findByRole("menu");
    expect(
      screen.queryByRole("menuitem", { name: "Change field…" })
    ).toBeNull();
  });
});

describe("an unbind of a field visitors can't read", () => {
  it("says the field's value wasn't copied in, and what was kept instead", async () => {
    const plan: UnbindPlanAnswer = {
      kept: { set: { label: "Ask us at the front desk" } },
      answer: {
        kept: "fallback",
        value: "Ask us at the front desk",
        unreadable: true,
        reason: "Visitors can't read …",
      },
    };
    mount(
      {
        label: {
          $bind: "internalNote",
          source: "single",
          sourceKey: "contact-details",
        },
      },
      {
        planUnbind: vi.fn(async () => plan),
        listBindingFields: async () => [
          {
            binding: { source: "single", sourceKey: "contact-details" },
            label: "Contact details",
            fields: [
              {
                name: "internalNote",
                type: "text",
                label: "Internal note",
                public: false,
              },
            ],
          },
        ],
      }
    );
    const chip = await screen.findByRole("button", {
      name: /^Text: bound to Internal note of Contact details/,
    });
    fireEvent.keyDown(chip, { key: "Enter" });
    fireEvent.pointerUp(
      await screen.findByRole("menuitem", { name: "Unbind, keep the text" }),
      { pointerType: "mouse", button: 0 }
    );
    const note = await screen.findByRole("status");
    expect(note.textContent).toBe(
      "Unbound. Visitors can't read “Internal note”, so its value wasn't copied in. The badge keeps the fallback: “Ask us at the front desk”."
    );
    expect(note.getAttribute("data-tone")).toBe("private");
  });
});

describe("every bindable prop", () => {
  it("offers the bind button on its own row, and a prop no field fills offers none", () => {
    // One prop of each type a block may draw on its own row.
    const props = {
      title: { label: "Title", role: "content", type: "text" },
      summary: { label: "Summary", role: "content", type: "textarea" },
      address: { label: "Address", role: "content", type: "url" },
      count: { label: "Count", role: "content", type: "number" },
      shown: { label: "Shown", role: "content", type: "checkbox" },
      tone: {
        label: "Tone",
        role: "content",
        type: "select",
        options: [
          { label: "Calm", value: "calm" },
          { label: "Loud", value: "loud" },
        ],
      },
      body: { label: "Body", role: "content", type: "richText" },
      glyph: { label: "Glyph", role: "content", type: "icon" },
    } as const;
    registerBlocks(
      [
        {
          name: "acme/every",
          version: 1,
          description: "Every type.",
          example: { props: {} },
          editor: { label: "Every" },
          props,
          defaultProps: {},
          render: () => null,
        },
      ] as never,
      { source: "binding-controls-every-test" }
    );
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "e", type: "acme/every", version: 1, props: {} }],
    } as BlockDocument;
    render(
      <InspectorPanel
        editor={
          {
            document,
            selectedId: "e",
            selection: { ids: ["e"], primary: "e" },
            applyAll: vi.fn(() => document),
            select: vi.fn(),
            apply: vi.fn(() => document),
            undo: vi.fn(),
            redo: vi.fn(),
            canUndo: false,
            canRedo: false,
            undoDepth: 0,
            composed: () => undefined,
          } as unknown as EditorState
        }
        contentServices={{ listBindingFields: async () => SOURCES }}
      />
    );
    for (const schema of Object.values(props)) {
      const button = screen.queryByRole("button", {
        name: `Bind ${schema.label} to a field`,
      });
      // The engine's own answer to "can any field fill this prop".
      if (bindablePropKind(schema as never) === undefined) {
        expect(button, schema.label).toBeNull();
      } else {
        expect(button, schema.label).not.toBeNull();
      }
    }
    // The control: some prop types bind and some don't, or the loop proves nothing.
    expect(
      Object.values(props).filter(
        schema => bindablePropKind(schema as never) !== undefined
      ).length
    ).toBeGreaterThan(3);
    expect(
      Object.values(props).some(
        schema => bindablePropKind(schema as never) === undefined
      )
    ).toBe(true);
  });

  it("offers the bind button inside a group for each prop the group binds, and none for what qualifies it", () => {
    // An image's source and alt text, and a link, declared as `core/image`
    // and `core/button` declare them, so every prop is drawn by a group.
    const props = {
      mediaId: {
        label: "Image",
        role: "content",
        type: "media",
        accept: "image/*",
        addressProp: "src",
      },
      src: { label: "Image address", role: "content", type: "url" },
      alt: { label: "Alt text", role: "content", type: "text" },
      decorative: { label: "Decorative (no alt text)", type: "checkbox" },
      href: { label: "Link", role: "content", type: "url" },
      target: {
        label: "Open link in",
        type: "select",
        options: ["_self", "_blank"],
      },
      rel: { label: "Link relationship", type: "text" },
    } as const;
    registerBlocks(
      [
        {
          name: "acme/linked-picture",
          version: 1,
          description: "A linked picture.",
          example: { props: {} },
          editor: { label: "Linked picture" },
          props,
          defaultProps: {},
          render: () => null,
        },
      ] as never,
      { source: "binding-controls-groups-test" }
    );
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "g",
          type: "acme/linked-picture",
          version: 1,
          // An address and a link stored, so the source shows its URL side
          // and the link its target and rel rows: every prop is on screen.
          props: {
            src: "https://example.test/spring.jpg",
            href: "https://example.test/",
          },
        },
      ],
    } as BlockDocument;
    render(
      <InspectorPanel
        editor={
          {
            document,
            selectedId: "g",
            selection: { ids: ["g"], primary: "g" },
            applyAll: vi.fn(() => document),
            select: vi.fn(),
            apply: vi.fn(() => document),
            undo: vi.fn(),
            redo: vi.fn(),
            canUndo: false,
            canRedo: false,
            undoDepth: 0,
            composed: () => undefined,
          } as unknown as EditorState
        }
        contentServices={{ listBindingFields: async () => SOURCES }}
      />
    );
    // The groups as the panel finds them, so the test follows the groups'
    // own statement of what they bind rather than a copy of it.
    const groups = propGroupsOf(inspectSelection(document, "g")?.props ?? []);
    const grouped = groups.flatMap(group => [...group.drawn]);
    // Every prop is drawn by a group: none of them falls to a row of its own,
    // which the test above already covers.
    expect(new Set(grouped)).toEqual(new Set(Object.keys(props)));
    const offered = new Set(groups.flatMap(group => [...group.bindable]));
    for (const name of grouped) {
      const schema = props[name as keyof typeof props];
      const button = screen.queryByRole("button", {
        name: `Bind ${schema.label} to a field`,
      });
      if (offered.has(name)) {
        // A group offers only what a field can fill, and draws its button.
        expect(bindablePropKind(schema as never), name).not.toBeUndefined();
        expect(button, name).not.toBeNull();
      } else {
        expect(button, name).toBeNull();
      }
    }
    // Named, so neither a group binding nothing nor one binding everything
    // passes: the image, its address, its words and the link offer the
    // button; whether it is decorative, and how the link opens, do not,
    // though a row of their own would bind them.
    expect([...offered].sort()).toEqual(["alt", "href", "mediaId", "src"]);
    expect(
      grouped
        .filter(
          name =>
            !offered.has(name) &&
            bindablePropKind(props[name as keyof typeof props] as never) !==
              undefined
        )
        .sort()
    ).toEqual(["decorative", "rel", "target"]);
  });
});
