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
 * which is the second declarer. Handed the four operations it actually needs,
 * it never names a Lexical type and cannot become one.
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

/** The operations the page builder needs to edit a passage in place. */
export interface InlineRichTextEditor {
  /**
   * Hand the editor to an element and load a value into it.
   *
   * Replaces whatever was attached before: the previous element is released
   * first, so an author moving between passages never leaves two live.
   *
   * @param element - the element to edit inside
   * @param value - the stored passage, or anything unusable for an empty one
   */
  attach(element: HTMLElement, value: unknown): void;
  /** Release the current element, leaving the editor idle and reusable. */
  detach(): void;
  /** Put the caret in the attached element. */
  focus(): void;
  /**
   * The passage as it now stands, in the stored shape.
   *
   * `unknown` for the reason the module records: the caller owns the type.
   */
  read(): unknown;
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
  return Array.isArray(children) && children.length > 0
    ? JSON.stringify(value)
    : EMPTY_STATE;
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
  pending ??= build();
  return pending;
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

  /*
   * Torn down on the way out and rebuilt on the way in, which is what keeps the
   * two undo stacks apart.
   *
   * The canvas has its own history over document ops, and a finished edit
   * writes exactly one of them. A history that persisted across passages would
   * let an author undo their way backwards into a block they had already left,
   * with the canvas's own stack disagreeing about what the last change was.
   * Given away at each detach, the editor's history covers only the passage
   * currently open, and the canvas owns everything larger.
   */
  let release: (() => void) | null = null;

  const detach = (): void => {
    release?.();
    release = null;
    editor.setRootElement(null);
  };

  return {
    attach(element, value) {
      // Release first: attaching over a live element leaves the previous one
      // with listeners for an editor that has moved on.
      detach();
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
      };
    },
    detach,
    focus() {
      editor.focus();
    },
    read() {
      return editor.getEditorState().toJSON();
    },
  };
}
