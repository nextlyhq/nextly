/**
 * The two questions every reader of stored values asks before trusting one:
 * is it a plain object, and is it text with something in it. Pure, so the
 * server and the admin screen ask them the same way.
 *
 * @module plain-values
 */

/** Whether `value` is a plain object, not an array or null. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `value` where it is text that is not blank; nothing otherwise. */
export const textOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;
