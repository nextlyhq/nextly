/**
 * The two guards the dashboard's card models read a `load` answer through:
 * the answer reaches the browser as plain JSON, so each field is checked
 * before it is drawn. One copy for every model, so the cards agree on what an
 * object and a piece of text are.
 */

/** Whether `value` is a plain object, not null and not an array. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether `value` is text with something in it. */
export const isText = (value: unknown): value is string =>
  typeof value === "string" && value !== "";
