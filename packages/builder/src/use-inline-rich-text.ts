"use client";

/**
 * Editing a block's passage directly on the canvas.
 *
 * The DOM half of {@link module:inline-rich-text}, which decides WHAT may be
 * edited; this decides how. The split is the same one the plain-text pair
 * makes, and earns its keep the same way: the rules are asserted without a
 * browser, and the part that genuinely needs one stays small enough to read.
 *
 * ## ONE editor, moved between passages
 *
 * The editor is not built here. It is loaded from the admin facade, which hands
 * over four operations rather than Lexical itself — because building an editor
 * means importing Lexical, and a second copy of Lexical anywhere produces nodes
 * that fail their own `instanceof` checks, with content saving and reading back
 * as plain text on documents that already saved.
 *
 * It is loaded on FIRST EDIT rather than on mount. The node classes carry a
 * 630KB chunk, and an author who never edits a passage should never fetch it.
 *
 * ## The subtree is given back exactly as it was found
 *
 * React renders the passage from the document; the editor then owns that DOM
 * for the duration and rewrites it as the author types. When the edit ends,
 * React's picture of the subtree is whatever it last rendered, and the real DOM
 * is whatever the editor left — so a later render would diff against a tree
 * that is no longer there and patch around the editor's nodes.
 *
 * So the markup is snapshotted before the handover and restored after it, on
 * EVERY exit rather than only on cancel. That puts the DOM back in agreement
 * with React, and a committed edit then re-renders from the document the
 * ordinary way, because the op changed it.
 *
 * @module use-inline-rich-text
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { useCallback, useEffect, useRef, useState } from "react";

import type { EditorState } from "./editor-state";
import { richInlineTargets, richInlineTextOp } from "./inline-rich-text";
import { namedTarget } from "./inline-target";
import { editableElement, EDITING_ATTRIBUTE } from "./use-inline-text";

/**
 * Where the caret sits inside an element, as a character offset into its text.
 *
 * Counted rather than kept as a DOM range, because attaching REBUILDS the
 * subtree: a range captured now points at nodes that will not be in the
 * document by the time there is an editor to hand it to. An offset survives
 * that, and it is what the gesture meant.
 *
 * `undefined` when there is no selection, when it is not inside this element,
 * or when the runtime has no selection at all — every one of which means "no
 * better answer than the editor's own", not an error.
 */
function caretOffsetIn(element: HTMLElement): number | undefined {
  const selection = element.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return undefined;
  const upToCaret = range.cloneRange();
  upToCaret.selectNodeContents(element);
  upToCaret.setEnd(range.startContainer, range.startOffset);
  return upToCaret.toString().length;
}

/** Which passage is being edited. */
export interface InlineRichTextEditing {
  readonly nodeId: string;
  readonly prop: string;
}

export interface UseInlineRichTextResult {
  /** The passage being edited, or `null` when none is. */
  editing: InlineRichTextEditing | null;
  /**
   * Start editing a passage, reporting whether it could be.
   *
   * `prop` defaults to the block's FIRST declared rich value, which is what a
   * keyboard caller wants: it has a selected block and no element.
   *
   * `element` is the one a pointer landed on. A caller that has it should pass
   * it: finding the element again from the document alone searches the whole
   * page, and two canvases showing one document carry the same node ids — so
   * the search can answer with the other canvas's passage, attaching there
   * while committing here.
   */
  begin: (nodeId: string, prop?: string, element?: HTMLElement) => boolean;
  /**
   * Finish, writing whatever the author left behind.
   *
   * Returns the document the write produced, or `null` when there was nothing
   * to write. A caller that is about to hand the document somewhere else needs
   * that: its own copy is the one from before this commit.
   */
  commit: () => BlockDocument | null;
  /** Finish, discarding it. */
  cancel: () => void;
}

/** One consumer's hold on the shared editor, as this module uses it. */
interface EditorSession {
  focus(at?: number): void;
  read(): unknown;
  detach(): void;
}

/** The facade's editor, as this module uses it. */
interface LoadedEditor {
  /** `null` when the editor refuses this passage — see the facade for when. */
  attach(element: HTMLElement, value: unknown): EditorSession | null;
}

/**
 * How the editor is fetched.
 *
 * A parameter rather than a hard import so the rules of this hook can be
 * exercised without loading Lexical — and because the editor is genuinely
 * optional: a builder embedded somewhere that never supplies one still edits
 * plain text, and a passage simply does not open.
 */
