/**
 * Collection Builder Types
 *
 * Type definitions for the Visual Collection Builder components.
 */

import type { FieldConfig } from "@admin/types/ui/collection";

// ============================================================
// Field Width Options
// ============================================================

/**
 * Available width options for fields in the admin UI
 */
export const FIELD_WIDTH_OPTIONS = [
  { value: "25%", label: "25%" },
  { value: "33%", label: "33%" },
  { value: "50%", label: "50%" },
  { value: "66%", label: "66%" },
  { value: "75%", label: "75%" },
  { value: "100%", label: "100%" },
] as const;

export type FieldWidth = (typeof FIELD_WIDTH_OPTIONS)[number]["value"];

/**
 * Available position options for fields
 */
export const FIELD_POSITION_OPTIONS = [
  { value: "main", label: "Main Content" },
  { value: "sidebar", label: "Sidebar" },
] as const;

export type FieldPosition = "main" | "sidebar";

// ============================================================
// Field Condition (Simplified)
// ============================================================

/**
 * Operator union for FieldCondition. PR E2 (2026-05-03) extends the
 * legacy { field, equals } shape with type-aware operators per Q6 = (b).
 *
 * Operator semantics:
 *   - equals / notEquals      -- universal scalar equality
 *   - contains / notContains  -- substring (text-style only)
 *   - startsWith / endsWith   -- substring at boundary (text-style only)
 *   - isEmpty / isNotEmpty    -- emptiness check (text-style only); no value
 *   - greaterThan / lessThan / greaterThanOrEqual / lessThanOrEqual
 *                              -- numeric comparison (number/date)
 *   - between                  -- inclusive range (number/date); value is { min, max }
 *   - before / after           -- date comparison (alias for less/greater on dates)
 *   - isTrue / isNotTrue       -- boolean-only; no value
 */
export type ConditionOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "isEmpty"
  | "isNotEmpty"
  | "greaterThan"
  | "lessThan"
  | "greaterThanOrEqual"
  | "lessThanOrEqual"
  | "between"
  | "before"
  | "after"
  | "isTrue"
  | "isNotTrue";

/**
 * Value shape for the `between` operator.
 */
export interface ConditionRangeValue {
  min: number | string;
  max: number | string;
}

/**
 * Field visibility condition.
 *
 * PR E2 extended this from `{ field, equals }` to support type-aware
 * operators. Legacy shape is preserved as an OPTIONAL `equals` for
 * backwards-compat at the runtime evaluator boundary; new code writes
 * `{ field, operator, value? }`.
 *
 * Use the `evaluateCondition` helper in `lib/builder/condition-evaluator`
 * to evaluate at runtime. It normalizes both shapes to the same logic.
 */
export interface FieldCondition {
  /** The source field name to check. */
  field: string;
  /**
   * Operator. Optional only for backwards-compat with the legacy
   * `{ field, equals }` shape; new code always sets this.
   */
  operator?: ConditionOperator;
  /**
   * Value to compare against. Type depends on operator:
   *   - string for text-style operators
   *   - number for numeric comparison
   *   - string (ISO 8601) for date comparison
   *   - { min, max } for between
   *   - undefined for isEmpty/isNotEmpty/isTrue/isNotTrue
   */
  value?: string | number | boolean | ConditionRangeValue;
  /**
   * @deprecated Legacy shape from before PR E2. Treated as `{ operator:
   * "equals", value: equals }` at the evaluator boundary. New code should
   * use `operator` + `value`.
   */
  equals?: string;
}

// ============================================================
// Field Admin Options (for Builder)
// ============================================================

/**
 * Admin UI options for a field in the builder
 */
