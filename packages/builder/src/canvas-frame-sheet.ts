/**
 * The stylesheet the canvas frame carries inside it.
 *
 * The editor's own sheet, `builder-chrome.css`, is imported by the host app
 * and applies to the editor's document only: nothing in it reaches a page
 * rendered inside the frame. So the few rules the page needs from the editor
 * travel with the frame instead, as a string `CanvasFrame` renders into the
 * frame's document beside the page.
 *
 * Deliberately few. Everything the editor DRAWS over the page — outlines, the
 * toolbar, the drop line, the spacing bands, notices — is drawn in the editor's
 * document over the frame, where the site's CSS cannot reach it. What is left
 * here is what has to be IN the page because it changes layout or input: the
 * base reset, the canvas surface, a placeholder giving an empty container an
 * area, text selection and the caret while editing, the cursor, and the dimmed
 * block in a drag.
 *
 * No admin tokens: they are custom properties of the editor's document and
 * resolve to nothing in here. Colours come from the site's own tokens where
 * the canvas names them, the browser's system colours where it does not, and
 * the page's own text colour for the placeholder, so it reads on any section.
 *
 * @module canvas-frame-sheet
 */

import { EMPTY_CONTAINER_SELECTOR } from "./empty-slot";
import { CANVAS_ROOT_CLASS } from "./shell-state";

const ROOT = `.${CANVAS_ROOT_CLASS}`;

/**
 * Boxes size as border-box: the default most site resets set (Tailwind's
 * preflight, modern-normalize), so a padded block at full width is as wide
 * on the canvas as on most published pages.
 *
 * It stands in until the frame loads the site's own stylesheets, which will
 * then decide. So it sits in a cascade layer of its own, declared before
 * anything else in the frame: the lowest layer, which any site rule loaded
 * later wins over, whether that rule is in a layer of the site's or in none.
 * The rest of this sheet is not layered, and states what the editor needs
 * whatever the site does.
 *
 * @internal
 */
export const CANVAS_FRAME_DEFAULTS =
  "@layer nx-canvas-defaults { *, ::before, ::after { box-sizing: border-box; } }";

/**
 * The rules, in the order they cascade.
 *
 * @internal
 */
export const CANVAS_FRAME_SHEET: string = `
/* A plain base: the user agent's body margin never shows, so a bare page in the
   frame lines up with the same page published. */
html, body { margin: 0; padding: 0; }

/* The page is light unless the site says otherwise: the frame's document is
   its own, so the admin's dark scheme is never inherited, and the ground under
   the page is the browser's default canvas. */
html { color-scheme: light; background-color: Canvas; }

/* The page fills the frame's viewport, so the end of a short page still has
   pixels to drop a block on. Grown as a flex item of the body rather than
   given a minimum height of its own: with a minimum height on the canvas root,
   Chromium's End and Home keys stop moving the caret in text being edited
   below the first block. */
body { min-height: 100vh; display: flex; flex-direction: column; }

/* The page's own surface, in the SITE's colours and type. The frame is a
   document of its own, so nothing of the admin's theme is inherited here; what
   the canvas does not name falls back to the browser's defaults, which is what
   a published page shows where nothing paints. */
${ROOT} {
  position: relative;
  box-sizing: border-box;
  /* Fills the viewport: see the body above. */
  flex: 1 0 auto;
  /* The site's background, text and body font, which the canvas root names
     under the site's token prefix (see \`canvas.tsx\`); they follow the site's
     dark values by themselves. */
  color-scheme: light;
  background-color: var(--nx-canvas-site-ground, Canvas);
  color: var(--nx-canvas-site-ink, CanvasText);
  font-family: var(--nx-canvas-site-font, system-ui), sans-serif;
  /* A press on a block is a grab, not a text selection: the browser would
     otherwise start selecting words before the drag reaches its activation
     distance. */
  user-select: none;
  -webkit-user-select: none;
}

/* The site's own dark mode, the one thing that darkens the page. The canvas
   root carries the dark-ground marker only when the site's dark values include
   a dark ground, and states the nearest theme marker above it as
   data-nx-site-theme; with none stated, the device decides, as it does for
   the token values. The admin's theme reaches nothing in this document. */
${ROOT}[data-nx-site-dark-ground][data-nx-site-theme="dark"] {
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  ${ROOT}[data-nx-site-dark-ground]:not([data-nx-site-theme]) {
    color-scheme: dark;
  }
}

/* The page is one stacking context, so a blend mode inside it starts from the
   page's own background, and it repeats the site's ground where that ground is
   opaque, so a blended block mixes with it as on the published page. The
   ground at no weight, so a background the page gives its own root wins. */
${ROOT} > .nx-pb-page {
  isolation: isolate;
}
:where(${ROOT}[data-nx-site-ground-opaque] > .nx-pb-page) {
  background-color: var(--nx-canvas-site-ground, Canvas);
}

/* Text being edited is text again. */
${ROOT} [contenteditable="true"],
${ROOT} [contenteditable="true"] * {
  user-select: text;
  -webkit-user-select: text;
}

/* A block that draws nothing still has height enough to be selected. */
${ROOT} [data-nx-selected]:empty { min-height: 2px; }

/* An empty container has an area to aim at, unless the author asked to see the
   page as a visitor will. Drawn in the page's own text colour, faint, so it
   reads on a light page and a dark section alike. */
${EMPTY_CONTAINER_SELECTOR} {
  display: block;
  min-height: 2.75rem;
  border: 1px dashed color-mix(in srgb, currentColor 35%, transparent);
  border-radius: 0.25rem;
  background: color-mix(in srgb, currentColor 6%, transparent);
}

/* The cursor says what a press does: grab a block, place a caret in text being
   edited, and while dragging, whether the block can land. */
${ROOT} [data-nx-node] { cursor: grab; }
${ROOT} [data-nx-node][data-nx-locked] { cursor: default; }
${ROOT} [data-nx-node][data-nx-editing],
${ROOT} [data-nx-node][contenteditable="true"],
${ROOT} [data-nx-node][contenteditable="plaintext-only"] { cursor: text; }
${ROOT}[data-nx-dragging],
${ROOT}[data-nx-dragging] [data-nx-node] { cursor: grabbing; }
${ROOT}[data-nx-dragging="refused"],
${ROOT}[data-nx-dragging="refused"] [data-nx-node] { cursor: no-drop; }

/* What is being held, dimmed where it sits. */
${ROOT} [data-nx-drag-source] { opacity: 0.4; }

/* Text being edited keeps the platform's long-press callout. */
${ROOT} [contenteditable] { -webkit-touch-callout: default; }
${ROOT} [contenteditable="false"] { -webkit-touch-callout: none; }
`;
