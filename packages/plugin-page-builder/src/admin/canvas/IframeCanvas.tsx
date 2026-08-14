"use client";

/**
 * Iframe canvas (spec §9). Renders the block tree inside an <iframe> via a portal so the
 * preview lives in its own document at a real device width — responsive overrides are
 * actually visible, and page CSS is isolated from the admin shell. The compiled page CSS
 * + a small editor-overlay stylesheet are injected into the iframe <head>.
 */
import { PAGE_ROOT_CLASS } from "@nextlyhq/blocks-engine";
import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { sanitizeCustomCss } from "../../core/css-sanitize";
import { BREAKPOINT_WIDTHS } from "../../core/responsive";
import {
  compileDocumentCss,
  compileTokensCss,
  documentScopeClass,
} from "../../core/style-compiler";
import { useEditor } from "../store/EditorProvider";

// Admin design tokens mirrored into the iframe as `--nx-pb-ed-*` so the editor chrome
// (selection ring, drop indicators, placeholders) is monochrome and follows the admin's
// light/dark theme. The iframe is a separate document that renders the *user's* page with
// its own tokens, so admin tokens aren't otherwise available inside it.
export const MIRRORED_TOKENS = [
  "--nx-primary",
  "--nx-primary-foreground",
  "--nx-ring",
  "--nx-border",
  "--nx-border-strong",
  "--nx-muted",
  "--nx-muted-foreground",
  "--nx-destructive",
];

/** The admin's token prefix, dropped so `--nx-primary` mirrors as `--nx-pb-ed-primary`. */
const ADMIN_TOKEN_PREFIX = "--nx-";

/** The editor-chrome name the overlay reads for a given admin token. */
export function mirroredName(token: string): string {
  return `--nx-pb-ed-${token.slice(ADMIN_TOKEN_PREFIX.length)}`;
}

/** Read the current admin token values and emit an iframe `:root` mirror block. */
function buildTokenMirrorCss(): string {
  const src =
    document.querySelector(".nextly-admin") ?? document.documentElement;
  const cs = getComputedStyle(src);
  const decls = MIRRORED_TOKENS.map(
    t => `${mirroredName(t)}: ${cs.getPropertyValue(t).trim()};`
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
  // Between-item drop zones. The SLOT stays in flow at zero height for the
  // document's whole life, so starting a drag moves nothing; the target itself
  // is taken out of flow and anchored to that slot.
  //
  // Growing the zone from 0 to 6px on dragstart is what this replaces. It gave
  // the pointer something to hit by making the zone occupy space, so every zone
  // in the document expanded at once and the page moved under the cursor at the
  // exact moment aim starts to matter.
  //
  // The slot carries its own `position: relative` rather than relying on an
  // ancestor. Selection sets `position: relative` on `.nx-pb-selected`, so an
  // absolutely-positioned target would otherwise anchor to the canvas normally
  // and to the selected node once one is an ancestor of it — targeting that
  // works until you click something, which reads as a drag defect and is a
  // containing-block one.
  ".nx-pb-dropzone-slot{position:relative;height:0}",
  // The SAME 6px band the in-flow zone occupied, centred on the gap it marks.
  // This changes what a zone COSTS, not what it catches, so the pointer meets
  // exactly the geometry it met before and no targeting behaviour moves with it.
  //
  // A larger rect is worth having and is deliberately not here. A zone's box
  // extends above its own slot, so a taller one reaches into the element before
  // it and changes which zones are eligible where — a claim about targeting,
  // which needs its own evidence rather than riding along with a claim about
  // layout.
  //
  // `pointer-events` are live only during a drag, so at rest the zone cannot
  // intercept a click meant for the block behind it.
  ".nx-pb-dropzone{position:absolute;left:0;right:0;top:-3px;height:6px;border-radius:3px;background:transparent;pointer-events:none;transition:background .1s ease}",
  ".nx-pb-dropzone[data-drag]{pointer-events:auto;background:color-mix(in srgb, var(--nx-pb-ed-primary) 12%, transparent)}",
  ".nx-pb-dropzone[data-active]{background:var(--nx-pb-ed-primary);box-shadow:0 0 0 4px color-mix(in srgb, var(--nx-pb-ed-primary) 15%, transparent)}",
  // Empty-container placeholder.
  ".nx-pb-dropzone-empty{border:2px dashed var(--nx-pb-ed-border-strong);border-radius:8px;padding:20px 12px;margin:6px;text-align:center;color:var(--nx-pb-ed-muted-foreground);font-size:13px;background:var(--nx-pb-ed-muted)}",
  ".nx-pb-dropzone-empty[data-active]{border-color:var(--nx-pb-ed-primary);background:color-mix(in srgb, var(--nx-pb-ed-primary) 12%, transparent);color:var(--nx-pb-ed-primary)}",
  // Grid drop targets (layout-safe: inset shadow / outline, no box).
  ".nx-pb-drop-before{box-shadow:inset 3px 0 0 var(--nx-pb-ed-primary)}",
  ".nx-pb-drop-append{outline:2px dashed var(--nx-pb-ed-primary);outline-offset:-2px}",
].join("");

export function IframeCanvas({ children }: { children: ReactNode }) {
  const { state, dispatch, remotePatterns, nodeClasses } = useEditor();
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
    const adminRoot = document.querySelector(".nextly-admin");
    if (!adminRoot) return;
    const observer = new MutationObserver(sync);
    observer.observe(adminRoot, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [body]);

  // Deferred for the same reason the Inspector's warnings are: sanitizing runs
  // a full parse and several walks, and on a large stylesheet doing that
  // synchronously per keystroke made typing wait for the preview to recompile.
  const deferredCustomCss = useDeferredValue(state.customCss);

  // The document's own scope, derived exactly as the renderer derives it, so
  // the preview anchors its tokens and custom CSS to the same class the
  // published page will — including the namespaced `@keyframes` and
  // `@font-face` names, which differ per scope and would otherwise make the
  // preview the one place an animation resolved.
  const pageScope = documentScopeClass(state.document);

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
      compileTokensCss(pageScope) +
      "\n" +
      compileDocumentCss(state.document, {
        remotePatterns,
        scope: pageScope,
        classes: nodeClasses,
      }) +
      "\n" +
      // Same sanitize+scope pass as PageRenderer, so the preview is faithful.
      sanitizeCustomCss(deferredCustomCss, pageScope).css;
  }, [
    state.document,
    deferredCustomCss,
    remotePatterns,
    body,
    pageScope,
    nodeClasses,
  ]);

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
        background: "var(--nx-muted)",
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
          boxShadow: width ? "0 0 0 1px var(--nx-border)" : "none",
          borderRadius: width ? 8 : 0,
        }}
      />
      {body
        ? createPortal(
            <div className={`${PAGE_ROOT_CLASS} ${pageScope}`}>{children}</div>,
            body
          )
        : null}
    </div>
  );
}
