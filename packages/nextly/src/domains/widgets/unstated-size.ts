/**
 * The size a widget is read at when what arrived states none.
 *
 * Every registered widget states its size, so this is the reading for a
 * summary or a payload entry that arrived without one. The server's summary
 * and the admin's grid both need the same answer, so it lives here, in one
 * place they both read: the server through the canonical summary, the admin
 * through `nextly/config`.
 *
 * Imports only a type, so it stays safe for the browser.
 *
 * @module domains/widgets/unstated-size
 */

import type { WidgetSizeDeclaration } from "./grid-size";

/**
 * The full row at four rows tall, as a card with no stated size has always
 * started full width, and resizable from a quarter of the row to six rows: a
 * declaration that says nothing about its size has not limited it.
 *
 * @experimental While the dashboard widget SDK is being built.
 */
export const UNSTATED_WIDGET_SIZE: WidgetSizeDeclaration = {
  default: { w: 12, h: 4 },
  min: { w: 3, h: 2 },
  max: { w: 12, h: 6 },
};
