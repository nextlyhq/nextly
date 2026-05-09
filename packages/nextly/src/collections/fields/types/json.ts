/**
 * JSON Field Type
 *
 * A flexible field that stores arbitrary JSON data.
 * Provides a code editor interface in the Admin UI with optional
 * JSON Schema validation for type safety and editor guidance.
 *
 * **Use Cases:**
 * - Storing configuration objects
 * - Custom metadata that varies per document
 * - API response caching
 * - Flexible data structures
 * - Settings that don't warrant dedicated fields
 *
 * @module collections/fields/types/json
 * @since 1.0.0
 */

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  RequestContext,
} from "./base";

// ============================================================
// JSON Field Value Type
// ============================================================

/**
 * Possible value types for a JSON field.
 *
 * Can store any valid JSON structure: objects, arrays, or primitives.
 *
 * @example
 * ```typescript
 * // Object value
 * const config: JSONFieldValue = {
 *   theme: 'dark',
 *   notifications: { email: true, push: false }
 * };
 *
 * // Array value
 * const tags: JSONFieldValue = ['featured', 'new', 'sale'];
 *
 * // Null/undefined
 * const empty: JSONFieldValue = null;
 * ```
 */
export type JSONFieldValue =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null
  | undefined;

// ============================================================
// JSON Schema Types
// ============================================================

/**
 * JSON Schema type keywords.
 *
 * Defines the allowed types for a JSON Schema property.
 */
export type JSONSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

/**
 * JSON Schema property definition.
 *
 * A simplified subset of JSON Schema for inline schema definitions.
 * Supports the most common validation keywords.
 */
export interface JSONSchemaProperty {
  /**
   * The type(s) allowed for this property.
   */
  type?: JSONSchemaType | JSONSchemaType[];

  /**
   * Human-readable description of the property.
   */
  description?: string;

  /**
   * Default value for the property.
   */
  default?: unknown;

  /**
   * Allowed values (enum).
   */
  enum?: unknown[];

  /**
   * Constant value.
   */
  const?: unknown;

  // String validations
  /**
   * Minimum string length.
   */
  minLength?: number;

  /**
   * Maximum string length.
   */
  maxLength?: number;

  /**
   * Regex pattern the string must match.
   */
  pattern?: string;

  /**
   * Format hint (e.g., 'email', 'uri', 'date-time').
   */
  format?: string;

  // Number validations
  /**
   * Minimum value (inclusive).
   */
  minimum?: number;

  /**
   * Maximum value (inclusive).
   */
  maximum?: number;

  /**
   * Exclusive minimum value.
   */
  exclusiveMinimum?: number;

  /**
   * Exclusive maximum value.
   */
  exclusiveMaximum?: number;

  /**
   * Value must be a multiple of this number.
   */
  multipleOf?: number;

  // Array validations
  /**
   * Minimum number of items.
   */
  minItems?: number;

  /**
   * Maximum number of items.
   */
  maxItems?: number;

  /**
   * Whether items must be unique.
   */
  uniqueItems?: boolean;

  /**
   * Schema for array items.
   */
  items?: JSONSchemaProperty;

  // Object validations
  /**
   * Property definitions for objects.
   */
  properties?: Record<string, JSONSchemaProperty>;

  /**
   * Required property names.
   */
  required?: string[];

  /**
   * Whether additional properties are allowed.
   */
  additionalProperties?: boolean | JSONSchemaProperty;

  /**
   * Minimum number of properties.
   */
  minProperties?: number;

  /**
   * Maximum number of properties.
   */
  maxProperties?: number;
}

/**
 * JSON Schema definition for field validation.
 *
 * Inline JSON Schema for validating and guiding JSON input.
 * Validation is performed at the application level for equal
 * support across all database adapters.
 *
 * @example
 * ```typescript
 * // Schema for a settings object
 * const settingsSchema: JSONSchemaDefinition = {
 *   type: 'object',
 *   properties: {
 *     theme: {
 *       type: 'string',
 *       enum: ['light', 'dark', 'system'],
 *       default: 'system',
 *     },
 *     fontSize: {
 *       type: 'integer',
 *       minimum: 12,
 *       maximum: 24,
 *       default: 14,
 *     },
 *     notifications: {
 *       type: 'object',
 *       properties: {
 *         email: { type: 'boolean', default: true },
 *         push: { type: 'boolean', default: false },
 *       },
 *     },
 *   },
 *   required: ['theme'],
 * };
 * ```
 */
