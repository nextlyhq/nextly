"use client";

/**
 * Iframe canvas (spec §9). Renders the block tree inside an <iframe> via a portal so the
 * preview lives in its own document at a real device width — responsive overrides are
 * actually visible, and page CSS is isolated from the admin shell. The compiled page CSS
 * + a small editor-overlay stylesheet are injected into the iframe <head>.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { BREAKPOINT_WIDTHS } from "../../core/responsive";
import {
  compileDocumentCss,
  compileTokensCss,
} from "../../core/style-compiler";
import { useEditor } from "../store/EditorProvider";

const OVERLAY_CSS = [
  "body{margin:0;font-family:system-ui,-apple-system,sans-serif}",
  // Blocks are grabbable; hovering hints the boundary (Elementor-like).
  "[data-nx-id]{cursor:grab}",
  "[data-nx-id]:active{cursor:grabbing}",
  "[data-nx-id]:hover{outline:1px dashed #a5b4fc;outline-offset:-1px}",
  ".nx-pb-selected,[data-nx-id].nx-pb-selected:hover{outline:2px solid #6366f1;outline-offset:-2px}",
  ".nx-pb-dragging{opacity:.4}",
  ".nx-pb-empty{color:#9ca3af;padding:32px;text-align:center;font-size:14px}",
  // Between-item drop zones: collapsed at rest, a hint while dragging, a bold blue
  // insertion bar when they are the active drop target.
  ".nx-pb-dropzone{height:0;border-radius:3px;transition:height .1s ease,background .1s ease}",
  ".nx-pb-dropzone[data-drag]{height:6px;margin:3px 0;background:rgba(99,102,241,.12)}",
  ".nx-pb-dropzone[data-active]{height:6px;margin:4px 0;background:#4f46e5;box-shadow:0 0 0 4px rgba(79,70,229,.15)}",
  // Empty-container placeholder.
  ".nx-pb-dropzone-empty{border:2px dashed #c7d2fe;border-radius:8px;padding:20px 12px;margin:6px;text-align:center;color:#6366f1;font-size:13px;background:#f8f9ff}",
  ".nx-pb-dropzone-empty[data-active]{border-color:#4f46e5;background:#eef2ff;color:#4338ca}",
  // Grid drop targets (layout-safe: inset shadow / outline, no box).
  ".nx-pb-drop-before{box-shadow:inset 3px 0 0 #4f46e5}",
  ".nx-pb-drop-append{outline:2px dashed #4f46e5;outline-offset:-2px}",
].join("");

export function IframeCanvas({ children }: { children: ReactNode }) {
  const { state, dispatch } = useEditor();
  const ref = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const width = BREAKPOINT_WIDTHS[state.activeBreakpoint] || 0;

  // Attach to the iframe document once it exists (onLoad or already-complete).
  const attach = () => {
    const doc = ref.current?.contentDocument;
    if (doc?.body) setBody(doc.body);
  };
  useEffect(() => {
    attach();
  }, []);

  // Keep the compiled page CSS in sync with the document.
  useEffect(() => {
    const doc = ref.current?.contentDocument;
    if (!doc?.head) return;
    let overlay = doc.getElementById("nx-pb-overlay");
    if (!overlay) {
      overlay = doc.createElement("style");
      overlay.id = "nx-pb-overlay";
      overlay.textContent = OVERLAY_CSS;
      doc.head.appendChild(overlay);
    }
    let pageStyle = doc.getElementById(
      "nx-pb-style"
    ) as HTMLStyleElement | null;
    if (!pageStyle) {
      pageStyle = doc.createElement("style");
      pageStyle.id = "nx-pb-style";
      doc.head.appendChild(pageStyle);
    }
    pageStyle.textContent =
      compileTokensCss("nx-pb-page") +
      "\n" +
      compileDocumentCss(state.document);
  }, [state.document, body]);

  // Selection via a native delegated listener ON THE IFRAME DOCUMENT. React's synthetic
  // events don't cross the portal→iframe boundary, so onClick handlers inside the canvas
  // fire unreliably; a native listener on the iframe document does not have that problem.
  // Clicking empty space (no [data-nx-id] ancestor) deselects.
  useEffect(() => {
    const doc = ref.current?.contentDocument;
    if (!doc) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const el = target?.closest?.("[data-nx-id]") ?? null;
      dispatch({ type: "SELECT", id: el?.getAttribute("data-nx-id") ?? null });
    };
    doc.addEventListener("click", onClick);
    return () => doc.removeEventListener("click", onClick);
  }, [body, dispatch]);

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        height: "100%",
        background: "#f3f4f6",
        overflow: "auto",
        padding: width ? 16 : 0,
      }}
    >
      <iframe
        ref={ref}
        title="Page preview"
        onLoad={attach}
        style={{
          border: "none",
          background: "#fff",
          height: "100%",
          width: width ? `${width}px` : "100%",
          // A fixed device width must NOT be capped to the pane — the canvas scrolls
          // instead, so the preview stays a faithful WYSIWYG at that width.
          maxWidth: width ? "none" : "100%",
          flexShrink: 0,
          boxShadow: width ? "0 0 0 1px #e5e7eb" : "none",
          borderRadius: width ? 8 : 0,
        }}
      />
      {body
        ? createPortal(<div className="nx-pb-page">{children}</div>, body)
        : null}
    </div>
  );
}
