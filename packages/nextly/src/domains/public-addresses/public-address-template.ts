/**
 * The rule a declared public address is judged by, and how one is filled from
 * an entry.
 *
 * A public address is where a type's pages are served on the site:
 * `"/blog/{slug}"` for a collection, `"/"` for a homepage Single. It is a
 * template rather than a function so that it can be read, compared and, in
 * time, matched backwards from a requested path to the entry that holds it,
 * which a function cannot be.
 *
 * An address has exactly one spelling, so its template must too: a leading
 * `/`, no trailing one but the root's, no empty or dot segment, no query or
 * fragment, and each literal segment spelled as a browser sends it (`%C3%A9`,
 * never `é` or `%c3%a9`). A placeholder is a whole segment naming a field of
 * the type, or `id`; a field whose values are paths (`db.slugPaths`) may stand
 * for several segments. A collection's address names at least one
 * placeholder, since each entry has an address of its own; a Single's names
 * none, since it is one page. Nothing may sit under a path the runtime keeps
 * for itself (`/admin`, `/api`, `/_next`, `/sitemap.xml` and the rest), by the
 * content route's own rule.
 *
 * @module domains/public-addresses/public-address-template
 */
import { isReservedPath } from "../../runtime/routing/reserved-paths";
import { previewUrlFromTemplate } from "../collections/services/preview-url-resolver";

/** The two kinds of type a page can belong to. */
export type PublicAddressKind = "collection" | "single";

/** What a template is judged against: the kind of type, and its field names. */
export interface PublicAddressOwner {
  kind: PublicAddressKind;
  /** The type's own top-level field names; `id` is always allowed. */
  fieldNames: readonly string[];
}

/** A whole-segment placeholder, `{fieldName}`. */
const PLACEHOLDER = /^\{(\w+)\}$/;

/** Every field a template may name besides the type's own. */
const ALWAYS_NAMEABLE = new Set(["id"]);

/**
 * Whether `segment` is spelled as a browser sends it: decoding and encoding it
 * again gives it back unchanged. `a b`, `%c3%a9` and a stray `%` are not.
 */
function spelledAsSent(segment: string): boolean {
  try {
    return encodeURIComponent(decodeURIComponent(segment)) === segment;
  } catch {
    return false;
  }
}

/**
 * Why `template` cannot be the public address of a type like `owner`, or null
 * where it can.
 *
 * One sentence, naming the remedy, for a developer reading a refused
 * configuration. The same rule judges an address declared in code and one a
 * plugin supplies for a type made in the Schema Builder, so an address one
 * road accepts is never one another refuses.
 */
