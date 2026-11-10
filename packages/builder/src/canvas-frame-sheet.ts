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

import { EMPTY_CONTAINER_SELECTOR, EMPTY_TEXT_SELECTOR } from "./empty-slot";
import { CANVAS_ROOT_CLASS } from "./shell-state";

const ROOT = `.${CANVAS_ROOT_CLASS}`;

/** A collection list drawing its empty state while that state holds nothing. */
const EMPTY_LIST = `${EMPTY_CONTAINER_SELECTOR}[data-nx-list-shows]`;

/**
 * The attribute on the root element of the editor's blank page, which a page
 * the site serves never carries.
 *
 * @internal
 */
export const BLANK_PAGE_ATTRIBUTE = "data-nx-canvas-frame";

/**
 * Scopes a rule to the editor's blank page.
 *
 * The blank page has no site around the canvas, so some rules here stand in
 * for one: a base reset, a light ground, the site's ink and body font drawn on
 * the canvas root. On a page the site serves, its own layout and stylesheets
 * already decide each of those, exactly as they do for the published page, and
 * a stand-in would override them.
 */
// In \`:where()\`, so scoping a rule adds nothing to its specificity: on the
// blank page each wins or loses exactly as it did before it was scoped.
const BLANK = `:where(:root[${BLANK_PAGE_ATTRIBUTE}])`;

/**
 * Marks the site's own elements around the point the canvas is mounted at,
 * on a page the site serves: its header, footer and whatever else its layout
 * draws, inert and quietened.
 *
 * @internal
 */
export const SITE_CHROME_ATTRIBUTE = "data-nx-site-chrome";

/**
 * Boxes size as border-box: the default most site resets set (Tailwind's
 * preflight, modern-normalize), so a padded block at full width is as wide
 * on the canvas as on most published pages.
 *
 * It stands in, on the blank page only, for the site's own stylesheets, which
 * decide on a page the site serves. So it sits in a cascade layer of its own, declared before
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
/* A plain base, on the blank page: the user agent's body margin never shows,
   so a bare page in the frame lines up with the same page published. A page
   the site serves keeps the site's own base. */
${BLANK}, ${BLANK} body { margin: 0; padding: 0; }

/* The blank page is light unless the site says otherwise: the frame's document
   is its own, so the admin's dark scheme is never inherited, and the ground
   under the page is the browser's default canvas. */
${BLANK} { color-scheme: light; background-color: Canvas; }

/* The blank page fills the frame's viewport, so the end of a short page still
   has pixels to drop a block on. Grown as a flex item of the body rather than
   given a minimum height of its own: with a minimum height on the canvas root,
   Chromium's End and Home keys stop moving the caret in text being edited
   below the first block. On a page the site serves, the site's layout decides
   how tall the canvas is, as it does for the published page. */
${BLANK} body { min-height: 100vh; display: flex; flex-direction: column; }

${ROOT} {
  position: relative;
  box-sizing: border-box;
  /* A press on a block is a grab, not a text selection: the browser would
     otherwise start selecting words before the drag reaches its activation
     distance. */
  user-select: none;
  -webkit-user-select: none;
}

/* The page's own surface on the blank page, in the SITE's colours and type.
   Nothing of the admin's theme is inherited in the frame; what the canvas does
   not name falls back to the browser's defaults, which is what a published
   page shows where nothing paints. On a page the site serves, the canvas
   paints none of these and inherits the site's, as the published page does. */
${BLANK} ${ROOT} {
  /* Fills the viewport: see the body above. */
  flex: 1 0 auto;
  /* The site's background, text and body font, which the canvas root names
     under the site's token prefix (see \`canvas.tsx\`); they follow the site's
     dark values by themselves. */
  color-scheme: light;
  background-color: var(--nx-canvas-site-ground, Canvas);
  color: var(--nx-canvas-site-ink, CanvasText);
  font-family: var(--nx-canvas-site-font, system-ui), sans-serif;
}

/* The site's own dark mode, the one thing that darkens the blank page. The
   canvas root carries the dark-ground marker only when the site's dark values
   include a dark ground, and states the nearest theme marker above it as
   data-nx-site-theme; with none stated, the device decides, as it does for
   the token values. The admin's theme reaches nothing in this document. */
${BLANK} ${ROOT}[data-nx-site-dark-ground][data-nx-site-theme="dark"] {
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  ${BLANK} ${ROOT}[data-nx-site-dark-ground]:not([data-nx-site-theme]) {
    color-scheme: dark;
  }
}

/* On the blank page, the page is one stacking context, so a blend mode inside
   it starts from the page's own background, and it repeats the site's ground
   where that ground is opaque, so a blended block mixes with it as on the
   published page. The ground at no weight, so a background the page gives its
   own root wins. On a page the site serves, a blend mixes with the site's own
   ground, as it does published. */
