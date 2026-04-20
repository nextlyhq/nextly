/**
 * Base Field Types and Interfaces
 *
 * This module provides the foundational type definitions for Nextly's field system.
 * All specific field types (text, number, select, etc.) extend from BaseFieldConfig.
 *
 * Inspired by modern CMS field patterns, adapted for Nextly's architecture.
 *
 * @module collections/fields/types/base
 * @since 1.0.0
 */

import type React from "react";

import type { HookHandler } from "@nextly/hooks/types";

// ============================================================
// Field Type Union
// ============================================================

/**
 * All supported field types in Nextly.
 *
 * Field types are categorized as:
 * - **Text types:** text, textarea, richText, email, password, code
 * - **Numeric types:** number
 * - **Selection types:** checkbox, date, select, radio
 * - **Media types:** upload
 * - **Relational types:** relationship
 * - **Structured types:** array, group, json
 * - **Virtual types:** join (computed at read time, no data storage)
 */
export type FieldType =
  // Text types
  | "text"
  | "textarea"
  | "richText"
  | "email"
  | "password"
  | "code"
  // Numeric types
  | "number"
  // Selection types
  | "checkbox"
  | "boolean" // Schema Builder alias for "checkbox"
  | "date"
  | "select"
  | "radio"
  // Media types
  | "upload"
  // Relational types
  | "relationship"
  // Structured types
  | "repeater"
  | "group"
  | "json"
  // Component types
  | "component"
  // Array-like types
  | "chips"
  // Virtual types (computed at read time, no data storage)
  | "join";

// ============================================================
// Request Context
// ============================================================

/**
 * Request context passed to access control and hook functions.
 *
 * Contains information about the current user, locale, and HTTP request.
 * Used by access control functions to determine field-level permissions
 * and by hooks for context-aware processing.
 *
 * @example
 * ```typescript
 * const accessFn: AccessFunction = ({ req }) => {
 *   // Only admins can access this field
 *   return req.user?.role === 'admin';
 * };
 * ```
 */
export interface RequestContext {
  /**
   * The authenticated user making the request.
   * Undefined if the request is unauthenticated.
   */
  user?: {
    /** Unique user identifier */
    id: string;
    /** User's email address */
    email?: string;
    /** User's role (e.g., 'admin', 'editor', 'user') */
    role?: string;
    /** Additional user properties */
    [key: string]: unknown;
  };

  /**
   * Current locale for localized content.
   * Used when localization is enabled for a field.
   */
  locale?: string;

  /**
   * HTTP request metadata.
   * Available when the operation originates from an HTTP request.
   */
  req?: {
    /** HTTP request headers */
    headers?: Record<string, string>;
    /** Query string parameters */
    query?: Record<string, unknown>;
  };
}

// ============================================================
// Access Control
// ============================================================

/**
 * Function signature for field-level access control.
 *
 * Access functions determine whether a user can perform a specific
 * operation (create, read, update) on a field.
 *
 * @param args - Object containing request context, document ID, and data
 * @returns `true` to allow access, `false` to deny access
 *
 * @example
 * ```typescript
 * // Only allow admins to update the 'status' field
 * const canUpdateStatus: AccessFunction = ({ req }) => {
 *   return req.user?.role === 'admin';
 * };
 *
 * // Allow users to read their own data only
 * const canReadOwnData: AccessFunction = ({ req, id }) => {
 *   return req.user?.id === id;
 * };
 * ```
 */
export type AccessFunction = (args: {
  /** Request context with user and locale information */
  req: RequestContext;
  /** Document ID (available for read/update operations) */
  id?: string;
  /** Document data being created or updated */
  data?: Record<string, unknown>;
}) => boolean | Promise<boolean>;

/**
 * Field-level access control configuration.
 *
 * Defines granular permissions for create, read, and update operations
 * on a specific field. If not specified, access defaults to `true`.
 *
 * @example
 * ```typescript
 * const passwordAccess: FieldAccess = {
 *   // Anyone can set password on create
 *   create: () => true,
 *   // Only the user themselves can read (actually never return it)
 *   read: () => false,
 *   // Only admins or the user themselves can update
 *   update: ({ req, id }) => req.user?.role === 'admin' || req.user?.id === id,
 * };
 * ```
 */
export interface FieldAccess {
  /** Access control for field creation */
  create?: AccessFunction;
  /** Access control for field reading */
  read?: AccessFunction;
  /** Access control for field updates */
  update?: AccessFunction;
}

// ============================================================
// Conditional Logic
// ============================================================

