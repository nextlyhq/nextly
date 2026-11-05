// @vitest-environment jsdom

/**
 * Escape while typing on the canvas keeps what was typed, as the editor's
 * design asks: it ends the edit, and the next Escape selects the block's
 * parent. It used to throw the typing away, which an author pressing Escape to
 * get out of the text met as lost work.
 *
 * @module use-inline-escape.test
 */
import {
  hasBlock,
  RICH_TEXT_PROP_TYPE,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { useInlineRichText } from "./use-inline-rich-text";
import { useInlineText } from "./use-inline-text";

afterEach(() => {
  document.body.innerHTML = "";
});

function registerArticle(): void {
  if (hasBlock("acme/escape-article")) return;
  registerBlocks(
    [
      {
        version: 1,
        description: "A block.",
        example: { props: {} },
        render: () => null,
        name: "acme/escape-article",
        props: {
          content: { type: RICH_TEXT_PROP_TYPE, inline: true },
          caption: { type: "text", inline: true },
        },
      },
    ] as never,
    { source: "use-inline-escape-test" }
  );
}

function editorState(): EditorState & { apply: ReturnType<typeof vi.fn> } {
  const nodes = [
    {
      id: "a",
      type: "acme/escape-article",
      version: 1,
      props: { caption: "A caption" },
    } as BlockNode,
  ];
  const document = { formatVersion: 1, kind: "page", nodes } as BlockDocument;
  return {
    document,
    selectedId: "a",
    apply: vi.fn(() => document),
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
}

/** The editor's document with the article's caption, or its lock, changed. */
function documentWith(
  editor: EditorState,
  change: { caption?: string; locked?: boolean }
): BlockDocument {
  const [article] = editor.document.nodes;
  if (article === undefined) throw new Error("no article");
  return {
    ...editor.document,
    nodes: [
      {
        ...article,
        ...(change.locked === undefined ? {} : { locked: change.locked }),
        props: {
          ...article.props,
          ...(change.caption === undefined ? {} : { caption: change.caption }),
        },
      },
    ],
  };
}

/** A passage session whose reads answer, in turn, each of `reads`. */
function passageLoader(reads: readonly unknown[]) {
  let at = 0;
  const attach = vi.fn(() => ({
    status: "attached",
    session: {
      focus: () => {},
      read: () => reads[Math.min(at++, reads.length - 1)],
      detach: () => {},
      hold: () => {},
    },
  }));
  return vi.fn(async () => ({ attach }));
}

const STORED = { root: { type: "root", children: [] } };
function typedPassage(text: string) {
  return {
    root: {
      type: "root",
      children: [{ type: "paragraph", children: [{ type: "text", text }] }],
    },
  };
}

/** The page, marked the way the renderer marks it. */
function page(): void {
  document.body.innerHTML = `
    <div class="nx-canvas">
      <div data-nx-node="a">
        <div data-nx-prop="content"><p>A passage</p></div>
        <span data-nx-prop="caption">A caption</span>
      </div>
    </div>`;
}

/** One Escape keydown; `repeat` is what a held key's auto-repeat sends. */
function escape(element: Element, repeat = false): void {
  element.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, repeat })
  );
}

