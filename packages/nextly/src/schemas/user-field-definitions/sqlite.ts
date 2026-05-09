/**
 * SQLite Schema for User Field Definitions
 *
 * Defines the `user_field_definitions` table schema for SQLite databases
 * using Drizzle ORM. This schema stores metadata for custom user fields
 * that extend the base user model, managed via `defineConfig()` (code)
 * or the Admin Settings UI.
 *
 * @module schemas/user-field-definitions/sqlite
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   userFieldDefinitionsSqlite,
 *   type UserFieldDefinitionSqlite,
 *   type UserFieldDefinitionInsertSqlite,
 * } from '../schemas/user-field-definitions/sqlite';
 *
 * // Insert a new field definition
 * await db.insert(userFieldDefinitionsSqlite).values({
 *   name: 'company',
 *   label: 'Company',
 *   type: 'text',
 *   source: 'ui',
 * });
 * ```
 */

import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { UserFieldType } from "../../users/config/types";

import type { UserFieldSource } from "./types";

// ============================================================
// User Field Definitions Table (SQLite)
// ============================================================

/**
 * SQLite schema for the `user_field_definitions` table.
 *
 * Stores metadata for custom user fields that extend the base user model.
 * Fields can be sourced from `defineConfig()` (code) or created via the
 * Admin Settings > User Fields tab (ui).
 *
 * @example
 * ```typescript
 * // Query all active field definitions
 * const fields = await db
 *   .select()
 *   .from(userFieldDefinitionsSqlite)
 *   .where(eq(userFieldDefinitionsSqlite.isActive, true))
 *   .orderBy(asc(userFieldDefinitionsSqlite.sortOrder));
 *
 * // Query code-sourced fields only
 * const codeFields = await db
 *   .select()
 *   .from(userFieldDefinitionsSqlite)
 *   .where(eq(userFieldDefinitionsSqlite.source, 'code'));
 * ```
 */
export const userFieldDefinitionsSqlite = sqliteTable(
  "user_field_definitions",
  {
    // --------------------------------------------------------
    // Primary Key
    // --------------------------------------------------------

    /** Unique identifier (UUID v4, auto-generated) */
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // --------------------------------------------------------
    // Field Identity
    // --------------------------------------------------------

    /**
     * Unique field name used as the column name in `user_ext` table.
     * Must be a valid identifier (alphanumeric + underscores).
     * @example 'phoneNumber'
     */
    name: text("name").notNull(),

    /**
     * Human-readable label displayed in the admin UI.
     * @example 'Phone Number'
     */
    label: text("label").notNull(),

    /**
     * Field type determining the input component and column type.
     * One of: 'text', 'textarea', 'number', 'email', 'select', 'radio', 'checkbox', 'date'.
     */
    type: text("type").$type<UserFieldType>().notNull(),

    // --------------------------------------------------------
    // Field Configuration
    // --------------------------------------------------------

    /**
     * Whether this field is required when creating/updating a user.
     */
    required: integer("required", { mode: "boolean" }).default(false).notNull(),

    /**
     * Default value for this field when creating a new user.
     * Stored as a string regardless of type (parsed at runtime).
     */
    defaultValue: text("default_value"),

    /**
     * Available options for `select` and `radio` field types.
     * Each option has a `label` (display text) and `value` (stored value).
     * Should be `null` for non-select/radio types.
     */
    options: text("options", { mode: "json" }).$type<
      { label: string; value: string }[] | null
    >(),

    /**
     * Placeholder text shown in the input field.
     * @example 'Enter your phone number'
     */
    placeholder: text("placeholder"),

    /**
     * Help text / description shown below the input field.
     * @example 'Your company phone number including country code'
     */
    description: text("description"),

    // --------------------------------------------------------
    // Ordering & Source
    // --------------------------------------------------------

    /**
     * Sort order for display in the admin UI.
     * Lower numbers appear first.
     */
    sortOrder: integer("sort_order").default(0).notNull(),

    /**
     * Origin of this field definition.
     * - `code`: Synced from `defineConfig()` — read-only in admin UI
     * - `ui`: Created via admin Settings — fully editable
     */
    source: text("source").$type<UserFieldSource>().default("ui").notNull(),

    /**
     * Whether this field is currently active.
     * Inactive fields are stored but not rendered in forms or included in queries.
     */
    isActive: integer("is_active", { mode: "boolean" }).default(true).notNull(),

    // --------------------------------------------------------
    // Metadata
    // --------------------------------------------------------

    /** When the field definition was created */
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    /** When the field definition was last updated */
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    // --------------------------------------------------------
    // Indexes for Query Performance
    // --------------------------------------------------------

    /** Unique index on field name (field names must be unique) */
    uniqueIndex("user_field_defs_name_unique_idx").on(table.name),

    /** Index for filtering by source (code vs ui) */
    index("user_field_defs_source_idx").on(table.source),

    /** Index for filtering active/inactive fields */
    index("user_field_defs_is_active_idx").on(table.isActive),

    /** Index for ordering by sort position */
    index("user_field_defs_sort_order_idx").on(table.sortOrder),

    /** Index for sorting by creation date */
    index("user_field_defs_created_at_idx").on(table.createdAt),
  ]
);

// ============================================================
// Type Exports (Drizzle Inference)
// ============================================================

/**
 * SQLite-specific select type for user field definitions.
 * Represents a full row from the `user_field_definitions` table.
 */
export type UserFieldDefinitionSqlite =
  typeof userFieldDefinitionsSqlite.$inferSelect;

/**
 * SQLite-specific insert type for user field definitions.
 * Fields with defaults (id, required, sortOrder, source, isActive, timestamps) are optional.
 */
export type UserFieldDefinitionInsertSqlite =
  typeof userFieldDefinitionsSqlite.$inferInsert;
