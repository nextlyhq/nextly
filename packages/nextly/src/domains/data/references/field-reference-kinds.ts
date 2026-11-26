/**
 * How each core field type's stored value holds references: to another
 * entry or media item by id, or to a media file by its address.
 *
 * The walker (`content-references`) dispatches from this table and from
 * nothing else, so it is the one account of which field types can hold a
 * reference. It is keyed by every member of `FieldType`, so a new core field
 * type does not compile until it says how its value holds references, and the
 * walker cannot miss it.
 *
 * @module domains/data/references/field-reference-kinds
 */

import type { FieldType } from "../../../collections/fields/types";

/**
 * - `none`: a plain value (text, a number, a date, a choice) that names
 *   nothing;
 * - `link`: a relationship or upload, holding ids in any stored shape;
 * - `richText`: a rich-text tree, naming media files by the `src` of its
 *   image and gallery nodes;
 * - `json`: a JSON value, read as a block document when it is one and
 *   otherwise for the addresses under `src` or `url`;
 * - `group`: a named group, its child fields in one object;
 * - `repeater`: rows of child fields;
 * - `fieldGroup`: a field group's instance or list of instances, each read by
 *   the schema it names.
 */
export type FieldReferenceKind =
  | "none"
  | "link"
  | "richText"
  | "json"
  | "group"
  | "repeater"
  | "fieldGroup";

export const FIELD_REFERENCE_KINDS: Readonly<
  Record<FieldType, FieldReferenceKind>
> = {
  text: "none",
  textarea: "none",
  richText: "richText",
  email: "none",
  password: "none",
  code: "none",
  icon: "none",
  number: "none",
  checkbox: "none",
  date: "none",
  select: "none",
  radio: "none",
  upload: "link",
  relationship: "link",
  repeater: "repeater",
  group: "group",
  json: "json",
  component: "fieldGroup",
  fieldGroup: "fieldGroup",
  // A list of free-text tags, never ids.
  chips: "none",
};

/**
 * The kind of a core field type, or `undefined` for a type core does not
 * define: one a plugin adds, read through its declared shape
 * (`plugin-reference-shapes`) or, with none, as JSON.
 */
export function coreFieldReferenceKind(
  type: unknown
): FieldReferenceKind | undefined {
  if (typeof type !== "string") return undefined;
  return Object.prototype.hasOwnProperty.call(FIELD_REFERENCE_KINDS, type)
    ? FIELD_REFERENCE_KINDS[type as FieldType]
    : undefined;
}
