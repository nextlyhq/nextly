// @vitest-environment jsdom
/**
 * A Rich text in the panel: the line saying it is edited on the canvas, the
 * "Open the full editor" button, the full editor it opens (the same shared
 * editor, the canvas's own actions, Done and Cancel), and closing it putting
 * the author back on the block, with Done's words written and Cancel's not.
 *
 * The editor is a stand-in, so what is asserted is the builder's half; what
 * each action does to a real passage is asserted against Lexical in the
 * admin (`inline-editor-blocks.test.ts`).
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShortcutProvider } from "@nextlyhq/ui";

import type { ContentControlProps, ContentServices } from "./content-services";
import { createOpenPassages } from "../../open-passages";
import { RichTextControl } from "./rich-text-control";
import { FULL_EDITOR_WORDS } from "./rich-text-full-editor";

afterEach(() => cleanup());

const passage = (text: string) => ({
  root: {
    type: "root",
    children: [
      { type: "paragraph", children: [{ type: "text", text, format: 0 }] },
    ],
  },
});

const heading = (text: string) => ({
  root: {
    type: "root",
    children: [
      {
        type: "heading",
        tag: "h2",
        children: [{ type: "text", text, format: 0 }],
      },
    ],
  },
});

/**
 * A stand-in for the shared editor: each attachment keeps a passage, made a
 * heading by the H2 verb, and tells the host what is under the caret.
 */
function sharedEditor() {
  const attached: { element: HTMLElement; value: unknown }[] = [];
  const sessions: ReturnType<typeof session>[] = [];
  function session(start: unknown, told?: (state: unknown) => void) {
    let words = start;
    return {
      focus: vi.fn(),
      read: vi.fn(() => words),
      detach: vi.fn(),
      hold: vi.fn(),
      format: vi.fn(),
      link: vi.fn(),
      selection: vi.fn(() => undefined),
      block: vi.fn((kind: string) => {
        if (kind === "h2") words = heading("Hello");
        told?.({
          collapsed: true,
          bold: false,
          italic: false,
          link: null,
          block: kind,
        });
      }),
    };
  }
  const attach = vi.fn(
    (
      element: HTMLElement,
      value: unknown,
      options?: { onSelection?: (state: unknown) => void }
    ) => {
      attached.push({ element, value });
      const live = session(value, options?.onSelection);
      sessions.push(live);
      return { status: "attached" as const, session: live };
    }
  );
  return { attach, attached, sessions };
}

function drawPanel(
  options: {
    oneParagraph?: boolean;
    load?: boolean;
    onCommit?: (name: string, value: unknown) => unknown;
  } = {}
) {
  const editor = sharedEditor();
  const openPassages = createOpenPassages();
  const services = {
    ...(options.load === false
      ? {}
      : { loadRichTextEditor: vi.fn(async () => ({ attach: editor.attach })) }),
    openPassages,
  } as unknown as ContentServices;
  const onCommit = vi.fn(options.onCommit ?? (() => undefined));
  // Under the editor's shortcut manager, as the panel is: the full editor
  // holds the editor's shortcuts while it is open.
  render(
    <ShortcutProvider>
      <RichTextControl
        {...({
          id: "content",
          prop: {
            name: "content",
            value: passage("Hello"),
            schema: {
              type: "richText",
              label: "Text",
              ...(options.oneParagraph === true ? { oneParagraph: true } : {}),
            },
          },
          disabled: false,
          onCommit,
          services,
        } as unknown as ContentControlProps)}
      />
    </ShortcutProvider>
  );
  return { editor, onCommit, openPassages };
}

/** Open the full editor and let the shared editor attach to its page. */
async function openFullEditor() {
  const panel = drawPanel();
  const button = screen.getByRole("button", { name: FULL_EDITOR_WORDS.open });
  await act(async () => {
    fireEvent.click(button);
  });
  const dialog = screen.getByRole("dialog");
  return { ...panel, button, dialog };
}