export interface BuilderFieldAdmin {
  /** Field width in the form layout */
  width?: FieldWidth;
  /** Field position (main or sidebar) */
  position?: FieldPosition;
  /** Make field read-only */
  readOnly?: boolean;
  /** Hide field from UI */
  hidden?: boolean;
  /** Condition for showing/hiding the field */
  condition?: FieldCondition;
  /** Description/help text */
  description?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Hide the gutter (vertical line and padding) for group fields */
  hideGutter?: boolean;
  /**
   * Select fields only -- show a clear button on the picker.
   * Defaults to true when the field is not required, false otherwise.
   * PR E3: matches Payload's SelectAdmin.isClearable.
   */
  isClearable?: boolean;
  /**
   * Radio fields only -- horizontal vs vertical option layout.
   * Defaults to "horizontal" (Payload's default).
   * PR E3: matches Payload's RadioAdmin.layout.
   */
  layout?: "horizontal" | "vertical";
  /**
   * Relationship fields only -- picker shape.
   * "select" (default) renders the inline collection picker; "drawer"
   * opens a side drawer better suited to long-list searching.
   * PR E3: matches Payload's RelationshipAdmin.appearance.
   */
  appearance?: "drawer" | "select";
  /**
   * Upload fields only -- whether the user can upload new files
   * inline. Defaults to true. PR H feedback 2.2: matches the
   * framework's UploadFieldAdminOptions.allowCreate (which is where
   * the runtime UploadInput already reads from). Editor previously
   * stored this at top-level field.allowCreate which mismatched the
   * runtime path; storing here closes the gap.
   */
  allowCreate?: boolean;
}

// ============================================================
// Field Validation Options (for Builder)
// ============================================================

/**
 * Validation options for a field in the builder
 */
export interface BuilderFieldValidation {
  /** Field is required */
  required?: boolean;
  /** Minimum length (text fields) */
  minLength?: number;
  /** Maximum length (text fields) */
  maxLength?: number;
  /** Minimum value (number fields) */
  min?: number;
  /** Maximum value (number fields) */
  max?: number;
  /** Minimum rows/items (array/hasMany fields) */
  minRows?: number;
  /** Maximum rows/items (array/hasMany fields) */
  maxRows?: number;
  /** Minimum chips (chips fields) */
  minChips?: number;
  /** Maximum chips (chips fields) */
  maxChips?: number;
  /** Regex pattern (text fields) */
  pattern?: string;
  /** Custom validation error message */
  message?: string;
}

// ============================================================
// Field Advanced Options (for Builder)
// ============================================================

/**
 * Advanced options for a field in the builder
 */
export interface BuilderFieldAdvanced {
  /** Field value must be unique */
  unique?: boolean;
  /** Create database index on this field */
  index?: boolean;
  /** Field supports localization (reserved for future) */
  localized?: boolean;
}

/**
 * Field type category for organizing fields in the palette
 */
export interface FieldCategory {
  name: string;
  color: string;
  types: FieldTypeInfo[];
}

/**
 * Information about a field type in the palette
 */
export interface FieldTypeInfo {
  type: string;
  label: string;
  description: string;
  icon: string;
}

/**
 * Drag data for palette items
 * Used to identify what's being dragged from the palette
 */
export interface PaletteDragData {
  source: "palette";
  fieldType: string;
  label: string;
  icon: string;
}

/**
 * Drag data for field list items
 * Used to identify what's being dragged within the list
 */
export interface FieldListDragData {
  source: "field-list";
  field: BuilderField;
}

/**
 * Union type for all drag data
 */
export type DragData = PaletteDragData | FieldListDragData;

/**
 * Active drag state for the builder
 */
export interface ActiveDragState {
  id: string;
  data: DragData;
}

/**
 * Option for select/radio fields (without id for storage)
 */
export interface FieldOption {
  /** Unique identifier for drag-and-drop (optional for storage) */
  id?: string;
  /** Display text shown to users */
  label: string;
  /** Value stored in the database */
  value: string;
}

/**
 * Simplified filter for relationship field options.
 * Limits available related documents by a field value.
 */
export interface RelationshipFilter {
  /** The field name to filter by */
  field: string;
  /** The value that field should equal */
  equals: string;
}

/**
 * Labels for array field rows (singular/plural)
 */
