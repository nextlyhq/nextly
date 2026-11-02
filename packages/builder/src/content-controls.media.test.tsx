// @vitest-environment jsdom

/**
 * The media and rich-text controls, with the host's services stood in for.
 *
 * - Media: "Choose" opens the host's picker; the chosen item's id is stored,
 *   and nothing else; Remove clears it; without a picker the control says the
 *   library is not available rather than offering a button that does nothing.
 * - Rich text: focusing the field attaches the shared editor to it with the
 *   stored passage; leaving commits what the editor reads, once; an editor
 *   held elsewhere is said in words and nothing is written.
 * - Both are read-only on a locked block.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { ContentServices, MediaPickerProps } from "./content-controls";
import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

beforeAll(() => {
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
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

function register(): void {
  registerBlocks(
    [
      {
        name: "acme/picture",
        version: 1,
        description: "A picture and a passage.",
        example: { props: {} },
        editor: { label: "Picture" },
        props: {
          mediaId: { role: "content", type: "media" },
          body: { role: "content", type: "richText" },
        },
        render: () => null,
      },
    ] as never,
    { source: "content-controls-media-test" }
  );
}

function editorFor(
  props: Record<string, unknown>,
  extra: Partial<BlockNode> = {}
) {
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "acme/picture",
        version: 1,
        props,
        ...extra,
      } as BlockNode,
    ],
  } as BlockDocument;
  return {
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
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
}

/** A picker that offers one item the moment it opens. */
function FakePicker({
  open,
  onSelect,
  onOpenChange,
}: MediaPickerProps): React.JSX.Element | null {
  if (!open) return null;
  return (
    <button
      type="button"
      onClick={() => {
        onSelect([{ id: "m-42", url: "/m-42.png", filename: "hero.png" }]);
        onOpenChange(false);
      }}
    >
      Take hero.png
    </button>
  );
}

describe("the media control", () => {
  it("stores only the chosen item's id, through the host's picker", () => {
    register();
    const editor = editorFor({});
    render(
      <InspectorPanel
        editor={editor}
        contentServices={{ MediaPicker: FakePicker }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose Media id" }));
    fireEvent.click(screen.getByRole("button", { name: "Take hero.png" }));

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { props: { mediaId: "m-42" } },
    });
  });

  it("removes a stored item", () => {
    register();
    const editor = editorFor({ mediaId: "m-1" });
    render(
      <InspectorPanel
        editor={editor}
        contentServices={{ MediaPicker: FakePicker }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Media id" }));
    // The prop is dropped, not stored as `undefined`: a document holds no
    // undefined values, and absent is what "no media" means.
    const patch = editor.apply.mock.calls[0]?.[0] as {
      patch: { props: object };
    };
    expect(patch.patch.props).toEqual({});
    expect(Object.hasOwn(patch.patch.props, "mediaId")).toBe(false);
  });

  it("says the library is not available when the host gave no picker", () => {
    register();
    render(<InspectorPanel editor={editorFor({})} />);
    expect(
      screen.queryByRole("button", { name: "Choose Media id" })
    ).toBeNull();
    expect(
      screen.getByText(/media library is not available here/)
    ).toBeDefined();
  });

  it("offers no change on a locked block", () => {
    register();
    render(
      <InspectorPanel
        editor={editorFor({ mediaId: "m-1" }, { locked: true })}
        contentServices={{ MediaPicker: FakePicker }}
      />
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Choose Media id",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });
});

/** An editor that attaches, and reads back a passage of its own. */
function fakeEditor(attach: (element: HTMLElement, value: unknown) => unknown) {
  return vi.fn(async () => ({
    attach,
  })) as unknown as ContentServices["loadRichTextEditor"];
}

describe("the rich-text control", () => {
  it("attaches on focus with the stored passage, and commits what it reads on leaving", async () => {
    register();
    const editor = editorFor({ body: { root: "stored" } });
    const detach = vi.fn();
    const attach = vi.fn(() => ({
      status: "attached",
      session: { focus: vi.fn(), read: () => ({ root: "edited" }), detach },
    }));
    render(
      <InspectorPanel
        editor={editor}
        contentServices={{ loadRichTextEditor: fakeEditor(attach) }}
      />
    );
    const field = screen.getByRole("textbox", { name: "Body" });
    await act(async () => {
      fireEvent.focus(field);
    });
    expect(attach).toHaveBeenCalledWith(field, { root: "stored" });

    await act(async () => {
      fireEvent.blur(field);
    });
    expect(detach).toHaveBeenCalledTimes(1);
    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { props: { body: { root: "edited" } } },
    });
  });

  it("says so when the editor is busy on the canvas, and writes nothing", async () => {
    register();
    const editor = editorFor({ body: { root: "stored" } });
    const attach = vi.fn(() => ({ status: "refused", reason: "held" }));
    render(
      <InspectorPanel
        editor={editor}
        contentServices={{ loadRichTextEditor: fakeEditor(attach) }}
      />
    );
    const field = screen.getByRole("textbox", { name: "Body" });
    await act(async () => {
      fireEvent.focus(field);
    });
    expect(screen.getByText(/being edited on the canvas/)).toBeDefined();
    await act(async () => {
      fireEvent.blur(field);
    });
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("is not editable on a locked block", () => {
    register();
    render(
      <InspectorPanel
        editor={editorFor({}, { locked: true })}
        contentServices={{ loadRichTextEditor: fakeEditor(vi.fn()) }}
      />
    );
    const field = screen.getByRole("textbox", { name: "Body" });
    expect(field.getAttribute("contenteditable")).toBe("false");
    expect(field.getAttribute("aria-readonly")).toBe("true");
  });
});
