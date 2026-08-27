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

import {
  getBlock,
  findNode,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { useCallback } from "react";

import type { EditorState } from "./editor-state";
import { inlinePropKind, type InlinePropKind } from "./inline-prop-kind";
import { firstInlineProp } from "./inline-target";
import {
  useInlineRichText,
  type CaretPoint,
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
  /**
   * Finish whichever edit is open, writing what the author left behind.
   *
   * Returns the document the write produced, or `null` when nothing was open or
   * nothing changed. A host about to hand the document to a form needs it: the
   * copy it rendered with is the one from before this commit, and an inline
   * edit that has not been written yet is invisible in it.
   */
  commit: () => BlockDocument | null;
  /** Finish whichever edit is open, discarding it. */
  cancel: () => void;
  /**
   * Enter an edit from a double-click on the canvas.
   *
   * The pointer's position is read when it is there. A passage needs it to put
   * the caret where the author aimed: the canvas suppresses the browser's own
   * text selection so a press on a block is a grab rather than a highlight, so
   * there is no selection to ask and the point is the only record of where they
   * meant to type.
   */
  onDoubleClick: (event: {
    target: EventTarget | null;
    clientX?: number;
    clientY?: number;
  }) => void;
}

/** What a double-click landed on, or `null` when it was not on a value. */
function markedAt(target: EventTarget | null): {
  nodeId: string;
  prop: string;
  element: HTMLElement;
} | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>("[data-nx-prop]");
  if (element === null) return null;
  const prop = element.getAttribute("data-nx-prop");
  const nodeId = element
    .closest("[data-nx-node]")
    ?.getAttribute("data-nx-node");
  if (prop === null || nodeId === null || nodeId === undefined) return null;
  return { nodeId, prop, element };
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

  /**
   * Open one surface, having finished whatever the other was doing.
   *
   * Both are asked to commit first, and each is a no-op when it holds nothing.
   * Without it an author who starts a passage and then double-clicks a line of
   * text before the editor's chunk arrives leaves BOTH surfaces live: the
   * loader resolves, focuses the passage, and the focus it steals blurs the
   * line of text into a commit the author never asked for — with the caret
   * ending up somewhere they were not looking.
   */
  const openOn = useCallback(
    (
      kind: InlinePropKind,
      nodeId: string,
      prop: string,
      element?: HTMLElement,
      point?: CaretPoint
    ) => {
      plain.commit();
      rich.commit();
      return kind === "rich"
        ? rich.begin(nodeId, prop, element, point)
        : plain.begin(nodeId, prop);
    },
    [plain, rich]
  );

  const begin = useCallback(
    (nodeId: string, prop?: string) => {
      if (prop === undefined) {
        // The block's first inline value in DECLARATION order, across both
        // kinds. Asking one surface and then the other answers with that
        // surface's first instead, which is a different value whenever a block
        // declares a passage after a line of text.
        const first = firstInlineProp(editor.document, nodeId);
        if (first === null) return false;
        return openOn(first.kind, nodeId, first.prop);
      }
      const kind = kindOf(nodeId, prop);
      if (kind === null) return false;
      return openOn(kind, nodeId, prop);
    },
    [editor, kindOf, openOn]
  );

  const commit = useCallback(() => {
    // Both are asked, and at most one is open. Asking only the one believed to
    // be open would leave the other's edit hanging whenever that belief was
    // wrong, and each answers `null` when it holds nothing.
    const written = plain.commit();
    return rich.commit() ?? written;
  }, [plain, rich]);

  const cancel = useCallback(() => {
    plain.cancel();
    rich.cancel();
  }, [plain, rich]);

  const onDoubleClick = useCallback(
    (event: {
      target: EventTarget | null;
      clientX?: number;
      clientY?: number;
    }) => {
      const found = markedAt(event.target);
      if (found === null) return;
      const point =
        event.clientX === undefined || event.clientY === undefined
          ? undefined
          : { x: event.clientX, y: event.clientY };
      if (kindOf(found.nodeId, found.prop) === "rich") {
        // The element the gesture landed on is passed rather than looked up
        // again: two canvases showing one document carry the same node ids, so
        // a search of the page can answer with the other one's passage.
        openOn("rich", found.nodeId, found.prop, found.element, point);
        return;
      }
      // Finished for the same reason `openOn` does it, then delegated: the
      // plain surface has to keep the element the gesture landed on, because a
      // value whose element cannot be found again from the document alone is
      // still editable from a click.
      rich.commit();
      plain.onDoubleClick(event);
    },
    [kindOf, openOn, plain, rich]
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