export interface JSONSchemaDefinition extends JSONSchemaProperty {
  /**
   * JSON Schema version identifier.
   *
   * @example 'https://json-schema.org/draft/2020-12/schema'
   */
  $schema?: string;

  /**
   * Schema title for documentation.
   */
  title?: string;
}

// ============================================================
// JSON Field Admin Options
// ============================================================

/**
 * Editor configuration options for the JSON code editor.
 *
 * These options are passed to the code editor component
 * (e.g., Monaco, CodeMirror) in the Admin UI.
 */
export interface JSONEditorOptions {
  /**
   * Height of the editor in pixels or CSS value.
   *
   * @default 300
   * @example 400, '50vh', 'auto'
   */
  height?: number | string;

  /**
   * Minimum height of the editor.
   *
   * @default 100
   */
  minHeight?: number;

  /**
   * Maximum height of the editor.
   *
   * When set, the editor becomes scrollable beyond this height.
   */
  maxHeight?: number;

  /**
   * Whether to show line numbers.
   *
   * @default true
   */
  lineNumbers?: boolean;

  /**
   * Whether to enable code folding.
   *
   * @default true
   */
  folding?: boolean;

  /**
   * Whether to enable word wrap.
   *
   * @default false
   */
  wordWrap?: boolean;

  /**
   * Whether to enable minimap (code overview).
   *
   * @default false
   */
  minimap?: boolean;

  /**
   * Tab size for indentation.
   *
   * @default 2
   */
  tabSize?: number;

  /**
   * Whether to format JSON on blur.
   *
   * Automatically prettifies the JSON when the field loses focus.
   *
   * @default true
   */
  formatOnBlur?: boolean;

  /**
   * Whether to validate JSON in real-time.
   *
   * Shows syntax errors as the user types.
   *
   * @default true
   */
  validateOnChange?: boolean;
}

/**
 * Admin panel options specific to JSON fields.
 *
 * Extends the base admin options with JSON editor configuration.
 */
export interface JSONFieldAdminOptions extends FieldAdminOptions {
  /**
   * Code editor configuration options.
   *
   * Customize the appearance and behavior of the JSON editor.
   */
  editorOptions?: JSONEditorOptions;
}

// ============================================================
// JSON Field Configuration
// ============================================================

