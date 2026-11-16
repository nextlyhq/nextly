/**
 * The editor's acceptance properties, and which of them the editor suite covers.
 *
 * The canvas manifest (`acceptance-manifest.ts`) names what the drag engine
 * must do inside the canvas harness. These are the properties an author meets
 * in the REAL editor: selecting, moving with the keyboard, dragging, and editing
 * text in place. They are what has to stay true when the canvas changes where it
 * renders, so they are asserted through the editor itself rather than a harness
 * that mounts only part of it.
 *
 * The rules are the canvas manifest's: every `covered` property has a test whose
 * title is {@link editorTitleFor}, the spec checks that against its own source,
 * and a `deferred` one carries the reason it cannot run yet.
 *
 * @module tests/canvas/editor-manifest
 */

import type { AcceptanceProperty } from "./acceptance-manifest";

export const EDITOR_PROPERTIES: readonly AcceptanceProperty[] = [
  {
    n: 1,
    property: "A click selects one block, and Layers marks the same block",
    greenIn: "selection",
    status: "covered",
  },
  {
    n: 2,
    property: "Shift-click extends the selection and Mod-click toggles a block",
    greenIn: "selection",
    status: "covered",
  },
  {
    n: 3,
    property:
      "Escape goes up to the block holding the selection, and clears it at the top",
    greenIn: "selection",
    status: "covered",
  },
  {
    n: 4,
    property: "A Layers row selects its block on the canvas",
    greenIn: "selection",
    status: "covered",
  },
  {
    n: 5,
    property:
      "Alt+Arrow up and down reorder the selected block and announce it",
    greenIn: "keyboard moves",
    status: "covered",
  },
  {
    n: 6,
    property:
      "Alt+ArrowRight moves a block into the container above, Alt+ArrowLeft out of it",
    greenIn: "keyboard moves",
    status: "covered",
  },
  {
    n: 7,
    property: "A keyboard move is one undo step",
    greenIn: "keyboard moves",
    status: "covered",
  },
  {
    n: 8,
    property: "A canvas drag reorders a block in the editor, as one undo step",
    greenIn: "drag",
    status: "covered",
  },
  {
    n: 9,
    property:
      "Double-click edits plain text in place, Enter commits a single-line field",
    greenIn: "inline text",
    status: "covered",
  },
  {
    n: 10,
    property:
      "Escape keeps a plain-text edit, and a second Escape selects the parent",
    greenIn: "inline text",
    status: "covered",
  },
  {
    n: 11,
    property:
      "A multi-line field keeps Enter as a line break and commits on blur",
    greenIn: "inline text",
    status: "covered",
  },
  {
    n: 12,
    property:
      "Double-click edits a rich-text passage, and a bold run commits as formatting",
    greenIn: "inline rich text",
    status: "covered",
  },
  {
    n: 13,
    property: "Escape keeps a rich-text edit, as one undo step",
    greenIn: "inline rich text",
    status: "covered",
  },
  {
    n: 14,
    property:
      "Dragging in Layers reorders a block, and dragging right nests it, each one undo step",
    greenIn: "layers drag",
    status: "covered",
  },
];

export const EDITOR_COVERED = EDITOR_PROPERTIES.filter(
  p => p.status === "covered"
);
export const EDITOR_DEFERRED = EDITOR_PROPERTIES.filter(
  p => p.status === "deferred"
);

/** The title a covered property's test must carry, so a rename cannot hide one. */
export function editorTitleFor(p: AcceptanceProperty): string {
  return `E${p.n}: ${p.property}`;
}
