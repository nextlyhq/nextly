/**
 * Runtime-checked readers that turn a Direct API document into a domain type.
 *
 * `nextly.find()` resolves to `Record<string, unknown>` unless the project
 * generates types, and this template cannot ship generated ones: the visual
 * approach declares `collections: []` in its config because its schema lives
 * in the database, so one committed generated file cannot describe both
 * approaches while the same query layer serves them.
 *
 * These helpers therefore CHECK each field instead of asserting the whole
 * document. A record missing `slug` yields the fallback rather than an
 * `undefined` that would reach a route segment and render `/categories/undefined`.
 */

import type { Author, Category, Tag } from "./types";

/** A present string, or undefined when the field is absent or another type. */
export function readOptionalString(
  doc: Record<string, unknown>,
  key: string
): string | undefined {
  const value = doc[key];
  return typeof value === "string" ? value : undefined;
}

/** A present string, or the fallback. Used for fields the UI always renders. */
export function readString(
  doc: Record<string, unknown>,
  key: string,
  fallback = ""
): string {
  return readOptionalString(doc, key) ?? fallback;
}

/**
 * A nullable text field. Distinguishes "absent" from "empty" by collapsing
 * both to null, which is what the domain types declare for these fields.
 */
export function readNullableString(
  doc: Record<string, unknown>,
  key: string
): string | null {
  return readOptionalString(doc, key) ?? null;
}

/**
 * The document id. Nextly ids are strings, but a dialect that returns a
 * numeric primary key would otherwise put a number where a route expects text.
 */
export function readId(doc: Record<string, unknown>): string {
  const value = doc.id;
  return typeof value === "string" ? value : String(value ?? "");
}

export function toCategory(doc: Record<string, unknown>): Category {
  return {
    id: readId(doc),
    name: readString(doc, "name"),
    slug: readString(doc, "slug"),
    icon: readNullableString(doc, "icon"),
    description: readNullableString(doc, "description"),
  };
}

export function toTag(doc: Record<string, unknown>): Tag {
  return {
    id: readId(doc),
    name: readString(doc, "name"),
    slug: readString(doc, "slug"),
    description: readNullableString(doc, "description"),
  };
}

/**
 * The public Author projection. Email, password and roles are never read here,
 * so they cannot leak into a payload the frontend serializes.
 */
export function toAuthor(doc: Record<string, unknown>): Author {
  return {
    id: readId(doc),
    name: readString(doc, "name"),
    slug: readString(doc, "slug"),
    bio: readNullableString(doc, "bio"),
    avatarUrl: readNullableString(doc, "avatarUrl"),
  };
}
