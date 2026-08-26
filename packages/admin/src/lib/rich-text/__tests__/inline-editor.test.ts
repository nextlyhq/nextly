/**
 * The shared inline editor, attached to a real element.
 *
 * These assert what a consumer of the facade cannot check for itself and would
 * otherwise discover only by hand, in a browser, after shipping:
 *
 * - whether an attached element can actually take a caret;
 * - whether the element is given back the way it arrived;
 * - whether a session that lost the editor can still read or tear down the one
 *   that has it.
 *
 * Every one of those is invisible to a test that stubs the loader, which is how
 * the first version of this shipped with an element that could not be typed in.
 *
 * @module lib/rich-text/inline-editor.test
 */
import { describe, expect, it } from "vitest";

import {
  loadInlineRichTextEditor,
  type InlineRichTextEditor,
  type InlineRichTextSession,
} from "../inline-editor";

/**
 * Attach, refusing to continue if the editor declined.
 *
 * Narrows the nullable return without an assertion operator, and fails the case
 * with a sentence rather than a `TypeError` three lines later.
 */
function attached(
  editor: InlineRichTextEditor,
  element: HTMLElement,
  value: unknown
): InlineRichTextSession {
  const session = editor.attach(element, value);
  if (session === null) throw new Error("the editor refused this passage");
  return session;
}

function host(): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = "<p>rendered by the page</p>";
  document.body.append(element);
  return element;
}

const passage = (text: string) => ({
  root: {
    type: "root",
    format: "",
    indent: 0,
    version: 1,
    direction: null,
    children: [
      {
        type: "paragraph",
        format: "",
        indent: 0,
        version: 1,
        direction: null,
        children: [
          {
            type: "text",
            text,
            format: 0,
            style: "",
            mode: "normal",
            detail: 0,
            version: 1,
          },
        ],
      },
    ],
  },
});

describe("attaching the shared editor", () => {
  it("makes the element editable, which Lexical does NOT do itself", async () => {
    /*
     * `setRootElement` writes `data-lexical-editor` and three inline styles and
     * installs its listeners, but it never sets `contentEditable` — it expects
     * an element that already is. An element handed over without it takes no
     * caret and no typing, so the whole feature is inert while every routing
     * test still passes.
     */
    const editor = await loadInlineRichTextEditor();
    const element = host();

    const session = attached(editor, element, passage("Hello"));

    expect(element.getAttribute("contenteditable")).toBe("true");
    session.detach();
  });

  it("reads back the passage it was given", async () => {
    // The round trip, which is what makes a commit meaningful: a session that
    // read nothing would write an empty passage over the author's words.
    const editor = await loadInlineRichTextEditor();
    const session = attached(editor, host(), passage("Hello"));

    expect(JSON.stringify(session.read())).toContain("Hello");
    session.detach();
  });

  it("gives the element back exactly as it arrived", async () => {
    /*
     * Lexical mutates the root and undoes none of it on release: the attribute
     * and the `user-select` / `white-space` / `word-break` styles stay. React
     * never knew they were added, so a canvas would keep `pre-wrap` wrapping
     * for the rest of the session after one edit.
     */
    const editor = await loadInlineRichTextEditor();
    const element = host();
    element.setAttribute("style", "color: red");
    const before = element.getAttribute("style");

    const session = attached(editor, element, passage("Hello"));
    // The treatment is only meaningful if the editor did mutate it.
    expect(element.getAttribute("style")).not.toBe(before);

    session.detach();

    expect(element.getAttribute("style")).toBe(before);
    expect(element.hasAttribute("data-lexical-editor")).toBe(false);
    expect(element.hasAttribute("contenteditable")).toBe(false);
  });
});

describe("a session that no longer owns the editor", () => {
  it("reads nothing rather than the passage that replaced it", async () => {
    // There is ONE editor. A superseded session reading the live state is how
    // one block's words get committed into another block.
    const editor = await loadInlineRichTextEditor();
    const first = attached(editor, host(), passage("FIRST"));
    attached(editor, host(), passage("SECOND"));

    expect(first.read()).toBeUndefined();
  });

  it("does not tear down the attachment that replaced it", async () => {
    // The stale session's own cleanup must not take the live element's editor
    // away — the failure is the second passage going dead mid-edit.
    const editor = await loadInlineRichTextEditor();
    const first = attached(editor, host(), passage("FIRST"));
    const secondElement = host();
    const second = attached(editor, secondElement, passage("SECOND"));

    first.detach();

    expect(secondElement.getAttribute("contenteditable")).toBe("true");
    expect(JSON.stringify(second.read())).toContain("SECOND");
  });
});

describe("a value the editor cannot load", () => {
  it("falls back to an empty passage rather than throwing into the canvas", async () => {
    // Serialization is not safe merely because the shape is: a cycle throws,
    // and an exception here would surface while an author was trying to type.
    const editor = await loadInlineRichTextEditor();
    const cyclic: { root: { type: string; children: unknown[] } } = {
      root: { type: "root", children: [] },
    };
    cyclic.root.children.push(cyclic);

    const session = attached(editor, host(), cyclic);

    expect(session.read()).toBeDefined();
    session.detach();
  });
});

describe("a passage this editor cannot represent", () => {
  it("REFUSES a node type the registry does not know", async () => {
    /*
     * The engine accepts unknown node types deliberately — a site may register
     * more than this editor does — and the renderer draws their children. This
     * editor cannot: `parseEditorState` reports the type through `onError`,
     * which does NOT throw, and hands back an EMPTY root.
     *
     * Loading that makes the baseline empty, so the author's first keystroke
     * commits an empty passage over words that were on the page a moment ago.
     * Refusing leaves the passage exactly as rendered, which is the only
     * outcome that cannot lose their work.
     */
    const editor = await loadInlineRichTextEditor();
    const element = host();
    const before = element.innerHTML;
    const unknown = {
      root: {
        type: "root",
        format: "",
        indent: 0,
        version: 1,
        direction: null,
        children: [
          {
            type: "acme-unregistered",
            version: 1,
            children: [{ type: "text", text: "WORDS", version: 1 }],
          },
        ],
      },
    };

    expect(editor.attach(element, unknown)).toBeNull();
    // Untouched, not merely un-edited: a refusal that still marked the element
    // would leave it editable with nothing behind it.
    expect(element.innerHTML).toBe(before);
    expect(element.hasAttribute("contenteditable")).toBe(false);
  });

  it("ACCEPTS an ordinary passage, so the refusal is not blanket", async () => {
    // The control, and it is load-bearing: a refusal that fired for everything
    // would pass the case above while making the feature useless.
    const editor = await loadInlineRichTextEditor();

    expect(editor.attach(host(), passage("Hello"))).not.toBeNull();
  });
});

describe("the element's CHILDREN", () => {
  it("come back too, not only its attributes", async () => {
    /*
     * `setRootElement` replaces the root's children with the editor's own
     * output, and passing `null` clears them rather than putting the originals
     * back. A caller that opened a passage and changed nothing would otherwise
     * be handed an empty element.
     *
     * Restoring them belongs here rather than in the one consumer that happens
     * to know: this module is what promises to return the element as received,
     * and the facade is documented for plugins that have no such hook.
     */
    const editor = await loadInlineRichTextEditor();
    const element = host();
    const before = element.innerHTML;

    const session = attached(editor, element, passage("Hello"));
    session.detach();

    expect(element.innerHTML).toBe(before);
  });
});
