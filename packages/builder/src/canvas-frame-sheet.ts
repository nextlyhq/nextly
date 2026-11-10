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

import {
  DEFAULT_TOKEN_PREFIX,
  tokenCustomProperty,
} from "@nextlyhq/blocks-engine";
import {
  ENTRY_CONTENT_DRAWN_ATTRIBUTE,
  ENTRY_CONTENT_NOTE_ATTRIBUTE,
} from "@nextlyhq/blocks-react";

import { EMPTY_CONTAINER_SELECTOR, EMPTY_TEXT_SELECTOR } from "./empty-slot";
import { CANVAS_ROOT_CLASS } from "./shell-state";

const ROOT = `.${CANVAS_ROOT_CLASS}`;

/** A site token as the page's sheet names it, with what stands in without it. */
function siteToken(name: string, fallback: string): string {
  return `var(${tokenCustomProperty(name, DEFAULT_TOKEN_PREFIX)}, ${fallback})`;
}

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

/* A block its conditions hide while they are applied, drawn as one line in
   its place: its words kept readable however small the canvas paints the
   page, never under 11px on screen, and at its own 13px from full size up.
   In pixels, not rems, so a site whose root font size is not 16px moves
   neither. Its spacing is in its own text's units, so it keeps its shape at
   every zoom. Written under the root, so it outweighs the marker's own
   defaults in the page's sheet. One row, its icon centred before its words,
   here too: a marker a list's entry draws is made as the page is drawn, so
   the page's sheet holds no defaults for it, and a site's own sheet may set
   an icon on a line of its own. */
${ROOT} .nx-condition-hidden {
  display: flex;
  align-items: center;
  font-size: max(13px, calc(11px / var(--nx-canvas-zoom, 1)));
  gap: 0.6em;
  padding: 0.45em 0.75em;
}

${ROOT} .nx-condition-hidden > svg {
  display: inline-block;
  flex: none;
}

/* The marker's look, in the site's own tokens, for a marker the page's sheet
   holds no defaults for: one a list's entry draws, made as the page is
   drawn. At no specificity, so a page marker's compiled defaults, the same
   tokens, still win; each token stands in for itself in the page's own ink
   where the site names its tokens otherwise. */