/**
 * Conditional logic for field visibility and behavior.
 *
 * Allows fields to be shown, hidden, or modified based on
 * the values of other fields in the document.
 *
 * @example
 * ```typescript
 * // Show 'externalUrl' field only when 'linkType' is 'external'
 * const showExternalUrl: FieldCondition = {
 *   field: 'linkType',
 *   equals: 'external',
 * };
 *
 * // Show 'customMessage' only when 'useCustomMessage' exists and is true
 * const showCustomMessage: FieldCondition = {
 *   field: 'useCustomMessage',
 *   exists: true,
 * };
 * ```
 */
export interface FieldCondition {
  /** The field name to evaluate */
  field: string;
  /** Show this field when the target field equals this value */
  equals?: unknown;
  /** Show this field when the target field does NOT equal this value */
  notEquals?: unknown;
  /** Show this field when the target field contains this string */
  contains?: string;
  /** Show this field when the target field exists (or doesn't exist) */
  exists?: boolean;
}

// ============================================================
// Admin UI Options
// ============================================================

/**
 * Admin panel configuration options for fields.
 *
 * Controls how the field appears and behaves in the Admin UI,
 * including layout, styling, and custom components.
 *
 * @example
 * ```typescript
 * const adminOptions: FieldAdminOptions = {
 *   width: '50%',
 *   description: 'Enter the product SKU',
 *   placeholder: 'e.g., SKU-12345',
 *   condition: {
 *     field: 'productType',
 *     equals: 'physical',
 *   },
 * };
 * ```
 */
export interface FieldAdminOptions {
  /**
   * Position the field in the sidebar instead of the main content area.
   * Only 'sidebar' is currently supported.
   */
  position?: "sidebar";

  /**
   * Width of the field in the form layout.
   * Uses CSS percentage values for responsive grid layouts.
   */
  width?: "25%" | "33%" | "50%" | "66%" | "75%" | "100%";

  /**
   * Custom inline styles to apply to the field wrapper.
   */
  style?: Record<string, string>;

  /**
   * Custom CSS class name(s) to apply to the field wrapper.
   */
  className?: string;

  /**
   * Make the field read-only in the Admin UI.
   * The field value can still be set programmatically.
   */
  readOnly?: boolean;

  /**
   * Hide the field from the Admin UI entirely.
   * The field still exists in the schema and can be set via API.
   */
  hidden?: boolean;

  /**
   * Disable the field input in the Admin UI.
   * Similar to readOnly but with different visual styling.
   */
  disabled?: boolean;

  /**
   * Conditional logic for showing/hiding the field.
   * The field is hidden when the condition evaluates to false.
   */
  condition?: FieldCondition;

  /**
   * Help text displayed below the field label.
   * Use this to provide additional context or instructions.
   */
  description?: string;

  /**
   * Placeholder text displayed in the input when empty.
   */
  placeholder?: string;

  /**
   * Custom React components to override default field rendering.
   */
  components?: {
    /**
     * Custom component for rendering the field in forms.
     * Receives field props including value, onChange, etc.
     */
    Field?: React.ComponentType<FieldComponentProps>;

    /**
     * Custom component for rendering the field in list/table views.
     * Receives the cell value and row data.
     */
    Cell?: React.ComponentType<CellComponentProps>;

    /**
     * Custom component for rendering the field's filter UI.
     * Used in list views for filtering by this field.
     */
    Filter?: React.ComponentType<FilterComponentProps>;
  };
}

/**
 * Props passed to custom Field components.
 */
export interface FieldComponentProps {
  /** Current field value */
  value: unknown;
  /** Callback to update the field value */
  onChange: (value: unknown) => void;
  /** Field configuration */
  field: BaseFieldConfig;
  /** Path to the field in nested structures */
  path: string;
  /** Whether the field is read-only */
  readOnly?: boolean;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Validation error message, if any */
  error?: string;
}

/**
 * Props passed to custom Cell components (list view).
 */
export interface CellComponentProps {
  /** Cell value to display */
  value: unknown;
  /** Full row data */
  rowData: Record<string, unknown>;
  /** Field configuration */
  field: BaseFieldConfig;
  /** Collection slug */
  collection: string;
}

/**
 * Props passed to custom Filter components.
 */
export interface FilterComponentProps {
  /** Current filter value */
  value: unknown;
  /** Callback to update the filter value */
  onChange: (value: unknown) => void;
  /** Field configuration */
  field: BaseFieldConfig;
}

// ============================================================
// Field Hooks
// ============================================================