export interface ArrayFieldLabels {
  /** Singular label for a single row (e.g., "Item", "Question", "Slide") */
  singular?: string;
  /** Plural label for multiple rows (e.g., "Items", "Questions", "Slides") */
  plural?: string;
}

/**
 * Builder field with unique ID for drag-and-drop
 * Supports nested fields for array, group, and blocks types
 */
export interface BuilderField extends FieldConfig {
  id: string;
  /**
   * System fields (title, slug) are auto-generated and cannot be deleted or renamed.
   */
  isSystem?: boolean;
  /**
   * Field description/help text
   */
  description?: string;
  /**
   * Default value for the field
   */
  defaultValue?: string | number | boolean | null;
  /**
   * Allow multiple values (for text, number, select, upload, relationship)
   */
  hasMany?: boolean;
  /**
   * Options for select/radio fields
   */
  options?: FieldOption[];
  /**
   * Validation options
   */
  validation?: BuilderFieldValidation;
  /**
   * Admin UI options
   */
  admin?: BuilderFieldAdmin;
  /**
   * Advanced options (unique, index, localized)
   */
  advanced?: BuilderFieldAdvanced;
  /**
   * Nested fields for container types (array, group)
   */
  fields?: BuilderField[];
  // ============================================================
  // Relationship Field Properties
  // ============================================================
  /**
   * Target collection slug(s) for relationship fields
   * Single string for simple relationships, array for polymorphic
   */
  relationTo?: string | string[];
  /**
   * Maximum depth for populating related documents
   */
  maxDepth?: number;
  /**
   * Allow creating new related documents from the field
   */
  allowCreate?: boolean;
  /**
   * Allow editing related documents from the field
   */
  allowEdit?: boolean;
  /**
   * Allow drag-and-drop reordering of selected relationships (when hasMany)
   */
  isSortable?: boolean;
  /**
   * Simple filter for available related documents
   */
  relationshipFilter?: RelationshipFilter;
  // ============================================================
  // Upload Field Properties
  // ============================================================
  /**
   * MIME type filter pattern for upload fields (e.g., "image/*")
   */
  mimeTypes?: string;
  /**
   * Maximum file size in bytes for upload fields
   */
  maxFileSize?: number;
  // ============================================================
  // Array Field Properties
  // ============================================================
  /**
   * Row labels for array fields (singular/plural)
   */
  labels?: ArrayFieldLabels;
  /**
   * Whether array rows should be initially collapsed
   */
  initCollapsed?: boolean;
  /**
   * Field name to use as the row label (instead of "Item 1", "Item 2")
   */
  rowLabelField?: string;
  // ============================================================
  // Component Field Properties
  // ============================================================
  /**
   * Single component mode: embed one specific component type.
   * Mutually exclusive with `components`.
   * @example 'seo'
   */
  component?: string;
  /**
   * Multi-component mode (dynamic zone): allow editor to pick from
   * multiple component types.
   * Mutually exclusive with `component`.
   * @example ['hero', 'cta', 'content']
   */
  components?: string[];
  /**
   * Whether this component field allows multiple instances (array).
   * Only applies to component fields.
   * @default false
   */
  repeatable?: boolean;
  // ============================================================
  // Blocks Field Properties
  // ============================================================
  /**
   * Block types for blocks field
   */
  blocks?: Array<{
    slug: string;
    label?: string;
    fields: BuilderField[];
  }>;
}

/**
 * Field types that can contain nested fields
 */
export const NESTED_FIELD_TYPES = ["repeater", "group"] as const;

export type NestedFieldType = (typeof NESTED_FIELD_TYPES)[number];

/**
 * Check if a field type supports nested fields
 */
export function isNestedFieldType(type: string): type is NestedFieldType {
  return NESTED_FIELD_TYPES.includes(type as NestedFieldType);
}

/**
 * Maximum nesting depth allowed (3-4 levels as per design decision)
 */
export const MAX_NESTING_DEPTH = 4;

