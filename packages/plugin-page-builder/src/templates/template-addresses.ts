/**
 * The addresses collections declared in code serve their entries under:
 * `pageBuilder({ templates: { addresses: { posts: "/blog" } } })` serves each
 * published post at `/blog/<its slug>` while the collection has a published
 * template.
 *
 * An address has exactly one spelling, so two spellings of one path can never
 * be two addresses: it starts with `/`, ends without one, has no empty or dot
 * segment, no scheme, host, query or fragment, is not `/` itself, and each
 * segment is percent-encoded as a browser sends it. It lies outside the paths
 * the runtime keeps for itself (`/admin`, `/api` and the rest), by the
 * content route's own rule. Each is held by one collection. A declaration
 * breaking any of these refuses to start, naming what is wrong.
 *
 * @module templates/template-addresses
 */
import { pathOf, servedAddress } from "../address-claims/claim-key";

/** The `templates` option of `pageBuilder()`. */
export interface PageBuilderTemplateOptions {
  /**
   * Where each collection defined in code serves its entries, by collection
   * slug: `{ posts: "/blog" }` serves the post `hello` at `/blog/hello`, drawn
   * with the collection's published template.
   *
   * Written as the path a visitor requests: starting with `/`, ending without
   * one, with no empty or `.` segment, and not `/` itself, nor under a path
   * the runtime keeps (`/admin`, `/api`, …). Two collections may not share an
   * address. A collection named here must be one that may have a template
   * (it has a `slug` text field, and is not one of the page builder's own).
   * Any other declaration refuses to start.
   *
   * @experimental New public surface: its name and shape may change before it
   * is marked stable.
   */
  readonly addresses?: Readonly<Record<string, string>>;
}

/**
 * Any language serves to check a path's form: the language is a part of the
 * key of its own, and nothing here depends on which.
 */
const ANY_LOCALE = "en";

/**
 * Why `address` is not a template address in its one spelling, or null when
 * it is.
 */
export function templateAddressProblem(address: unknown): string | null {
  if (typeof address !== "string") {
    return 'the address is not a path: write it as text, such as "/blog".';
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(address) || address.startsWith("//")) {
    return `"${address}" names a scheme or a host: write the path alone, such as "/blog".`;
  }
  if (!address.startsWith("/")) {
    return `"${address}" does not start with "/": write it as "/${address}".`;
  }
  if (address === "/") {
    return '"/" is the site\'s root, where entries cannot be served yet: give the collection a path of its own, such as "/blog".';
  }
  if (address.endsWith("/")) {
    return `"${address}" ends with "/": write it without one.`;
  }
  if (/[?#]/.test(address)) {
    return `"${address}" holds a query or a fragment: write the path alone.`;
  }
  const segments = address.slice(1).split("/");
  if (segments.some(segment => segment === "")) {
    return `"${address}" has an empty segment ("//").`;
  }
  if (segments.some(segment => segment === "." || segment === "..")) {
    return `"${address}" has a "." or ".." segment, which a browser resolves away.`;
  }
  // The store's own reading of a served path, which refuses what the content
  // route refuses (the runtime's reserved paths among them), so an address is
  // never declared that no request could reach.
  const served = servedAddress(ANY_LOCALE, address);
  if (served === null) {
    return `"${address}" is not a path the site serves content at: it is kept by the runtime (such as /admin or /api), or holds a character a browser would rewrite.`;
  }
  const canonical = pathOf(served);
  if (canonical !== address) {
    return `"${address}" is spelled differently from how a browser requests it: write it as "${canonical}".`;
  }
  return null;
}

/**
 * The declared addresses, checked, as each collection's address segments.
 *
 * @throws When an address is not in its one spelling, or two collections
 *   share one, naming the collections and what is wrong.
 */
export function checkedTemplateAddresses(
  options: PageBuilderTemplateOptions | undefined
): ReadonlyMap<string, readonly string[]> {
  const declared: unknown = options?.addresses;
  if (declared === undefined) return new Map();
  if (
    typeof declared !== "object" ||
    declared === null ||
    Array.isArray(declared)
  ) {
    throw new Error(
      '[page-builder] templates.addresses must map collection slugs to paths, such as { posts: "/blog" }.'
    );
  }
  const problems: string[] = [];
  const byAddress = new Map<string, string>();
  const addresses = new Map<string, readonly string[]>();
  for (const [collection, address] of Object.entries(declared)) {
    const problem = templateAddressProblem(address);
    if (problem !== null) {
      problems.push(`For "${collection}", ${problem}`);
      continue;
    }
    const path = address as string;
    const other = byAddress.get(path);
    if (other !== undefined) {
      problems.push(
        `"${other}" and "${collection}" are both given the address "${path}"; each collection needs one of its own.`
      );
      continue;
    }
    byAddress.set(path, collection);
    addresses.set(collection, path.slice(1).split("/").map(decodeURIComponent));
  }
  if (problems.length > 0) {
    throw new Error(
      `[page-builder] templates.addresses cannot be used: ${problems.join(" ")}`
    );
  }
  return addresses;
}
