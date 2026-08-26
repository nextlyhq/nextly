"use client";

/**
 * One double-click, routed to whichever surface owns the value under it.
 *
 * A block declares a value editable on the canvas; what that MEANS depends on
 * the value. A line of text is handed to a `contenteditable` element and read
 * back as a string; a passage is handed to a rich-text editor and read back as
 * a tree. An author performs the same gesture for both and should not have to
 * know which they are about to get.
 *
 * So the gesture is decided ONCE, here, rather than by two handlers on one
 * tree. Two would each see every double-click and each decide whether it was
 * theirs, and the failure mode is the pair disagreeing: both open, and the two
 * editors fight over one element — or neither does, and the value reads as
 * simply not editable.
 *
 * The kind is asked of the block's schema through the shared classifier, which
 * is the same answer the two rule modules use to decide what they offer. The
 * routing cannot drift from what the surfaces accept, because it is not a
 * second opinion about which values are whose.
 *
 * @module use-inline-editing
 */

import { getBlock, findNode } from "@nextlyhq/blocks-engine";
import { useCallback } from "react";

import type { EditorState } from "./editor-state";
import { inlinePropKind } from "./inline-prop-kind";
import {
  useInlineRichText,
  type InlineRichTextEditing,
  type InlineRichTextEditorLoader,
} from "./use-inline-rich-text";
import { useInlineText, type InlineTextEditing } from "./use-inline-text";

export interface UseInlineEditingResult {
  /** The plain value being edited, or `null`. */
  editing: InlineTextEditing | null;
  /** The passage being edited, or `null`. Never set at the same time as {@link editing}. */
  editingRich: InlineRichTextEditing | null;
  /**
   * Start editing a value, reporting whether it could be.
   *
   * Routed by the prop's declared kind, so a keyboard caller with a selected
   * block gets whichever surface that block's first inline value asks for.
   */
  begin: (nodeId: string, prop?: string) => boolean;
  /** Finish whichever edit is open, writing what the author left behind. */
  commit: () => void;
  /** Finish whichever edit is open, discarding it. */
  cancel: () => void;
  /** Enter an edit from a double-click on the canvas. */
  onDoubleClick: (event: { target: EventTarget | null }) => void;
}

/** What a double-click landed on, or `null` when it was not on a value. */
function markedAt(target: EventTarget | null): {
  nodeId: string;
  prop: string;
} | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>("[data-nx-prop]");
  if (element === null) return null;
  const prop = element.getAttribute("data-nx-prop");
  const nodeId = element
    .closest("[data-nx-node]")
    ?.getAttribute("data-nx-node");
  if (prop === null || nodeId === null || nodeId === undefined) return null;
  return { nodeId, prop };
}

/**
 * @param editor - the editor state whose document is being edited
 * @param loadRichText - how to obtain the shared rich-text editor, when there is one
 * @returns one edit at a time, and the canvas handler that starts it
 */
export function useInlineEditing(
  editor: EditorState,
  loadRichText?: InlineRichTextEditorLoader
): UseInlineEditingResult {
  const plain = useInlineText(editor);
  const rich = useInlineRichText(editor, loadRichText);

  /** The kind the block declared for this value, or `null` if it declared none. */
  const kindOf = useCallback(
    (nodeId: string, prop: string) => {
      const node = findNode(editor.document.nodes, nodeId);
      if (node === undefined) return null;
      return inlinePropKind(getBlock(node.type)?.props?.[prop]);
    },
    [editor]
  );

  const begin = useCallback(
    (nodeId: string, prop?: string) => {
      // Without a named prop the caller wants the block's first inline value,
      // and only the surfaces know which that is. Rich is asked first and
      // answers false when the block has no passage, so a block with only
      // plain values is unaffected.
      if (prop === undefined) return rich.begin(nodeId) || plain.begin(nodeId);
      return kindOf(nodeId, prop) === "rich"
        ? rich.begin(nodeId, prop)
        : plain.begin(nodeId, prop);
    },
    [kindOf, plain, rich]
  );

  const commit = useCallback(() => {
    // Both are asked, and at most one is open. Asking only the one believed to
    // be open would leave the other's edit hanging whenever that belief was
    // wrong, and each is a no-op when it holds nothing.
    plain.commit();
    rich.commit();
  }, [plain, rich]);

  const cancel = useCallback(() => {
    plain.cancel();
    rich.cancel();
  }, [plain, rich]);

  const onDoubleClick = useCallback(
    (event: { target: EventTarget | null }) => {
      const found = markedAt(event.target);
      if (found === null) return;
      if (kindOf(found.nodeId, found.prop) === "rich") {
        rich.begin(found.nodeId, found.prop);
        return;
      }
      // Delegated rather than begun here, because the plain surface has to keep
      // the element the gesture landed on: a value whose element cannot be
      // found again from the document alone is still editable from a click.
      plain.onDoubleClick(event);
    },
    [kindOf, plain, rich]
  );

  return {
    editing: plain.editing,
    editingRich: rich.editing,
    begin,
    commit,
    cancel,
    onDoubleClick,
  };
}