${BLANK} ${ROOT} > .nx-pb-page {
  isolation: isolate;
}
:where(${BLANK} ${ROOT}[data-nx-site-ground-opaque] > .nx-pb-page) {
  background-color: var(--nx-canvas-site-ground, Canvas);
}

/* The site's own layout around the canvas, on a page the site serves: there
   to show where the page sits, quietened as a Layout region's content is, and
   inert, so its links and forms neither work nor navigate the frame. */
[${SITE_CHROME_ATTRIBUTE}] {
  opacity: var(--nx-builder-region-opacity, 0.6);
}

/* Text being edited is text again. */
${ROOT} [contenteditable="true"],
${ROOT} [contenteditable="true"] * {
  user-select: text;
  -webkit-user-select: text;
}

/* A block that draws nothing still has height enough to be selected: at no
   specificity, so a min height the block sets (a Section at Full screen)
   wins over it while it is selected, as it does on the page. */
:where(${ROOT} [data-nx-selected]:empty) { min-height: 2px; }

/* A text block emptied of its words keeps a line, so it can still be clicked:
   see EMPTY_TEXT_SELECTOR. */
${EMPTY_TEXT_SELECTOR} { min-height: 1lh; }

/* An empty container always has an area to aim at, since without one it has
   no height and cannot be clicked. Drawn in the page's own text colour, faint,
   so it reads on a light page and a dark section alike. Its height is held
   apart, at no specificity, so a min height the block sets (a Section at Full
   screen) wins over it, as it does on the page. */
