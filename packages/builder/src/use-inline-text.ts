"use client";

/**
 * Typing a block's text directly on the canvas.
 *
 * The DOM half of {@link module:inline-text}, which decides WHAT may be edited;
 * this decides how. The split is the same one the rest of this package makes,
 * and here it earns its keep twice over: the rules are asserted without a
 * browser, and the parts that genuinely need one are small enough to read.
 *
 * ## The element is left UNCONTROLLED while the caret is in it
 *
 * No op is dispatched per keystroke. React renders the canvas from the
 * document, so an edit that wrote through on every character would re-render
 * the element the author is typing into and move the caret out from under
 * them — the standard failure of `contentEditable` inside a framework that
 * owns the DOM. Every editor that does this well hands the element over for
 * the duration: Gutenberg, Lexical and Puck all do.
 *
 * So the document is untouched until the edit finishes, and finishing writes
 * ONE op. That also gives the behaviour an author expects from undo: a
 * sentence typed and then undone comes back as a sentence, not as forty
 * characters.
 *
 * The visible cost is that the inspector shows the value the document holds
 * rather than the letters being typed, until the edit is committed. That is
 * the same rule the blocks field itself follows when it commits its document
 * on exit, and one editor with two answers about when a change counts is
 * worse than a panel that updates a moment later.
 *
 * ## `plaintext-only`, with a fallback that still cannot store markup
 *
 * The values here are plain text, and `contenteditable="plaintext-only"` is
 * what stops a paste bringing markup, a bold shortcut inserting a `<b>`, and
 * Enter inserting a `<div>`. Where a browser does not support it the attribute
 * falls back to ordinary editing, so the commit reads `textContent` — which is
 * text whatever the element ended up containing.
 *
 * @module use-inline-text
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { useCallback, useEffect, useRef, useState } from "react";

import type { EditorState } from "./editor-state";
import { namedTarget } from "./inline-target";
import { inlineTarget, inlineTargets, inlineTextOp } from "./inline-text";

/** The attribute naming the element an author is currently typing into. */
export const EDITING_ATTRIBUTE = "data-nx-editing";

/** Which value is being edited. */
export interface InlineTextEditing {
  readonly nodeId: string;
  readonly prop: string;
}

export interface UseInlineTextResult {
  /** The value being edited, or `null` when none is. */
  editing: InlineTextEditing | null;
  /**
   * Start editing a value, reporting whether it could be.
   *
   * `prop` defaults to the block's FIRST declared inline value, which is what
   * a keyboard caller wants: it has a selected block and no element.
   */
  begin: (nodeId: string, prop?: string) => boolean;
  /**
   * Finish, writing whatever the author left behind.
   *
   * Returns the document the write produced, or `null` when there was nothing
   * to write — a caller about to hand the document elsewhere holds the one from
   * before this commit.
   */
  commit: () => BlockDocument | null;
  /** Finish, discarding it. */
  cancel: () => void;
  /**
   * Enter an edit from a double-click on the canvas.
   *
   * Handed to `Canvas` rather than attached here, because the canvas owns its
   * own root and a second listener on the same tree would be a second place
   * the gesture is decided.
   */
  onDoubleClick: (event: { target: EventTarget | null }) => void;
}

/**
 * The element the author is typing into, found from what they double-clicked.
 *
 * Walks UP from the event target rather than reading it: a click lands on
 * whatever leaf is under the pointer, and the element carrying the mark may be
 * an ancestor of it.
 */
function editableFrom(target: EventTarget | null): {
  element: HTMLElement;
  prop: string;
  nodeId: string;
} | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>("[data-nx-prop]");
  if (element === null) return null;
  const prop = element.getAttribute("data-nx-prop");
  const owner = element.closest("[data-nx-node]");
  const nodeId = owner?.getAttribute("data-nx-node") ?? null;
  if (prop === null || nodeId === null) return null;
  return { element, prop, nodeId };
}

/**
 * The element carrying a value, found from the rendered tree rather than from a
 * click.
 *
 * For a keyboard caller, which has a selected node and no element. The node id
 * is compared in JavaScript rather than interpolated into the selector: it
 * reaches this from stored data, and putting it in a selector makes any
 * character CSS treats specially either throw or match something else. The prop
 * name is a key from the block's own schema and is escaped rather than
 * compared, because it addresses an element that may have no other handle.
 *
 * Exported for its own test. Which element holds a value is the part of this
 * module that varies per block, and it is not observable from the hook's
 * result — a wrong answer here shows up as an edit that quietly never starts.
 */
export function editableElement(
  root: ParentNode,
  editing: InlineTextEditing
): HTMLElement | null {
  const owners = root.querySelectorAll<HTMLElement>("[data-nx-node]");
  let found: HTMLElement | null = null;
  // `forEach` rather than `for…of`: a `NodeList` is only iterable under a lib
  // that declares its iterator, and this package compiles without one.
  owners.forEach(owner => {
    if (found !== null) return;
    if (owner.getAttribute("data-nx-node") !== editing.nodeId) return;
    // The owner ITSELF first. A block whose text is its own root element — an
    // unlinked heading is exactly this, carrying both attributes on one `<h2>`
    // — is missed entirely by a descendant search, and the failure is silent:
    // the edit never begins and the key reads as broken.
    if (owner.getAttribute("data-nx-prop") === editing.prop) {
      found = owner;
      return;
    }
    owner.querySelectorAll<HTMLElement>("[data-nx-prop]").forEach(candidate => {
      if (found !== null) return;
      if (candidate.getAttribute("data-nx-prop") !== editing.prop) return;
      // Not a value belonging to a block nested inside this one. Blocks nest,
      // so without this a container answers with its child's text and the
      // caret lands in a block the author did not select.
      if (candidate.closest("[data-nx-node]") !== owner) return;
      found = candidate;
    });
  });
  return found;
}

