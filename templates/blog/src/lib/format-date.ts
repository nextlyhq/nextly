/**
 * Format a publishedAt-style value as a human-readable date.
 *
 * Returns `null` for missing, falsy, or unparseable inputs — callers
 * branch on `null` to skip rendering the `<time>` element entirely
 * rather than showing literal "Invalid Date" text.
 *
 * Why null instead of throwing: editorial content with a missing or
 * malformed date should still render the rest of the post.
 *
 * @param value - ISO string, epoch number, Date instance, or nullish
 * @param options - Intl.DateTimeFormatOptions (defaults to "Apr 15, 2026")
 */
export function formatPublishedDate(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  }
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", options);
}
