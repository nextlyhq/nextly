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

/** Why `template` is not a path of one spelling, judged whole, or null. */
function shapeProblem(template: string): string | null {
  if (!template.startsWith("/")) {
    return `A public address must start with "/": "${template}" does not.`;
  }
  if (/[?#]/.test(template)) {
    return `A public address is a path, with no query or fragment: "${template}" has one.`;
  }
  if (template.length > 1 && template.endsWith("/")) {
    return `A public address must not end with "/", except "/" itself: "${template}" does.`;
  }
  return null;
}

/** Why `segment` of `template` cannot be one, or null where it can. */
function segmentProblem(segment: string, template: string): string | null {
  if (segment === "") {
    return `A public address has no empty segment ("//"): "${template}" has one.`;
  }
  if (segment === "." || segment === "..") {
    return `A public address has no "." or ".." segment: "${template}" has one.`;
  }
  if (PLACEHOLDER.test(segment)) return null;
  if (/[{}]/.test(segment)) {
    return `A placeholder must be a whole segment, such as "/blog/{slug}": "${segment}" in "${template}" is not.`;
  }
  if (!spelledAsSent(segment)) {
    return `The segment "${segment}" in "${template}" must be spelled as a browser sends it, as percent-encoded UTF-8 with capital hex digits.`;
  }
  return null;
}

/**
 * Why the fields `template` names in `placeholders` do not suit `owner`, or
 * null where they do.
 */
function placeholderProblem(
  template: string,
  placeholders: readonly string[],
  owner: PublicAddressOwner
): string | null {
  if (owner.kind === "collection" && placeholders.length === 0) {
    return `A collection's public address needs at least one placeholder, such as "/blog/{slug}", since each entry has its own: "${template}" has none.`;
  }
  if (owner.kind === "single" && placeholders.length > 0) {
    return `A Single's public address has no placeholder, since a Single is one page at one address: "${template}" has one.`;
  }
  const unknown = placeholders.find(
    name => !ALWAYS_NAMEABLE.has(name) && !owner.fieldNames.includes(name)
  );
  return unknown === undefined
    ? null
    : `"${unknown}" is not a field of this type, so "${template}" cannot be filled from an entry.`;
}

/**
 * Why every address `template` makes falls under a path the runtime keeps,
 * or null where none need.
 *
 * The literal part before the first placeholder decides it; a fixed address
 * is judged whole. A placeholder's value that lands on a kept path is a single
 * entry's problem, answered when that entry's address is filled.
 */
function keptPathProblem(
  template: string,
  segments: readonly string[]
): string | null {
  const firstPlaceholder = segments.findIndex(s => PLACEHOLDER.test(s));
  const probe =
    firstPlaceholder === -1
      ? template
      : `/${[...segments.slice(0, firstPlaceholder), "_"].join("/")}`;
  return isReservedPath(probe)
    ? `"${template}" is kept for the admin, the API or the runtime's own files, so no page can be served there.`
    : null;
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
  const shape = shapeProblem(template);
  if (shape !== null) return shape;

  // The root is one page with no segments.
  const segments = template === "/" ? [] : template.slice(1).split("/");
  for (const segment of segments) {
    const problem = segmentProblem(segment, template);
    if (problem !== null) return problem;
  }
  const placeholders = segments.flatMap(
    segment => PLACEHOLDER.exec(segment)?.[1] ?? []
  );
  return (
    placeholderProblem(template, placeholders, owner) ??
    keptPathProblem(template, segments)
  );
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

/** A refused `publicAddress`, as the collection and Single validators report one. */
export interface PublicAddressError {
  path: "publicAddress" | "publicAddressField";
  code: "PUBLIC_ADDRESS_INVALID";
  message: string;
}

/**
 * The errors a validator reports for the `publicAddress` a type of `kind`
 * with `fields` declares: none, or the one rule it breaks.
 */
export function publicAddressErrors(
  publicAddress: unknown,
  kind: PublicAddressKind,
  fields: unknown
): PublicAddressError[] {
  const message = declaredPublicAddressProblem(
    publicAddress,
    kind,
    Array.isArray(fields) ? fields : []
  );
  return message === null
    ? []
    : [{ path: "publicAddress", code: "PUBLIC_ADDRESS_INVALID", message }];
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

/**
 * @experimental An entry's own address, as the field a collection names in
 * `publicAddressField` holds it: none where the field is empty, so the
 * collection's template gives the entry its address; the address where the
 * value is one a visitor can be served at on this site; and why not
 * otherwise.
 */
export type OwnAddress =
  | { status: "none" }
  | { status: "resolved"; path: string }
  | { status: "invalid"; problem: string };

/** The shape a refused own address is described against. */
const OWN_ADDRESS_SHAPE =
  'Use an address on this site, starting with "/", such as "/about"';

/**
 * The address `value` names as an entry's own, judged and spelled as a
 * template's result is: from the site's root, with no other host, query,
 * fragment or trailing `/`, each segment encoded as a browser sends it, and
 * no `.`, `..` or empty segment, or path the runtime keeps for itself.
 */
export function ownAddressOf(value: unknown): OwnAddress {
  if (value === undefined || value === null) return { status: "none" };
  if (typeof value !== "string") {
    return { status: "invalid", problem: `${OWN_ADDRESS_SHAPE}.` };
  }
  const text = value.trim();
  if (text === "") return { status: "none" };
  if (text === "/") return { status: "resolved", path: "/" };
  if (!text.startsWith("/") || text.startsWith("//") || /[?#\\\s]/.test(text)) {
    return {
      status: "invalid",
      problem: `${OWN_ADDRESS_SHAPE}, with no other site, query or fragment.`,
    };
  }
  if (text.endsWith("/")) {
    return {
      status: "invalid",
      problem: `${OWN_ADDRESS_SHAPE}, without a "/" at the end.`,
    };
  }
  // A step out of the path, or an empty part, is refused rather than encoded
  // into one segment as a placeholder's value would be: a person typed it.
  const segments = text.slice(1).split("/");
  if (segments.some(part => part === "" || part === "." || part === "..")) {
    return {
      status: "invalid",
      problem: `${OWN_ADDRESS_SHAPE}, with no empty, "." or ".." part.`,
    };
  }
  // Filled as a template's one path placeholder is, so an own address and a
  // template's result are encoded and refused by the same rule.
  const path = fillPublicAddress(
    "/{address}",
    { address: text.slice(1) },
    { pathFields: ["address"] }
  );
  return path === null
    ? {
        status: "invalid",
        problem: `${OWN_ADDRESS_SHAPE}, outside the paths kept for the admin, the API and the runtime.`,
      }
    : { status: "resolved", path };
}

/**
 * Why the field `publicAddressField` names cannot hold a collection's
 * entries' own addresses, or null where it can or none is named: it needs the
 * collection's template to fall back to, and must be a top-level text field.
 */
export function publicAddressFieldProblem(
  field: unknown,
  publicAddress: unknown,
  fields: readonly unknown[]
): string | null {
  if (field === undefined) return null;
  if (typeof field !== "string" || field === "") {
    return "publicAddressField must name a text field of the collection.";
  }
  if (publicAddress === undefined) {
    return `publicAddressField "${field}" needs publicAddress, the template an entry with no address of its own is served at.`;
  }
  const declared = fields.find(
    each => (each as { name?: unknown } | null)?.name === field
  ) as { type?: unknown } | undefined;
  if (declared === undefined) {
    return `publicAddressField: "${field}" is not a field of the collection.`;
  }
  if (declared.type !== "text") {
    return `publicAddressField: "${field}" must be a text field.`;
  }
  return null;
}
