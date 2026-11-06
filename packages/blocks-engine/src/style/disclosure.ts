/**
 * A disclosure's icon and where it sits: what an Accordion's sections draw
 * beside their titles, written as declarations on the Accordion's own items.
 *
 * Each choice is one keyword the author stores on the Accordion. The keyword
 * expands into fixed declarations under child selectors (`> details >
 * summary`), so one value set on the group reaches every section of it, at
 * the device and state it was set at, and never a section of an accordion
 * nested inside one (each `>` stops at its own children). The icon is a mask
 * painted in the title's colour, so it follows whatever colour the section
 * has, and its open look (the chevron turned, the plus a minus) is a rule on
 * `details[open]`: no script, and the browser's keyboard and focus stay.
 *
 * `browser` keeps the browser's own marker. It is what a site built before
 * these choices keeps, so its pages look as they did.
 *
 * @module style/disclosure
 * @experimental
 */

import type { KeywordExpansion } from "./catalog-types";
import { DISCLOSURE_ICON_CLASS, DISCLOSURE_TITLE_CLASS } from "./node-class";

/** The custom property the icon choice is traced by on the Accordion. */
export const DISCLOSURE_ICON_PROPERTY = "--nx-pb-disclosure-icon";

/** The custom property the icon's position is traced by on the Accordion. */
export const DISCLOSURE_POSITION_PROPERTY = "--nx-pb-disclosure-position";

/** The choices of icon, in the order an editor offers them. */
export const DISCLOSURE_ICONS = ["chevron", "plus", "none", "browser"] as const;

/** Where the icon sits against the title. */
export const DISCLOSURE_POSITIONS = ["before", "after"] as const;

/** A section's title row, its icon, and its title, as child selectors. */
const SUMMARY = "> details > summary";
const ICON = `${SUMMARY} > .${DISCLOSURE_ICON_CLASS}`;
const OPEN_ICON = `> details[open] > summary > .${DISCLOSURE_ICON_CLASS}`;
const TITLE = `${SUMMARY} > .${DISCLOSURE_TITLE_CLASS}`;

/** A 16-unit stroked glyph as a mask: its paths, drawn in any one colour. */
function glyph(paths: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'>${paths}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") center / contain no-repeat`;
}

const CHEVRON = glyph("<path d='m4 6 4 4 4-4'/>");
const PLUS = glyph("<path d='M8 3.5v9M3.5 8h9'/>");
const MINUS = glyph("<path d='M3.5 8h9'/>");

/** The title row as one line of icon and title, with no browser marker. */
const ROW: readonly KeywordExpansion[] = [
  { descendant: SUMMARY, property: "display", value: "flex" },
  { descendant: SUMMARY, property: "align-items", value: "center" },
  { descendant: SUMMARY, property: "gap", value: "0.625em" },
  { descendant: SUMMARY, property: "list-style", value: "none" },
];

/** The icon's box, painted in the title's colour through its glyph. */
function painted(mask: string): readonly KeywordExpansion[] {
  return [
    { descendant: ICON, property: "display", value: "block" },
    { descendant: ICON, property: "flex", value: "none" },
    { descendant: ICON, property: "inline-size", value: "1em" },
    { descendant: ICON, property: "block-size", value: "1em" },
    { descendant: ICON, property: "background-color", value: "currentColor" },
    { descendant: ICON, property: "mask", value: mask },
  ];
}

/** Every icon choice's declarations, by its keyword. */
export const DISCLOSURE_ICON_EXPANSIONS: Readonly<
  Record<(typeof DISCLOSURE_ICONS)[number], readonly KeywordExpansion[]>
> = {
  chevron: [
    ...ROW,
    ...painted(CHEVRON),
    // Turned to point up while the section is open, its own glyph set there
    // too, over a minus another device's Plus may have put on the open look.
    { descendant: OPEN_ICON, property: "mask", value: CHEVRON },
    { descendant: OPEN_ICON, property: "transform", value: "rotate(180deg)" },
  ],
  plus: [
    ...ROW,
    ...painted(PLUS),
    // A minus while the section is open, unturned over another device's
    // Chevron turn.
    { descendant: OPEN_ICON, property: "mask", value: MINUS },
    { descendant: OPEN_ICON, property: "transform", value: "none" },
  ],
  // A row with no marker and no icon: the whole title still toggles.
  none: [...ROW, { descendant: ICON, property: "display", value: "none" }],
  // The browser's marker, with a heading title kept on its line. The row's
  // display and marker style roll back to the browser's own, so Browser
  // default set on an accordion restores the marker over a row its block
  // defaults (Chevron) or another tier made.
  browser: [
    { descendant: SUMMARY, property: "display", value: "revert" },
    { descendant: SUMMARY, property: "list-style", value: "revert" },
    { descendant: ICON, property: "display", value: "none" },
    { descendant: TITLE, property: "display", value: "inline" },
  ],
};

/**
 * Each position's declarations, by its keyword. The icon comes first in the
 * markup: Before keeps it there, and After moves it to the end of the row and
 * pushes it to the far edge, so the title starts the line whichever is chosen,
 * with or without an icon. By order rather than a reversed row, which would
 * set a title with no icon against the far edge.
 */
export const DISCLOSURE_POSITION_EXPANSIONS: Readonly<
  Record<(typeof DISCLOSURE_POSITIONS)[number], readonly KeywordExpansion[]>
> = {
  before: [
    { descendant: ICON, property: "order", value: "0" },
    { descendant: ICON, property: "margin-inline-start", value: "0" },
  ],
  after: [
    { descendant: ICON, property: "order", value: "1" },
    { descendant: ICON, property: "margin-inline-start", value: "auto" },
  ],
};
