/**
 * How the SEO tab writes an answer's values on screen: the address as a
 * results page shows it, text cut where Google cuts it, and an image's file
 * name. Pure, so the tab and its tests share one reading.
 *
 * @module tab/display
 */

/**
 * An address as a person reads it: a path from the site's root is put under
 * the site's origin; an address that is already whole is kept.
 */
export function absoluteAddress(origin: string, address: string): string {
  if (!address.startsWith("/") || address.startsWith("//")) return address;
  return `${origin.replace(/\/+$/, "")}${address}`;
}

/** An address as a results page writes it: `https://acme.com › blog › post`. */
export function resultsAddress(address: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return address;
  }
  const segments = url.pathname
    .split("/")
    .filter(segment => segment !== "")
    .map(segment => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  return [`${url.protocol}//${url.host}`, ...segments].join(" › ");
}

/** The host of an origin, as a shared card names the site. */
export function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** `text` cut to about `limit` characters, as a results page cuts it. */
export function cutAt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()} …`;
}

/** The file name an image's address ends in. */
export function fileNameOf(url: string): string {
  const path = url.split(/[?#]/)[0] ?? url;
  const name =
    path
      .split("/")
      .filter(part => part !== "")
      .pop() ?? path;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