/**
 * Validation error for a field
 */
export interface FieldValidationError {
  fieldId: string;
  message: string;
  type: "error" | "warning";
}

/**
 * Collection form data for the builder
 */
export interface CollectionFormData {
  singularName: string;
  pluralName: string;
  description?: string;
  fields: BuilderField[];
}

/**
 * Entity type for the builder (collection, single, or component)
 */
export type BuilderEntityType = "collection" | "single" | "component";

/**
 * Props for the FieldList component
 */
export interface FieldListProps {
  fields: BuilderField[];
  selectedFieldId: string | null;
  onFieldSelect: (fieldId: string) => void;
  onFieldsReorder: (fields: BuilderField[]) => void;
  onFieldDelete: (fieldId: string) => void;
  onFieldAdd: () => void;
  /**
   * Validation errors for fields
   */
  validationErrors?: FieldValidationError[];
  /**
   * Collapsed field IDs (for nested fields)
   */
  collapsedFieldIds?: Set<string>;
  /**
   * Toggle collapsed state for a field
   */
  onToggleCollapse?: (fieldId: string) => void;
  /**
   * Callback when the empty state placeholder is clicked
   */
  onPlaceholderClick?: (parentFieldId?: string) => void;
}

/**
 * Props for the FieldEditor component
 */
export interface FieldEditorProps {
  field: BuilderField | null;
  onFieldUpdate: (field: BuilderField) => void;
  onClose: () => void;
  siblingFields?: BuilderField[];
}

/**
 * Props for the main CollectionBuilder page
 */
export interface CollectionBuilderProps {
  initialData?: {
    slug: string;
    name: string;
    description?: string;
    fields: BuilderField[];
  };
  isEditing?: boolean;
}

// ============================================================
// Collection Settings Types
// ============================================================

/**
 * Labels for the collection in the Admin UI
 */
export interface CollectionLabels {
  /** Singular form (e.g., "Post") */
  singular: string;
  /** Plural form (e.g., "Posts") */
  plural: string;
}

/**
 * Admin UI configuration for the collection
 */
export interface CollectionAdminConfig {
  /** Lucide icon name for sidebar */
  icon?: string;
  /** Sidebar group name */
  group?: string;
  /** Hide from admin sidebar */
  hidden?: boolean;
  /** Sort order in sidebar (lower = higher position, default: 100) */
  order?: number;
  /** Custom sidebar group slug. When set, item moves from Collections section to this custom group */
  sidebarGroup?: string;
  /** Field name to use as entry title */
  useAsTitle?: string;
  /** Default columns to show in list view */
  defaultColumns?: string[];
}

/**
 * An enabled hook instance in the collection.
 * Represents a pre-built hook that has been added to a collection
 * with its specific configuration.
 */
export interface EnabledHook {
  /** Unique instance ID for this hook (for drag-and-drop) */
  id: string;
  /** Pre-built hook ID (e.g., 'auto-slug', 'audit-fields') */
  hookId: string;
  /** Validated configuration matching the hook's configSchema */
  config: Record<string, unknown>;
  /** Whether this hook is enabled (can be toggled without removing) */
  enabled: boolean;
}

// CollectionSettingsData / CollectionSettingsProps were retired alongside
// CollectionSettings.tsx in PR 2 of the Builder redesign. Settings now flow
// through BuilderSettingsValues + BuilderSettingsModal — see
// schema-builder/BuilderSettingsModal.tsx.

// ============================================================
// Select/Radio Options Types
// ============================================================

/**
 * A single option for select or radio fields.
 * Includes an id for drag-and-drop operations.
 */
export interface SelectOption {
  /** Unique identifier for drag-and-drop (auto-generated) */
  id: string;
  /** Display text shown to users */
  label: string;
  /** Value stored in the database */
  value: string;
}

/**
 * Props for the SelectOptionsEditor component
 */
