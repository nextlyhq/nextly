/**
 * ONE rich-text editor, moved between the elements an author edits in place.
 *
 * The page builder lets an author type into a passage on the canvas. Every such
 * passage is the same kind of value, and Lexical's own model separates the
 * editor from the DOM it is currently attached to — `setRootElement` associates
 * an instance with an element, and passing another element moves it. So one
 * instance serves every block, created the first time an author edits anything
 * and never again.
 *
 * ## Why one instance rather than one per block
 *
 * The node classes bring Lexical and PrismJS with them, measured at 630KB. A
 * builder that mounted an editor per block would pay that once but hold as many
 * editor states, command listeners and history stacks as the page has passages
 * — and Lexical's own ecosystem does not support several simultaneously live
 * regions in one instance, which is the arrangement this deliberately avoids by
 * keeping at most ONE passage live at a time.
 *
 * That is also the honest model of the interaction: a caret is in one place.
 *
 * ## Why the builder is handed a controller and not the editor
 *
 * The one-copy rule for Lexical is enforced by keeping it bundled here rather
 * than shared as a peer, because its node classes are recognised by
 * `instanceof` and a second declarer anywhere in the dependency graph produces
 * nodes that fail their own type checks — with content saving and reading back
 * as plain text, silently.
 *
 * A consumer handed `createEditor` would have to import Lexical to call it,
 * which is the second declarer. Handed an
 * attachment instead, it never names a Lexical type and cannot become one.
 *
 * ## What it refuses, and why refusing is the safe answer
 *
 * This editor registers one node set. A stored passage may contain a node it
 * does not know — the engine accepts unknown types deliberately, and the
 * renderer draws their children — and `parseEditorState` answers that with an
 * EMPTY root rather than an exception. It may also contain a decorator node,
 * whose visible output comes from `decorate()` and is mounted by the React
 * plugin this raw editor does not use.
 *
 * Either way the editor would hold less than the document does, and the first
 * keystroke would write that back. So `attach` answers `null` and the passage
 * stays exactly as the page rendered it.
 *
 * ## Values cross this boundary as `unknown`
 *
 * Deliberately. The stored shape is defined once, in the blocks engine, and
 * this package does not depend on it; restating it here would be a second
 * declaration of one format, which is the failure the shared definition exists
 * to prevent. The caller narrows with the engine's own predicate, which is
 * structural precisely because the value arrives as parsed JSON.
 *
 * @module lib/rich-text/inline-editor
 */

import type { EditorState, LexicalNode } from "lexical";

/** One consumer's hold on the shared editor, for as long as it owns it. */
export interface InlineRichTextSession {
  /**
   * Put the caret in the attached element.
   *
   * `at` is a character offset into the passage's text — where the author's
   * gesture landed. Without one the caret goes wherever the editor puts it,
   * which is the END of the passage: `focus()` calls `root.selectEnd()` when
   * the state carries no selection, and a freshly parsed state never does. So
   * a caller that knows where the author clicked must say so, or their first
   * keystroke appends to the end of the passage instead of editing the word
   * they double-clicked.
   */
  focus(at?: number): void;
  /**
   * The passage as it now stands, in the stored shape.
   *
   * `undefined` once this session has been superseded or detached, because the
   * editor has moved and its state is another passage's. Answering with that
   * state instead is how one block's words get written into another.
   */
  read(): unknown;
  /**
   * Release the element, if this session still owns it.
   *
   * A no-op once superseded, for the same reason `read` answers nothing: the
   * root belongs to whoever attached last, and tearing it down from a stale
   * session takes the live one's editor away.
   */
  detach(): void;
  /**
   * Keep this attachment against a later request to move the editor.
   *
   * There is ONE editor behind every consumer, so ownership is global while a
   * decision to preserve an edit is local to whoever made it. A consumer that
   * has refused to write — because the words exist only in this editor and
   * nowhere else — has to say so HERE, or the next `attach` from anywhere,
   * including another canvas with its own hook, supersedes it and the words go
   * with it.
   *
   * Cleared by detaching, which is the only way this attachment ends — so a
   * holder MUST detach. There is one editor for the whole admin, and a hold
   * left standing refuses every later attachment anywhere in it; nothing times
   * it out, because an editor that let go on a timer would lose the words at a
   * moment nobody chose.
   */
  hold(): void;
}

