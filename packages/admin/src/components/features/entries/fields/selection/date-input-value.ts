/**
 * How a stored date value is written into an HTML date, time, month or
 * date-and-time input: its own module, a pure function of the value, the
 * format and the reader's zone, so each of its branches is tested directly.
 *
 * @module components/entries/fields/selection/date-input-value
 */

/**
 * Formats a stored value for an HTML input of `format`, read in the zone it
 * was written in. A date and time is a moment, picked and shown in the
 * reader's own zone. A day, a month or a time of day names no moment: it is
 * saved in UTC (`DateInput`'s `handleChange`), so it is read back in UTC too.
 * Read in local
 * time, a day saved as UTC midnight showed the day before to everyone west of
 * UTC, and was saved a day earlier again on the next edit.
 */
export function toInputValue(
  value: string | Date | null | undefined,
  format: "date" | "datetime" | "time" | "month"
): string {
  if (!value) return "";

  try {
    const date = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) return "";

    const local = format === "datetime";
    const Y = local ? date.getFullYear() : date.getUTCFullYear();
    const M = String(
      (local ? date.getMonth() : date.getUTCMonth()) + 1
    ).padStart(2, "0");
    const D = String(local ? date.getDate() : date.getUTCDate()).padStart(
      2,
      "0"
    );
    const h = String(local ? date.getHours() : date.getUTCHours()).padStart(
      2,
      "0"
    );
    const m = String(local ? date.getMinutes() : date.getUTCMinutes()).padStart(
      2,
      "0"
    );

    switch (format) {
      case "datetime":
        return `${Y}-${M}-${D}T${h}:${m}`;
      case "time":
        return `${h}:${m}`;
      case "month":
        return `${Y}-${M}`;
      case "date":
      default:
        return `${Y}-${M}-${D}`;
    }
  } catch {
    return "";
  }
}