export interface SelectOptionsEditorProps {
  /** Current options */
  options: SelectOption[];
  /** Callback when options change */
  onOptionsChange: (options: SelectOption[]) => void;
  /** Whether multiple selections are allowed (select only) */
  hasMany?: boolean;
  /** Callback when hasMany changes */
  onHasManyChange?: (hasMany: boolean) => void;
  /** The field type (select or radio) */
  fieldType: "select" | "radio";
  /**
   * Select fields only -- whether the picker shows a clear button.
   * Stored as `field.admin.isClearable`. PR E3.
   */
  isClearable?: boolean;
  /** Callback when isClearable changes. */
  onIsClearableChange?: (isClearable: boolean) => void;
  /**
   * Select fields only -- placeholder text shown when no value picked.
   * Stored as `field.admin.placeholder`. PR E3.
   */
  placeholder?: string;
  /** Callback when placeholder changes. */
  onPlaceholderChange?: (placeholder: string) => void;
  /**
   * Radio fields only -- horizontal vs vertical layout.
   * Stored as `field.admin.layout`. PR E3.
   */
  layout?: "horizontal" | "vertical";
  /** Callback when layout changes. */
  onLayoutChange?: (layout: "horizontal" | "vertical") => void;
}

/**
 * Import format for options
 */
export type OptionsImportFormat = "json" | "csv";

// ============================================================
// Upload Field Types
// ============================================================

/**
 * MIME type category for file filtering
 */
export type MimeTypeCategory =
  | "all"
  | "images"
  | "videos"
  | "audio"
  | "documents"
  | "custom";

/**
 * MIME type category options for the selector
 */
export const MIME_TYPE_CATEGORIES: Array<{
  value: MimeTypeCategory;
  label: string;
  pattern?: string;
  description?: string;
}> = [
  { value: "all", label: "All Files", description: "No restriction" },
  {
    value: "images",
    label: "Images",
    pattern: "image/*",
    description: "PNG, JPG, GIF, etc.",
  },
  {
    value: "videos",
    label: "Videos",
    pattern: "video/*",
    description: "MP4, WebM, etc.",
  },
  {
    value: "audio",
    label: "Audio",
    pattern: "audio/*",
    description: "MP3, WAV, etc.",
  },
  {
    value: "documents",
    label: "Documents",
    pattern:
      "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    description: "PDF, Word, Excel",
  },
  { value: "custom", label: "Custom", description: "Specify MIME types" },
] as const;

/**
 * File size unit for the max file size input
 */
export type FileSizeUnit = "KB" | "MB" | "GB";

/**
 * File size unit options for the selector
 */
export const FILE_SIZE_UNITS: Array<{
  value: FileSizeUnit;
  label: string;
  multiplier: number;
}> = [
  { value: "KB", label: "KB", multiplier: 1024 },
  { value: "MB", label: "MB", multiplier: 1024 * 1024 },
  { value: "GB", label: "GB", multiplier: 1024 * 1024 * 1024 },
] as const;

/**
 * Get MIME pattern from category
 */
export function getMimePatternFromCategory(
  category: MimeTypeCategory
): string | undefined {
  if (category === "all" || category === "custom") return undefined;
  const found = MIME_TYPE_CATEGORIES.find(c => c.value === category);
  return found?.pattern;
}

/**
 * Get category from MIME pattern
 */
export function getCategoryFromMimePattern(
  pattern: string | undefined
): MimeTypeCategory {
  if (!pattern) return "all";

  // Check if it matches a predefined category
  for (const category of MIME_TYPE_CATEGORIES) {
    if (category.pattern === pattern) {
      return category.value;
    }
  }

  // If it's a simple wildcard pattern, try to match
  if (pattern === "image/*") return "images";
  if (pattern === "video/*") return "videos";
  if (pattern === "audio/*") return "audio";

  // Otherwise, it's a custom pattern
  return "custom";
}

/**
 * Convert file size to bytes
 */
export function convertToBytes(value: number, unit: FileSizeUnit): number {
  const unitInfo = FILE_SIZE_UNITS.find(u => u.value === unit);
  return value * (unitInfo?.multiplier || 1);
}

