/**
 * Legacy UI-collection field-definition types.
 *
 * Moved verbatim from the top-level packages/nextly/src/schemas/dynamic-collections.ts
 * file as part of Plan A schemas consolidation. The top-level file also declared a
 * stale `dynamicCollections` Drizzle table whose columns diverged from the runtime
 * canonical (database/schema/<dialect>.ts); that duplicate table was unused by any
 * importer and is dropped. Only the widely-imported field-definition types survive
 * here.
 *
 * Long-term, these types overlap with `@nextly/collections` (FieldConfig) and
 * the dialect-aware `schemas/dynamic-collections/types.ts` (CollectionSource,
 * StoredHookConfig, etc.). A follow-up unification pass is tracked under the
 * Plan B work; until then, this file is the single source for the UI-builder
 * `FieldDefinition` / `DynamicFieldType` shape consumed across the runtime.
 *
 * @module schemas/dynamic-collections/legacy-types
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

// Public-API aliases for the now-deleted top-level Drizzle table types.
// The previous declarations were `typeof dynamicCollections.$inferSelect` /
// `$inferInsert` on a stale table that diverged from the canonical runtime
// table. Aliasing to the canonical Postgres types preserves the public type
// names without re-introducing a duplicate Drizzle definition.
export type {
  DynamicCollectionPg as DynamicCollection,
  DynamicCollectionInsertPg as NewDynamicCollection,
} from "./postgres";

export type CollectionSchemaDefinition = {
  fields: FieldDefinition[];
};

/**
 * Field types for dynamic collections (UI-created collections).
 *
 * Note: This is separate from the core FieldType in collections/fields/types
 * to support the field surface available to UI-built collections.
 */
export type DynamicFieldType =
  | "text"
  | "textarea"
  | "richText"
  | "email"
  | "password"
  | "code"
  | "number"
  | "checkbox"
  | "date"
  | "select"
  | "radio"
  | "upload"
  | "relationship"
  | "repeater"
  | "group"
  | "json"
  | "component"
  | "chips";

export type FieldDefinition = {
  name: string;
  label?: string;
  type: DynamicFieldType;
  required?: boolean;
  unique?: boolean;
  index?: boolean;
  private?: boolean;
  default?: unknown;
  length?: number;

  options?: {
    variant?: "short" | "long";
    format?: "float" | "integer" | "datetime" | "date" | "time";
    relationType?: "oneToOne" | "oneToMany" | "manyToOne" | "manyToMany";
    target?: string; // Related collection name
    targetLabelField?: string; // Field to display in relation picker
    onDelete?: "cascade" | "set null" | "restrict" | "no action"; // Foreign key behavior on delete
    onUpdate?: "cascade" | "set null" | "restrict" | "no action"; // Foreign key behavior on update
    junctionTable?: string; // Custom junction table name for many-to-many
    maxDepth?: number; // Maximum depth for relationship population (0-5)
  };

  /** Options for select and radio fields */
  fieldOptions?: Array<{
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
  /** Display thumbnail preview for upload fields */
  displayPreview?: boolean;
  /** Row labels for array fields (singular/plural) */
  labels?: {
    singular?: string;
    plural?: string;
  };
  /** Whether array rows should be initially collapsed */
  initCollapsed?: boolean;
  /** Field name to use as the row label (instead of "Item 1", "Item 2") */
  rowLabelField?: string;
  /** Nested fields for array and group field types */
  fields?: FieldDefinition[];
  /** Minimum rows for array fields */
  minRows?: number;
  /** Maximum rows for array fields */
  maxRows?: number;
  /** Maximum number of chips for chips fields */
  maxChips?: number;
  /** Minimum number of chips for chips fields */
  minChips?: number;
  validation?: {
    minLength?: number;
    maxLength?: number;
    regex?: string;
    min?: number;
    max?: number;
    pattern?: string; // Added to match admin
    message?: string; // Added to match admin
  };

  admin?: {
    placeholder?: string;
  };

  /** Single component slug for component fields (mutually exclusive with components) */
  component?: string;
  /** Multiple component slugs for dynamic zone (mutually exclusive with component) */
  components?: string[];
  /** Whether this component field allows multiple instances (array) */
  repeatable?: boolean;

  /**
   * Provenance of this field. "ui" = user-defined in the Builder; "code" =
   * code-first; "plugin" = contributed by a plugin (locked in the Builder,
   * removed from the registry when the plugin is removed). Defaults to "ui"
   * when absent.
   */
  source?: "ui" | "code" | "plugin";
  /** Owning plugin name when source === "plugin" (for reconcile + display). */
  owner?: string;
  /** When true, the Builder schema editor shows this field read-only (inspect only). */
  locked?: boolean;
};
