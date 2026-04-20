/**
 * Shared constants and utilities for FieldList components
 */

import type { LucideIcon } from "@admin/components/icons";
import * as Icons from "@admin/components/icons";

import type { BuilderField } from "../types";

// Icon mapping for dynamic icon rendering
export const iconMap = Icons as unknown as Record<string, LucideIcon>;

// Map field types to icons
export const FIELD_TYPE_ICONS: Record<string, string> = {
  text: "Type",
  textarea: "AlignLeft",
  richText: "Edit",
  email: "Mail",
  password: "Lock",
  code: "Code",
  number: "Hash",
  checkbox: "CheckSquare",
  date: "Calendar",
  select: "List",
  radio: "Circle",
  upload: "Upload",
  relationship: "Link2",
  array: "Layers",
  repeater: "Layers",
  group: "FolderOpen",
  json: "Braces",
};

// Display name overrides for field types
export const FIELD_TYPE_DISPLAY_NAMES: Record<string, string> = {
  repeater: "Repeater",
};

// Format field type for display
export function formatFieldType(type: string): string {
  if (FIELD_TYPE_DISPLAY_NAMES[type]) return FIELD_TYPE_DISPLAY_NAMES[type];
  return type
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

// Count nested fields recursively
export function countNestedFields(field: BuilderField): number {
  if (!field.fields || field.fields.length === 0) return 0;
  return field.fields.reduce((sum, f) => sum + 1 + countNestedFields(f), 0);
}

/**
 * Recursively find a field by ID, searching through nested fields and block types.
 */
export function findFieldById(
  fields: BuilderField[],
  fieldId: string
): BuilderField | null {
  for (const field of fields) {
    if (field.id === fieldId) {
      return field;
    }
    // Search in nested fields (for array, group, etc.)
    if (field.fields && field.fields.length > 0) {
      const found = findFieldById(field.fields, fieldId);
      if (found) return found;
    }
  }
  return null;
}