/**
 * Convert bytes to file size with appropriate unit
 */
export function convertFromBytes(bytes: number): {
  value: number;
  unit: FileSizeUnit;
} {
  // Find the best unit
  if (bytes >= 1024 * 1024 * 1024) {
    return {
      value: Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100,
      unit: "GB",
    };
  }
  if (bytes >= 1024 * 1024) {
    return {
      value: Math.round((bytes / (1024 * 1024)) * 100) / 100,
      unit: "MB",
    };
  }
  return { value: Math.round((bytes / 1024) * 100) / 100, unit: "KB" };
}

/**
 * Props for the UploadEditor component.
 *
 * PR H feedback 2.2: trimmed to only the knobs that work end-to-end
 * (have a runtime consumer in UploadInput.tsx + MediaPickerDialog).
 * Removed: relationTo (Media Collection picker -- the runtime ignores
 * it), allowEdit (never read), isSortable (never read), displayPreview
 * (never read).
 */
export interface UploadEditorProps {
  /** Whether multiple uploads are allowed */
  hasMany?: boolean;
  /** Callback when hasMany changes */
  onHasManyChange: (hasMany: boolean) => void;
  /** MIME type filter pattern */
  mimeTypes?: string;
  /** Callback when mimeTypes changes */
  onMimeTypesChange?: (mimeTypes: string | undefined) => void;
  /** Maximum file size in bytes */
  maxFileSize?: number;
  /** Callback when maxFileSize changes */
  onMaxFileSizeChange?: (maxFileSize: number | undefined) => void;
  /** Allow uploading new files from the field */
  allowCreate?: boolean;
  /** Callback when allowCreate changes */
  onAllowCreateChange?: (allowCreate: boolean) => void;
}

// ============================================================
// Relationship Field Types
// ============================================================

/**
 * Props for the RelationshipEditor component
 */
export interface RelationshipEditorProps {
  /** Current target collection(s) */
  relationTo?: string | string[];
  /** Callback when relationTo changes */
  onRelationToChange: (relationTo: string | string[] | undefined) => void;
  /** Whether multiple relationships are allowed */
  hasMany?: boolean;
  /** Callback when hasMany changes */
  onHasManyChange: (hasMany: boolean) => void;
  /** Maximum population depth */
  maxDepth?: number;
  /** Callback when maxDepth changes */
  onMaxDepthChange?: (maxDepth: number | undefined) => void;
  /** Allow creating new related documents */
  allowCreate?: boolean;
  /** Callback when allowCreate changes */
  onAllowCreateChange?: (allowCreate: boolean) => void;
  /** Allow editing related documents */
  allowEdit?: boolean;
  /** Callback when allowEdit changes */
  onAllowEditChange?: (allowEdit: boolean) => void;
  /** Allow reordering (when hasMany) */
  isSortable?: boolean;
  /** Callback when isSortable changes */
  onIsSortableChange?: (isSortable: boolean) => void;
  /** Current filter options */
  filterOptions?: RelationshipFilter;
  /** Callback when filter options change */
  onFilterOptionsChange?: (filter: RelationshipFilter | undefined) => void;
  /**
   * Picker shape: "select" inline picker (default) or "drawer" overlay.
   * Stored as `field.admin.appearance`. PR E3.
   */
  appearance?: "drawer" | "select";
  /** Callback when appearance changes. */
  onAppearanceChange?: (appearance: "drawer" | "select") => void;
}

// ============================================================
// Array Field Types
// ============================================================

/**
 * Props for the ArrayFieldEditor component
 */
