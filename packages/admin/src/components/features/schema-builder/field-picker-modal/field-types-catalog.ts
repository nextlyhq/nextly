// Why: single source of truth for the field types shown in
// FieldPickerModal: their categories, one-line hints, AND the Lucide
// icon name to render in the picker row. Icons used to live in legacy
// FieldList/constants.ts which is slated for deletion in PR F; moving
// them inline here so the picker stays self-contained.
//
// PR C (2026-05-03) audit results:
//   - Restored `toggle` (legacy palette had it; first picker shipped
//     without it).
//   - Dropped `blocks` (speculative addition; no editor exists; can be
//     re-added when an editor is built).
//   - Renamed "Rich text" -> "Editor" with a Lexical hint per Mobeen's
//     feedback Section 3.
//   - Tightened other taglines for clarity.
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
  /** Lucide icon name (resolved via @admin/components/icons). */
  icon: string;
}

/**
 * Stable ordering: Basic -> Advanced -> Media -> Relational -> Structured.
 * Categories are sticky headers in the picker; field rows appear in this
 * order under their header.
 */
export const FIELD_TYPES_CATALOG: readonly FieldTypeEntry[] = [
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
    type: "toggle",
    label: "Toggle",
    category: "Advanced",
    hint: "Boolean rendered as a switch",
    icon: "ToggleLeft",
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
