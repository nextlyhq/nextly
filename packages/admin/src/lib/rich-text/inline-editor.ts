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

/** One consumer's hold on the shared editor, for as long as it owns it. */
export interface InlineRichTextSession {
  /** Put the caret in the attached element. */
  focus(): void;
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
}

/** The one operation the page builder needs; everything else hangs off it. */
export interface InlineRichTextEditor {
  /**
   * Hand the editor to an element and load a value into it.
   *
   * Supersedes any previous attachment: the element it held is released and
   * restored first, so an author moving between passages never leaves two live.
   *
   * @param element - the element to edit inside
   * @param value - the stored passage, or anything unusable for an empty one
   * @returns the caller's hold on the editor for as long as it owns it
   */
  attach(element: HTMLElement, value: unknown): InlineRichTextSession;
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
function loadable(value: unknown): string {
  const children = (
    value as { root?: { children?: unknown } } | null | undefined
  )?.root?.children;
  // Optional chaining answers `undefined` for a primitive and for null alike,
  // so the three ways a value can fail to be a passage collapse into one test.
  if (!Array.isArray(children) || children.length === 0) return EMPTY_STATE;
  // Serialization is not safe merely because the shape is. The value is stored
  // JSON as far as the type says, but a caller can hand over a live object: a
  // cycle throws, a `BigInt` throws, and a `toJSON` returning nothing yields
  // `undefined`. Every one of those would otherwise surface as an exception
  // thrown into the canvas while an author is trying to type.
  try {
    const json = JSON.stringify(value);
    return json ?? EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
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
}

function markRoot(element: HTMLElement): RootMarks {
  const marks: RootMarks = {
    contentEditable: element.getAttribute("contenteditable"),
    style: element.getAttribute("style"),
    lexical: element.getAttribute("data-lexical-editor"),
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
  restore(element, "contenteditable", marks.contentEditable);
  restore(element, "style", marks.style);
  restore(element, "data-lexical-editor", marks.lexical);
}

async function build(): Promise<InlineRichTextEditor> {
  const [{ createEditor }, { registerRichText }, history, kit] =
    await Promise.all([
      import("lexical"),
      import("@lexical/rich-text"),
      import("@lexical/history"),
      import("@admin/components/features/entries/fields/special/rich-text-kit"),
    ]);

  const { nodes, theme } = kit.richTextEditorKit();
  const editor = createEditor({
    namespace: "nextly-canvas-inline",
    nodes: [...nodes],
    theme,
    // Logged rather than thrown, matching the field editor. An exception raised
    // inside an update would otherwise take down the canvas around the author
    // rather than the one passage that produced it.
    onError: (error: Error) => {
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

  const detachCurrent = (): void => {
    release?.();
    release = null;
    owner = null;
  };

  return {
    attach(element, value) {
      // Released first. Attaching over a live element leaves the previous one
      // marked editable, styled by the editor and carrying listeners for an
      // editor that has moved on.
      detachCurrent();

      const token = {};
      owner = token;
      const marks = markRoot(element);
      editor.setEditorState(editor.parseEditorState(loadable(value)));
      editor.setRootElement(element);
      const stopRichText = registerRichText(editor);
      const stopHistory = history.registerHistory(
        editor,
        history.createEmptyHistoryState(),
        300
      );
      release = () => {
        stopRichText();
        stopHistory();
        editor.setRootElement(null);
        unmarkRoot(element, marks);
      };

      const owns = (): boolean => owner === token;
      return {
        focus() {
          if (owns()) editor.focus();
        },
        read() {
          // Nothing rather than another passage's state. A superseded session
          // reading the live editor is how one block's words reach another.
          return owns() ? editor.getEditorState().toJSON() : undefined;
        },
        detach() {
          if (owns()) detachCurrent();
        },
      };
    },
  };
}
