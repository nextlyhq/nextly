// @vitest-environment jsdom

/**
 * A prop's binding controls in the inspector: a bind button named for its
 * prop, a picker offering only the fields that fit and saying in words which
 * visitors can't read and which hold a draft, a pick written as an edit, and
 * a bound prop's chip, whose unbind keeps what the host's plan says.
 */
import {
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
    fields: [{ name: "applicationName", type: "text", public: true }],
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
  });
});
