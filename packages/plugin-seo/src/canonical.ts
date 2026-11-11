/**
 * The one rule for what counts as a canonical address, read by every output
 * that names one: the page's head, the sitemap and structured data.
 *
 * A canonical is a path from the site's root, or an http(s) address. A
 * person may type one in place of the page's own address, and it is taken
 * only where it is on the site itself (one of its production addresses), or
 * where the person has said the page first appeared elsewhere: a typo must
 * never send search engines off the site.
 *
 * @module canonical
 */

/** A bare origin as `URL.origin` spells it, or nothing for anything else. */
function originOf(address: string): string | undefined {
  try {
    const url = new URL(address);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `value`, trimmed, where search engines can follow it as a canonical: a
 * path from the site's root, or an http(s) address. Nothing for blank text,
 * another scheme (`mailto:`, `javascript:`) or stray text.
 */
export function usableCanonical(
  value: string | null | undefined
): string | undefined {
  const typed = value?.trim();
  if (typed === undefined || typed === "") return undefined;
  if (typed.startsWith("/") && !typed.startsWith("//")) return typed;
  return originOf(typed) === undefined ? undefined : typed;
}

/**
 * A canonical a person typed for a page, where it may stand: usable, and on
 * one of `productionAddresses` unless `elsewhere` says the page first
 * appeared on another site. A path from the root is always on the site.
 */
export function typedCanonical(
  value: string | null | undefined,
  site: { productionAddresses: readonly string[]; elsewhere: boolean }
): string | undefined {
  const usable = usableCanonical(value);
  if (usable === undefined || usable.startsWith("/")) return usable;
  if (site.elsewhere) return usable;
  const origin = originOf(usable);
  const own = new Set(
    site.productionAddresses.flatMap(address => originOf(address) ?? [])
  );
  return origin !== undefined && own.has(origin) ? usable : undefined;
}
