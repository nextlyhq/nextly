"use client";

/**
 * The editor canvas (spec §9). Renders the block tree inside an iframe (IframeCanvas) for
 * real device-width responsive preview + style isolation. DnD is layered on in Task 5 via
 * a DragDropProvider that wraps this subtree.
 */
import { DEFAULT_SLOT } from "../../core/types";
import { useEditor } from "../store/EditorProvider";

import { CanvasNode } from "./CanvasNode";
import { IframeCanvas } from "./IframeCanvas";

export function Canvas() {
  const { state } = useEditor();
  const root = state.document.root;
  const isEmpty =
    !root.slots?.[DEFAULT_SLOT] || root.slots[DEFAULT_SLOT].length === 0;

  return (
    <IframeCanvas>
      {isEmpty ? (
        <div className="nx-pb-empty">
          Empty page — add a block from the library.
        </div>
      ) : (
        <CanvasNode node={root} />
      )}
    </IframeCanvas>
  );
}
