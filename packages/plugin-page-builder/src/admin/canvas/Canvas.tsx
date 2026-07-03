"use client";

/**
 * The editor canvas (spec §9). Renders the block tree inside an iframe (IframeCanvas) for
 * real device-width responsive preview + style isolation. The root always renders through
 * CanvasNode so an empty page shows its "Drop a block here" zone. DnD is provided by the
 * DragDropProvider in EditorSurface.
 */
import { useEditor } from "../store/EditorProvider";

import { CanvasNode } from "./CanvasNode";
import { IframeCanvas } from "./IframeCanvas";

export function Canvas() {
  const { state } = useEditor();

  return (
    <IframeCanvas>
      <CanvasNode node={state.document.root} />
    </IframeCanvas>
  );
}
