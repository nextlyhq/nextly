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
  it("REFUSES one it cannot serialize, rather than treating it as empty", async () => {
    /*
     * Serialization is not safe merely because the shape is. A cycle throws, a
     * `BigInt` throws, and `JSON.stringify` itself recurses — a validly stored
     * passage nested a few thousand containers deep raises `RangeError` while
     * sitting far below the document's byte cap.
     *
     * Reading any of those as "empty" is the same data loss the unknown-node
     * refusal closes: the editor holds nothing, the author types, and the
     * commit replaces real content with the empty tree.
     */
    const editor = await loadInlineRichTextEditor();
    const element = host();
    const before = element.innerHTML;
    const cyclic: { root: { type: string; children: unknown[] } } = {
      root: { type: "root", children: [] },
    };
    cyclic.root.children.push(cyclic);

    expect(editor.attach(element, cyclic)).toBeNull();
    expect(element.innerHTML).toBe(before);
    expect(element.hasAttribute("contenteditable")).toBe(false);
  });

  it("still reads a value that is simply ABSENT as an empty passage", async () => {
    /*
     * The control, and the distinction the refusal turns on: a prop holding
     * nothing is not a passage that failed to serialize. Refusing it too would
     * make a newly inserted block impossible to type into — which is how a
     * guard against data loss becomes a feature that never opens.
     */
    const editor = await loadInlineRichTextEditor();

    expect(editor.attach(host(), undefined)).not.toBeNull();
    expect(
      editor.attach(host(), { root: { type: "root", children: [] } })
    ).not.toBeNull();
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

  it("are the SAME nodes, not freshly parsed copies of them", async () => {
    /*
     * The caller is React: it rendered those children and its fibers still hold
     * the exact node objects. Reinserting parsed copies compares equal as
     * markup and is still wrong — the fibers then address nodes that are no
     * longer in the document, so the next render writes the new passage into
     * detached nodes while the canvas goes on showing the stale copies.
     *
     * Identity is the only thing that separates the two, which is why the
     * markup assertion above cannot stand in for this one.
     */
    const editor = await loadInlineRichTextEditor();
    const element = host();
    const original = element.firstChild;

    const session = attached(editor, element, passage("Hello"));
    // Meaningful only if the editor actually took the children away first.
    expect(element.firstChild).not.toBe(original);

    session.detach();

    expect(element.firstChild).toBe(original);
  });
});

describe("an attachment that is holding an author's words", () => {
  /*
   * There is ONE editor behind every consumer, so ownership is global while the
   * decision to preserve an edit is local to whoever made it. Two canvases
   * mounted at once run two hooks; the second sees nothing of the first's state
   * and would attach straight over the top of words that exist nowhere else.
   * The rule therefore has to live at this boundary, not in a consumer.
   */
  it("refuses to hand the editor to anything else", async () => {
    const editor = await loadInlineRichTextEditor();
    const first = host();
    const session = attached(editor, first, passage("Words only in here"));

    session.hold();

    expect(editor.attach(host(), passage("Somewhere else"))).toBeNull();
    // Still live, which is the point of refusing: a superseded session reads
    // nothing, and that is exactly what holding it prevents.
    expect(session.read()).not.toBeUndefined();

    /*
     * Released before leaving, and NOT as tidiness — the editor is a singleton
     * shared by this whole module, so a hold left standing refuses every later
     * attachment in the process. That is the contract working, and it is the
     * obligation a holder takes on: whoever holds must detach.
     */
    session.detach();
  });

  it("hands it over once the hold has ended", async () => {
    // The control. A refusal that never lifted would pass the case above and
    // freeze the editor on the first passage anyone ever edited.
    const editor = await loadInlineRichTextEditor();
    const first = host();
    const session = attached(editor, first, passage("Words only in here"));
    session.hold();
    session.detach();

    expect(editor.attach(host(), passage("Somewhere else"))).not.toBeNull();
  });

  it("ignores a hold from a session that has already been superseded", async () => {
    // Otherwise a stale consumer freezes the editor on behalf of an edit that
    // is already gone, and nothing can ever attach again.
    const editor = await loadInlineRichTextEditor();
    const stale = attached(editor, host(), passage("First"));
    attached(editor, host(), passage("Second"));

    stale.hold();

    expect(editor.attach(host(), passage("Third"))).not.toBeNull();
  });
});

describe("what FOCUSING the editor leaves behind", () => {
  it("records that focusing writes the attribute at all", async () => {
    /*
     * The premise, not the fix. Measured: focusing writes
     * `autocapitalize="off"`, and releasing the root REMOVES it — so an element
     * that arrived without one ends without one whether or not this module
     * restores anything, and this case passes either way.
     *
     * Kept because it is what makes the next case the only one that needs a
     * fix, and because "the editor sets this on focus" is the fact the whole
     * pair rests on: if a version stopped doing it, the case below would go
     * green for the wrong reason and nothing else would notice.
     */
    const editor = await loadInlineRichTextEditor();
    const element = host();
    expect(element.hasAttribute("autocapitalize")).toBe(false);

    const session = attached(editor, element, passage("Hello"));
    session.focus();
    expect(element.getAttribute("autocapitalize")).toBe("off");

    session.detach();

    expect(element.hasAttribute("autocapitalize")).toBe(false);
  });

  it("gives back the value an element already had", async () => {
    const editor = await loadInlineRichTextEditor();
    const element = host();
    element.setAttribute("autocapitalize", "sentences");

    const session = attached(editor, element, passage("Hello"));
    session.focus();
    session.detach();

    expect(element.getAttribute("autocapitalize")).toBe("sentences");
  });
});
