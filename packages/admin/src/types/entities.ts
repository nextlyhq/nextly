// Entity type definitions for the admin app

import type { FieldDefinition } from "./collection";

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
  /** The API returns this on every role; it identifies the seeded ones. */
  slug?: string;
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

  /** Source file where a code-first collection is defined (shown in the read-only builder) */
  configPath?: string | null;

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
    defaultColumns?: string[];
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
  /**
   * This Single's preview, as much of it as SURVIVES being stored.
   *
   * The declaration's `url` is a FUNCTION, so it never reaches the browser and
   * nothing here should imply it does — resolving an address is the server's
   * job, and the admin asks for one rather than building it. `breakpoints` is
   * absent for the same reason in its function form, and because the resolved
   * list travels on the mint response instead of on a schema.
   *
   * What remains is the JSON-shaped part, listed rather than derived from the
   * core config type: `Omit<SinglePreviewConfig, "url">` would keep
   * `breakpoints` and so promise a field this payload never carries.
   */
  preview?: {
    /** Custom label for the preview button and pane. @default "Preview" */
    label?: string;

    /**
     * Whether the preview opens in a new browser tab. @default true
     *
     * A boolean, so unlike `url` it is stored and returned. The collection side
     * has always read it; omitting it here made the type disagree with the
     * payload, and a caller with a stored value could not reach it.
     */
    openInNewTab?: boolean;
  };
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
  fields: FieldDefinition[];
  admin?: SingleAdminOptions;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;

  // Single metadata fields
  /** Where the Single was defined (code, ui, or built-in) */
  source?: SingleSource;

  /** Whether the Single is locked from UI edits (code-first Singles) */
  locked?: boolean;

  /** Source file where a code-first Single is defined (shown in the read-only builder) */
  configPath?: string | null;

  /**
   * Whether the Single carries a Draft/Published status column. Default
   * false; users opt in via the Schema Builder modal. See PR 1's backend
   * for the column-synthesis + query auto-filter end-to-end.
   */
  status?: boolean;

  /**
   * Whether this Single is localized (i18n). When true, its translatable
   * fields live in the companion `single_<slug>_locales` table and the editor
   * shows the per-language switcher. Backed by `dynamic_singles.localized`.
   */
  localized?: boolean;

  /**
   * Whether a status-less save on this Single is HELD as a pending change
   * rather than written to the live document (the draft/published split).
   *
   * Server-DERIVED from the same predicate the write gates on, never stored:
   * the split also depends on the fields (a reachable password field, an
   * unresolvable component), so a flag persisted beside `status` would drift
   * from what a save actually does. An editor told drafts are off sends an
   * explicit published save, which overwrites the live document.
   */
  draftsEnabled?: boolean;

  /**
   * Resolved version-history config, or null/absent when the Single is
   * unversioned. The server normalizes the Schema Builder's on/off into this
   * shape, so reads carry the object while writes send a boolean — see
   * `UpdateSinglePayload`.
   */
  versions?: { enabled?: boolean; maxPerDoc?: number | false } | null;

  /**
   * Resolved cache-revalidation config, or null/absent when revalidation is on
   * with no override. The server normalizes the Schema Builder's on/off into
   * this shape (off → `{ disable: true }`), so reads carry the object while
   * writes send a boolean — see `UpdateSinglePayload`.
   */
  revalidate?: { disable?: boolean; tags?: string[] } | null;

  /**
   * Resolved webhook recording policy, or null/absent when recording is on
   * (the default). The server normalizes the Schema Builder's on/off into this
   * shape (off → `{ record: false }`), so reads carry the object while writes
   * send a boolean — see `UpdateSinglePayload`.
   */
  webhooks?: { record?: boolean } | null;

  /** Current migration status */
  migrationStatus?: SingleMigrationStatus;

  /** Schema version number */
  schemaVersion?: number;

  /** Number of fields in the Single */
  fieldCount?: number;
}

/**
 * What a Single schema update may send.
 *
 * Most keys mirror the read shape, but `versions`, `revalidate` and `webhooks`
 * do not: the
 * Schema Builder offers on/off and the server resolves each into the config
 * `ApiSingle` carries back.
 */
export type UpdateSinglePayload = Omit<
  Partial<ApiSingle>,
  "versions" | "revalidate" | "webhooks"
> & {
  versions?: boolean;
  /** Durable versions kept per document. `false` = unlimited, a number = keep
   *  that many, undefined = the default (50). Ignored when `versions` is off. */
  versionsMaxPerDoc?: number | false;
  revalidate?: boolean;
  webhooks?: boolean;
};

// ==================== COMPONENT TYPES ====================

/**
 * Source of the Component definition.
 *
 * - `code`: Defined in code via `defineFieldGroup()` in a config file
 * - `ui`: Created through the Visual Field Group Builder in Admin UI
 *
 * Note: Unlike Collections/Singles, Components do not have a "built-in" source.
 */
export type FieldGroupSource = "code" | "ui";

/**
 * Migration status for a Component's schema.
 *
 * - `synced`: Schema is in sync with the database (no pending changes)
 * - `pending`: Schema has changed but migration not yet created
 * - `generated`: Migration file has been created but not applied
 * - `applied`: Migration has been applied to the database
 * - `failed`: Migration failed to apply
 */
export type FieldGroupMigrationStatus =
  | "synced"
  | "pending"
  | "generated"
  | "applied"
  | "failed"
  // Tables changed, record did not. Rendered distinctly from `failed` because the two ask the
  // operator for opposite things: retry, versus reconcile and do not retry.
  | "diverged";

/**
 * Admin options for displaying the Component in the Admin UI.
 */
export interface FieldGroupAdminOptions {
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
export interface ApiFieldGroup {
  id: string;
  slug: string;
  label: string;
  tableName: string;
  description?: string;
  fields: FieldDefinition[];
  admin?: FieldGroupAdminOptions;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;

  // Component metadata fields
  /** Where the Component was defined (code or ui) */
  source?: FieldGroupSource;

  /** Whether the Component is locked from UI edits (code-first Components) */
  locked?: boolean;

  /** Source file where a code-first Component is defined (shown in the read-only builder) */
  configPath?: string | null;

  /** Current migration status */
  migrationStatus?: FieldGroupMigrationStatus;

  /** Schema version number */
  schemaVersion?: number;

  /** Number of fields in the Component */
  fieldCount?: number;
}
