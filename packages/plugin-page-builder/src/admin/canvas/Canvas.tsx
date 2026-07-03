"use client";

/**
 * The editor canvas (spec §9). M4 renders same-document (proves the shell + WYSIWYG +
 * selection + save). M5 upgrades this to an iframe for real device-width responsive
 * preview + style isolation, alongside the drag-and-drop interactions.
 */
import { compileDocumentCss } from "../../core/style-compiler";
import { useEditor } from "../store/EditorProvider";

import { CanvasNode } from "./CanvasNode";

const SELECTION_CSS =
  ".nx-pb-canvas .nx-pb-selected{outline:2px solid #6366f1 !important;outline-offset:-2px}";

export function Canvas() {
  const { state, dispatch } = useEditor();
  const css = compileDocumentCss(state.document) + "\n" + SELECTION_CSS;

  return (
    <div
      className="nx-pb-canvas"
      style={{
        height: "100%",
        overflow: "auto",
        background: "#fff",
        padding: 8,
      }}
      onClick={() => dispatch({ type: "SELECT", id: null })}
    >
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="nx-pb-page">
        <CanvasNode node={state.document.root} />
      </div>
    </div>
  );
}
