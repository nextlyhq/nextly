"use client";

/**
 * Iframe canvas (spec §9). Renders the block tree inside an <iframe> via a portal so the
 * preview lives in its own document at a real device width — responsive overrides are
 * actually visible, and page CSS is isolated from the admin shell. The compiled page CSS
 * + a small editor-overlay stylesheet are injected into the iframe <head>.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { sanitizeCustomCss } from "../../core/css-sanitize";
import { BREAKPOINT_WIDTHS } from "../../core/responsive";
import {
  compileDocumentCss,
  compileTokensCss,
} from "../../core/style-compiler";
import { useEditor } from "../store/EditorProvider";

// Admin design tokens mirrored into the iframe as `--nx-pb-ed-*` so the editor chrome
// (selection ring, drop indicators, placeholders) is monochrome and follows the admin's
// light/dark theme. The iframe is a separate document that renders the *user's* page with
// its own tokens, so admin tokens aren't otherwise available inside it.
const MIRRORED_TOKENS = [
  "--primary",
  "--primary-foreground",
  "--ring",
  "--border",
  "--border-strong",
  "--muted",
  "--muted-foreground",
  "--destructive",
];

/** Read the current admin token values and emit an iframe `:root` mirror block. */
function buildTokenMirrorCss(): string {
  const src = document.querySelector(".adminapp") ?? document.documentElement;
  const cs = getComputedStyle(src);
  const decls = MIRRORED_TOKENS.map(
    t => `--nx-pb-ed${t.slice(1)}: ${cs.getPropertyValue(t).trim()};`
  ).join("");
  return `:root{${decls}}`;
}

const OVERLAY_CSS = [
  "body{margin:0;font-family:system-ui,-apple-system,sans-serif}",
  // Blocks are grabbable; hovering hints the boundary (Elementor-like).
  "[data-nx-id]{cursor:grab}",
  "[data-nx-id]:active{cursor:grabbing}",
  "[data-nx-id]:hover{outline:1px dashed color-mix(in srgb, var(--nx-pb-ed-ring) 50%, transparent);outline-offset:-1px}",
  // Selected block: solid ring + a small grip badge (top-left) as a grab cue.
  ".nx-pb-selected,[data-nx-id].nx-pb-selected:hover{outline:2px solid var(--nx-pb-ed-ring);outline-offset:-2px;position:relative}",
  ".nx-pb-selected::before{content:'\\283F';position:absolute;top:-2px;left:-2px;transform:translateY(-100%);font-size:12px;line-height:1;padding:2px 5px;background:var(--nx-pb-ed-primary);color:var(--nx-pb-ed-primary-foreground);border-radius:4px 4px 0 0;pointer-events:none;z-index:2}",
  ".nx-pb-dragging{opacity:.4}",
  ".nx-pb-empty{color:var(--nx-pb-ed-muted-foreground);padding:32px;text-align:center;font-size:14px}",
  // Between-item drop zones: collapsed at rest, a hint while dragging, a solid
  // insertion bar when they are the active drop target.
  ".nx-pb-dropzone{height:0;border-radius:3px;transition:height .1s ease,background .1s ease}",
  ".nx-pb-dropzone[data-drag]{height:6px;margin:3px 0;background:color-mix(in srgb, var(--nx-pb-ed-primary) 12%, transparent)}",
  ".nx-pb-dropzone[data-active]{height:6px;margin:4px 0;background:var(--nx-pb-ed-primary);box-shadow:0 0 0 4px color-mix(in srgb, var(--nx-pb-ed-primary) 15%, transparent)}",
  // Empty-container placeholder.
  ".nx-pb-dropzone-empty{border:2px dashed var(--nx-pb-ed-border-strong);border-radius:8px;padding:20px 12px;margin:6px;text-align:center;color:var(--nx-pb-ed-muted-foreground);font-size:13px;background:var(--nx-pb-ed-muted)}",
  ".nx-pb-dropzone-empty[data-active]{border-color:var(--nx-pb-ed-primary);background:color-mix(in srgb, var(--nx-pb-ed-primary) 12%, transparent);color:var(--nx-pb-ed-primary)}",
  // Grid drop targets (layout-safe: inset shadow / outline, no box).
  ".nx-pb-drop-before{box-shadow:inset 3px 0 0 var(--nx-pb-ed-primary)}",
  ".nx-pb-drop-append{outline:2px dashed var(--nx-pb-ed-primary);outline-offset:-2px}",
].join("");

export function IframeCanvas({ children }: { children: ReactNode }) {
  const { state, dispatch } = useEditor();
  const ref = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  // Desktop/base is FLUID (fills the pane); only tablet/mobile use a fixed device width.
  // A fixed desktop frame (1280px) clips behind the panels when the pane is narrower.
  const width =
    state.activeBreakpoint === "base"
      ? 0
      : BREAKPOINT_WIDTHS[state.activeBreakpoint] || 0;

  // Attach to the iframe document once it exists (onLoad or already-complete).
  const attach = () => {
    const doc = ref.current?.contentDocument;
    if (doc?.body) setBody(doc.body);
  };
  useEffect(() => {
    attach();
  }, []);

  // Mirror the admin design tokens into the iframe and keep them in sync when the admin
  // theme flips (next-themes toggles the `.dark` class on the admin root).
  useEffect(() => {
    const doc = ref.current?.contentDocument;
    if (!doc?.head) return;
    const sync = () => {
      let tokens = doc.getElementById(
        "nx-pb-tokens"
      ) as HTMLStyleElement | null;
      if (!tokens) {
        tokens = doc.createElement("style");
        tokens.id = "nx-pb-tokens";
        doc.head.insertBefore(tokens, doc.head.firstChild);
      }
      tokens.textContent = buildTokenMirrorCss();
    };
    sync();
    const adminRoot = document.querySelector(".adminapp");
    if (!adminRoot) return;
    const observer = new MutationObserver(sync);
    observer.observe(adminRoot, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [body]);

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
      compileDocumentCss(state.document) +
      "\n" +
      // Same sanitize+scope pass as PageRenderer, so the preview is faithful.
      sanitizeCustomCss(state.customCss, "nx-pb-page");
  }, [state.document, state.customCss, body]);

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
        // "safe center" centers the device frame but falls back to the start edge when it
        // would overflow — so a narrow pane scrolls from the left instead of clipping it.
        justifyContent: "safe center",
        height: "100%",
        background: "var(--muted)",
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
          boxShadow: width ? "0 0 0 1px var(--border)" : "none",
          borderRadius: width ? 8 : 0,
        }}
      />
      {body
        ? createPortal(<div className="nx-pb-page">{children}</div>, body)
        : null}
    </div>
  );
}