export type InlineRichTextEditorLoader = () => Promise<LoadedEditor>;

/**
 * @param editor - the editor state whose document is being edited
 * @param load - how to obtain the shared rich-text editor
 * @returns the current edit and the ways in and out
 */
export function useInlineRichText(
  editor: EditorState,
  load: InlineRichTextEditorLoader | undefined
): UseInlineRichTextResult {
  const [editing, setEditing] = useState<InlineRichTextEditing | null>(null);

  /*
   * Read through refs inside the callbacks below rather than captured as
   * dependencies, so a commit is decided against the document as it stands now
   * rather than the one that was current when the caret went in.
   */
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const editingRef = useRef(editing);
  editingRef.current = editing;

  /**
   * The element a pointer handed over, used in place of searching for one.
   *
   * A ref rather than state: it is read once by the effect that follows the
   * `begin` it came with, and re-rendering for it would be a render nobody
   * needs.
   */
  const handed = useRef<HTMLElement | null>(null);

  /** The live editor, the element it holds, and what to put back. */
  const mounted = useRef<{
    session: EditorSession;
    element: HTMLElement;
    /**
     * WHICH passage this session was mounted for.
     *
     * Recorded with the session rather than read from the hook's current state
     * when the write happens. A caller that begins a second passage before the
     * first has released changes that state first, and the cleanup that follows
     * would then read the live session — the first passage — while addressing
     * the op with the second's node and prop, copying one block's words over
     * another. Bound here, a session can only ever write to the passage it was
     * opened for.
     */
    editing: InlineRichTextEditing;
    /** The editor's own reading of the passage when it opened. */
    baseline: unknown;
  } | null>(null);

  /** Take the subtree back, whatever else happens. */
  const release = useCallback((): unknown => {
    const live = mounted.current;
    mounted.current = null;
    setEditing(null);
    if (live === null) return undefined;
    // Read BEFORE detaching: a detached session answers nothing, deliberately,
    // so that a superseded one cannot read the live passage.
    const next = live.session.read();
    // The element's markup and attributes are the editor's to put back: it is
    // what changed them, and it is what a plugin using the facade directly
    // relies on. Only this module's own mark is this module's to remove.
    live.session.detach();
    live.element.removeAttribute(EDITING_ATTRIBUTE);
    return next;
  }, []);

  const commit = useCallback(() => {
    const live = mounted.current;
    const baseline = live?.baseline;
    const next = release();
    if (live === null) return null;
    // The passage this session was opened for, not whichever is current now.
    const op = richInlineTextOp(
      editorRef.current.document,
      live.editing.nodeId,
      live.editing.prop,
      next,
      baseline
    );
    // `null` for an unchanged passage, for one the editor did not return as
    // rich text, and for a value that stopped being editable while the caret
    // was in it — see `richInlineTextOp`.
    return op === null ? null : editorRef.current.apply(op);
  }, [release]);

  const cancel = useCallback(() => {
    release();
  }, [release]);

  const begin = useCallback(
    (nodeId: string, prop?: string, element?: HTMLElement) => {
      if (load === undefined) return false;
      const target = namedTarget(
        richInlineTargets(editorRef.current.document, nodeId),
        prop
      );
      if (target === undefined) return false;
      handed.current = element ?? null;
      setEditing({ nodeId: target.nodeId, prop: target.prop });
      return true;
    },
    [load]
  );

  /*
   * Drop an edit the author has already walked away from.
   *
   * The editor arrives asynchronously, and until it does the element is neither
   * focused nor editable — this module marks it inside `attach`. So none of the
   * ordinary ways of leaving a block emit `blur`: clicking the canvas
   * background, selecting another block, or deselecting from the keyboard each
   * change only the selection. Nothing would cancel the pending load, and when
   * it landed it would attach to the passage they left and take the caret back.
   *
   * Only a load that has NOT attached yet is dropped this way. Once the editor
   * is live the element is focused, leaving it blurs, and blur commits — so
   * cancelling here as well would throw away what the author had just typed.
   */
  useEffect(() => {
    if (editing === null || mounted.current !== null) return;
    if (editor.selectedId === editing.nodeId) return;
    cancel();
  }, [editor.selectedId, editing, cancel]);

  /*
   * Hand the subtree over, and take it back on the way out.
   *
   * In an effect rather than in `begin` so the handover happens after React has
   * finished rendering: attaching an editor mid-render fights whatever the
   * renderer is about to commit.
   */
  useEffect(() => {
    if (editing === null || load === undefined) return;
    if (globalThis.document === undefined) return;
    // The element the gesture landed on, when there was one. Searching the
    // document is the fallback for a keyboard caller, which has no element.
    const element =
      handed.current ?? editableElement(globalThis.document, editing);
    handed.current = null;
    if (element === null) {
      // Nothing on screen carries this passage. The node may have been removed
      // between the request and this effect; dropping the edit is the honest
      // answer, and leaving `editing` set would show a caret nobody can see.
      setEditing(null);
      return;
    }

    let cancelled = false;
    // Read now, while the element still holds what the page rendered. The
    // editor replaces this subtree, so afterwards there is nothing to measure.
    const caret = caretOffsetIn(element);
    const targets = richInlineTargets(
      editorRef.current.document,
      editing.nodeId
    );
    const value = targets.find(t => t.prop === editing.prop)?.value;

    void load().then(
      live => {
        /*
         * The author may have left before the chunk arrived. Attaching then
         * would put a caret into a passage they are no longer editing.
         *
         * All three conditions are asked, because `cancelled` alone is not
         * enough: it is set by an effect CLEANUP, and this callback can run
         * before React has flushed that — so a selection that has already moved
         * is visible here while the cleanup that would record it has not run.
         */
        if (cancelled) return;
        if (editingRef.current !== editing) return;
        if (editorRef.current.selectedId !== editing.nodeId) return;
        const session = live.attach(element, value);
        if (session === null) {
          /*
           * The editor refused this passage — it holds a node this editor
           * cannot represent, and loading it would hand back less than the
           * document has. Dropping the edit leaves the passage as the page
           * rendered it, which is the only outcome that cannot lose the words.
           */
          setEditing(null);
          return;
        }
        element.setAttribute(EDITING_ATTRIBUTE, editing.prop);
        session.focus(caret);
        mounted.current = {
          session,
          element,
          editing,
          // Taken AFTER the editor loaded the value, so it is the editor's own
          // reading of an untouched passage — which is what makes an unchanged
          // edit compare equal rather than differing by normalisation alone.
          baseline: session.read(),
        };
      },
      () => {
        /*
         * The chunk did not arrive. Leaving `editing` set would show a passage
         * marked as being edited with no editor behind it — and because the
         * element then swallows the double-click that would retry, the author
         * would be locked out of it for the rest of the session.
         *
         * Dropping the edit puts the gesture back in their hands. The loader
         * discards its rejected promise, so the next double-click genuinely
         * tries again rather than replaying the failure.
         */
        if (!cancelled) setEditing(null);
      }
    );

    /*
     * Stopped at the element rather than by teaching the canvas about editing.
     * Selection and dragging both listen on the canvas root, so a press inside
     * the passage would start a drag instead of placing the caret — and the
     * rule belongs to the element that is currently something else.
     */
    const swallow = (event: Event) => event.stopPropagation();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };

    /*
     * Leaving the passage finishes the edit, as it does for plain text. Enter
     * is deliberately NOT an exit here: a passage holds paragraphs, so Enter
     * belongs to the value.
     */
    const onBlur = () => commit();

    element.addEventListener("keydown", onKeyDown);
    element.addEventListener("blur", onBlur);
    element.addEventListener("pointerdown", swallow);
    element.addEventListener("click", swallow);
    element.addEventListener("dblclick", swallow);
    return () => {
      cancelled = true;
      /*
       * Give the element back on the way out, not only when the author leaves
       * the passage. Unmounting the canvas — a navigation, a field removed,
       * access revoked — removes the focused element without reliably firing
       * `blur`, so nothing else would run: the editor would stay attached to a
       * detached tree, holding its listeners and its state, until some later
       * passage displaced it.
       */
      /*
       * COMMITTED, not discarded. Rich keystrokes go into the editor's own
       * history and never touch the document until an edit finishes, so the
       * canvas op history — which is what the unsaved-work guard reads — is
       * still at zero while a passage is being typed. Detaching without writing
       * would drop the words AND leave the guard silent about it, so a
       * navigation nobody warned about takes the work with it.
       */
      if (mounted.current !== null) commit();
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("blur", onBlur);
      element.removeEventListener("pointerdown", swallow);
      element.removeEventListener("click", swallow);
      element.removeEventListener("dblclick", swallow);
    };
  }, [editing, load, cancel, commit]);

  return { editing, begin, commit, cancel };
}