export interface ArrayFieldEditorProps {
  /** Row labels (singular/plural) */
  labels?: ArrayFieldLabels;
  /** Callback when labels change */
  onLabelsChange: (labels: ArrayFieldLabels | undefined) => void;
  /** Whether rows are initially collapsed */
  initCollapsed?: boolean;
  /** Callback when initCollapsed changes */
  onInitCollapsedChange: (initCollapsed: boolean) => void;
  /** Whether rows can be reordered */
  isSortable?: boolean;
  /** Callback when isSortable changes */
  onIsSortableChange: (isSortable: boolean) => void;
  /** Field name to use as row label */
  rowLabelField?: string;
  /** Callback when rowLabelField changes */
  onRowLabelFieldChange: (field: string | undefined) => void;
  /**
   * Nested fields exposed for the row-label-field selector (the editor
   * picks a labelable text/number/etc. field by name). PR I dropped the
   * +Add affordance; this prop is read-only metadata only.
   */
  nestedFields?: BuilderField[];
}

// ============================================================
// Group Field Types
// ============================================================

/**
 * Props for the GroupFieldEditor component. PR I dropped the +Add
 * affordance and the nested-fields display section -- the field list
 * itself shows the children now. Group editor configures only the parent
 * (gutter visibility).
 */
export interface GroupFieldEditorProps {
  /** Whether to hide the gutter (vertical line and padding) */
  hideGutter?: boolean;
  /** Callback when hideGutter changes */
  onHideGutterChange: (hideGutter: boolean) => void;
}

// ============================================================
// Component Field Types
// ============================================================

/**
 * Mode for component field: single component or multi-component (dynamic zone)
 */
export type ComponentFieldMode = "single" | "multi";

/**
 * Props for the ComponentFieldEditor component
 */
export interface ComponentFieldEditorProps {
  /** Single component mode: one specific component slug */
  component?: string;
  /** Callback when single component changes */
  onComponentChange: (component: string | undefined) => void;
  /** Multi-component mode: array of component slugs */
  components?: string[];
  /** Callback when multi-component list changes */
  onComponentsChange: (components: string[] | undefined) => void;
  /** Whether this field allows multiple instances (array) */
  repeatable?: boolean;
  /** Callback when repeatable changes */
  onRepeatableChange: (repeatable: boolean) => void;
  /** Minimum number of instances (when repeatable) */
  minRows?: number;
  /** Callback when minRows changes */
  onMinRowsChange: (minRows: number | undefined) => void;
  /** Maximum number of instances (when repeatable) */
  maxRows?: number;
  /** Callback when maxRows changes */
  onMaxRowsChange: (maxRows: number | undefined) => void;
  /** Whether component instances start collapsed */
  initCollapsed?: boolean;
  /** Callback when initCollapsed changes */
  onInitCollapsedChange: (initCollapsed: boolean) => void;
  /** Whether instances can be reordered (when repeatable) */
  isSortable?: boolean;
  /** Callback when isSortable changes */
  onIsSortableChange: (isSortable: boolean) => void;
}

// ============================================================
// Hooks Editor Types
// ============================================================

/**
 * Props for the HooksEditor component
 */
export interface HooksEditorProps {
  /** Current list of enabled hooks */
  hooks: EnabledHook[];
  /** Callback when hooks change */
  onHooksChange: (hooks: EnabledHook[]) => void;
  /** List of field names for field selector dropdowns */
  fieldNames: string[];
  /** Whether the panel is expanded */
  isExpanded?: boolean;
  /** Callback when expanded state changes */
  onExpandedChange?: (expanded: boolean) => void;
}

/**
 * Props for the HookSelectorModal component
 */
export interface HookSelectorModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Callback when modal is closed */
  onOpenChange: (open: boolean) => void;
  /** Callback when a hook is selected */
  onSelect: (hookId: string) => void;
  /** List of already added hook IDs (to show as "already added") */
  addedHookIds: string[];
}

/**
 * Props for the HookConfigForm component
 */
export interface HookConfigFormProps {
  /** The hook ID to configure */
  hookId: string;
  /** Current configuration values */
  config: Record<string, unknown>;
  /** Callback when configuration changes */
  onConfigChange: (config: Record<string, unknown>) => void;
  /** List of field names for field selector dropdowns */
  fieldNames: string[];
}
