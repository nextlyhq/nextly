// Entity type definitions for the admin app

export interface Permission {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  usage: "In Use" | "Not Used";
  created: string;
}

export interface Role {
  id: string;
  roleName: string;
  name: string;
  subtitle: string;
  description: string;
  type: "System" | "Custom";
  permissions: string[];
  status: "Active" | "Inactive";
  created: string;
  slug?: string;
}

// Simple API response interface
export interface ApiResponse<T> {
  data: {
    success: boolean;
    message: string;
    data: T;
  };
}

// API role interface
export interface ApiRole {
  id: string;
  name: string;
  level: number;
  isSystem: boolean;
  description?: string;
}

export interface ApiRoleCreatePayload {
  name: string;
  slug?: string;
  level: number;
  isSystem: boolean;
  description?: string;
  permissionIds: string[];
  childRoleIds?: string[];
}

export interface ApiRoleUpdatePayload {
  name?: string;
  slug?: string;
  isSystem?: boolean;
  description?: string;
  childRoleIds?: string[];
}

export interface FieldValidation {
  maxLength?: number;
  minLength?: number;
  max?: number;
  min?: number;
}

// Represents additional options for specific field types
export interface FieldOptions {
  format?: string; // e.g. "float"
  variant?: string; // e.g. "long"
}

// Represents an individual field within a schema
export interface SchemaField {
  name: string;
  type: string;
  label?: string;
  unique?: boolean;
  default?: string;
  required?: boolean;
  options?: FieldOptions;
  validation?: FieldValidation;
}

// Represents the schema definition of a collection
export interface SchemaDefinition {
  fields: SchemaField[];
}

// ==================== COLLECTION TYPES ====================

/**
 * Source of the collection definition.
 *
 * - `code`: Defined in code via `defineCollection()` in a config file
 * - `ui`: Created through the Visual Collection Builder in Admin UI
 * - `built-in`: System collections provided by Nextly core
 */
export type CollectionSource = "code" | "ui" | "built-in";

/**
 * Migration status for a collection's schema.
 *
 * - `synced`: Schema is in sync with the database (no pending changes)
 * - `pending`: Schema has changed but migration not yet created
 * - `generated`: Migration file has been created but not applied
 * - `applied`: Migration has been applied to the database
 */
export type MigrationStatus =
  | "synced"
  | "pending"
  | "generated"
  | "applied"
  | "failed";

/**
 * Labels for displaying the collection in the Admin UI.
 */
export interface CollectionLabels {
  /** Singular form of the collection name (e.g., "Post") */
  singular: string;
  /** Plural form of the collection name (e.g., "Posts") */
  plural: string;
}

/**
 * API Collection interface - represents a collection from the API
 *
 * This interface includes all metadata fields needed for the collection
 * list page, including source tracking, migration status, and locked state.
 */
export interface ApiCollection {
  id: string;
  name: string;
  label: string;
  tableName: string;
  description?: string;
  icon?: string | null;
  schemaDefinition: SchemaDefinition;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;

  // Collection metadata fields
  /** Where the collection was defined (code, ui, or built-in) */
  source?: CollectionSource;

  /** Whether the collection is locked from UI edits (code-first collections) */
  locked?: boolean;

  /** Current migration status */
  migrationStatus?: MigrationStatus;

  /** Schema version number */
  schemaVersion?: number;

  /** Display labels for singular/plural forms */
  labels?: CollectionLabels;

  /** Admin UI configuration */
  admin?: {
    group?: string;
    icon?: string;
    hidden?: boolean;
    /** Sort order within sidebar group (lower = higher position, default: 100) */
    order?: number;
    /** Custom sidebar group slug. When set, item moves from its default section to this custom group */
    sidebarGroup?: string;
    useAsTitle?: string;
    /** Whether this collection is provided by a plugin */
    isPlugin?: boolean;
    /** Custom component configuration for plugin views */
    components?: {
      /** Custom view components */
      views?: {
        Edit?: { Component?: string };
        List?: { Component?: string };
      };
      /** Injection point components */
      BeforeListTable?: string;
      AfterListTable?: string;
      BeforeEdit?: string;
      AfterEdit?: string;
    };
  };
  /** Direct fields array (new API format) */
  fields?: SchemaField[];

  /** Number of fields in the collection (derived from schemaDefinition.fields.length) */
  fieldCount?: number;
}

// ==================== SINGLE (GLOBAL) TYPES ====================

