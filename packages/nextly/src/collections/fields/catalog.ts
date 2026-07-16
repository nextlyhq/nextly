/**
 * The serializable field-type catalog: one description of every built-in
 * field type — its key, human label, picker category, one-line hint, and
 * Lucide icon name. Pure data with no runtime imports, safe to consume from
 * the browser, the server, and plugins alike.
 *
 * This is the single source of truth the admin's field pickers render from.
 * Surfaces narrow it to their allowed subset by key (user profile fields,
 * form fields, block props); none of them redeclare what a field type is.
 *
 * Icons are carried as Lucide icon *names*: the catalog stays serializable,
 * and each consumer resolves names against its own icon set.
 */

import type { FieldType } from "./types/base";

/**
 * Picker grouping, in display order: Basic → Advanced → Media → Relational →
 * Structured. Categories render as sticky headers; entries appear under
 * their header in catalog order.
 */
export type FieldTypeCategory =
  | "Basic"
  | "Advanced"
  | "Media"
  | "Relational"
  | "Structured";

/** One catalog row describing a field type for pickers and docs. */
export interface FieldTypeCatalogEntry {
  /** The canonical type key field instances reference. */
  type: FieldType;
  /** Human label shown in pickers. */
  label: string;
  /** Picker grouping. */
  category: FieldTypeCategory;
  /** One-line description shown under the label. */
  hint: string;
  /** Lucide icon name, resolved by each consumer's icon set. */
  icon: string;
}

/** Every built-in field type, described once. */
export const FIELD_TYPE_CATALOG: readonly FieldTypeCatalogEntry[] = [
  // Basic
  {
    type: "text",
    label: "Text",
    category: "Basic",
    hint: "Single-line input",
    icon: "Type",
  },
  {
    type: "textarea",
    label: "Long text",
    category: "Basic",
    hint: "Multi-line input",
    icon: "AlignLeft",
  },
  {
    type: "richText",
    label: "Editor",
    category: "Basic",
    hint: "Lexical rich-text editor",
    icon: "Edit",
  },
  {
    type: "email",
    label: "Email",
    category: "Basic",
    hint: "Validated email address",
    icon: "Mail",
  },
  {
    type: "password",
    label: "Password",
    category: "Basic",
    hint: "Hashed at rest",
    icon: "Lock",
  },
  {
    type: "number",
    label: "Number",
    category: "Basic",
    hint: "Integer or decimal",
    icon: "Hash",
  },
  // Advanced
  {
    type: "code",
    label: "Code",
    category: "Advanced",
    hint: "Code with syntax highlighting",
    icon: "Code",
  },
  {
    type: "date",
    label: "Date",
    category: "Advanced",
    hint: "Date or datetime",
    icon: "Calendar",
  },
  {
    type: "select",
    label: "Select",
    category: "Advanced",
    hint: "Dropdown of options",
    icon: "List",
  },
  {
    type: "radio",
    label: "Radio",
    category: "Advanced",
    hint: "One choice from a set",
    icon: "Circle",
  },
  {
    type: "checkbox",
    label: "Checkbox",
    category: "Advanced",
    hint: "Boolean rendered as a checkbox",
    icon: "CheckSquare",
  },
  {
    type: "json",
    label: "JSON",
    category: "Advanced",
    hint: "Raw JSON value",
    icon: "Braces",
  },
  {
    type: "chips",
    label: "Tags",
    category: "Advanced",
    hint: "Free-form list of strings",
    icon: "Tags",
  },
  // Media
  {
    type: "upload",
    label: "Media",
    category: "Media",
    hint: "File or image upload",
    icon: "Upload",
  },
  // Relational
  {
    type: "relationship",
    label: "Relationship",
    category: "Relational",
    hint: "Link to records in another collection",
    icon: "Link2",
  },
  // Structured
  {
    type: "repeater",
    label: "Repeater",
    category: "Structured",
    hint: "Repeating group of fields",
    icon: "Layers",
  },
  {
    type: "group",
    label: "Group",
    category: "Structured",
    hint: "Nested set of fields",
    icon: "FolderOpen",
  },
  {
    type: "component",
    label: "Component",
    category: "Structured",
    hint: "Embed a reusable component",
    icon: "Puzzle",
  },
];

/** Look up one catalog entry by its type key. */
export function getFieldTypeCatalogEntry(
  type: FieldType
): FieldTypeCatalogEntry | undefined {
  return FIELD_TYPE_CATALOG.find(entry => entry.type === type);
}

/**
 * Narrow the catalog to a surface's allowed types, preserving catalog order.
 * The result's `type` is narrowed to the requested subset, so a surface with
 * its own type union (e.g. user profile fields) keeps it end to end.
 */
export function narrowFieldTypeCatalog<T extends FieldType>(
  types: readonly T[]
): Array<FieldTypeCatalogEntry & { type: T }> {
  const allowed: ReadonlySet<string> = new Set(types);
  return FIELD_TYPE_CATALOG.filter(
    (entry): entry is FieldTypeCatalogEntry & { type: T } =>
      allowed.has(entry.type)
  );
}
