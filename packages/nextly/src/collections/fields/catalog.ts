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

/**
 * One catalog row describing a field type for pickers and docs. Generic over
 * the key so a surface's own types (see the user-surface entries below) carry
 * their narrower union end to end.
 */
export interface FieldTypeCatalogEntry<T extends string = FieldType> {
  /** The type key field instances reference. */
  type: T;
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

/**
 * Field types that exist only on specific admin surfaces. They are NOT part
 * of the canonical `FieldType` union: a collection cannot declare them, so
 * they can never reach the schema pipeline's column mappers. Their storage
 * is either text with validation semantics (url, phone, time, hidden) or the
 * surface's own blob handling (file inside a form's JSON).
 */
export type UserSurfaceFieldType = "url" | "phone";

/** Field types that exist only on the form-builder surface. */
export type FormSurfaceFieldType = "url" | "phone" | "file" | "time" | "hidden";

/**
 * Surface-only catalog entries, described once so every surface that admits
 * them shares one label/icon/hint. Slotted into per-surface catalogs below.
 */
const URL_SURFACE_ENTRY = {
  type: "url",
  label: "URL",
  category: "Basic",
  hint: "Validated web address",
  icon: "Link2",
} as const satisfies FieldTypeCatalogEntry<"url">;

const PHONE_SURFACE_ENTRY = {
  type: "phone",
  label: "Phone",
  category: "Basic",
  hint: "Phone number",
  icon: "Phone",
} as const satisfies FieldTypeCatalogEntry<"phone">;

const TIME_SURFACE_ENTRY = {
  type: "time",
  label: "Time",
  category: "Basic",
  hint: "Time of day",
  icon: "Clock",
} as const satisfies FieldTypeCatalogEntry<"time">;

const FILE_SURFACE_ENTRY = {
  type: "file",
  label: "File upload",
  category: "Media",
  hint: "File attached by the visitor",
  icon: "Upload",
} as const satisfies FieldTypeCatalogEntry<"file">;

const HIDDEN_SURFACE_ENTRY = {
  type: "hidden",
  label: "Hidden",
  category: "Advanced",
  hint: "Invisible value submitted with the form",
  icon: "EyeOff",
} as const satisfies FieldTypeCatalogEntry<"hidden">;

/** The user-profile surface's field types: flat scalars plus url/phone. */
export type UserFieldCatalogType =
  | "text"
  | "textarea"
  | "number"
  | "email"
  | "url"
  | "phone"
  | "select"
  | "radio"
  | "checkbox"
  | "date";

/**
 * The user-profile picker's catalog: the flat-scalar subset of the shared
 * catalog with the two user-surface types slotted beside email, where a
 * profile author expects contact-shaped fields together.
 */
export const USER_FIELD_TYPE_CATALOG: readonly FieldTypeCatalogEntry<UserFieldCatalogType>[] =
  (() => {
    const scalars = narrowFieldTypeCatalog([
      "text",
      "textarea",
      "number",
      "email",
      "select",
      "radio",
      "checkbox",
      "date",
    ] as const);
    const combined: FieldTypeCatalogEntry<UserFieldCatalogType>[] = [];
    for (const entry of scalars) {
      combined.push(entry);
      if (entry.type === "email") {
        combined.push(URL_SURFACE_ENTRY, PHONE_SURFACE_ENTRY);
      }
    }
    return combined;
  })();

/** The form-builder surface's field types: flat inputs plus its own five. */
export type FormFieldCatalogType =
  | "text"
  | "textarea"
  | "number"
  | "email"
  | "url"
  | "phone"
  | "select"
  | "radio"
  | "checkbox"
  | "date"
  | "time"
  | "file"
  | "hidden";

/**
 * The form-builder picker's catalog: the flat-input subset of the shared
 * catalog plus the form-surface types — url/phone beside email (contact
 * shapes together, matching the user surface), time beside date, and
 * file/hidden appended in their own categories. Form fields live in the
 * form's JSON blob, so none of these touch the schema pipeline.
 */
export const FORM_FIELD_TYPE_CATALOG: readonly FieldTypeCatalogEntry<FormFieldCatalogType>[] =
  (() => {
    const scalars = narrowFieldTypeCatalog([
      "text",
      "textarea",
      "number",
      "email",
      "select",
      "radio",
      "checkbox",
      "date",
    ] as const);
    const combined: FieldTypeCatalogEntry<FormFieldCatalogType>[] = [];
    for (const entry of scalars) {
      combined.push(entry);
      if (entry.type === "email") {
        combined.push(URL_SURFACE_ENTRY, PHONE_SURFACE_ENTRY);
      }
      if (entry.type === "date") {
        combined.push(TIME_SURFACE_ENTRY);
      }
    }
    combined.push(FILE_SURFACE_ENTRY, HIDDEN_SURFACE_ENTRY);
    return combined;
  })();

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
