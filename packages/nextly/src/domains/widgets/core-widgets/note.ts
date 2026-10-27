/**
 * Core's Note card, as a widget. One module per widget; `core-widgets/index.ts`
 * lists them in their order.
 *
 * @module domains/widgets/core-widgets/note
 */

import type { WidgetDefinition } from "../definition";

import { NOTE_TEXT } from "./shared";

export const noteWidget = {
  id: "core/note",
  title: "Note",
  description: "A note of your own, in Markdown, that only you see.",
  // Its own component: the reader's Markdown, drawn read-only through the
  // text archetype's renderer, from the card's own setting.
  archetype: "custom",
  component: "core#Note",
  // Added from the add panel when a reader wants one, never placed on the
  // default dashboard, where it would be an empty card; several allowed.
  offered: "on-request",
  // Any width from a quarter, and as tall as its reader's text wants.
  size: {
    default: { w: 4, h: 3 },
    min: { w: 3, h: 2 },
    max: { w: 12, h: 6 },
  },
  settings: [NOTE_TEXT],
} as const satisfies WidgetDefinition;