:where(${EMPTY_CONTAINER_SELECTOR}) { min-height: 2.75rem; }
${EMPTY_CONTAINER_SELECTOR} {
  display: block;
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

/* A collection list's note to its author: why its sort fell back (amber) or
   its read failed (red). Drawn in the page, where the list draws it, in the
   admin's scheme and face, which the frame hands these notes as values. A
   visitor's page never carries one. */
[data-nx-list-diagnostic] {
  /* The whole row of a list laid out as a grid or a wrapping row, so it
     reads as a note about the list rather than one of its entries. */
  grid-column: 1 / -1;
  flex-basis: 100%;
  /* Its words, and the one action a fallen-back sort offers, on one row. */
  display: flex;
  align-items: flex-start;
  color-scheme: var(--nx-builder-scheme, light);
  border: 1px solid;
  border-radius: var(--radius-sm, 0.25rem);
  color: var(--nx-builder-text, CanvasText);
  font-family: var(--font-sans, system-ui), sans-serif;
  /* The admin's size whatever the zoom, so the author can read it on a
     page drawn small; its spacing is in its own text's units, so it keeps
     its shape at every zoom. */
  font-size: calc(0.8125rem / var(--nx-canvas-zoom, 1));
  line-height: 1.5;
  gap: 0.9em;
  margin-block-end: 0.6em;
  padding: 0.6em 0.9em;
}

[data-nx-list-diagnostic="sort-fallback"] {
  border-color: color-mix(in srgb, var(--nx-builder-warning, Mark) 55%, transparent);
  background: color-mix(
    in srgb,
    var(--nx-builder-warning, Mark) 12%,
    var(--nx-builder-surface-raised, Canvas)
  );
}

/* The note's one action: an outlined button in the note's own ink, at the
   row's end. Pressing it is the editor's (see the canvas's click). */
[data-nx-list-diagnostic] > [data-nx-list-action] {
  flex: none;
  margin-inline-start: auto;
  padding: 0.15em 0.6em;
  border: 1px solid currentColor;
  border-radius: var(--radius-sm, 0.25rem);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.92em;
  font-weight: 500;
  cursor: pointer;
}

[data-nx-list-diagnostic] > [data-nx-list-action]:focus-visible {
  outline: 2px solid var(--nx-builder-select, Highlight);
  outline-offset: 2px;
}

[data-nx-list-diagnostic="query-failed"] {
  border-color: color-mix(in srgb, var(--nx-builder-danger, CanvasText) 55%, transparent);
  background: color-mix(
    in srgb,
    var(--nx-builder-danger, CanvasText) 8%,
    var(--nx-builder-surface-raised, Canvas)
  );
}

/* A list drawing its empty state is tagged, in the editing colour, with why:
   the author chose to see it, nothing matched, or its read failed. The tag
   is the first thing in the list's own flow, so it covers nothing: lifted
   above the list's top edge it lay over whatever the page draws there, and
   a page with no gap above the list lost that line. It spans a grid's row
   from its start, sits first in a flex row, and is as wide as its words.
   On the canvas only. */
${ROOT} [data-nx-list-shows]::before {
  display: block;
  grid-column: 1 / -1;
  justify-self: start;
  align-self: start;
  flex: none;
  inline-size: max-content;
  max-inline-size: 100%;
  margin-block-end: 0.375rem;
  padding: 0.0625rem 0.375rem;
  border-radius: 0.1875rem;
  background: var(--nx-builder-select, Highlight);
  color: var(--nx-builder-select-text, HighlightText);
  font-family: system-ui, sans-serif;
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  zoom: calc(1 / var(--nx-canvas-zoom, 1));
}

/* A list whose empty state holds nothing yet: a roomy area, at the admin's
   size whatever the zoom, so the "+" drawn over its centre, the line below
   it and the spacing badges on its edges never meet. The tag sits at the
   inside of its top edge, clear of the centred words. Written on the empty
   container's own selector, so it outweighs that rule's smaller box. */
${EMPTY_LIST} {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: calc(7.5rem / var(--nx-canvas-zoom, 1));
}

${EMPTY_LIST}::before {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  margin: 0;
  border-radius: 0 0 0.1875rem 0;
}

/* What the area is for, under the "+" and its words, faint in the page's
   own ink so it reads on any section. */
${EMPTY_LIST}::after {
  content: "Visitors see this when no entry matches. Left empty, the list shows nothing.";
  max-inline-size: 100%;
  margin-block-start: 2.5rem;
  padding-inline: 0.75rem;
  color: color-mix(in srgb, currentColor 65%, transparent);
  font-family: system-ui, sans-serif;
  font-size: 0.75rem;
  line-height: 1.4;
  text-align: center;
  pointer-events: none;
  zoom: calc(1 / var(--nx-canvas-zoom, 1));
}

${ROOT} [data-nx-list-empty-because="chosen"]::before {
  content: "When empty";
}

${ROOT} [data-nx-list-empty-because="none"]::before {
  content: "No entries match · showing When empty";
}

${ROOT} [data-nx-list-empty-because="failed"]::before {
  content: "Showing When empty";
}

/* A region of the page's Layout, drawn locked around the page. Its content
   keeps the site's own colours, quietened, so it reads as what surrounds the
   page; its links and forms are inert. The region is one focus stop: its
   badge says where it comes from at rest, and a click or Enter opens the tag
   with the way to edit it. The badge and tag are the admin's words, so they
   read the admin's tokens, which the frame hands those elements alone as
   values. */
.nx-canvas-region {
  position: relative;
  cursor: default;
}

.nx-canvas-region__content {
  opacity: var(--nx-builder-region-opacity, 0.6);
}

/* Where the region meets the page: a quiet line. */
.nx-canvas-region[data-nx-region="header"] {
  border-bottom: 1px dashed var(--nx-builder-border);
}

.nx-canvas-region[data-nx-region="footer"] {
  border-top: 1px dashed var(--nx-builder-border);
}

.nx-canvas-region:hover,
.nx-canvas-region[data-open] {
  box-shadow: inset 0 0 0 1px var(--nx-builder-border);
}

.nx-canvas-region:focus-visible {
  outline: 2px solid var(--nx-builder-accent);
  outline-offset: -2px;
}

/* The admin's face and scheme rather than the site's, and the admin's size
   however far the frame is painted down: the scale the canvas publishes is
   undone here. */
.nx-canvas-region__badge,
.nx-canvas-region__tag {
  zoom: calc(1 / var(--nx-canvas-zoom, 1));
  color-scheme: var(--nx-builder-scheme, light);
  font-family: var(--font-sans, system-ui), sans-serif;
}

.nx-canvas-region__badge {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.5rem;
  border: 1px solid var(--nx-builder-border);
  border-radius: var(--radius-sm);
  background: var(--nx-builder-surface-raised);
  color: var(--nx-builder-text-muted);
  font-size: var(--text-xs, 0.75rem);
  line-height: 1.4;
  pointer-events: none;
}

/* The badge opens into the tag, in the same place. */
.nx-canvas-region[data-open] .nx-canvas-region__badge {
  display: none;
}

.nx-canvas-region__tag {
  position: absolute;
  z-index: 3;
  top: 0.5rem;
  right: 0.5rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem 0.5rem;
  max-width: calc(100% - 1rem);
  padding: 0.375rem 0.625rem;
  border: 1px solid var(--nx-builder-border);
  border-radius: 0.375rem;
  background: var(--nx-builder-surface-raised);
  color: var(--nx-builder-text);
  box-shadow: 0 1px 3px var(--nx-builder-border);
  font-size: 0.8125rem;
  line-height: 1.4;
}

.nx-canvas-region__note {
  color: var(--nx-builder-text-muted);
}

.nx-canvas-region__edit {
  color: var(--nx-builder-text);
  font-weight: 500;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.nx-canvas-region__edit:focus-visible {
  outline: 2px solid var(--nx-builder-accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
`;
