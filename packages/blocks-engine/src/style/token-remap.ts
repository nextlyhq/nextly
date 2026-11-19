/**
 * Pointing what a value names, of variables carried from another site, at
 * this site: each `$token` at the identity the variable takes here, and each
 * `var()` of its custom property at the property it is written under here,
 * under this site's prefix.
 *
 * The one implementation for every import that carries variables: a design
 * token file, and a page, pattern, component or Layout transfer file. Both
 * build the remap once per import and ask it of every value they write.
 *
 * @module token-remap
 */
import { tokenCustomProperty } from "./declarations";
import { onlySiteProperties } from "./document-token-usage";

/**
 * How a `var()` reference is matched in CSS text: its opening, spaces
 * allowed before the name, and the end of a whole name (a space, a
 * fallback's comma or the closing parenthesis). One grammar for finding the
 * properties CSS text names and for pointing them elsewhere, so a file
 * carries exactly the variables an import points.
 */
const VAR_OPEN = "(var\\(\\s*)";
const NAME_END = "(?=[\\s,)])";

/**
 * The custom properties CSS text (a page's or a block's custom CSS) reads
 * through `var()` that a site variable could be written under, matched as
 * {@link remapTokenReferences} points them.
 */
export function cssTextProperties(text: string): Set<string> {
  const found = new Set<string>();
  if (!text.includes("var(")) return found;
  const pattern = new RegExp(`${VAR_OPEN}(--[a-z0-9-]+)${NAME_END}`, "g");
  for (const match of text.matchAll(pattern)) {
    if (match[2] !== undefined) found.add(match[2]);
  }
  return onlySiteProperties(found);
}

/** Where an import's variables land, as {@link remapTokenReferences} reads it. */
export interface TokenRemap {
  /**
   * The identity each of the file's variables takes here, where it is not
   * its own: a variable renamed, or merged into one here under its id.
   */
  readonly ids: ReadonlyMap<string, string>;
  /** Every variable identity the file holds, mapped or not. */
  readonly identities: readonly string[];
  /** The prefix the file's `var()` references are written under. */
  readonly from: string;
  /** This site's prefix, which they are read under here. */
  readonly to: string;
}

/**
 * `value` with every variable it names pointed where `remap` says: a
 * `$token` key's identity through `remap.ids`, and inside any string, each
 * `var()` of one of the file's variables' custom properties.
 *
 * A property is matched as a whole name inside `var()`, ended by a space, a
 * fallback's comma or the closing parenthesis, so a longer property it
 * begins is left alone; and in one pass over the text as written, so a
 * property already pointed elsewhere is never pointed again. A `var()` of a
 * property no variable in the file is written under is CSS the author typed,
 * and stays as it is.
 *
 * The walk is built once per `remap` object, however many values it is
 * asked of, so an import passes one object for all its values.
 */
export function remapTokenReferences<T>(value: T, remap: TokenRemap): T {
  let walk = walks.get(remap);
  if (walk === undefined) {
    walk = walkFor(remap);
    walks.set(remap, walk);
  }
  return walk(value) as T;
}

/** Each remap's walk, kept with the remap it was built for. */
const walks = new WeakMap<TokenRemap, (value: unknown) => unknown>();

/** The walk that points a value's references where `remap` says. */
function walkFor(remap: TokenRemap): (value: unknown) => unknown {
  // Each of the file's variables' custom properties, as the file writes it,
  // to the one it is read under here: its id here, under this site's prefix.
  const table = new Map<string, string>();
  for (const identity of remap.identities) {
    const from = tokenCustomProperty(identity, remap.from);
    const to = tokenCustomProperty(
      remap.ids.get(identity) ?? identity,
      remap.to
    );
    if (from !== to && !table.has(from)) table.set(from, to);
  }
  if (table.size === 0 && remap.ids.size === 0) return value => value;
  const names = [...table.keys()]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);
  const pattern =
    names.length === 0
      ? undefined
      : new RegExp(`${VAR_OPEN}(${names.join("|")})${NAME_END}`, "g");
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      return pattern === undefined
        ? node
        : node.replace(
            pattern,
            (_match, open: string, name: string) =>
              `${open}${table.get(name) ?? name}`
          );
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== "object") return node;
    return Object.fromEntries(
      Object.entries(node).map(([key, entry]) => [
        key,
        key === "$token" && typeof entry === "string"
          ? (remap.ids.get(entry) ?? entry)
          : walk(entry),
      ])
    );
  };
  return walk;
}

/** `text` as a regular expression matching it literally. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
