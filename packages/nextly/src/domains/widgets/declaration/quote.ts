/**
 * How a widget declaration's faults quote a value.
 *
 * @module domains/widgets/declaration/quote
 */

/**
 * A value as a fault quotes it. Total, because the value is whatever a plain
 * JavaScript declaration holds: `JSON.stringify` throws on a bigint or a
 * cycle, and the fault must still be reported, with every other.
 */
export function quote(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return `a ${typeof value} that cannot be written out`;
  }
}