export function publicAddressProblem(
  template: unknown,
  owner: PublicAddressOwner
): string | null {
  if (typeof template !== "string") {
    return 'A public address must be a string, such as "/blog/{slug}".';
  }
  if (!template.startsWith("/")) {
    return `A public address must start with "/": "${template}" does not.`;
  }
  if (/[?#]/.test(template)) {
    return `A public address is a path, with no query or fragment: "${template}" has one.`;
  }
  if (template.length > 1 && template.endsWith("/")) {
    return `A public address must not end with "/", except "/" itself: "${template}" does.`;
  }

  // The root is one page with no segments.
  const segments = template === "/" ? [] : template.slice(1).split("/");
  const placeholders: string[] = [];
  for (const segment of segments) {
    if (segment === "") {
      return `A public address has no empty segment ("//"): "${template}" has one.`;
    }
    if (segment === "." || segment === "..") {
      return `A public address has no "." or ".." segment: "${template}" has one.`;
    }
    const placeholder = PLACEHOLDER.exec(segment);
    if (placeholder) {
      placeholders.push(placeholder[1]);
      continue;
    }
    if (/[{}]/.test(segment)) {
      return `A placeholder must be a whole segment, such as "/blog/{slug}": "${segment}" in "${template}" is not.`;
    }
    if (!spelledAsSent(segment)) {
      return `The segment "${segment}" in "${template}" must be spelled as a browser sends it, as percent-encoded UTF-8 with capital hex digits.`;
    }
  }

  if (owner.kind === "collection" && placeholders.length === 0) {
    return `A collection's public address needs at least one placeholder, such as "/blog/{slug}", since each entry has its own: "${template}" has none.`;
  }
  if (owner.kind === "single" && placeholders.length > 0) {
    return `A Single's public address has no placeholder, since a Single is one page at one address: "${template}" has one.`;
  }
  for (const name of placeholders) {
    if (!ALWAYS_NAMEABLE.has(name) && !owner.fieldNames.includes(name)) {
      return `"${name}" is not a field of this type, so "${template}" cannot be filled from an entry.`;
    }
  }

  // The literal part before the first placeholder decides whether every
  // address the template can make falls under a kept path; a fixed address
  // is judged whole. A placeholder's value that lands on a kept path is a
  // single entry's problem, answered when that entry's address is filled.
  const firstPlaceholder = segments.findIndex(s => PLACEHOLDER.test(s));
  const probe =
    firstPlaceholder === -1
      ? template
      : `/${[...segments.slice(0, firstPlaceholder), "_"].join("/")}`;
  if (isReservedPath(probe)) {
    return `"${template}" is kept for the admin, the API or the runtime's own files, so no page can be served there.`;
  }
  return null;
}

/**
 * The fields every collection and Single has, whether or not its declaration
 * lists them: `defineCollection`, `defineSingle` and the Schema Builder each
 * add `title` and `slug` where the type does not declare its own.
 */
const SYSTEM_FIELD_NAMES = ["title", "slug"] as const;

/**
 * The top-level field names a template may name for a type with `fields`:
 * each field's own name, and the system fields every type is given.
 */
export function addressableFieldNames(fields: readonly unknown[]): string[] {
  const names = new Set<string>(SYSTEM_FIELD_NAMES);
  for (const field of fields) {
    const name = (field as { name?: unknown } | null)?.name;
    if (typeof name === "string") names.add(name);
  }
  return [...names];
}

/**
 * Why the `publicAddress` a type declares cannot be its address, or null
 * where it can or the type declares none. What the collection and Single
 * validators ask, so a declaration is judged by one rule wherever it is made.
 */
export function declaredPublicAddressProblem(
  publicAddress: unknown,
  kind: PublicAddressKind,
  fields: readonly unknown[]
): string | null {
  if (publicAddress === undefined) return null;
  return publicAddressProblem(publicAddress, {
    kind,
    fieldNames: addressableFieldNames(fields),
  });
}

/** Options for {@link fillPublicAddress}. */
export interface FillPublicAddressOptions {
  /**
   * The fields whose values are paths of several segments, such as the slug
   * of a collection with `db.slugPaths`: their `/` is kept and each segment
   * encoded. Every other value is one segment, its `/` encoded.
   */
  pathFields?: readonly string[];
}

/**
 * The address `template` gives `entry`, or null where it gives none yet.
 *
 * Null where a placeholder has no value to fill it (missing, empty, or with
 * no text form), and where the filled address is not one a visitor can be
 * served at: a `.` or `..` segment, or a path the runtime keeps for itself
 * (an entry whose slug is `admin`, under `"/{slug}"`).
 *
 * The values are substituted by the same rule a preview path is, so the two
 * addresses one entry has never encode a value two ways. The template is
 * assumed to have passed {@link publicAddressProblem}.
 */
export function fillPublicAddress(
  template: string,
  entry: Readonly<Record<string, unknown>>,
  options: FillPublicAddressOptions = {}
): string | null {
  const filled = previewUrlFromTemplate(template, {
    pathFields: options.pathFields,
  })({ ...entry });
  if (filled === null) return null;
  const segments = filled === "/" ? [] : filled.slice(1).split("/");
  if (segments.some(s => s === "" || s === "." || s === "..")) return null;
  if (isReservedPath(filled)) return null;
  return filled;
}
