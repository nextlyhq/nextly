import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

// Stores collection definitions without holding actual data
export const dynamicCollections = pgTable("dynamic_collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).unique().notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  tableName: varchar("table_name", { length: 255 }).unique().notNull(),
  description: text("description"),
  icon: varchar("icon", { length: 50 }),
  schemaDefinition: jsonb("schema_definition")
    .$type<CollectionSchemaDefinition>()
    .notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DynamicCollection = typeof dynamicCollections.$inferSelect;
export type NewDynamicCollection = typeof dynamicCollections.$inferInsert;

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
  | "blocks"
  | "json"
  | "component"
  | "chips"
  // Layout types (presentational only, no data storage)
  | "tabs"
  | "collapsible"
  | "row"
  | "point"
  | "slug";

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

};
