// @vitest-environment jsdom

/**
 * A prop's binding controls in the inspector: a bind button named for its
 * prop, a picker offering only the fields that fit and saying in words which
 * visitors can't read and which hold a draft, a pick written as an edit, and
 * a bound prop's chip, whose unbind keeps what the host's plan says.
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
import { InspectorPanel } from "./inspector-panel";

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
  render(
    <InspectorPanel
      editor={editor}
      contentServices={{
        listBindingFields: async () => SOURCES,
        ...services,
      }}
    />
  );
  return editor;
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
});
