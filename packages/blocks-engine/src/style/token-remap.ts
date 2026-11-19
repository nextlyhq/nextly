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
import { customPropertyReferences } from "./css-value-check";
import { tokenCustomProperty } from "./declarations";
import { onlySiteProperties } from "./document-token-usage";

/**
 * The custom properties CSS text (a page's or a block's custom CSS) reads
 * through `var()` that a site variable could be written under: the engine's
 * one reading of a reference, which {@link remapTokenReferences} points, so a
 * file carries exactly the variables an import points. Text with no `(`
 * holds no function, so it is not parsed.
 */
export function cssTextProperties(text: string): Set<string> {
  const found = new Set<string>();
  if (!text.includes("(")) return found;
  for (const reference of customPropertyReferences(text) ?? []) {
    // Only what the CSS reads needs a variable carried; a local
    // declaration supplies its own value.
    if (reference.kind === "read") found.add(reference.name);
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
 * A reference is read as a browser reads it, by the engine's one reading
 * ({@link customPropertyReferences}): a whole name, decoded, so a longer
 * property one begins is left alone, an escaped spelling of one is pointed,
 * and a quoted string, a comment or a URL is never read as one. Each is
 * pointed once, in place, over the text as written, so a property already
 * pointed elsewhere is never pointed again. A `var()` of a property no
 * variable in the file is written under is CSS the author typed, and stays
 * as it is.
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
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      // Text with no `(` holds no function to read a property, and text
      // with no `--` no declaration of one: neither has anything to point.
      return table.size === 0 || !(node.includes("(") || node.includes("--"))
        ? node
        : pointedIn(node, table);
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

/**
 * `text` with each `var()` reference `table` names, and each local
 * declaration of one (so an override in custom CSS still holds), written as
 * the property it maps to, in place, and every other character as it was. A reference
 * whose place doesn't hold a spelling of its name is left alone rather than
 * spliced blind. Text that can't be read whole is left as written.
 */
function pointedIn(text: string, table: ReadonlyMap<string, string>): string {
  const references = customPropertyReferences(text);
  if (references === undefined) return text;
  let out = "";
  let from = 0;
  for (const reference of [...references].sort((a, b) => a.start - b.start)) {
    const to = table.get(reference.name);
    if (to === undefined || reference.start < from) continue;
    if (!text.slice(reference.start, reference.end).startsWith("--")) continue;
    out += text.slice(from, reference.start) + to;
    from = reference.end;
  }
  return from === 0 ? text : out + text.slice(from);
}
