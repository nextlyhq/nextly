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

import { useCallback, useEffect, useRef, useState } from "react";

import type { EditorState } from "./editor-state";
import { richInlineTargets, richInlineTextOp } from "./inline-rich-text";
import { namedTarget } from "./inline-target";
import { editableElement, EDITING_ATTRIBUTE } from "./use-inline-text";

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
   */
  begin: (nodeId: string, prop?: string) => boolean;
  /** Finish, writing whatever the author left behind. */
  commit: () => void;
  /** Finish, discarding it. */
  cancel: () => void;
}

/** The four operations the facade hands over, as this module uses them. */
interface LoadedEditor {
  attach(element: HTMLElement, value: unknown): void;
  detach(): void;
  focus(): void;
  read(): unknown;
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

  /** The live editor, the element it holds, and what to put back. */
  const mounted = useRef<{
    editor: LoadedEditor;
    element: HTMLElement;
    /** The markup React rendered, restored on the way out. */
    markup: string;
    /** The editor's own reading of the passage when it opened. */
    baseline: unknown;
  } | null>(null);

  /** Take the subtree back, whatever else happens. */
  const release = useCallback((): unknown => {
    const live = mounted.current;
    mounted.current = null;
    setEditing(null);
    if (live === null) return undefined;
    const next = live.editor.read();
    live.editor.detach();
    live.element.innerHTML = live.markup;
    live.element.removeAttribute(EDITING_ATTRIBUTE);
    return next;
  }, []);

  const commit = useCallback(() => {
    const live = mounted.current;
    const current = editingRef.current;
    const baseline = live?.baseline;
    const next = release();
    if (live === null || current === null) return;
    const op = richInlineTextOp(
      editorRef.current.document,
      current.nodeId,
      current.prop,
      next,
      baseline
    );
    // `null` for an unchanged passage, for one the editor did not return as
    // rich text, and for a value that stopped being editable while the caret
    // was in it — see `richInlineTextOp`.
    if (op !== null) editorRef.current.apply(op);
  }, [release]);

  const cancel = useCallback(() => {
    release();
  }, [release]);

  const begin = useCallback(
    (nodeId: string, prop?: string) => {
      if (load === undefined) return false;
      const target = namedTarget(
        richInlineTargets(editorRef.current.document, nodeId),
        prop
      );
      if (target === undefined) return false;
      setEditing({ nodeId: target.nodeId, prop: target.prop });
      return true;
    },
    [load]
  );

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
    const element = editableElement(globalThis.document, editing);
    if (element === null) {
      // Nothing on screen carries this passage. The node may have been removed
      // between the request and this effect; dropping the edit is the honest
      // answer, and leaving `editing` set would show a caret nobody can see.
      setEditing(null);
      return;
    }

    let cancelled = false;
    const markup = element.innerHTML;
    const targets = richInlineTargets(
      editorRef.current.document,
      editing.nodeId
    );
    const value = targets.find(t => t.prop === editing.prop)?.value;

    void load().then(live => {
      // The author may have left before the chunk arrived. Attaching then would
      // put a caret into a passage they are no longer editing.
      if (cancelled) return;
      live.attach(element, value);
      element.setAttribute(EDITING_ATTRIBUTE, editing.prop);
      live.focus();
      mounted.current = {
        editor: live,
        element,
        markup,
        // Taken AFTER the editor loaded the value, so it is the editor's own
        // reading of an untouched passage — which is what makes an unchanged
        // edit compare equal rather than differing by normalisation alone.
        baseline: live.read(),
      };
    });

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
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("blur", onBlur);
      element.removeEventListener("pointerdown", swallow);
      element.removeEventListener("click", swallow);
      element.removeEventListener("dblclick", swallow);
    };
  }, [editing, load, cancel, commit]);

  return { editing, begin, commit, cancel };
}
