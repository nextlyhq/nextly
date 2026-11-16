/**
 * The site's origin, as every output that states an absolute address reads
 * one.
 *
 * @module origin
 */

/** An http(s) origin, such as `https://example.com`; nothing otherwise. */
export function originOf(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}
