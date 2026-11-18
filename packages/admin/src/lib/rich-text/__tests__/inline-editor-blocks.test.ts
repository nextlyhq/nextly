/**
 * The shared inline editor on a whole passage, as a Rich text is edited: the
 * toolbar's verbs (bold, italic, a link, H2, H3, bullets, numbers and quote)
 * run on the real editor, and what each one stores is read back in the shape
 * the page saves. Pressing a verb a second time on the same block takes it
 * back to a paragraph, as a toolbar's pressed button does.
 *
 * @module lib/rich-text/inline-editor-blocks.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  loadInlineRichTextEditor,
  type InlineAttachOptions,
  type InlineRichTextSession,
  type InlineSelectionState,
} from "../inline-editor";

// Each case's passage and selection go with it, so a later case's editor is
// not handed a selection left in an earlier case's element.
afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

const words = (text: string) => ({ type: "text", text, format: 0 });

const passage = (...blocks: unknown[]) => ({
  root: { type: "root", children: blocks },
});

const paragraph = (text: string) => ({
  type: "paragraph",
  children: [words(text)],
});

async function attach(
  value: unknown,
  options?: InlineAttachOptions
): Promise<{ session: InlineRichTextSession; element: HTMLElement }> {
  const editor = await loadInlineRichTextEditor();
  const element = document.createElement("div");
  document.body.append(element);
  const attachment = editor.attach(element, value, options);
  if (attachment.status === "refused")
    throw new Error(`the editor refused this passage: ${attachment.reason}`);
  return { session: attachment.session, element };
}

/**
 * Let the editor's queued updates land: placing the caret is one, and it is
 * committed on the next microtask, as an author's own selection would be.
 */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

/** The stored passage's top-level blocks. */
function blocksOf(session: InlineRichTextSession): Record<string, unknown>[] {
  const read = session.read() as {
    root: { children: Record<string, unknown>[] };
  };
  return read.root.children;
}

/**
 * Select the first `length` characters of the passage's first text, as an
 * author dragging over them does: the DOM's selection, then the
 * `selectionchange` the editor reads it from.
 */
function selectFirst(element: HTMLElement, length: number): void {
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  const text = walker.nextNode();
  if (text === null) throw new Error("the passage drew no text");
  const range = element.ownerDocument.createRange();
  range.setStart(text, 0);
  range.setEnd(text, length);
  const selection = element.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  element.ownerDocument.dispatchEvent(new Event("selectionchange"));
}

describe("a whole passage's block verbs", () => {
  it("makes the caret's paragraph an H2, and pressing H2 again a paragraph", async () => {
    const { session } = await attach(passage(paragraph("Hello")));
    session.focus(2);
    session.block("h2");
    expect(blocksOf(session)[0]).toMatchObject({ type: "heading", tag: "h2" });
    expect(session.selection()?.block).toBe("h2");
    session.block("h2");
    expect(blocksOf(session)[0]).toMatchObject({ type: "paragraph" });
    expect(session.selection()?.block).toBe("paragraph");
    session.detach();
  });

  it("makes it an H3, and an H2 straight from an H3", async () => {
    const { session } = await attach(passage(paragraph("Hello")));
    session.focus(1);
    session.block("h3");
    expect(blocksOf(session)[0]).toMatchObject({ type: "heading", tag: "h3" });
    session.block("h2");
    expect(blocksOf(session)[0]).toMatchObject({ type: "heading", tag: "h2" });
    session.detach();
  });

  it("makes it a bulleted list, a numbered one, and back to a paragraph", async () => {
    const { session } = await attach(passage(paragraph("Hello")));
    session.focus(1);
    session.block("bullet");
    expect(blocksOf(session)[0]).toMatchObject({
      type: "list",
      listType: "bullet",
      children: [{ type: "listitem", children: [{ text: "Hello" }] }],
    });
    expect(session.selection()?.block).toBe("bullet");
    session.block("number");
    expect(blocksOf(session)[0]).toMatchObject({
      type: "list",
      listType: "number",
    });
    expect(session.selection()?.block).toBe("number");
    session.block("number");
    expect(blocksOf(session)[0]).toMatchObject({
      type: "paragraph",
      children: [{ text: "Hello" }],
    });
    session.detach();
  });

  it("makes it a quote, and a quote an H2", async () => {
    const { session } = await attach(passage(paragraph("Hello")));
    session.focus(1);
    session.block("quote");
    expect(blocksOf(session)[0]).toMatchObject({
      type: "quote",
      children: [{ text: "Hello" }],
    });
    expect(session.selection()?.block).toBe("quote");
    session.block("h2");
    expect(blocksOf(session)[0]).toMatchObject({ type: "heading", tag: "h2" });
    session.detach();
  });

  it("changes only the block the caret is in", async () => {
    const { session } = await attach(
      passage(paragraph("One"), paragraph("Two"))
    );
    // Offset 4 is inside "Two": "One" is three characters.
    session.focus(4);
    session.block("quote");
    expect(blocksOf(session).map(block => block.type)).toEqual([
      "paragraph",
      "quote",
    ]);
    session.detach();
  });

  it("does nothing on a passage held to one paragraph", async () => {
    const { session } = await attach(passage(paragraph("Hello")), {
      paragraph: { restrict: value => ({ value, dropped: false }) },
    });
    session.focus(1);
    session.block("h2");
    expect(blocksOf(session)[0]).toMatchObject({ type: "paragraph" });
    session.detach();
  });
});

describe("a whole passage's marks and links", () => {
  it("makes the selected words bold, then italic", async () => {
    const { session, element } = await attach(
      passage(paragraph("Hello world"))
    );
    session.focus(0);
    await settle();
    selectFirst(element, 5);
    session.format("bold");
    const bold = blocksOf(session)[0]?.children as Record<string, unknown>[];
    expect(bold[0]).toMatchObject({ text: "Hello", format: 1 });
    expect(bold[1]).toMatchObject({ text: " world", format: 0 });
    session.format("italic");
    const both = blocksOf(session)[0]?.children as Record<string, unknown>[];
    expect(both[0]).toMatchObject({ text: "Hello", format: 3 });
    session.detach();
  });

  it("links the selected words, in a new tab when asked", async () => {
    const { session, element } = await attach(
      passage(paragraph("Hello world"))
    );
    session.focus(0);
    await settle();
    selectFirst(element, 5);
    session.link("https://example.com", { newTab: true });
    const children = blocksOf(session)[0]?.children as Record<
      string,
      unknown
    >[];
    expect(children[0]).toMatchObject({
      type: "link",
      url: "https://example.com",
      target: "_blank",
      children: [{ text: "Hello" }],
    });
    session.detach();
  });
});

describe("what a whole passage's selection holds", () => {
  it("is told to the host as the caret moves and the block changes", async () => {
    const told: InlineSelectionState[] = [];
    const { session } = await attach(
      passage(paragraph("One"), {
        type: "heading",
        tag: "h3",
        children: [words("Two")],
      }),
      { onSelection: state => told.push(state) }
    );
    session.focus(4);
    await settle();
    // Told once the caret landed in the H3. Not necessarily last: jsdom
    // answers the editor's own selection write with a late `selectionchange`
    // whose reading depends on earlier cases in the file.
    expect(told.map(state => state.block)).toContain("h3");
    session.block("bullet");
    expect(told.at(-1)?.block).toBe("bullet");
    session.detach();
  });
});