:where(${ROOT} .nx-condition-hidden) {
  border: 1px dashed ${siteToken("color.border-strong", "color-mix(in srgb, currentColor 35%, transparent)")};
  border-radius: 2px;
  background-color: ${siteToken("color.surface", "color-mix(in srgb, currentColor 6%, transparent)")};
  color: ${siteToken("color.muted", "color-mix(in srgb, currentColor 70%, transparent)")};
  line-height: 1.35;
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

/* A named query that ran, but reads what visitors can't: amber, as a sort
   that fell back is, since the page still draws. */
[data-nx-list-diagnostic="query-caution"] {
  border-color: color-mix(in srgb, var(--nx-builder-warning, Mark) 55%, transparent);
  background: color-mix(
    in srgb,
    var(--nx-builder-warning, Mark) 12%,
    var(--nx-builder-surface-raised, Canvas)
  );
}

/* The log reference a failed run names: the exact text to quote, set as
   code and selectable whole, though the canvas selects blocks on a press. */
[data-nx-list-diagnostic] [data-nx-list-ref] {
  font-family: var(--font-mono, ui-monospace), monospace;
  font-size: 0.95em;
  user-select: all;
  -webkit-user-select: all;
}

/* Copy ref: its one word, and "Copied" for a moment once pressed. */
[data-nx-list-diagnostic] [data-nx-list-copy="done"],
[data-nx-list-diagnostic] [data-nx-list-copied] > [data-nx-list-copy="ready"] {
  display: none;
}

[data-nx-list-diagnostic] [data-nx-list-copied] > [data-nx-list-copy="done"] {
  display: inline;
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

/* An Entry content block drawing the entry's own blocks: they are the
   entry's, edited on the entry, so the pointer passes through them to the
   block, which a click selects. Nothing inside is pressed, hovered or
   followed, and no caret lands in it. */
${ROOT} [${ENTRY_CONTENT_DRAWN_ATTRIBUTE}] * {
  pointer-events: none;
  cursor: inherit;
}

/* An Entry content block's note to its author, where it has none of the
   entry's content to draw: the canvas's muted note, drawn as an empty
   container is, in the page's own ink so it reads on any section, its words
   faint and the entry's title in full ink; red for a field the collection
   no longer has. At the admin's size whatever the zoom. A visitor's page
   never carries one. */
[${ENTRY_CONTENT_NOTE_ATTRIBUTE}] {
  display: flex;
  align-items: center;
  gap: 0.6em;
  margin: 0;
  padding: 0.6em 0.9em;
  border: 1px dashed color-mix(in srgb, currentColor 35%, transparent);
  border-radius: var(--radius-sm, 0.25rem);
  background: color-mix(in srgb, currentColor 6%, transparent);
  font-family: var(--font-sans, system-ui), sans-serif;
  font-size: calc(0.75rem / var(--nx-canvas-zoom, 1));
  font-weight: 400;
  line-height: 1.4;
  text-align: start;
}

[${ENTRY_CONTENT_NOTE_ATTRIBUTE}] span > span {
  color: color-mix(in srgb, currentColor 65%, transparent);
}

[${ENTRY_CONTENT_NOTE_ATTRIBUTE}] b {
  font-weight: 500;
}

/* The red note, drawn on the page as the muted one is: its tint over the
   page itself and its words mixed with the page's own ink, so it reads on a
   light page and a dark section alike, whatever the admin's theme. The red
   is the admin's danger hue, the one value taken from the editor. */
[${ENTRY_CONTENT_NOTE_ATTRIBUTE}="failed"] {
  border-style: solid;
  border-color: color-mix(in srgb, var(--nx-builder-danger, currentColor) 55%, transparent);
  background: color-mix(in srgb, var(--nx-builder-danger, currentColor) 8%, transparent);
  color: color-mix(in oklab, var(--nx-builder-danger, currentColor) 70%, currentColor);
}

[${ENTRY_CONTENT_NOTE_ATTRIBUTE}="failed"] span > span {
  color: inherit;
}

[${ENTRY_CONTENT_NOTE_ATTRIBUTE}] > svg {
  flex: none;
  inline-size: 1.15em;
  block-size: 1.15em;
}

/* A list whose new source waits for an input wears what it still draws
   ("Still showing Events"), in the same tag, first in its flow. Written
   after the empty state's, so the wait is what it says while both hold. */
${ROOT} [data-nx-list-still]::before {
  content: attr(data-nx-list-still);
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

/* A list drawn as a visitor reads it, while conditions are applied, wears
   how many of the editor's entries a visitor sees ("Showing what visitors
   see: 4 of 6 entries"): the same place as the wait's tag, quieter, since
   it reports rather than asks. A list waiting for an input says that
   instead, as the one thing it asks. */
${ROOT} [data-nx-list-visitors]:not([data-nx-list-still])::before {
  content: attr(data-nx-list-visitors);
  display: block;
  grid-column: 1 / -1;
  justify-self: start;
  align-self: start;
  flex: none;
  inline-size: max-content;
  max-inline-size: 100%;
  margin-block-end: 0.375rem;
  padding: 0.0625rem 0.375rem;
  border: 1px solid var(--nx-builder-border, GrayText);
  border-radius: 0.1875rem;
  background: var(--nx-builder-surface-raised, Canvas);
  color: var(--nx-builder-text-muted, GrayText);
  font-family: system-ui, sans-serif;
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  zoom: calc(1 / var(--nx-canvas-zoom, 1));
}

/* Over a list's empty area, the same tag sits inside the area's dashed edge,
   clear of it, rather than on the corner the empty state's own tag fills. */
${EMPTY_LIST}[data-nx-list-visitors]:not([data-nx-list-still])::before {
  inset-block-start: 0.25rem;
  inset-inline-start: 0.25rem;
  border-radius: 0.1875rem;
}

/* A region of the page's Layout, drawn locked around the page. Its content
   keeps the site's own colours, quietened, so it reads as what surrounds the
   page; its links and forms are inert. Its mark never covers that content: a
   lock outside the region, at the edge it shares with the page (below a
   header, above a footer), which widens into a badge on hover or focus and
   opens the tag beside it on a click or Enter. Where outside has no room on
   screen the mark is placed inside instead, by its data-placement. The mark
   holds the admin's words, so it reads the admin's tokens, which the frame
   hands it alone as values. */
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
.nx-canvas-region:focus-within,
.nx-canvas-region[data-state="open"] {
  box-shadow: inset 0 0 0 1px var(--nx-builder-border);
}

/* Placed in the page's own pixels, so its edge is the region's: the left
   offset is measured to keep it on screen. Only its body takes the pointer. */
.nx-canvas-region__mark {
  position: absolute;
  z-index: 3;
  left: 0.5rem;
  display: flex;
  pointer-events: none;
}

.nx-canvas-region[data-nx-region="header"] > .nx-canvas-region__mark[data-placement="outside"] {
  top: 100%;
}

.nx-canvas-region[data-nx-region="footer"] > .nx-canvas-region__mark[data-placement="outside"] {
  bottom: 100%;
}

.nx-canvas-region > .nx-canvas-region__mark[data-placement="inside"] {
  top: 0;
}

/* The admin's face and scheme rather than the site's, and the admin's size
   however far the frame is painted down: the scale the canvas publishes is
   undone here. */
.nx-canvas-region__mark-body {
  zoom: calc(1 / var(--nx-canvas-zoom, 1));
  color-scheme: var(--nx-builder-scheme, light);
  font-family: var(--font-sans, system-ui), sans-serif;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin: 0.375rem 0;
  pointer-events: auto;
}

/* At rest a lock alone; on hover or focus it widens into the badge. */
.nx-canvas-region__lock {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 1.375rem;
  height: 1.375rem;
  padding: 0 0.3125rem;
  border: 1px solid var(--nx-builder-border);
  border-radius: 999px;
  background: var(--nx-builder-surface-raised);
  color: var(--nx-builder-text-muted);
  font: inherit;
  font-size: var(--text-xs, 0.75rem);
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}

.nx-canvas-region__lock:focus-visible {
  outline: 2px solid var(--nx-builder-accent);
  outline-offset: 2px;
}

.nx-canvas-region__lock[aria-expanded="true"] {
  border-color: var(--nx-builder-text-muted);
  color: var(--nx-builder-text);
}

.nx-canvas-region__badge {
  display: none;
  padding-right: 0.125rem;
}

.nx-canvas-region[data-state="hover"] .nx-canvas-region__badge {
  display: inline;
}

.nx-canvas-region__tag {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem 0.5rem;
  max-width: 32rem;
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
