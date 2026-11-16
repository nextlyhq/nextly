/**
 * The site's production addresses: the origins its real visitors use, one or
 * several where a language is served on its own domain. Every other address,
 * such as a preview or a test copy, is kept out of search.
 *
 * One rule for what counts as one, used by the settings screen as a person
 * types and by the SEO settings Single when it is saved, so the two can never
 * accept different values.
 *
 * @module settings/production-addresses
 */

/** Why `value` is not a bare http(s) origin, in one sentence; null when it is. */
export function productionAddressProblem(value: string): string | null {
  if (/\s/.test(value)) return "Write the address without spaces.";
  const scheme = /^https?:\/\/[^/?#]/i.exec(value);
  if (scheme === null) {
    return "Start the address with https://, for example https://example.com.";
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Write a whole address, for example https://example.com.";
  }
  if (url.username !== "" || url.password !== "") {
    return "Write the address without a name or password.";
  }
  // `new URL` keeps a path, query or fragment it was given; an origin has none.
  const rest = value.slice(url.origin.length);
  if (rest === "/") return "Leave off the / at the end.";
  if (rest !== "" || value.length < url.origin.length) {
    return "Use the site's address only, without a path, for example https://example.com.";
  }
  return null;
}

/**
 * Why the stored list is not a list of distinct production addresses, naming
 * the address at fault; null when it is. An empty or absent list is allowed:
 * a site may not know its address yet.
 */
export function productionAddressesProblem(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return "Production addresses must be a list.";
  const seen = new Set<string>();
  for (const address of value) {
    if (typeof address !== "string") {
      return "Each production address must be text.";
    }
    const problem = productionAddressProblem(address);
    if (problem !== null) return `${address}: ${problem}`;
    // Origins compare case-insensitively: `new URL` lower-cases the host.
    const origin = new URL(address).origin;
    if (seen.has(origin)) return `${address} is listed more than once.`;
    seen.add(origin);
  }
  return null;
}