/** Why the editor would not take a passage. */
export type InlineRichTextRefusal =
  /**
   * This passage cannot be represented here — a node type the registry does not
   * know, a decorator, or a value that will not serialize. Nothing about it
   * changes by waiting.
   */
  | "unsupported"
  /**
   * The editor is HELD by an attachment protecting words that exist nowhere
   * else. A different value entirely, and the only thing that resolves it is
   * finishing the edit that is holding on — which is why a caller has to be
   * able to tell the two apart rather than seeing one absence.
   */
  | "held";

/** What asking for the editor produced. */
export type InlineRichTextAttachment =
  | { readonly status: "attached"; readonly session: InlineRichTextSession }
  | { readonly status: "refused"; readonly reason: InlineRichTextRefusal };

/** The one operation the page builder needs; everything else hangs off it. */
export interface InlineRichTextEditor {
  /**
   * Hand the editor to an element and load a value into it.
   *
   * Supersedes any previous attachment: the element it held is released and
   * restored first, so an author moving between passages never leaves two live.
   *
   * Refused when this passage must NOT be edited here — see the module for the
   * cases — and when the live attachment is HELD, because superseding one that
   * is deliberately keeping an author's unwritten words would destroy exactly
   * what holding it protects. Refusing leaves the passage as the page rendered
   * it, which is the only outcome that cannot lose an author's work.
   *
   * The reason is STATED rather than left as an absence: a host can do nothing
   * about a passage this editor cannot represent, and can do something about an
   * editor that is busy — at minimum say so, since the author's gesture
   * otherwise appears to do nothing at all.
   *
   * @param element - the element to edit inside
   * @param value - the stored passage, or anything unusable for an empty one
   * @returns the caller's hold on the editor, or why it was refused
   */
  attach(element: HTMLElement, value: unknown): InlineRichTextAttachment;
}

/**
 * An empty passage, which is ONE empty paragraph rather than nothing.
 *
 * Lexical refuses an editor state with no children, and a root with none also
 * renders to nothing at all — leaving an author an element with no line to put
 * a caret on.
 */
const EMPTY_STATE = JSON.stringify({
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
        children: [],
      },
    ],
  },
});

/**
 * The value to load, as Lexical takes it.
 *
 * A stored passage is used only when it carries a root with children. Anything
 * else — a string left by a document written before the prop was rich, a null,
 * a half-written object — becomes an empty passage rather than an exception
 * thrown into the canvas while an author is trying to type.
 *
 * Checked structurally rather than by the engine's predicate because this
 * package cannot depend on it; the check is narrower here on purpose, asking
 * only what Lexical itself will refuse.
 */