/**
 * Configuration interface for JSON fields.
 *
 * JSON fields store arbitrary JSON data and provide a code editor
 * interface in the Admin UI. Optional JSON Schema validation ensures
 * data integrity and provides editor guidance (autocomplete, hints).
 *
 * **Database Storage:**
 * - PostgreSQL: `JSONB` (binary JSON with indexing support)
 * - MySQL: `JSON` (native JSON type)
 * - SQLite: `TEXT` (JSON string, parsed at application level)
 *
 * **Validation:**
 * JSON Schema validation is performed at the application level,
 * ensuring equal support across all database adapters.
 *
 * @example
 * ```typescript
 * // Basic JSON field (any valid JSON)
 * const metadataField: JSONFieldConfig = {
 *   name: 'metadata',
 *   type: 'json',
 *   label: 'Metadata',
 * };
 *
 * // JSON field with schema validation
 * const settingsField: JSONFieldConfig = {
 *   name: 'settings',
 *   type: 'json',
 *   label: 'User Settings',
 *   jsonSchema: {
 *     type: 'object',
 *     properties: {
 *       theme: {
 *         type: 'string',
 *         enum: ['light', 'dark', 'system'],
 *         description: 'UI theme preference',
 *       },
 *       language: {
 *         type: 'string',
 *         pattern: '^[a-z]{2}(-[A-Z]{2})?$',
 *         description: 'Locale code (e.g., en-US)',
 *       },
 *       notifications: {
 *         type: 'object',
 *         properties: {
 *           email: { type: 'boolean', default: true },
 *           push: { type: 'boolean', default: false },
 *           sms: { type: 'boolean', default: false },
 *         },
 *       },
 *     },
 *     required: ['theme'],
 *   },
 * };
 *
 * // JSON field with custom editor options
 * const configField: JSONFieldConfig = {
 *   name: 'config',
 *   type: 'json',
 *   label: 'Configuration',
 *   admin: {
 *     description: 'Advanced configuration in JSON format',
 *     editorOptions: {
 *       height: 400,
 *       lineNumbers: true,
 *       folding: true,
 *       minimap: false,
 *       tabSize: 2,
 *       formatOnBlur: true,
 *     },
 *   },
 * };
 *
 * // JSON field with default value
 * const preferencesField: JSONFieldConfig = {
 *   name: 'preferences',
 *   type: 'json',
 *   label: 'Preferences',
 *   defaultValue: {
 *     displayMode: 'grid',
 *     itemsPerPage: 20,
 *     showThumbnails: true,
 *   },
 * };
 *
 * // JSON array field
 * const tagsField: JSONFieldConfig = {
 *   name: 'customTags',
 *   type: 'json',
 *   label: 'Custom Tags',
 *   jsonSchema: {
 *     type: 'array',
 *     items: {
 *       type: 'object',
 *       properties: {
 *         name: { type: 'string', minLength: 1 },
 *         color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
 *       },
 *       required: ['name'],
 *     },
 *     minItems: 0,
 *     maxItems: 10,
 *   },
 * };
 *
 * // JSON field with custom validation
 * const apiConfigField: JSONFieldConfig = {
 *   name: 'apiConfig',
 *   type: 'json',
 *   label: 'API Configuration',
 *   validate: (value) => {
 *     if (value && typeof value === 'object' && !Array.isArray(value)) {
 *       const config = value as Record<string, unknown>;
 *       if (!config.endpoint || typeof config.endpoint !== 'string') {
 *         return 'API endpoint is required';
 *       }
 *       if (!config.endpoint.startsWith('https://')) {
 *         return 'API endpoint must use HTTPS';
 *       }
 *     }
 *     return true;
 *   },
 * };
 * ```
 */
export interface JSONFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. Must be 'json'.
   */
  type: "json";

  /**
   * JSON Schema for validation and editor guidance.
   *
   * Inline schema definition that validates the JSON structure
   * and provides autocomplete hints in the editor.
   *
   * Validation is performed at the application level for
   * consistent behavior across all database adapters.
   */
  jsonSchema?: JSONSchemaDefinition;

  /**
   * Default value for the field.
   *
   * Can be any valid JSON value or a function that returns one.
   *
   * @example
   * ```typescript
   * // Static default object
   * defaultValue: { enabled: true, count: 0 }
   *
   * // Static default array
   * defaultValue: []
   *
   * // Dynamic default
   * defaultValue: () => ({ createdAt: new Date().toISOString() })
   * ```
   */
  defaultValue?:
    | Record<string, unknown>
    | unknown[]
    | string
    | number
    | boolean
    | null
    | ((
        data: Record<string, unknown>
      ) =>
        | Record<string, unknown>
        | unknown[]
        | string
        | number
        | boolean
        | null);

  /**
   * Admin UI configuration options.
   */
  admin?: JSONFieldAdminOptions;

  /**
   * Custom validation function.
   *
   * Receives the JSON value and returns `true` for valid
   * or an error message string for invalid.
   *
   * This runs in addition to JSON Schema validation (if defined).
   *
   * @param value - The JSON field value
   * @param args - Object containing document data and request context
   * @returns `true` if valid, or an error message string
   *
   * @example
   * ```typescript
   * // Validate specific structure
   * validate: (value) => {
   *   if (value && typeof value === 'object') {
   *     const obj = value as Record<string, unknown>;
   *     if (!obj.version || typeof obj.version !== 'number') {
   *       return 'Config must include a numeric version';
   *     }
   *   }
   *   return true;
   * }
   *
   * // Validate array length
   * validate: (value) => {
   *   if (Array.isArray(value) && value.length > 100) {
   *     return 'Maximum 100 items allowed';
   *   }
   *   return true;
   * }
   *
   * // Cross-field validation
   * validate: (value, { data }) => {
   *   if (value && data.type === 'advanced') {
   *     const config = value as Record<string, unknown>;
   *     if (!config.advancedSettings) {
   *       return 'Advanced settings required for advanced type';
   *     }
   *   }
   *   return true;
   * }
   * ```
   */
  validate?: (
    value: JSONFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}
