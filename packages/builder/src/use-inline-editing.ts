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
import { INSTANCE_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { useCallback, useSyncExternalStore } from "react";

import type { EditorState } from "./editor-state";
import { composedTextAt } from "./exposed-inline";
import {
  INLINE_EDIT_UNCHANGED,
  type InlineEditOutcome,
} from "./inline-edit-outcome";
import { inlinePropKind, type InlinePropKind } from "./inline-prop-kind";
import { firstInlineProp } from "./inline-target";
import type { OpenPassages } from "./open-passages";
import {
  useInlineRichText,
  type CaretPoint,
  type InlineRichTextEditing,
  type InlineRichTextEditorLoader,
  type InlineRichTextFinished,
} from "./use-inline-rich-text";
import {
  editableFrom,
  useInlineText,
  type InlineTextEditing,
} from "./use-inline-text";

export interface UseInlineEditingResult {
  /** The plain value being edited, or `null`. */
  editing: InlineTextEditing | null;
  /** The passage being edited, or `null`. Never set at the same time as {@link editing}. */
  editingRich: InlineRichTextEditing | null;
  /**
   * Whether an inspector field holds a passage open in the shared editor:
   * unsaved work, as an open passage on the canvas is.
   */
  inspecting: boolean;
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
   * A host about to hand the document to a form needs the outcome: the copy it
   * rendered with is the one from before this commit, an edit that has not been
   * written yet is invisible in it, and a REFUSED commit is still holding the
   * author's words — so closing over it is what loses them.
   */
  commit: () => InlineEditOutcome;
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
  /** Whether the node is one a component contributed, by its marker. */
  inComponent: boolean;
} | null {
  const found = editableFrom(target);
  if (found === null) return null;
  const placement =
    found.element.closest("[data-nx-node]")?.getAttribute(INSTANCE_ATTRIBUTE) ??
    "";
  return { ...found, inComponent: placement !== "" };
}

/**
 * @param editor - the editor state whose document is being edited
 * @param loadRichText - how to obtain the shared rich-text editor, when there is one
 * @param onFinished - told how every finished PASSAGE turned out; see {@link InlineRichTextFinished}
 * @param onPartOf - told the placement whose text was double-clicked when that
 *   text belongs to the component's design rather than to a field it exposes,
 *   or to a field a lock the component sets holds, by that field's exposure
 *   id; the placement is selected first, and the host says so
 * @param passages - where inspector fields hold open passages; `commit`
 *   finishes them first, see {@link OpenPassages}
 * @returns one edit at a time, and the canvas handler that starts it
 */
export function useInlineEditing(
  editor: EditorState,
  loadRichText?: InlineRichTextEditorLoader,
  onFinished?: InlineRichTextFinished,
  onPartOf?: (placementId: string, heldExposureId?: string) => void,
  passages?: OpenPassages
): UseInlineEditingResult {
  const subscribe = useCallback(
    (listener: () => void) => passages?.subscribe(listener) ?? noSubscription(),
    [passages]
  );
  const inspecting = useSyncExternalStore(
    subscribe,
    () => passages?.isOpen() ?? false,
    () => false
  );
  /*
   * The plain surface reports only a key's refused way out, the case where its
   * line stays open: its blur commits and answers the pre-union way, so a line
   * lost to a capped write on blur still goes unreported. Stated so a host
   * does not read silence there as "nothing happened".
   */
  const plain = useInlineText(editor, onFinished);
  const rich = useInlineRichText(editor, loadRichText, onFinished);

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
      point?: CaretPoint,
      exposure?: InlineRichTextEditing["exposure"]
    ) => {
      plain.commit();
      const finished = rich.commit();
      /*
       * A refused passage is still open and still holds the only copy of what
       * the author typed. There is one editor behind both surfaces, so opening
       * anything at all supersedes that session — declined instead, the same
       * answer `begin` gives for a value that cannot be edited.
       */
      if (finished.status === "refused") return false;
      return kind === "rich"
        ? rich.begin(nodeId, prop, element, point, exposure)
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

  const commit = useCallback((): InlineEditOutcome => {
    // Both are asked, and at most one is open. Asking only the one believed to
    // be open would leave the other's edit hanging whenever that belief was
    // wrong, and each reports nothing when it holds nothing.
    // The inspector's passages first, through their own commit: their words
    // are in the shared editor alone, and the document the caller holds is
    // from before them. What they wrote is the base the rest answers with.
    const inspected = passages?.finishAll() ?? null;
    const written = plain.commit();
    const passage = rich.commit();
    // The passage's answer wins whenever it has one, because it is the surface
    // that can refuse. The plain surface reports the pre-union way — a document
    // or `null` — and cannot refuse: it has no equivalent of a passage kept
    // open, which is why a plain edit lost to a capped write is a defect of its
    // own rather than something this can translate.
    if (passage.status !== "unchanged") return passage;
    const latest = written ?? inspected;
    return latest === null
      ? INLINE_EDIT_UNCHANGED
      : { status: "written", document: latest };
  }, [plain, rich, passages]);

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
      // Text inside a component: its exposed text and passages are edited in
      // place through the placement (the plain surface below finds the text),
      // and anything else is the component's own, which selects the
      // placement and says so.
      // Asked only of an element a component contributed, which the renderer
      // marks with its placement: the page's own text never needs the
      // composition.
      const composed = found.inComponent
        ? composedTextAt(
            editor.document,
            editor.composed(),
            found.nodeId,
            found.prop,
            editor.lockDefinitions
          )
        : null;
      if (composed?.kind === "part-of") {
        if (rich.commit().status === "refused") return;
        plain.commit();
        editor.select(composed.placementId);
        if (composed.heldExposureId === undefined) {
          onPartOf?.(composed.placementId);
        } else {
          onPartOf?.(composed.placementId, composed.heldExposureId);
        }
        return;
      }
      const point =
        event.clientX === undefined || event.clientY === undefined
          ? undefined
          : { x: event.clientX, y: event.clientY };
      // A component's exposed passage, edited in place on its placement.
      if (composed?.kind === "exposed-rich") {
        const { placementId, exposureId } = composed.target;
        openOn("rich", found.nodeId, found.prop, found.element, point, {
          placementId,
          exposureId,
        });
        return;
      }
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
      if (rich.commit().status === "refused") return;
      plain.onDoubleClick(event);
    },
    [editor, kindOf, onPartOf, openOn, plain, rich]
  );

  return {
    editing: plain.editing,
    editingRich: rich.editing,
    inspecting,
    begin,
    commit,
    cancel,
    onDoubleClick,
  };
}

/** A subscription to nothing, for an editor with no inspector passages. */
function noSubscription(): () => void {
  return () => {};
}