describe("a Rich text's panel", () => {
  it("says it is edited on the canvas, and offers the full editor", () => {
    drawPanel();
    expect(screen.getByText(FULL_EDITOR_WORDS.line)).not.toBeNull();
    expect(FULL_EDITOR_WORDS.line).toBe(
      "Edit on the canvas. Select text for bold, links, headings and lists."
    );
    const button = screen.getByRole("button", {
      name: "Open the full editor",
    });
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("offers neither for a Text, whose words are one paragraph", () => {
    drawPanel({ oneParagraph: true });
    expect(screen.queryByText(FULL_EDITOR_WORDS.line)).toBeNull();
    expect(
      screen.queryByRole("button", { name: FULL_EDITOR_WORDS.open })
    ).toBeNull();
  });

  it("offers no full editor where the host has no editor to open", () => {
    drawPanel({ load: false });
    expect(
      screen.queryByRole("button", { name: FULL_EDITOR_WORDS.open })
    ).toBeNull();
  });
});

describe("the full editor", () => {
  it("opens a large editor on the shared editor, with the stored passage", async () => {
    const { dialog, editor } = await openFullEditor();
    expect(dialog.className).toContain("nx-rich-text-editor");
    expect(screen.getByRole("heading", { name: "Text" })).not.toBeNull();
    const page = screen.getByRole("textbox", { name: "Text" });
    expect(dialog.contains(page)).toBe(true);
    expect(editor.attached).toHaveLength(1);
    expect(editor.attached[0]?.element).toBe(page);
    expect(editor.attached[0]?.value).toEqual(passage("Hello"));
    expect(editor.sessions[0]?.focus).toHaveBeenCalled();
  });

  it("offers what the canvas offers a Rich text, and no more", async () => {
    const { dialog } = await openFullEditor();
    const toolbar = screen.getByRole("toolbar", { name: "Text formatting" });
    expect(dialog.contains(toolbar)).toBe(true);
    const names = [...toolbar.querySelectorAll("button")].map(
      button => button.getAttribute("aria-label") ?? button.textContent
    );
    expect(names).toEqual([
      "Bold",
      "Italic",
      "Link",
      "Heading 2",
      "Heading 3",
      "Bullets",
      "Numbers",
      "Quote",
    ]);
  });

  it("presses the editor's own verbs, and says which block is on", async () => {
    const { editor } = await openFullEditor();
    const h2 = screen.getByRole("button", { name: "Heading 2" });
    expect(h2.getAttribute("aria-pressed")).toBe("false");
    act(() => {
      fireEvent.click(h2);
    });
    expect(editor.sessions[0]?.block).toHaveBeenCalledWith("h2");
    expect(
      screen
        .getByRole("button", { name: "Heading 2" })
        .getAttribute("aria-pressed")
    ).toBe("true");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    });
    expect(editor.sessions[0]?.format).toHaveBeenCalledWith("bold");
  });

  it("moves along its toolbar with the arrow keys, one tab stop", async () => {
    await openFullEditor();
    const toolbar = screen.getByRole("toolbar", { name: "Text formatting" });
    const buttons = [...toolbar.querySelectorAll("button")];
    expect(buttons.filter(button => button.tabIndex === 0)).toHaveLength(1);
    act(() => buttons[0]?.focus());
    act(() => {
      fireEvent.keyDown(toolbar, { key: "ArrowRight" });
    });
    expect(document.activeElement).toBe(buttons[1]);
    act(() => {
      fireEvent.keyDown(toolbar, { key: "End" });
    });
    expect(document.activeElement).toBe(buttons.at(-1));
  });

  it("writes the words on Done, closes, and goes back to the block", async () => {
    const { button, editor, onCommit, openPassages } = await openFullEditor();
    expect(openPassages.isOpen()).toBe(true);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Heading 2" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("content", heading("Hello"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editor.sessions[0]?.detach).toHaveBeenCalled();
    expect(openPassages.isOpen()).toBe(false);
    // The dialog gives the focus back as it unmounts, a task later.
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("writes nothing on Done when nothing changed", async () => {
    const { onCommit } = await openFullEditor();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("writes nothing on Cancel, closes, and goes back to the block", async () => {
    const { button, editor, onCommit } = await openFullEditor();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Heading 2" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editor.sessions[0]?.detach).toHaveBeenCalled();
    // The dialog gives the focus back as it unmounts, a task later.
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("keeps changed words open on Escape, and says how to keep or discard them", async () => {
    const { onCommit } = await openFullEditor();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Heading 2" }));
    });
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    });
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(screen.getByText(FULL_EDITOR_WORDS.unsaved)).not.toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("closes on Escape when nothing changed", async () => {
    const { button } = await openFullEditor();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    // The dialog gives the focus back as it unmounts, a task later.
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("stays open with the words when the page refuses the write", async () => {
    const panel = drawPanel({ onCommit: () => null });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: FULL_EDITOR_WORDS.open })
      );
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Heading 2" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
    });
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(screen.getByText(FULL_EDITOR_WORDS.refused)).not.toBeNull();
    expect(panel.editor.sessions[0]?.hold).toHaveBeenCalled();
    expect(panel.editor.sessions[0]?.detach).not.toHaveBeenCalled();
  });

  describe("finished by a save while open", () => {
    // What the canvas's own commit asks of every open passage before the page
    // is stored: the passage's words written, and the document that write
    // produced handed back, so the save stores the page with them in it.
    it("writes the words and answers the document the write produced", async () => {
      const stored = { formatVersion: 1, kind: "page", nodes: [] };
      const { editor, onCommit, openPassages } = drawPanel({
        onCommit: () => stored,
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: FULL_EDITOR_WORDS.open })
        );
      });
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Heading 2" }));
      });
      let answered: unknown;
      act(() => {
        answered = openPassages.finishAll();
      });
      expect(onCommit).toHaveBeenCalledWith("content", heading("Hello"));
      expect(answered).toBe(stored);
      // Finished as Done finishes it: let go, and closed.
      expect(editor.sessions[0]?.detach).toHaveBeenCalled();
      expect(openPassages.isOpen()).toBe(false);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("answers nothing written when nothing changed", async () => {
      const { onCommit, openPassages } = await openFullEditor();
      let answered: unknown = "unset";
      act(() => {
        answered = openPassages.finishAll();
      });
      expect(answered).toBeNull();
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("stays open with the words, answering nothing, when the write is refused", async () => {
      const { editor, openPassages } = drawPanel({ onCommit: () => null });
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: FULL_EDITOR_WORDS.open })
        );
      });
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Heading 2" }));
      });
      let answered: unknown = "unset";
      act(() => {
        answered = openPassages.finishAll();
      });
      expect(answered).toBeNull();
      expect(screen.getByRole("dialog")).not.toBeNull();
      expect(screen.getByText(FULL_EDITOR_WORDS.refused)).not.toBeNull();
      expect(editor.sessions[0]?.detach).not.toHaveBeenCalled();
      expect(openPassages.isOpen()).toBe(true);
    });
  });
});
