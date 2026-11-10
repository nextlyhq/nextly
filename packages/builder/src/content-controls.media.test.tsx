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

import {
  RichTextField,
  type ContentServices,
  type MediaPickerProps,
} from "./content-controls";
import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";
import { createOpenPassages } from "./open-passages";

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
          mediaId: { role: "content", type: "media", accept: "image/*" },
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
    // Nothing composed around the page: its own tree is all there is.
    composed: () => undefined,
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

/** A picker that, like the admin's, leaves closing to whoever opened it. */
function StayingPicker({
  open,
  onSelect,
}: MediaPickerProps): React.JSX.Element | null {
  if (!open) return null;
  return (
    <button
      type="button"
      onClick={() =>
        onSelect([{ id: "m-7", url: "/m-7.png", filename: "team.png" }])
      }
    >
      Take team.png
    </button>
  );
}

describe("the media control", () => {
  it("shows a stored file by its thumbnail, its name and its alt text", async () => {
    // Without a read of the stored id, every image read "A file from the
    // media library." and two pictures could not be told apart.
    register();
    const editor = editorFor({ mediaId: "m-42" });
    render(
      <InspectorPanel
        editor={editor}
        contentServices={{
          MediaPicker: FakePicker,
          readMedia: async id =>
            id === "m-42"
              ? { name: "hero.png", thumbnail: "/t/m-42.png", alt: "A hero" }
              : null,
        }}
      />
    );
    expect(await screen.findByText("hero.png")).toBeDefined();
    expect(screen.getByText("Library alt text: A hero")).toBeDefined();
    const thumbnail = document.querySelector(".nx-inspector__media-thumb");
    expect(thumbnail?.getAttribute("src")).toBe("/t/m-42.png");
    expect(screen.queryByText(/A file from the media library/)).toBeNull();
  });

  it("still says a file is chosen when it cannot be read", async () => {
    register();
    const editor = editorFor({ mediaId: "m-gone" });
    render(
      <InspectorPanel
        editor={editor}
        contentServices={{
          MediaPicker: FakePicker,
          readMedia: async () => null,
        }}
      />
    );
    expect(
      await screen.findByText("A file from the media library.")
    ).toBeDefined();
    expect(document.querySelector(".nx-inspector__media-thumb")).toBeNull();
  });

  it("closes the picker once a choice is made", () => {
    register();
    const editor = editorFor({});
    render(
      <InspectorPanel
        editor={editor}
        contentServices={{ MediaPicker: StayingPicker }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose Media id" }));
    fireEvent.click(screen.getByRole("button", { name: "Take team.png" }));

    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Take team.png" })).toBeNull();
  });

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

describe("a rich-text field whose write was refused", () => {
  it("gives the refused words up when the stored passage changes under them", async () => {
    // A Reset, an undo: the passage now stored is what the field shows, and
    // the refused draft and its notice go rather than sitting over it.
    const detach = vi.fn();
    const attach = vi.fn(() => ({
      status: "attached",
      session: {
        focus: vi.fn(),
        read: () => ({ root: "too long" }),
        detach,
        hold: vi.fn(),
      },
    }));
    const services = { loadRichTextEditor: fakeEditor(attach) };
    const field = (value: unknown) => (
      <>
        <span id="body-label">Body</span>
        <RichTextField
          id="body"
          labelledBy="body-label"
          value={value}
          disabled={false}
          onCommit={() => null}
          services={services}
        />
      </>
    );
    const view = render(field(passageOf("Ours")));
    const box = screen.getByRole("textbox", { name: "Body" });
    await act(async () => {
      fireEvent.focus(box);
    });
    await act(async () => {
      fireEvent.blur(box);
    });
    expect(screen.getByText(/could not be saved/)).toBeDefined();
    expect(detach).not.toHaveBeenCalled();

    view.rerender(field(passageOf("The component's")));
    expect(detach).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/could not be saved/)).toBeNull();
    expect(box.textContent).toBe("The component's");
  });
});

/** A one-paragraph passage, as the rich-text editor stores one. */
function passageOf(text: string): unknown {
  return {
    root: {
      type: "root",
      children: [{ type: "paragraph", children: [{ type: "text", text }] }],
    },
  };
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
    expect(field.getAttribute("contenteditable")).not.toBe("true");
    expect(field.getAttribute("aria-readonly")).toBe("true");
  });

  /** A loader whose editor arrives only when the test says so. */
  function slowEditor(
    attach: (element: HTMLElement, value: unknown) => unknown
  ) {
    let arrive: () => void = () => {};
    const arrived = new Promise<void>(resolve => {
      arrive = resolve;
    });
    const load = vi.fn(async () => {
      await arrived;
      return { attach };
    }) as unknown as ContentServices["loadRichTextEditor"];
    return { load, arrive };
  }

  it("takes no typing until the editor attaches, then puts the caret in it", async () => {
    // Keys typed into the bare element would be replaced by the stored
    // passage when the editor took it over, so it is not editable until then.
    register();
    const focus = vi.fn();
    const attach = vi.fn(() => ({
      status: "attached",
      session: { focus, read: () => ({ root: "stored" }), detach: vi.fn() },
    }));
    const { load, arrive } = slowEditor(attach);
    render(
      <InspectorPanel
        editor={editorFor({ body: { root: "stored" } })}
        contentServices={{ loadRichTextEditor: load }}
      />
    );
    const field = screen.getByRole("textbox", { name: "Body" });
    fireEvent.focus(field);
    expect(field.getAttribute("contenteditable")).not.toBe("true");
    expect(field.getAttribute("aria-busy")).toBe("true");
    expect(attach).not.toHaveBeenCalled();

    await act(async () => {
      arrive();
    });
    expect(attach).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(field.getAttribute("aria-busy")).toBe("false");
  });

  it("attaches nothing when the author left before the editor arrived", async () => {
    // Attached then, the shared editor would sit held on a field nobody is
    // in, and no blur would come to let it go.
    register();
    const attach = vi.fn();
    const { load, arrive } = slowEditor(attach);
    render(
      <InspectorPanel
        editor={editorFor({ body: { root: "stored" } })}
        contentServices={{ loadRichTextEditor: load }}
      />
    );
    const field = screen.getByRole("textbox", { name: "Body" });
    fireEvent.focus(field);
    fireEvent.blur(field);
    await act(async () => {
      arrive();
    });
    expect(attach).not.toHaveBeenCalled();
  });

  it("holds its open passage where the host finishes it before a save", async () => {
    // A Save while the field still has focus finishes the passage through
    // the field's own commit, so the words typed reach the document.
    register();
    const editor = editorFor({ body: { root: "stored" } });
    const attach = vi.fn(() => ({
      status: "attached",
      session: {
        focus: vi.fn(),
        read: () => ({ root: "typed" }),
        detach: vi.fn(),
      },
    }));
    const passages = createOpenPassages();
    render(
      <InspectorPanel
        editor={editor}
        contentServices={{
          loadRichTextEditor: fakeEditor(attach),
          openPassages: passages,
        }}
      />
    );
    const field = screen.getByRole("textbox", { name: "Body" });
    await act(async () => {
      fireEvent.focus(field);
    });
    expect(passages.isOpen()).toBe(true);

    act(() => {
      passages.finishAll();
    });
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { props: { body: { root: "typed" } } },
    });
    // Finished once: the hold is released, and leaving writes nothing more.
    expect(passages.isOpen()).toBe(false);
    fireEvent.blur(field);
    expect(editor.apply).toHaveBeenCalledTimes(1);
  });

  it("opens the picker on what the prop stores now, offering only what it accepts", () => {
    register();
    const seen: MediaPickerProps[] = [];
    function Recording(props: MediaPickerProps): React.JSX.Element | null {
      seen.push(props);
      return null;
    }
    render(
      <InspectorPanel
        editor={editorFor({ mediaId: "m-1" })}
        contentServices={{ MediaPicker: Recording }}
      />
    );
    // Not mounted while closed, so nothing of an earlier choice is kept.
    expect(seen).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Choose Media id" }));
    const opened = seen.at(-1);
    expect(opened?.accept).toBe("image/*");
    expect([...(opened?.initialSelectedIds ?? [])]).toEqual(["m-1"]);
  });

  it("keeps a passage the document refused, with its words, until Escape discards it", async () => {
    register();
    const editor = editorFor({ body: { root: "stored" } });
    editor.apply.mockReturnValue(null);
    const detach = vi.fn();
    const hold = vi.fn();
    const attach = vi.fn(() => ({
      status: "attached",
      session: {
        focus: vi.fn(),
        read: () => ({ root: "too long" }),
        detach,
        hold,
      },
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
    fireEvent.blur(field);

    // Refused: still attached and held, and the author is told what to do.
    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(detach).not.toHaveBeenCalled();
    expect(hold).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/could not be saved/)).toBeDefined();

    fireEvent.keyDown(field, { key: "Escape" });
    expect(detach).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/could not be saved/)).toBeNull();
  });

  it("lets a refused passage go when its field goes, rather than holding the editor", async () => {
    register();
    const editor = editorFor({ body: { root: "stored" } });
    editor.apply.mockReturnValue(null);
    const detach = vi.fn();
    const attach = vi.fn(() => ({
      status: "attached",
      session: {
        focus: vi.fn(),
        read: () => ({ root: "too long" }),
        detach,
        hold: vi.fn(),
      },
    }));
    const passages = createOpenPassages();
    const view = render(
      <InspectorPanel
        editor={editor}
        contentServices={{
          loadRichTextEditor: fakeEditor(attach),
          openPassages: passages,
        }}
      />
    );
    const field = screen.getByRole("textbox", { name: "Body" });
    await act(async () => {
      fireEvent.focus(field);
    });
    fireEvent.blur(field);
    // Refused and kept, while the field is on screen.
    expect(detach).not.toHaveBeenCalled();
    expect(passages.isOpen()).toBe(true);

    view.unmount();
    expect(detach).toHaveBeenCalledTimes(1);
    expect(passages.isOpen()).toBe(false);
  });
});
