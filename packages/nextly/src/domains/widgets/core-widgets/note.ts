/**
 * Core's Note card, as core's first widget declared with `defineWidget`: the
 * same declaration a plugin writes, so core's own list proves the shape it asks
 * of everyone. One module per widget; `core-widgets/index.ts` lists them in
 * their order.
 *
 * Declared, it is answered on the server like any declared widget: `load`
 * hands back the note's text, so the frame judges it empty by `isEmpty` and
 * draws the empty state, and the component draws only the text. A declared
 * widget is never placed on the default dashboard, where an unwritten note
 * would be an empty card, so it is added from the add panel when a reader
 * wants one.
 *
 * @module domains/widgets/core-widgets/note
 */

import { defineWidget } from "../declaration/define-widget";

import { CORE_WIDGET_ID } from "./ids";
import { NOTE_TEXT } from "./shared";

export const noteWidget = defineWidget({
  id: CORE_WIDGET_ID.note,
  title: "Note",
  description: "A note of your own, in Markdown, that only you see.",
  // Any width from a quarter, and as tall as its reader's text wants.
  size: {
    default: { w: 4, h: 3 },
    min: { w: 3, h: 2 },
    max: { w: 12, h: 6 },
  },
  several: true,
  settings: { text: NOTE_TEXT },
  // Its text is the card's own setting, so there is nothing to wait for.
  load: ({ settings }) => Promise.resolve({ text: settings.text }),
  // Drawn read-only through the text archetype's renderer by the admin's own
  // component, from the text `load` answers.
  view: { component: "core#Note" },
  // Blank as well as absent is an empty note: whitespace alone draws nothing.
  isEmpty: data => data.text.trim() === "",
  // The way to write one is the card's own settings, so its empty state opens them there.
  empty: {
    message: "Nothing written yet.",
    action: { label: "Write a note", opens: "settings" },
  },
});