describe("Escape while typing", () => {
  it("keeps the typing in a line of text, and ends the edit", () => {
    registerArticle();
    page();
    const editor = editorState();
    const { result } = renderHook(() => useInlineText(editor));
    act(() => {
      result.current.begin("a", "caption");
    });
    const caption = document.querySelector('[data-nx-prop="caption"]');
    if (caption === null) throw new Error("no caption");
    caption.textContent = "A better caption";

    act(() => escape(caption));

    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(editor.apply.mock.calls[0]?.[0])).toContain(
      "A better caption"
    );
    expect(result.current.editing).toBeNull();
    expect(caption.textContent).toBe("A better caption");
  });

  it("leaves a line open when the write is refused, and lets it go on a second Escape", () => {
    // A refused write (a size cap, a lock that arrived) stores nothing, so
    // the words on screen are the author's only copy until they choose to
    // let them go.
    registerArticle();
    page();
    const editor = editorState();
    editor.apply.mockImplementation(() => null);
    const { result } = renderHook(() => useInlineText(editor));
    act(() => {
      result.current.begin("a", "caption");
    });
    const caption = document.querySelector('[data-nx-prop="caption"]');
    if (caption === null) throw new Error("no caption");
    caption.textContent = "A better caption";

    act(() => escape(caption));
    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(result.current.editing).not.toBeNull();
    expect(caption.textContent).toBe("A better caption");

    // A held key repeats; that is not a second, deliberate press.
    act(() => escape(caption, true));
    expect(result.current.editing).not.toBeNull();
    expect(caption.textContent).toBe("A better caption");

    act(() => escape(caption));
    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(result.current.editing).toBeNull();
    expect(caption.textContent).toBe("A caption");
  });

  it("tries a revised line again after a refusal, rather than discarding it", () => {
    // Refused at a cap, the author shortens the line: the next Escape is a
    // new write, not the confirmation that lets the words go.
    registerArticle();
    page();
    const editor = editorState();
    const stored = editor.document;
    editor.apply
      .mockImplementationOnce(() => null)
      .mockImplementation(() => stored);
    const { result } = renderHook(() => useInlineText(editor));
    act(() => {
      result.current.begin("a", "caption");
    });
    const caption = document.querySelector('[data-nx-prop="caption"]');
    if (caption === null) throw new Error("no caption");
    caption.textContent = "A caption far too long";
    act(() => escape(caption));
    expect(result.current.editing).not.toBeNull();

    caption.textContent = "A shorter caption";
    act(() => escape(caption));
    expect(editor.apply).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(editor.apply.mock.calls[1]?.[0])).toContain(
      "A shorter caption"
    );
    expect(result.current.editing).toBeNull();
    expect(caption.textContent).toBe("A shorter caption");
  });

  it("holds a line whose block was locked while it was typed", () => {
    // The lock refuses the write before it is made; the words are still the
    // author's only copy, and stay until a second Escape lets them go.
    registerArticle();
    page();
    const editor = editorState();
    const finished = vi.fn();
    const { result } = renderHook(() => useInlineText(editor, finished));
    act(() => {
      result.current.begin("a", "caption");
    });
    const caption = document.querySelector('[data-nx-prop="caption"]');
    if (caption === null) throw new Error("no caption");
    caption.textContent = "A better caption";
    Object.assign(editor, { document: documentWith(editor, { locked: true }) });

    act(() => escape(caption));
    expect(editor.apply).not.toHaveBeenCalled();
    expect(result.current.editing).not.toBeNull();
    expect(caption.textContent).toBe("A better caption");
    // Said, so the line staying open is not read as a key that did nothing.
    expect(finished).toHaveBeenCalledWith({
      status: "refused",
      reason: "no-longer-editable",
    });

    act(() => escape(caption));
    expect(result.current.editing).toBeNull();
  });

  it("never writes over a line another surface changed while it was typed", () => {
    // Opened as "A caption", typed as "Mine", changed elsewhere to "Theirs":
    // writing "Mine" would silently replace the newer value.
    registerArticle();
    page();
    const editor = editorState();
    const finished = vi.fn();
    const { result } = renderHook(() => useInlineText(editor, finished));
    act(() => {
      result.current.begin("a", "caption");
    });
    const caption = document.querySelector('[data-nx-prop="caption"]');
    if (caption === null) throw new Error("no caption");
    caption.textContent = "Mine";
    Object.assign(editor, {
      document: documentWith(editor, { caption: "Theirs" }),
    });

    act(() => escape(caption));
    expect(editor.apply).not.toHaveBeenCalled();
    expect(result.current.editing).not.toBeNull();
    expect(caption.textContent).toBe("Mine");
    expect(finished).toHaveBeenCalledWith({
      status: "refused",
      reason: "moved-on",
    });
  });

  it("never writes over a moved-on line when it is left by a click away", () => {
    // Blur is a way out like Escape, and takes the same decision: the line
    // stays with the words in it, and the newer value is not written over.
    registerArticle();
    page();
    const editor = editorState();
    const finished = vi.fn();
    const { result } = renderHook(() => useInlineText(editor, finished));
    act(() => {
      result.current.begin("a", "caption");
    });
    const caption = document.querySelector('[data-nx-prop="caption"]');
    if (caption === null) throw new Error("no caption");
    caption.textContent = "Mine";
    Object.assign(editor, {
      document: documentWith(editor, { caption: "Theirs" }),
    });

    act(() => {
      caption.dispatchEvent(new FocusEvent("blur"));
    });
    expect(editor.apply).not.toHaveBeenCalled();
    expect(result.current.editing).not.toBeNull();
    expect(finished).toHaveBeenCalledWith({
      status: "refused",
      reason: "moved-on",
    });
  });

  it("never writes over a moved-on line when the host finishes it, and says it was lost", () => {
    // The host's commit cannot leave the line open, since it is closing or
    // opening something else; it gives the line back without the write.
    registerArticle();
    page();
    const editor = editorState();
    const finished = vi.fn();
    const { result } = renderHook(() => useInlineText(editor, finished));
    act(() => {
      result.current.begin("a", "caption");
    });
    const caption = document.querySelector('[data-nx-prop="caption"]');
    if (caption === null) throw new Error("no caption");
    caption.textContent = "Mine";
    Object.assign(editor, {
      document: documentWith(editor, { caption: "Theirs" }),
    });

    act(() => {
      result.current.commit();
    });
    expect(editor.apply).not.toHaveBeenCalled();
    expect(result.current.editing).toBeNull();
    expect(finished).toHaveBeenCalledWith({ status: "discarded" });
  });

  it("tries a revised passage again after a refusal, rather than discarding it", async () => {
    registerArticle();
    page();
    const editor = editorState();
    const stored = editor.document;
    editor.apply
      .mockImplementationOnce(() => null)
      .mockImplementation(() => stored);
    // The baseline, the refused write, the check on the second press, and the
    // revised write.
    const load = passageLoader([
      STORED,
      typedPassage("Too long"),
      typedPassage("Short"),
      typedPassage("Short"),
    ]);
    const { result } = renderHook(() =>
      useInlineRichText(editor, load as never)
    );
    await act(async () => {
      result.current.begin("a", "content");
    });
    const passage = document.querySelector('[data-nx-prop="content"]');
    if (passage === null) throw new Error("no passage");
    await act(async () => escape(passage));
    expect(result.current.editing).not.toBeNull();

    await act(async () => escape(passage));
    expect(editor.apply).toHaveBeenCalledTimes(2);
    expect(result.current.editing).toBeNull();
  });

  it("holds a passage whose block was locked while it was typed", async () => {
    registerArticle();
    page();
    const editor = editorState();
    const load = passageLoader([STORED, typedPassage("Typed")]);
    const { result } = renderHook(() =>
      useInlineRichText(editor, load as never)
    );
    await act(async () => {
      result.current.begin("a", "content");
    });
    const passage = document.querySelector('[data-nx-prop="content"]');
    if (passage === null) throw new Error("no passage");
    Object.assign(editor, { document: documentWith(editor, { locked: true }) });

    await act(async () => escape(passage));
    expect(editor.apply).not.toHaveBeenCalled();
    expect(result.current.editing).not.toBeNull();

    await act(async () => escape(passage));
    expect(result.current.editing).toBeNull();
  });

  it("keeps the typing in a passage, and ends the edit", async () => {
    registerArticle();
    page();
    const editor = editorState();
    // What the passage held when it opened, then what the author typed: the
    // editor reads the first as its baseline and the second when it writes.
    const stored = { root: { type: "root", children: [] } };
    const typed = {
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", text: "Typed" }] },
        ],
      },
    };
    let reads = 0;
    const attach = vi.fn(() => ({
      status: "attached",
      session: {
        focus: () => {},
        read: () => (reads++ === 0 ? stored : typed),
        detach: () => {},
        hold: () => {},
      },
    }));
    const load = vi.fn(async () => ({ attach }));
    const { result } = renderHook(() =>
      useInlineRichText(editor, load as never)
    );
    await act(async () => {
      result.current.begin("a", "content");
    });
    const passage = document.querySelector('[data-nx-prop="content"]');
    if (passage === null) throw new Error("no passage");

    await act(async () => escape(passage));

    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(result.current.editing).toBeNull();
  });

  it("leaves a passage open when the write is refused, and lets it go on a second Escape", async () => {
    // The words are the author's only copy: a refused write keeps them on
    // screen, and the second Escape is the deliberate way out.
    registerArticle();
    page();
    const editor = editorState();
    editor.apply.mockImplementation(() => null);
    let reads = 0;
    const stored = { root: { type: "root", children: [] } };
    const typed = {
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", text: "Typed" }] },
        ],
      },
    };
    const attach = vi.fn(() => ({
      status: "attached",
      session: {
        focus: () => {},
        read: () => (reads++ === 0 ? stored : typed),
        detach: () => {},
        hold: () => {},
      },
    }));
    const load = vi.fn(async () => ({ attach }));
    const { result } = renderHook(() =>
      useInlineRichText(editor, load as never)
    );
    await act(async () => {
      result.current.begin("a", "content");
    });
    const passage = document.querySelector('[data-nx-prop="content"]');
    if (passage === null) throw new Error("no passage");

    await act(async () => escape(passage));
    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(result.current.editing).not.toBeNull();

    // Holding the key down repeats it; the repeat must not discard.
    await act(async () => escape(passage, true));
    expect(result.current.editing).not.toBeNull();

    await act(async () => escape(passage));
    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(result.current.editing).toBeNull();
  });
});
