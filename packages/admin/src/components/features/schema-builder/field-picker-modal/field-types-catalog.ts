// Why: single source of truth for the field types shown in FieldPickerModal,
// their categories, and one-line hints. Replaces the hardcoded accordion in
// the legacy FieldPalette.tsx (which is deleted in PR 3). Per the per-kind
// audit, all three kinds support all field types today; the BuilderConfig's
// `picker.excludedTypes` array (currently empty for every kind) lets us
// hide a type per-kind in future product decisions without changing this
// catalog.
import type { FieldPrimitiveType } from "@admin/types/collection";

export type FieldTypeCategory =
  | "Basic"
  | "Advanced"
  | "Media"
  | "Relational"
  | "Structured";

export interface FieldTypeEntry {
  type: FieldPrimitiveType;
  label: string;
  category: FieldTypeCategory;
  hint: string;
}

/**
 * Stable ordering: Basic → Advanced → Media → Relational → Structured.
 * Categories are sticky headers in the picker; field rows appear in this
 * order under their header.
 */
export const FIELD_TYPES_CATALOG: readonly FieldTypeEntry[] = [
  // Basic
  {
    type: "text",
    label: "Text",
    category: "Basic",
    hint: "Single-line string",
  },
  {
    type: "textarea",
    label: "Textarea",
    category: "Basic",
    hint: "Multi-line text",
  },
  {
    type: "richText",
    label: "Rich text",
    category: "Basic",
    hint: "WYSIWYG editor",
  },
  { type: "email", label: "Email", category: "Basic", hint: "Validated email" },
  {
    type: "password",
    label: "Password",
    category: "Basic",
    hint: "Hashed string",
  },
  {
    type: "number",
    label: "Number",
    category: "Basic",
    hint: "Integer or decimal",
  },
  // Advanced
  {
    type: "code",
    label: "Code",
    category: "Advanced",
    hint: "Code snippet with language",
  },
  {
    type: "date",
    label: "Date",
    category: "Advanced",
    hint: "Date or date+time",
  },
  {
    type: "select",
    label: "Select",
    category: "Advanced",
    hint: "Dropdown of options",
  },
  {
    type: "radio",
    label: "Radio",
    category: "Advanced",
    hint: "Single choice",
  },
  {
    type: "checkbox",
    label: "Checkbox",
    category: "Advanced",
    hint: "Multi-select",
  },
  {
    type: "json",
    label: "JSON",
    category: "Advanced",
    hint: "Free-form structured data",
  },
  {
    type: "chips",
    label: "Chips",
    category: "Advanced",
    hint: "Tag-style multi value",
  },
  // Media
  { type: "upload", label: "Upload", category: "Media", hint: "File or image" },
  // Relational
  {
    type: "relationship",
    label: "Relationship",
    category: "Relational",
    hint: "Link to another collection",
  },
  // Structured
  {
    type: "repeater",
    label: "Repeater",
    category: "Structured",
    hint: "Repeatable rows of fields",
  },
  {
    type: "group",
    label: "Group",
    category: "Structured",
    hint: "Nested fields under one key",
  },
  {
    type: "component",
    label: "Component",
    category: "Structured",
    hint: "Reuse an existing component",
  },
  {
    type: "blocks",
    label: "Blocks",
    category: "Structured",
    hint: "Heterogeneous block list",
  },
];