/**
 * Source of the Single definition.
 *
 * - `code`: Defined in code via `defineSingle()` in a config file
 * - `ui`: Created through the Visual Single Builder in Admin UI
 * - `built-in`: System Singles provided by Nextly core
 */
export type SingleSource = "code" | "ui" | "built-in";

/**
 * Migration status for a Single's schema.
 *
 * - `synced`: Schema is in sync with the database (no pending changes)
 * - `pending`: Schema has changed but migration not yet created
 * - `generated`: Migration file has been created but not applied
 * - `applied`: Migration has been applied to the database
 * - `failed`: Migration failed to apply
 */
export type SingleMigrationStatus =
  | "synced"
  | "pending"
  | "generated"
  | "applied"
  | "failed";

/**
 * Admin options for displaying the Single in the Admin UI.
 */
export interface SingleAdminOptions {
  /** Group name for organizing Singles in the sidebar */
  group?: string;
  /** Icon identifier for the Single */
  icon?: string;
  /** Hide the Single from Admin UI navigation */
  hidden?: boolean;
  /** Sort order within sidebar group (lower = higher position, default: 100) */
  order?: number;
  /** Custom sidebar group slug. When set, item moves from its default section to this custom group */
  sidebarGroup?: string;
  /** Description text displayed below the Single title */
  description?: string;
}

/**
 * A user-created custom sidebar group.
 *
 * Users can create named groups (e.g., "Analytics", "Marketing") and assign
 * collections/singles to them from the Builder settings. Custom groups appear
 * between Singles and Media Library in the sidebar, sorted alphabetically.
 */
export interface CustomSidebarGroup {
  /** Unique slug identifier (e.g., "analytics", "marketing") */
  slug: string;
  /** Display name shown in the sidebar label */
  name: string;
  /** Optional Lucide icon name */
  icon?: string;
}

/**
 * API Single interface - represents a Single from the API
 *
 * This interface includes all metadata fields needed for the Single
 * list page, including source tracking, migration status, and locked state.
 */
export interface ApiSingle {
  id: string;
  slug: string;
  label: string;
  tableName: string;
  description?: string;
  fields: SchemaField[];
  admin?: SingleAdminOptions;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;

  // Single metadata fields
  /** Where the Single was defined (code, ui, or built-in) */
  source?: SingleSource;

  /** Whether the Single is locked from UI edits (code-first Singles) */
  locked?: boolean;

  /** Current migration status */
  migrationStatus?: SingleMigrationStatus;

  /** Schema version number */
  schemaVersion?: number;

  /** Number of fields in the Single */
  fieldCount?: number;
}

// ==================== COMPONENT TYPES ====================

/**
 * Source of the Component definition.
 *
 * - `code`: Defined in code via `defineComponent()` in a config file
 * - `ui`: Created through the Visual Component Builder in Admin UI
 *
 * Note: Unlike Collections/Singles, Components do not have a "built-in" source.
 */
export type ComponentSource = "code" | "ui";

/**
 * Migration status for a Component's schema.
 *
 * - `synced`: Schema is in sync with the database (no pending changes)
 * - `pending`: Schema has changed but migration not yet created
 * - `generated`: Migration file has been created but not applied
 * - `applied`: Migration has been applied to the database
 * - `failed`: Migration failed to apply
 */
export type ComponentMigrationStatus =
  | "synced"
  | "pending"
  | "generated"
  | "applied"
  | "failed";

/**
 * Admin options for displaying the Component in the Admin UI.
 */
export interface ComponentAdminOptions {
  /** Category for organizing Components in the sidebar */
  category?: string;
  /** Icon identifier for the Component */
  icon?: string;
  /** Hide the Component from Admin UI navigation */
  hidden?: boolean;
  /** Description text displayed below the Component title */
  description?: string;
  /** Preview image URL shown in component selector */
  imageURL?: string;
}

/**
 * API Component interface - represents a Component from the API
 *
 * This interface includes all metadata fields needed for the Component
 * list page, including source tracking, migration status, and locked state.
 */
export interface ApiComponent {
  id: string;
  slug: string;
  label: string;
  tableName: string;
  description?: string;
  fields: SchemaField[];
  admin?: ComponentAdminOptions;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;

  // Component metadata fields
  /** Where the Component was defined (code or ui) */
  source?: ComponentSource;

  /** Whether the Component is locked from UI edits (code-first Components) */
  locked?: boolean;

  /** Current migration status */
  migrationStatus?: ComponentMigrationStatus;

  /** Schema version number */
  schemaVersion?: number;

  /** Number of fields in the Component */
  fieldCount?: number;
}
