// Collection and dynamic content types for the admin app

/**
 * All supported field types in Nextly
 *
 * These map to the field types available in FieldPalette.tsx:
 * - Text: text, textarea, richText, email, password, code
 * - Number: number
 * - Selection: checkbox, date, select, radio
 * - Media: upload
 * - Relational: relationship
 * - Structured: repeater, group, json, component
 */
export type FieldPrimitiveType =
  // Text types
  | "text"
  | "textarea"
  | "richText"
  | "email"
  | "password"
  | "code"
  // Number types
  | "number"
  // Selection types
  | "checkbox"
  | "date"
  | "select"
  | "radio"
  | "chips"
  // Media types
  | "upload"
  // Relational types
  | "relationship"
  // Structured types
  | "repeater"
  | "group"
  | "component"
  | "json";

/**
 * Admin UI options for a field definition.
 * Controls field appearance and behavior in the admin interface.
 */
export interface FieldDefinitionAdmin {
  /** Field width in the form layout */
  width?: "25%" | "33%" | "50%" | "66%" | "75%" | "100%";
  /** Position the field in the sidebar instead of main content */
  position?: "sidebar";
  /** Make the field read-only in the admin UI */
  readOnly?: boolean;
  /** Hide the field from the admin UI entirely */
  hidden?: boolean;
  /** Description/help text displayed below the field */
  description?: string;
  /** Placeholder text for the input */
  placeholder?: string;
  /**
   * Conditional logic for showing/hiding the field.
   * PR E2 (2026-05-03) widened this to support type-aware operators.
   * Legacy `{ field, equals }` shape stays valid (the runtime evaluator
   * normalizes it to `{ field, operator: "equals", value: equals }`).
   */
  condition?: {
    field: string;
    operator?: string;
    value?:
      | string
      | number
      | boolean
      | { min: number | string; max: number | string };
    /** @deprecated Legacy shape; use `operator: "equals"` + `value` instead. */
    equals?: string;
  };
  /** Hide the gutter for group fields */
  hideGutter?: boolean;
  /**
   * Upload fields only -- whether the user can upload new files
   * inline (vs. only picking from existing media). Default true.
   * PR H feedback 2.2: matches the framework's
   * UploadFieldAdminOptions.allowCreate (where the runtime
   * UploadInput reads from). Editor previously stored this at
   * top-level field.allowCreate which never reached the runtime;
   * storing here closes the gap.
   */
  allowCreate?: boolean;
}

export interface FieldDefinition {
  name: string;
  label?: string;
  type: FieldPrimitiveType;
  required?: boolean;
  unique?: boolean;
  index?: boolean;
  /**
   * i18n: store a different value per language for this field (companion `_locales` table).
   * When omitted, text-like fields localize by default once the collection is `localized`.
   */
  localized?: boolean;
  /**
   * Field provenance, serialized by the API from the registry. "plugin" =
   * contributed by a plugin (locked + badged in the Builder, managed in the
   * plugin's code); "ui" / "code" otherwise.
   */
  source?: "ui" | "code" | "plugin";
  /** Owning plugin name when source === "plugin". */
  owner?: string;
  /** When true, the Builder shows this field read-only (inspect only). */
  locked?: boolean;
  /** Default value for the field */
  defaultValue?: unknown;
  /** Nested fields for container types (array, group, etc.) */
  fields?: FieldDefinition[];
  /** Admin UI options for the field */
  admin?: FieldDefinitionAdmin;
  /** Validation rules for the field */
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    minRows?: number;
    maxRows?: number;
    pattern?: string;
    message?: string;
  };
  /** Options for select and radio fields */
  options?: Array<{
    id?: string;
    label: string;
    value: string;
  }>;
  /** Allow multiple values (for text, number, select, upload, relationship) */
  hasMany?: boolean;
  /** Target collection slug(s) for relationship fields */
  relationTo?: string | string[];
  /** Maximum depth for populating related documents */
  maxDepth?: number;
  /** Allow creating new related documents from the field */
  allowCreate?: boolean;
  /** Allow editing related documents from the field */
  allowEdit?: boolean;
  /** Allow drag-and-drop reordering of selected relationships (when hasMany) */
  isSortable?: boolean;
  /** Simple filter for available related documents */
  relationshipFilter?: {
    field: string;
    equals: string;
  };
  /** MIME type filter pattern for upload fields (e.g., "image/*") */
  mimeTypes?: string;
  /** Maximum file size in bytes for upload fields */
  maxFileSize?: number;
  /** Row labels for array fields (singular/plural) */
  labels?: {
    singular?: string;
    plural?: string;
  };
  /** Whether array rows should be initially collapsed */
  initCollapsed?: boolean;
  /** Field name to use as the row label (instead of "Item 1", "Item 2") */
  rowLabelField?: string;
  /** Single component slug for component fields (mutually exclusive with components) */
  component?: string;
  /** Multiple component slugs for dynamic zone (mutually exclusive with component) */
  components?: string[];
  /** Whether this component field allows multiple instances (array) */
  repeatable?: boolean;
}

/**
 * Custom view configuration for replacing default admin views.
 */
