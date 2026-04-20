/**
 * Shared utilities and constants for the FieldEditor and its panels.
 *
 * @module components/features/schema-builder/FieldEditor/utils
 */

import type { LucideIcon } from "@admin/components/icons";
import * as Icons from "@admin/components/icons";

// Icon mapping
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
  blocks: "LayoutGrid",
  json: "Braces",
  tabs: "PanelTop",
  collapsible: "ChevronsUpDown",
  row: "Columns",
  point: "MapPin",
  slug: "Link",
  component: "Puzzle",
  chips: "Tags",
};

// Layout field types (no data storage, no validation/advanced options)
const LAYOUT_FIELD_TYPES: string[] = [];

// Field types that have options (select, radio)
const OPTIONS_FIELD_TYPES = ["select", "radio"];

// Relationship field type
const RELATIONSHIP_FIELD_TYPE = "relationship";

// Upload field type
const UPLOAD_FIELD_TYPE = "upload";

// Group field type
const GROUP_FIELD_TYPE = "group";

// Component field type
const COMPONENT_FIELD_TYPE = "component";

// Format field type for display
export function formatFieldType(type: string): string {
  return type
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

// Check if field is a layout type (no data storage)
export function isLayoutField(type: string): boolean {
  return LAYOUT_FIELD_TYPES.includes(type);
}

// Check if field type has options (select, radio)
export function hasOptions(type: string): boolean {
  return OPTIONS_FIELD_TYPES.includes(type);
}

// Check if field type is a relationship
export function isRelationshipField(type: string): boolean {
  return type === RELATIONSHIP_FIELD_TYPE;
}

// Check if field type is an upload
export function isUploadField(type: string): boolean {
  return type === UPLOAD_FIELD_TYPE;
}

// Check if field type is an array
export function isArrayField(type: string): boolean {
  return type === "repeater";
}

// Check if field type is a group
export function isGroupField(type: string): boolean {
  return type === GROUP_FIELD_TYPE;
}

// Check if field type is component
export function isComponentField(type: string): boolean {
  return type === COMPONENT_FIELD_TYPE;
}