/**
 * Field-level hooks configuration.
 *
 * Hooks allow custom logic to run at specific points in a field's lifecycle.
 * Unlike collection-level hooks, field hooks operate on individual field values.
 *
 * @example
 * ```typescript
 * const slugHooks: FieldHooks = {
 *   beforeValidate: [
 *     async ({ value, data }) => {
 *       // Auto-generate slug from title if not provided
 *       if (!value && data?.title) {
 *         return slugify(data.title);
 *       }
 *       return value;
 *     },
 *   ],
 * };
 * ```
 */
export interface FieldHooks {
  /**
   * Runs before field validation.
   * Can transform the field value before validation rules are applied.
   */
  beforeValidate?: HookHandler[];

  /**
   * Runs before the field value is saved to the database.
   * Can transform the final value to be stored.
   */
  beforeChange?: HookHandler[];

  /**
   * Runs after the field value has been saved to the database.
   * Useful for side effects like sending notifications.
   */
  afterChange?: HookHandler[];

  /**
   * Runs after the field value is read from the database.
   * Can transform the value before it's returned to the client.
   */
  afterRead?: HookHandler[];
}

// ============================================================
// Base Field Configuration
// ============================================================

/**
 * Base field configuration interface.
 *
 * All specific field types (text, number, select, etc.) extend this interface.
 * Contains common properties shared by all field types.
 *
 * @example
 * ```typescript
 * // A simple text field configuration
 * const titleField: BaseFieldConfig = {
 *   name: 'title',
 *   type: 'text',
 *   label: 'Title',
 *   required: true,
 *   admin: {
 *     description: 'Enter the post title',
 *   },
 * };
 * ```
 */
export interface BaseFieldConfig {
  /**
   * Unique field name (identifier).
   *
   * Must be unique within the collection and follow naming conventions:
   * - Start with a lowercase letter
   * - Contain only lowercase letters, numbers, and underscores
   * - Not be a reserved SQL keyword
   *
   * @example 'title', 'created_at', 'user_id'
   */
  name: string;

  /**
   * Field type identifier.
   *
   * Determines the field's behavior, validation, and UI rendering.
   */
  type: FieldType;

  /**
   * Human-readable label displayed in the Admin UI.
   *
   * If not provided, the label is auto-generated from the field name
   * (e.g., 'user_name' becomes 'User Name').
   */
  label?: string;

  /**
   * Whether the field is required.
   *
   * Required fields must have a non-null, non-empty value.
   * @default false
   */
  required?: boolean;

  /**
   * Whether the field value must be unique across all documents.
   *
   * Enforced at the database level with a unique constraint.
   * @default false
   */
  unique?: boolean;

  /**
   * Whether to create a database index on this field.
   *
   * Indexes improve query performance for frequently searched fields.
   * @default false
   */
  index?: boolean;

  /**
   * Default value for the field.
   *
   * Can be a static value or a function that returns a value.
   * The function receives the document data being created.
   *
   * @example
   * ```typescript
   * // Static default
   * defaultValue: 'draft'
   *
   * // Dynamic default
   * defaultValue: () => new Date().toISOString()
   * ```
   */
  defaultValue?: unknown | ((data: Record<string, unknown>) => unknown);

  /**
   * Admin UI configuration options.
   *
   * Controls field appearance, behavior, and custom components.
   */
  admin?: FieldAdminOptions;

  /**
   * Field-level access control.
   *
   * Defines who can create, read, and update this field.
   */
  access?: FieldAccess;

  /**
   * Field-level lifecycle hooks.
   *
   * Custom logic that runs at specific points in the field's lifecycle.
   */
  hooks?: FieldHooks;

  /**
   * Custom validation function.
   *
   * Runs after built-in validation. Return `true` for valid,
   * or a string error message for invalid.
   *
   * @example
   * ```typescript
   * validate: (value, { data }) => {
   *   if (value && value.length < 3) {
   *     return 'Must be at least 3 characters';
   *   }
   *   return true;
   * }
   * ```
   */
  validate?: (
    value: unknown,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;

  /**
   * Custom metadata for plugins and extensions.
   *
   * Store arbitrary data that can be used by custom components,
   * hooks, or plugins.
   */
  custom?: Record<string, unknown>;

  /**
   * Whether this field supports localization.
   *
   * When `true`, the field stores separate values for each locale.
   * Requires localization to be enabled in the collection config.
   *
   * @reserved Reserved for future implementation.
   * @default false
   */
  localized?: boolean;
}