/** Put the caret across the whole value, so typing replaces it. */
function selectAll(element: HTMLElement): void {
  const selection = element.ownerDocument.defaultView?.getSelection();
  if (!selection) return;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * @param editor - the editor state whose document is being edited
 * @returns the current edit, the ways in and out, and the canvas handler
 */
export function useInlineText(editor: EditorState): UseInlineTextResult {
  const [editing, setEditing] = useState<InlineTextEditing | null>(null);
  /** The element handed over for the duration, so the exit can find it again. */
  const elementRef = useRef<HTMLElement | null>(null);

  /*
   * Read through refs inside the listeners below rather than captured as
   * dependencies. The listeners are attached once per edit, and closing over
   * these would pin the document they saw when the caret went in — so a commit
   * would be decided against a document that may have changed underneath.
   */
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const editingRef = useRef(editing);
  editingRef.current = editing;

  /** Take the element back, whatever else happens. */
  const release = useCallback(() => {
    const element = elementRef.current;
    elementRef.current = null;
    setEditing(null);
    if (element === null) return;
    element.removeAttribute("contenteditable");
    element.removeAttribute(EDITING_ATTRIBUTE);
    return element;
  }, []);

  const commit = useCallback(() => {
    const element = elementRef.current;
    const current = editingRef.current;
    // `textContent` rather than `innerText` or `innerHTML`: the first is what
    // the value IS regardless of what the element ended up containing, and the
    // last would store markup this value cannot hold.
    const next = element?.textContent ?? null;
    release();
    if (current === null || next === null) return null;
    const op = inlineTextOp(
      editorRef.current.document,
      current.nodeId,
      current.prop,
      next
    );
    // `null` for an unchanged value and for one that stopped being editable
    // while the caret was in it — see `inlineTextOp`.
    return op === null ? null : editorRef.current.apply(op);
  }, [release]);

  const cancel = useCallback(() => {
    const element = elementRef.current;
    const current = editingRef.current;
    // Put back what the document holds before letting go. Without it the
    // abandoned text stays on screen until something else re-renders the
    // canvas, and the author sees an edit they explicitly discarded.
    if (element !== null && current !== null) {
      const target = inlineTarget(
        editorRef.current.document,
        current.nodeId,
        current.prop
      );
      if (target !== null) element.textContent = target.value;
    }
    release();
  }, [release]);

  const begin = useCallback((nodeId: string, prop?: string) => {
    const target = namedTarget(
      inlineTargets(editorRef.current.document, nodeId),
      prop
    );
    if (target === undefined) return false;
    setEditing({ nodeId: target.nodeId, prop: target.prop });
    return true;
  }, []);

  const onDoubleClick = useCallback(
    (event: { target: EventTarget | null }) => {
      const found = editableFrom(event.target);
      if (found === null) return;
      if (begin(found.nodeId, found.prop)) elementRef.current = found.element;
    },
    [begin]
  );

  /*
   * Hand the element over, and take it back on the way out.
   *
   * In an effect rather than in `begin` so the handover happens after React has
   * finished rendering: setting `contentEditable` and focusing mid-render
   * fights whatever the renderer is about to commit.
   */
  useEffect(() => {
    if (editing === null) return;
    const element =
      elementRef.current ??
      (globalThis.document === undefined
        ? null
        : editableElement(globalThis.document, editing));
    if (element === null) {
      // Nothing on screen carries this value. The node may have been removed
      // between the request and this effect; dropping the edit is the honest
      // answer, and leaving `editing` set would show a caret nobody can see.
      setEditing(null);
      return;
    }
    elementRef.current = element;

    element.setAttribute("contenteditable", "plaintext-only");
    element.setAttribute(EDITING_ATTRIBUTE, editing.prop);
    element.focus();
    selectAll(element);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      if (event.key !== "Enter") return;
      const target = inlineTarget(
        editorRef.current.document,
        editing.nodeId,
        editing.prop
      );
      // Enter belongs to the VALUE: a line break in a paragraph, and the way
      // out of a heading. The schema says which, so a block changing a field
      // from one type to the other changes this with it.
      if (target?.multiline === true) return;
      event.preventDefault();
      commit();
    };
    /*
     * Stopped at the element rather than by teaching the canvas about editing.
     * Selection and dragging both listen on the canvas root, so a press inside
     * the text would start a drag instead of placing the caret — and the rule
     * belongs to the element that is currently something else.
     */
    const swallow = (event: Event) => event.stopPropagation();

    element.addEventListener("keydown", onKeyDown);
    element.addEventListener("blur", commit);
    element.addEventListener("pointerdown", swallow);
    element.addEventListener("click", swallow);
    element.addEventListener("dblclick", swallow);
    return () => {
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("blur", commit);
      element.removeEventListener("pointerdown", swallow);
      element.removeEventListener("click", swallow);
      element.removeEventListener("dblclick", swallow);
    };
  }, [editing, cancel, commit]);

  return { editing, begin, commit, cancel, onDoubleClick };
}
