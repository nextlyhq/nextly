/**
 * Form Field Type Registry
 *
 * Central registry for all supported field types in the Visual Form Builder.
 * Used by AddFieldModal to display available field types grouped by category.
 *
 * Architecture Decision (Task 3.5):
 * - Adding Fields: Field Selection Modal (click to add) instead of drag-and-drop
 * - Reordering Fields: Drag handles on field list for reordering only
 * - Components: Preview + Editor only (no Render - external apps use API schema)
 *
 * Supported Field Types:
 * - Core Fields (8): text, textarea, email, number, checkbox, select, radio, date
 *
 * @module admin/fields
 * @since 0.1.0
 */

import {
  AlignLeft,
  Calendar,
  CheckSquare,
  ChevronDown,
  Circle,
  FileText,
  Hash,
  Mail,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";

import type { FormField, FormFieldType } from "../../types";

// ============================================================================
// Types
// ============================================================================

/**
 * Props for field editor components.
 *
 * Each field type has a dedicated editor component that receives these props.
 */
export interface FieldEditorProps<T extends FormField = FormField> {
  /** The field being edited */
  field: T;
  /** All fields in the form (for references, e.g., state -> country linking) */
  allFields: FormField[];
  /** Callback to update field properties */
  onUpdate: (updates: Partial<T>) => void;
}

/**
 * Field type configuration for the admin UI.
 *
 * Defines metadata and components for each supported field type.
 */
export interface FieldTypeConfig {
  /** Field type identifier (matches FormFieldType) */
  type: FormFieldType;
  /** Display name in field selector */
  label: string;
  /** Lucide icon name */
  icon: string;
  /** Short description shown in field selector */
  description: string;
  /** Category for grouping in the Add Field modal */
  category: "core";
  /**
   * Editor component for configuring field properties.
   * Lazy-loaded for code splitting.
   *
   * Note: Uses `any` for the component type to allow field-specific editors.
   * The actual editor component will receive the correctly typed field.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  EditorComponent: () => Promise<{ default: ComponentType<any> }>;
  /** Default field configuration when added to form */
  defaultConfig: Partial<FormField> & { type: FormFieldType };
}

/**
 * Field type category configuration.
 */
export interface FieldCategory {
  /** Category key */
  key: "core";
  /** Display label */
  label: string;
  /** Description of the category */
  description: string;
}

// ============================================================================
// Category Definitions
// ============================================================================

/**
 * Field type categories for organizing the Add Field modal.
 */
export const FIELD_CATEGORIES: FieldCategory[] = [
  {
    key: "core",
    label: "Core Fields",
    description: "Essential form input fields",
  },
];

// ============================================================================
// Field Type Definitions
// ============================================================================

/**
 * Supported field types.
 *
 * This registry defines 8 field types that cover the most common form use cases:
 * - Contact forms
 * - Registration forms
 * - Surveys and feedback
 *
 * Additional field types (phone, url, file, time, hidden)
 * can be added in future iterations.
 */
export const FIELD_TYPES: FieldTypeConfig[] = [
  // ---------------------------------------------------------------------------
  // Core Fields (7 types)
  // ---------------------------------------------------------------------------
  {
    type: "text",
    label: "Text",
    icon: "Type",
    description: "Single-line text input",
    category: "core",
    EditorComponent: () => import("./TextFieldEditor"),
    defaultConfig: {
      type: "text",
      label: "Text Field",
      placeholder: "",
      required: false,
    },
  },
  {
    type: "textarea",
    label: "Textarea",
    icon: "AlignLeft",
    description: "Multi-line text input",
    category: "core",
    EditorComponent: () => import("./TextareaFieldEditor"),
    defaultConfig: {
      type: "textarea",
      label: "Message",
      placeholder: "",
      required: false,
      rows: 4,
    },
  },
  {
    type: "email",
    label: "Email",
    icon: "Mail",
    description: "Email address with validation",
    category: "core",
    EditorComponent: () => import("./EmailFieldEditor"),
    defaultConfig: {
      type: "email",
      label: "Email",
      placeholder: "email@example.com",
      required: false,
    },
  },
  {
    type: "number",
    label: "Number",
    icon: "Hash",
    description: "Numeric input with min/max",
    category: "core",
    EditorComponent: () => import("./NumberFieldEditor"),
    defaultConfig: {
      type: "number",
      label: "Number",
      placeholder: "0",
      required: false,
    },
  },
  {
    type: "checkbox",
    label: "Checkbox",
    icon: "CheckSquare",
    description: "Single checkbox (yes/no)",
    category: "core",
    EditorComponent: () => import("./CheckboxFieldEditor"),
    defaultConfig: {
      type: "checkbox",
      label: "I agree to the terms",
      required: false,
      defaultValue: false,
    },
  },
  {
    type: "select",
    label: "Dropdown",
    icon: "ChevronDown",
    description: "Dropdown select menu",
    category: "core",
    EditorComponent: () => import("./SelectFieldEditor"),
    defaultConfig: {
      type: "select",
      label: "Select an option",
      placeholder: "Choose...",
      required: false,
      options: [
        { label: "Option 1", value: "option1" },
        { label: "Option 2", value: "option2" },
      ],
    },
  },
  {
    type: "radio",
    label: "Radio",
    icon: "Circle",
    description: "Radio button group",
    category: "core",
    EditorComponent: () => import("./RadioFieldEditor"),
    defaultConfig: {
      type: "radio",
      label: "Choose one",
      required: false,
      options: [
        { label: "Option 1", value: "option1" },
        { label: "Option 2", value: "option2" },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Date Fields
  // ---------------------------------------------------------------------------
  {
    type: "date",
    label: "Date",
    icon: "Calendar",
    description: "Date picker",
    category: "core",
    EditorComponent: () => import("./DateFieldEditor"),
    defaultConfig: {
      type: "date",
      label: "Date",
      required: false,
    },
  },
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get field types grouped by category.
 *
 * @returns Object with category keys mapping to arrays of field configs
 *
 * @example
 * ```typescript
 * const grouped = getFieldTypesByCategory();
 * // { core: [...], location: [...] }
 * ```
 */
export function getFieldTypesByCategory(): Record<string, FieldTypeConfig[]> {
  return FIELD_TYPES.reduce(
    (acc, field) => {
      if (!acc[field.category]) {
        acc[field.category] = [];
      }
      acc[field.category].push(field);
      return acc;
    },
    {} as Record<string, FieldTypeConfig[]>
  );
}

/**
 * Get field type configuration by type identifier.
 *
 * @param type - The field type to look up
 * @returns The field type config or undefined if not found
 *
 * @example
 * ```typescript
 * const config = getFieldTypeConfig('text');
 * console.log(config?.label); // "Text"
 * ```
 */
export function getFieldTypeConfig(
  type: FormFieldType
): FieldTypeConfig | undefined {
  return FIELD_TYPES.find(f => f.type === type);
}

/**
 * Check if a field type is supported by the registry.
 *
 * @param type - The field type to check
 * @returns True if the field type is supported
 */
export function isFieldTypeSupported(type: string): type is FormFieldType {
  return FIELD_TYPES.some(f => f.type === type);
}

/**
 * Create a new field instance from a field type.
 *
 * Generates a unique field name and applies default configuration.
 *
 * @param type - The field type to create
 * @returns A new FormField instance
 * @throws Error if the field type is unknown
 *
 * @example
 * ```typescript
 * const field = createFieldFromType('email');
 * // { type: 'email', name: 'email_abc123', label: 'Email', ... }
 * ```
 */
export function createFieldFromType(type: FormFieldType): FormField {
  const config = getFieldTypeConfig(type);

  if (!config) {
    throw new Error(`Unknown field type: ${type}`);
  }

  // Generate unique field name
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  const name = `${type}_${timestamp}_${random}`;

  return {
    name,
    ...config.defaultConfig,
  } as FormField;
}

/**
 * Get the Lucide icon name for a field type.
 *
 * @param type - The field type
 * @returns The Lucide icon name or "FileText" as fallback
 */
export function getFieldTypeIcon(type: FormFieldType): string {
  return getFieldTypeConfig(type)?.icon ?? "FileText";
}

/**
 * Get the display label for a field type.
 *
 * @param type - The field type
 * @returns The display label or the type itself as fallback
 */
export function getFieldTypeLabel(type: FormFieldType): string {
  return getFieldTypeConfig(type)?.label ?? type;
}

/**
 * Get all supported field types as an array of type identifiers.
 *
 * @returns Array of supported FormFieldType values
 */
export function getSupportedFieldTypes(): FormFieldType[] {
  return FIELD_TYPES.map(f => f.type);
}

// ============================================================================
// Icon Resolution
// ============================================================================

/**
 * Mapping of Lucide icon names to their component implementations.
 *
 * This map is used by `resolveFieldIcon()` to convert icon name strings
 * (stored in FIELD_TYPES) to actual React components for rendering.
 *
 * When adding new field types, ensure the corresponding icon is added here.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  Type,
  AlignLeft,
  Mail,
  Hash,
  CheckSquare,
  ChevronDown,
  Circle,
  Calendar,
  FileText, // Fallback icon
};

/**
 * Resolve a Lucide icon name to its component implementation.
 *
 * This function converts icon name strings (e.g., "Type", "Mail") to actual
 * Lucide React components that can be rendered. Used by SortableFieldRow
 * and other components that display field type icons.
 *
 * @param iconName - The Lucide icon name (from getFieldTypeIcon or FIELD_TYPES)
 * @returns The Lucide icon component, or FileText as fallback
 *
 * @example
 * ```tsx
 * const iconName = getFieldTypeIcon('email'); // "Mail"
 * const IconComponent = resolveFieldIcon(iconName);
 * return <IconComponent className="h-4 w-4" />;
 * ```
 */
export function resolveFieldIcon(iconName: string): LucideIcon {
  return ICON_MAP[iconName] ?? FileText;
}

// Re-export LucideIcon type for consumers
export type { LucideIcon };
