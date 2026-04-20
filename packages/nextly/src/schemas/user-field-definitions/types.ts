/**
 * Dialect-Agnostic Type Definitions for User Field Definitions
 *
 * These types define the structure for the `user_field_definitions` table
 * used to manage custom user field metadata. Fields can be sourced from
 * `defineConfig()` (code) or created via the Admin UI (ui).
 *
 * @module schemas/user-field-definitions/types
 * @since 1.0.0
 */

import type { UserFieldType } from "../../users/config/types";

// ============================================================
// User Field Source Type
// ============================================================

/**
 * Origin of a user field definition.
 *
 * - `code`: Synced from `defineConfig()` `users.fields` — read-only in admin UI
 * - `ui`: Created via the admin Settings > User Fields tab — fully editable
 */
export type UserFieldSource = "code" | "ui";

// ============================================================
// User Field Definition Insert Type
// ============================================================

/**
 * Insert type for creating a new user field definition.
 *
 * Contains all required and optional fields for inserting a field definition
 * into the `user_field_definitions` table. Fields with defaults (like
 * `required`, `isActive`, `sortOrder`) are optional on insert.
 *
 * @example
 * ```typescript
 * const newField: UserFieldDefinitionInsert = {
 *   name: 'company',
 *   label: 'Company',
 *   type: 'text',
 *   source: 'ui',
 *   placeholder: 'Enter company name',
 * };
 * ```
 */
export interface UserFieldDefinitionInsert {
  /**
   * Unique field name used as the column name in `user_ext` table.
   * Must be a valid identifier (alphanumeric + underscores).
   * @example 'phoneNumber'
   */
  name: string;

  /**
   * Human-readable label displayed in the admin UI.
   * @example 'Phone Number'
   */
  label: string;

  /**
   * Field type determining the input component and column type.
   * Limited to scalar types: text, textarea, number, email, select, radio, checkbox, date.
   */
  type: UserFieldType;

  /**
   * Whether this field is required when creating/updating a user.
   * @default false
   */
  required?: boolean;

  /**
   * Default value for this field when creating a new user.
   * Stored as a string regardless of type (parsed at runtime).
   */
  defaultValue?: string | null;

  /**
   * Available options for `select` and `radio` field types.
   * Each option has a `label` (display text) and `value` (stored value).
   * Should be `null` for non-select/radio types.
   */
  options?: { label: string; value: string }[] | null;

  /**
   * Placeholder text shown in the input field.
   * @example 'Enter your phone number'
   */
  placeholder?: string | null;

  /**
   * Help text / description shown below the input field.
   * @example 'Your company phone number including country code'
   */
  description?: string | null;

  /**
   * Sort order for display in the admin UI.
   * Lower numbers appear first.
   * @default 0
   */
  sortOrder?: number;

  /**
   * Origin of this field definition.
   * - `code`: Synced from `defineConfig()` — read-only in admin UI
   * - `ui`: Created via admin Settings — fully editable
   * @default 'ui'
   */
  source?: UserFieldSource;

  /**
   * Whether this field is currently active.
   * Inactive fields are stored but not rendered in forms or included in queries.
   * @default true
   */
  isActive?: boolean;
}

// ============================================================
// User Field Definition Record Type
// ============================================================

/**
 * Full record type for a user field definition.
 *
 * Extends `UserFieldDefinitionInsert` with all required fields that are
 * set by the database (id, timestamps) or have default values.
 *
 * @example
 * ```typescript
 * const field: UserFieldDefinitionRecord = {
 *   id: 'uuid-789',
 *   name: 'department',
 *   label: 'Department',
 *   type: 'select',
 *   required: false,
 *   defaultValue: null,
 *   options: [
 *     { label: 'Engineering', value: 'engineering' },
 *     { label: 'Marketing', value: 'marketing' },
 *   ],
 *   placeholder: null,
 *   description: 'The department this user belongs to',
 *   sortOrder: 1,
 *   source: 'ui',
 *   isActive: true,
 *   createdAt: new Date(),
 *   updatedAt: new Date(),
 * };
 * ```
 */
export interface UserFieldDefinitionRecord extends UserFieldDefinitionInsert {
  /** Unique identifier (UUID or CUID). */
  id: string;

  /** Whether this field is required (required on record). */
  required: boolean;

  /** Default value (required on record, nullable). */
  defaultValue: string | null;

  /** Options for select/radio (required on record, nullable). */
  options: { label: string; value: string }[] | null;

  /** Placeholder text (required on record, nullable). */
  placeholder: string | null;

  /** Description / help text (required on record, nullable). */
  description: string | null;

  /** Sort order (required on record). */
  sortOrder: number;

  /** Field source (required on record). */
  source: UserFieldSource;

  /** Whether this field is active (required on record). */
  isActive: boolean;

  /** When the field definition was created. */
  createdAt: Date;

  /** When the field definition was last updated. */
  updatedAt: Date;
}