function loadable(value: unknown): string | null {
  const children = (
    value as { root?: { children?: unknown } } | null | undefined
  )?.root?.children;
  // Optional chaining answers `undefined` for a primitive and for null alike,
  // so the three ways a value can fail to be a passage collapse into one test.
  // NOT a passage at all: an empty one is the right reading, and there is
  // nothing to lose by starting from empty.
  if (!Array.isArray(children) || children.length === 0) return EMPTY_STATE;
  /*
   * It IS a passage, so failing to serialize it is a different answer.
   *
   * Serialization is not safe merely because the shape is: a cycle throws, a
   * `BigInt` throws, a `toJSON` returning nothing yields `undefined`, and
   * `JSON.stringify` itself recurses — a validly stored passage nested a few
   * thousand containers deep raises `RangeError` while sitting far below the
   * document's byte cap.
   *
   * Reading any of those as "empty" would hand the editor an empty passage over
   * content that is really there, and the author's first keystroke would commit
   * it. `null` refuses instead, and the passage stays as the page rendered it.
   */
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

/** The build in flight or already finished, so concurrent callers share one. */
let pending: Promise<InlineRichTextEditor> | null = null;

/**
 * Load the shared inline editor, building it on first use.
 *
 * Await it wherever it is needed. The dynamic import is cached by the module
 * system and the instance is cached here, so every call after the first is
 * cheap and returns the SAME editor — which is what makes the node classes one
 * set rather than one set per caller.
 */
export async function loadInlineRichTextEditor(): Promise<InlineRichTextEditor> {
  pending ??= build().catch((error: unknown) => {
    // A REJECTED promise must not be the cached one. The chunk request fails
    // for reasons that pass — a dropped connection, a deployment swapping the
    // asset out from under an open tab — and keeping the rejection would make
    // every later attempt fail identically until the page was reloaded, with
    // nothing on screen explaining why editing had stopped working.
    pending = null;
    throw error;
  });
  return pending;
}

/**
 * What the editor changes about an element it is given, and how to put it back.
 *
 * `setRootElement` mutates the root: it writes `data-lexical-editor` and three
 * inline styles, and it does NOT set `contentEditable` — the editor expects an
 * element that is already editable, so an element handed over without it takes
 * no caret and no typing. It also does not undo any of this on release.
 *
 * The caller cannot be asked to know that. Whatever this module turns on, it
 * turns off again, so an element comes back the way it arrived rather than
 * keeping `white-space: pre-wrap` on a published canvas for the rest of the
 * session.
 */
interface RootMarks {
  readonly contentEditable: string | null;
  readonly style: string | null;
  readonly lexical: string | null;
  /**
   * Written by the editor on FOCUS rather than on attach, which is why
   * restoring the three above is not enough.
   *
   * Measured: focusing sets `off`, and releasing the root removes the attribute
   * outright. So an element that arrived WITHOUT one is already returned as it
   * came; what is lost is an element that arrived WITH a value, which comes
   * back with none — changing how a mobile keyboard behaves in a host that
   * reuses the element for anything else.
   */
  readonly autocapitalize: string | null;
  /**
   * The child NODES the element arrived with — the nodes themselves, not their
   * markup.
   *
   * `setRootElement` replaces the root's children with the editor's own
   * reconciled output, and passing `null` clears them rather than putting the
   * originals back. Restoring only attributes would leave a caller that edited
   * nothing holding an empty element.
   *
   * Reparsing the markup would look identical and be wrong. The caller here is
   * React: it rendered those children and its fibers still point at the exact
   * node objects. Reinserting freshly-parsed copies leaves those fibers
   * addressing nodes that are no longer in the document, so the next render
   * updates detached nodes while the canvas keeps showing the stale copies —
   * and nothing reports it, because the markup compares equal.
   */
  readonly children: readonly ChildNode[];
}

function markRoot(element: HTMLElement): RootMarks {
  const marks: RootMarks = {
    contentEditable: element.getAttribute("contenteditable"),
    style: element.getAttribute("style"),
    lexical: element.getAttribute("data-lexical-editor"),
    autocapitalize: element.getAttribute("autocapitalize"),
    children: [...element.childNodes],
  };
  element.setAttribute("contenteditable", "true");
  return marks;
}

/** Restores an attribute, removing it when it was absent to begin with. */
function restore(element: HTMLElement, name: string, was: string | null): void {
  if (was === null) element.removeAttribute(name);
  else element.setAttribute(name, was);
}

function unmarkRoot(element: HTMLElement, marks: RootMarks): void {
  /*
   * The original node objects, not copies of them — see {@link RootMarks}.
   *
   * Collected into a fragment and inserted as ONE argument rather than spread:
   * a spread passes every child as an argument, and a passage long enough
   * exceeds the call's own argument limit — turning a restore into a throw on
   * the way out of an edit, which is the worst possible moment for one.
   */
  const restored = element.ownerDocument.createDocumentFragment();
  for (const child of marks.children) restored.append(child);
  element.replaceChildren(restored);
  restore(element, "contenteditable", marks.contentEditable);
  restore(element, "style", marks.style);
  restore(element, "data-lexical-editor", marks.lexical);
  restore(element, "autocapitalize", marks.autocapitalize);
}

async function build(): Promise<InlineRichTextEditor> {
  const [
    { createEditor, $isDecoratorNode, $isElementNode, $isTextNode, $getRoot },
    { registerRichText },
    { registerList, registerCheckList },
    { registerTablePlugin, registerTableSelectionObserver },
    { registerCodeHighlighting },
    history,
    kit,
  ] = await Promise.all([
    import("lexical"),
    import("@lexical/rich-text"),
    import("@lexical/list"),
    import("@lexical/table"),
    import("@lexical/code-prism"),
    import("@lexical/history"),
    import("@admin/components/features/entries/fields/special/rich-text-kit"),
  ]);

  const { nodes, theme } = kit.richTextEditorKit();
  /**
   * Whether the editor reported a problem since this was last cleared.
   *
   * `onError` is how Lexical reports a node type it does not recognise, and it
   * does NOT throw — `parseEditorState` returns an EMPTY root instead. Logging
   * and continuing would install that empty state as the passage, so the first
   * keystroke commits it and the author's words are gone with nothing raised.
   *
   * Recorded here rather than inferred from the parsed result, because an empty
   * root is also what an empty passage legitimately parses to.
   */
  /**
   * Whether a parsed passage contains a node whose output this editor cannot
   * mount.
   *
   * Asked of Lexical's own predicate rather than a list of type names kept
   * here: the registry is shared with the CMS field and gains nodes without
   * this module hearing about it, and a list would answer "no decorators" for
   * the one that was added last.
   */
  const holdsDecorator = (state: EditorState): boolean =>
    state.read(() => {
      const stack: LexicalNode[] = [$getRoot()];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node === undefined) continue;
        if ($isDecoratorNode(node)) return true;
        if ($isElementNode(node))
          for (const child of node.getChildren()) stack.push(child);
      }
      return false;
    });

  /**
   * Puts the caret at a character offset into the passage.
   *
   * Counted across the passage's text rather than addressed as a DOM position,
   * because attaching REBUILDS the element's subtree — a range captured before
   * the handover points at nodes that are no longer in the document by the time
   * there is an editor to give it to. A character offset survives that, and it
   * is what the author's gesture meant anyway.
   *
   * An offset past the end simply leaves the caret wherever the walk ran out,
   * which is the end — the same place it would have gone with no offset at all.
   */
  const placeCaret = (offset: number): void => {
    editor.update(() => {
      let remaining = offset;
      const stack: LexicalNode[] = [$getRoot()];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node === undefined) continue;
        if ($isTextNode(node)) {
          const size = node.getTextContentSize();
          if (remaining <= size) {
            node.select(remaining, remaining);
            return;
          }
          remaining -= size;
          continue;
        }
        if (!$isElementNode(node)) continue;
        const kids = node.getChildren();
        for (let i = kids.length - 1; i >= 0; i--) {
          const kid = kids[i];
          if (kid !== undefined) stack.push(kid);
        }
      }
    });
  };

  let reportedError = false;

  const editor = createEditor({
    namespace: "nextly-canvas-inline",
    nodes: [...nodes],
    theme,
    // Recorded and logged rather than thrown, matching the field editor. An
    // exception raised inside an update would otherwise take down the canvas
    // around the author rather than the one passage that produced it.
    onError: (error: Error) => {
      reportedError = true;
      console.error("[inline-rich-text] Lexical error:", error);
    },
  });

  /**
   * The attachment that currently owns the editor.
   *
   * There is one editor, so there is one owner. Sessions compare against this
   * rather than holding a flag of their own: a stale session must be able to
   * tell that it was superseded, and only the shared value knows.
   */
  let owner: object | null = null;

  /** Undoes whatever the live attachment did, in the reverse order it did it. */
  let release: (() => void) | null = null;

  /**
   * Whether the live attachment has asked not to be moved.
   *
   * Kept HERE rather than in the session, because what it guards is the shared
   * editor: the request to supersede arrives through `attach`, from a consumer
   * that knows nothing about whoever holds it now.
   */
  let held = false;

  const detachCurrent = (): void => {
    release?.();
    release = null;
    owner = null;
    held = false;
  };

  return {
    attach(element, value) {
      /*
       * A held attachment is never superseded.
       *
       * Asked FIRST, before parsing and before anything is touched: the answer
       * cannot depend on the incoming passage, because what is being protected
       * is the outgoing one. A consumer holds when it has refused to write and
       * the author's words exist only inside this editor — so moving it, for
       * any reason, is the one thing that loses them.
       */
      if (held) return { status: "refused", reason: "held" };
      /*
       * Parsed BEFORE anything is touched, so a passage this editor cannot
       * represent leaves the element exactly as the page rendered it.
       *
       * Two things can go wrong and both end the same way — an editor holding
       * less than the document does, which the next keystroke writes back:
       *
       * - a node type this registry does not know. The engine accepts unknown
       *   nodes deliberately and the renderer draws their children, so a
       *   passage can legitimately contain one; this editor cannot.
       * - a decorator node — an image, a gallery, a video, a button. Their
       *   visible output comes from `decorate()` and is mounted by the React
       *   plugin this raw editor does not use, so they would vanish from the
       *   canvas for the duration of the edit and could not be selected.
       * - a passage that cannot be serialized at all, which is not the same as
       *   an absent one — see {@link loadable}.
       */
      const json = loadable(value);
      if (json === null) return { status: "refused", reason: "unsupported" };
      reportedError = false;
      const parsed = editor.parseEditorState(json);
      if (reportedError || holdsDecorator(parsed))
        return { status: "refused", reason: "unsupported" };

      /*
       * Released only once the new passage is known to be acceptable.
       *
       * Detaching first would destroy a live edit on behalf of a passage this
       * editor then refuses: the previous session goes stale, its `read()`
       * answers nothing, and whatever the author had already typed into it is
       * unrecoverable — spent on a request that was never going to succeed.
       *
       * Parsing does not touch the live editor, so asking first costs nothing.
       */
      detachCurrent();

      const token = {};
      owner = token;
      const marks = markRoot(element);
      editor.setEditorState(parsed);
      editor.setRootElement(element);
      const stopRichText = registerRichText(editor);
      /*
       * Lists behave like lists, which the generic handler alone does not give.
       * Without it Enter on an empty list item asks `ListItemNode` to insert
       * another one, so an author cannot leave a list by the gesture every
       * editor uses — and list nodes ARE accepted here, so a stored list is
       * reachable. The field editor mounts `ListPlugin` for the same reason;
       * this is that plugin's imperative half.
       */
      const stopList = registerList(editor);
      /*
       * And checklists respond to being clicked. Toggling one lives in its own
       * behaviour, which the field editor mounts as `CheckListPlugin` — without
       * it a checkbox in a stored passage renders and does nothing, so an
       * author can see the item and cannot tick it.
       *
       * Registered rather than refused, unlike the decorator nodes: a checklist
       * IS drawable and editable by this editor, it simply needed its handler.
       */
      const stopCheckList = registerCheckList(editor);
      /*
       * A table needs its own two registrations, and the SELECTION OBSERVER is
       * the one that matters here. It is what intercepts Tab and moves the
       * caret to the next cell — without it Tab moves browser FOCUS out of the
       * root, which blurs, and a blur commits. So an author tabbing between
       * cells would find the passage closed and written instead of the caret
       * one cell along.
       */
      const stopTable = registerTablePlugin(editor);
      const stopTableSelection = registerTableSelectionObserver(editor);
      /*
       * And a code block retokenizes as it is edited. Its highlight classes are
       * stored ON the nodes, so without this the old classification stays
       * attached to changed text and `read()` persists it — a keyword edited
       * into an identifier is saved still marked as a keyword, and the
       * published page styles it that way.
       */
      const stopCodeHighlighting = registerCodeHighlighting(editor);
      const stopHistory = history.registerHistory(
        editor,
        history.createEmptyHistoryState(),
        300
      );
      release = () => {
        stopRichText();
        stopList();
        stopCheckList();
        stopTableSelection();
        stopTable();
        stopCodeHighlighting();
        stopHistory();
        editor.setRootElement(null);
        unmarkRoot(element, marks);
      };

      const owns = (): boolean => owner === token;
      const session: InlineRichTextSession = {
        focus(at) {
          if (!owns()) return;
          // Placed BEFORE focusing: `focus()` keeps a selection that already
          // exists and invents one at the end only when there is none.
          if (at !== undefined) placeCaret(at);
          editor.focus();
        },
        read() {
          // Nothing rather than another passage's state. A superseded session
          // reading the live editor is how one block's words reach another.
          return owns() ? editor.getEditorState().toJSON() : undefined;
        },
        detach() {
          if (owns()) detachCurrent();
        },
        hold() {
          // Only the live owner may hold. A superseded session asking for this
          // would freeze the editor on behalf of an edit that is already gone.
          if (owns()) held = true;
        },
      };
      return { status: "attached", session };
    },
  };
}