export interface CollectionAdminViewConfig {
  /** Component path in format "package/path#ExportName" */
  Component: string;
}

/**
 * Custom components configuration for collection admin UI.
 * Allows overriding default views and injecting custom components.
 */
export interface CollectionAdminComponents {
  /** Custom views to replace default admin views */
  views?: {
    /** Custom Edit view component (replaces entry edit form) */
    Edit?: CollectionAdminViewConfig;
    /** Custom List view component (replaces entry list) */
    List?: CollectionAdminViewConfig;
  };
  /** Component to render before the list table */
  BeforeListTable?: string;
  /** Component to render after the list table */
  AfterListTable?: string;
  /** Component to render before the edit form */
  BeforeEdit?: string;
  /** Component to render after the edit form */
  AfterEdit?: string;
}

export interface Collection {
  id: string;
  name: string;
  /** Slug for the collection (new API format) */
  slug?: string;
  label: string;
  /** Labels object (new API format) */
  labels?: {
    singular?: string;
    plural?: string;
  };
  description?: string;
  tableName: string;
  /** Admin UI configuration */
  admin?: {
    group?: string;
    icon?: string;
    hidden?: boolean;
    defaultColumns?: string[];
    useAsTitle?: string;
    /** Whether this collection is provided by a plugin */
    isPlugin?: boolean;
    /** Custom components for admin UI */
    components?: CollectionAdminComponents;
  };
  /** Where the collection was defined (code, ui, or built-in) */
  source?: "code" | "ui" | "built-in";
  /** Whether the collection is locked from UI edits */
  locked?: boolean;
  /** Source file where a code-first collection is defined (read-only builder) */
  configPath?: string | null;
  /**
   * Whether the collection has the Draft/Published status feature enabled.
   * Backed by the `dynamic_collections.status` boolean column. When true,
   * the data table carries a `status` system column and the admin's Save
   * Draft / Publish split lights up.
   */
  status?: boolean;
  /**
   * Legacy schema definition format.
   * New API returns `fields` directly at root level.
   */
  schemaDefinition?: {
    fields: FieldDefinition[];
  };
  /**
   * Direct fields array (new API format).
   * Takes precedence over schemaDefinition.fields.
   */
  fields?: FieldDefinition[];
  /** Pre-built hooks configured for this collection */
  hooks?: StoredHookConfig[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Helper to get fields from a collection, supporting both old and new API formats.
 * New API: collection.fields
 * Old API: collection.schemaDefinition.fields
 */
export function getCollectionFields(collection: Collection): FieldDefinition[] {
  return collection.fields || collection.schemaDefinition?.fields || [];
}

export type EntryValue = string | number | boolean | null | undefined;

export interface Entry {
  id: string;
  [key: string]: EntryValue;
}

/**
 * Hook type for stored hook configurations.
 * Matches StoredHookType from nextly backend.
 */
export type StoredHookType =
  | "beforeOperation"
  | "beforeCreate"
  | "afterCreate"
  | "beforeUpdate"
  | "afterUpdate"
  | "beforeDelete"
  | "afterDelete"
  | "beforeRead"
  | "afterRead"
  | "beforeChange"
  | "afterChange";

/**
 * Stored hook configuration for API payloads.
 * Matches StoredHookConfig from nextly backend.
 */
export interface StoredHookConfig {
  /** Pre-built hook ID (e.g., 'auto-slug', 'audit-fields') */
  hookId: string;
  /** When this hook runs in the document lifecycle */
  hookType: StoredHookType;
  /** Whether this hook is enabled */
  enabled: boolean;
  /** Hook-specific configuration values */
  config: Record<string, unknown>;
  /** Execution order (0-based, lower runs first) */
  order: number;
}

export interface CreateCollectionPayload {
  name: string;
  labels: { singular: string; plural?: string };
  description?: string;
  icon?: string;
  group?: string;
  order?: number;
  sidebarGroup?: string;
  hidden?: boolean;
  useAsTitle?: string;
  /** Whether records carry a Draft/Published status column. Default false. */
  status?: boolean;
  /** i18n: whether the collection has translatable (per-locale) fields. Default false. */
  localized?: boolean;
  /** Whether to auto-generate createdAt/updatedAt. Default true. */
  timestamps?: boolean;
  fields: FieldDefinition[];
  /** Pre-built hooks configured for this collection */
  hooks?: StoredHookConfig[];
}

export interface UpdateCollectionPayload {
  labels?: { singular: string; plural?: string };
  description?: string;
  icon?: string;
  group?: string;
  order?: number;
  sidebarGroup?: string;
  hidden?: boolean;
  useAsTitle?: string;
  /** Toggle Draft/Published. Toggling on adds a status column to the data
   *  table; toggling off drops it (destructive change, gated by the
   *  schema-change preview). */
  status?: boolean;
  /** i18n: toggle translatable fields. Toggling on adds the companion `_locales`
   *  table (migration-gated, via the schema-change preview). */
  localized?: boolean;
  timestamps?: boolean;
  fields?: FieldDefinition[];
  /** Pre-built hooks configured for this collection */
  hooks?: StoredHookConfig[];
}
