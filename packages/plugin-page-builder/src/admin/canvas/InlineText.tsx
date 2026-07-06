"use client";

/**
 * Inline (Elementor-style) canvas text editing. Text blocks become `contentEditable` while
 * selected so the author types directly on the canvas. Two constraints drive the design:
 *  1. The canvas lives in an iframe, so React synthetic events don't reach it — we bind a
 *     NATIVE `input` listener to sync edits back to the store.
 *  2. The text is UNCONTROLLED (managed via a ref, children set to null): React never rewrites
 *     it while typing, so the caret never jumps. `useLayoutEffect` re-seeds it only when the
 *     prop actually differs from the DOM (e.g. undo), and before paint (no flash).
 */
import {
  cloneElement,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactElement,
} from "react";

import type { BlockNode } from "../../core/types";
import { useEditor } from "../store/EditorProvider";

/** Blocks whose primary text is inline-editable on the canvas → their text prop name. */
export const INLINE_TEXT_PROP: Record<string, string> = {
  "core/paragraph": "text",
  "core/heading": "text",
  "core/button": "text",
};

export function InlineText({
  node,
  textProp,
  element,
  editing,
  forwardedRef,
}: {
  node: BlockNode;
  textProp: string;
  element: ReactElement<Record<string, unknown>>;
  editing: boolean;
  forwardedRef: (el: Element | null) => void;
}) {
  const { dispatch } = useEditor();
  const ref = useRef<HTMLElement | null>(null);
  const raw = node.props[textProp];
  const text = typeof raw === "string" ? raw : "";

  // Seed / re-sync text from props via the DOM, only when it differs — so our own typing
  // (which we dispatch) never resets the caret. Before paint → no flash.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== text) el.textContent = text;
  }, [text]);

  // Native input listener (React onInput can't cross the iframe boundary).
  useEffect(() => {
    const el = ref.current;
    if (!el || !editing) return;
    const onInput = () =>
      dispatch({
        type: "UPDATE_PROPS",
        id: node.id,
        props: { [textProp]: el.textContent ?? "" },
      });
    el.addEventListener("input", onInput);
    return () => el.removeEventListener("input", onInput);
  }, [editing, node.id, textProp, dispatch]);

  // On entering edit mode, focus and drop the caret at the end of the text.
  useLayoutEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    const doc = el.ownerDocument;
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = doc.defaultView?.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  const setRef = (el: Element | null) => {
    ref.current = el as HTMLElement | null;
    forwardedRef(el);
  };

  return cloneElement(
    element,
    {
      ref: setRef,
      "data-nx-id": node.id,
      contentEditable: editing || undefined,
      suppressContentEditableWarning: true,
      style: editing
        ? {
            ...(element.props.style as object),
            outline: "none",
            cursor: "text",
          }
        : element.props.style,
    },
    null // text is managed via the ref (uncontrolled)
  );
}
