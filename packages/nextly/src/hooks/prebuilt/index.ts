/**
 * Pre-built Hook Templates
 *
 * Common hook patterns that can be configured via the UI for UI-created collections.
 * These hooks provide out-of-the-box functionality without requiring code-first implementation.
 *
 * @module hooks/prebuilt
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { prebuiltHooks, getPrebuiltHook } from '@nextly/hooks/prebuilt';
 *
 * // Get all available hooks
 * console.log(prebuiltHooks.map(h => h.name));
 *
 * // Get a specific hook by ID
 * const autoSlugHook = getPrebuiltHook('auto-slug');
 * ```
 */

import { z } from "zod";

import { NextlyError } from "../../errors/nextly-error";
import type { HookContext, HookType } from "../types";

// ============================================================
// Pre-built Hook Types
// ============================================================

/**
 * Categories for organizing pre-built hooks in the UI.
 */
export type PrebuiltHookCategory =
  | "data-transform"
  | "validation"
  | "notification"
  | "audit";

/**
 * Extended hook type that includes virtual types like 'beforeChange'.
 *
 * - `beforeChange`: Runs on both create and update operations
 * - `afterChange`: Runs after both create and update operations
 * - Other types map directly to existing HookType
 */
export type PrebuiltHookType = HookType | "beforeChange" | "afterChange";

/**
 * Context passed to pre-built hook execute functions.
 *
 * Extends HookContext with additional properties needed for
 * pre-built hook execution.
 */
export interface PrebuiltHookContext extends HookContext {
  /**
   * The operation type (create, read, update, delete).
   * Inherited from HookContext but made explicit for clarity.
   */
  operation: "create" | "read" | "update" | "delete";

  /**
   * Database query function for uniqueness checks.
   * Returns true if a matching value exists, false otherwise.
   */
  queryDatabase?: (params: {
    collection: string;
    field: string;
    value: unknown;
    caseInsensitive?: boolean;
    excludeId?: string;
  }) => Promise<boolean>;
}

/**
 * Configuration interface for pre-built hooks.
 *
 * Pre-built hooks are common hook patterns that can be configured
 * via the Admin UI without writing code. Each hook has:
 * - A unique identifier
 * - Human-readable name and description
 * - Hook type (when it runs in the lifecycle)
 * - Category for UI organization
 * - Zod schema for configuration validation
 * - Execute function that performs the hook logic
 *
 * @example
 * ```typescript
 * const myHook: PrebuiltHookConfig = {
 *   id: 'my-custom-hook',
 *   name: 'My Custom Hook',
 *   description: 'Does something useful',
 *   hookType: 'beforeChange',
 *   category: 'data-transform',
 *   configSchema: z.object({
 *     fieldName: z.string(),
 *   }),
 *   execute: async (config, context) => {
 *     // Hook logic here
 *     return context.data;
 *   },
 * };
 * ```
 */
export interface PrebuiltHookConfig<TConfig = unknown> {
  /**
   * Unique identifier for this hook.
   * Used to reference the hook in stored configurations.
   *
   * @example 'auto-slug', 'audit-fields', 'unique-validation'
   */
  id: string;

  /**
   * Human-readable name displayed in the Admin UI.
   *
   * @example 'Auto-generate Slug', 'Set Audit Fields'
   */
  name: string;

  /**
   * Description of what this hook does.
   * Displayed in the hook selector UI.
   */
  description: string;

  /**
   * When this hook runs in the document lifecycle.
   *
   * - `beforeChange`: Runs before create or update (can modify data)
   * - `afterChange`: Runs after create or update (for side effects)
   * - `beforeCreate`, `afterCreate`, etc.: Specific operation hooks
   */
  hookType: PrebuiltHookType;

  /**
   * Category for organizing hooks in the UI.
   *
   * - `data-transform`: Modifies document data
   * - `validation`: Validates data before save
   * - `notification`: Sends notifications/webhooks
   * - `audit`: Tracks who/when documents change
   */
  category: PrebuiltHookCategory;

  /**
   * Zod schema for validating hook configuration.
   *
   * This schema defines what options the hook accepts and
   * is used to generate configuration forms in the Admin UI.
   */
  configSchema: z.ZodSchema<TConfig>;

  /**
   * Execute function that performs the hook logic.
   *
   * @param config - The validated configuration for this hook instance
   * @param context - The hook context with document data, user, etc.
   * @returns Modified data (for before hooks) or void (for after hooks)
   */
  execute: (
    config: TConfig,
    context: PrebuiltHookContext
  ) => Promise<Record<string, unknown> | void>;
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Default slugify function for auto-slug hook.
 *
 * Transforms a string into a URL-friendly slug:
 * - Converts to lowercase
 * - Normalizes unicode characters (removes diacritics)
 * - Replaces spaces and special characters with hyphens
 * - Removes leading/trailing hyphens
 * - Collapses multiple consecutive hyphens
 *
 * @param value - The string to slugify
 * @returns URL-friendly slug
 *
 * @example
 * ```typescript
 * slugify('Hello World!'); // 'hello-world'
 * slugify('Café & Restaurant'); // 'cafe-restaurant'
 * slugify('  Multiple   Spaces  '); // 'multiple-spaces'
 * ```
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD") // Decompose unicode characters
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, "") // Remove leading/trailing hyphens
    .replace(/-{2,}/g, "-"); // Collapse multiple hyphens
}

// ============================================================
// Auto-Slug Hook
// ============================================================

/**
 * Configuration schema for auto-slug hook.
 */
const autoSlugConfigSchema = z.object({
  /**
   * Field name to generate the slug from (e.g., 'title', 'name').
   */
  sourceField: z.string().describe("Field to generate slug from"),

  /**
   * Field name to store the generated slug in.
   * @default 'slug'
   */
  targetField: z.string().default("slug").describe("Field to store slug in"),

  /**
   * Whether to overwrite existing slug values.
   * When false, only generates slug if target field is empty.
   * @default false
   */
  overwriteExisting: z
    .boolean()
    .default(false)
    .describe("Overwrite existing slug values"),
});

/**
 * Inferred type for auto-slug configuration.
 */
export type AutoSlugConfig = z.infer<typeof autoSlugConfigSchema>;

/**
 * Auto-generate Slug Hook
 *
 * Automatically generates a URL-safe slug from another field.
 * Useful for creating SEO-friendly URLs from titles or names.
 *
 * **Runs on:** beforeChange (create and update)
 *
 * @example
 * ```typescript
 * // Configuration in Admin UI:
 * {
 *   sourceField: 'title',
 *   targetField: 'slug',
 *   overwriteExisting: false
 * }
 *
 * // Input: { title: 'My Blog Post' }
 * // Output: { title: 'My Blog Post', slug: 'my-blog-post' }
 * ```
 */
export const autoSlug: PrebuiltHookConfig<AutoSlugConfig> = {
  id: "auto-slug",
  name: "Auto-generate Slug",
  description: "Automatically generate a URL-safe slug from another field",
  hookType: "beforeChange",
  category: "data-transform",
  configSchema: autoSlugConfigSchema,
  // eslint-disable-next-line @typescript-eslint/require-await
  execute: async (config, context) => {
    const { sourceField, targetField, overwriteExisting } = config;
    const data = context.data as Record<string, unknown> | undefined;

    if (!data) {
      return data;
    }

    const sourceValue = data[sourceField];

    // Only generate if source has a value
    if (typeof sourceValue !== "string" || !sourceValue.trim()) {
      return data;
    }

    // Check if we should generate (either overwrite is true or target is empty)
    const currentTargetValue = data[targetField];
    const shouldGenerate =
      overwriteExisting ||
      currentTargetValue === undefined ||
      currentTargetValue === null ||
      currentTargetValue === "";

    if (shouldGenerate) {
      return {
        ...data,
        [targetField]: slugify(sourceValue),
      };
    }

    return data;
  },
};

// ============================================================
// Audit Fields Hook
// ============================================================

/**
 * Configuration schema for audit fields hook.
 */
const auditFieldsConfigSchema = z.object({
  /**
   * Field name to store the ID of the user who created the document.
   * @default 'createdBy'
   */
  createdByField: z
    .string()
    .default("createdBy")
    .describe("Field for creator user ID"),

  /**
   * Field name to store the ID of the user who last updated the document.
   * @default 'updatedBy'
   */
  updatedByField: z
    .string()
    .default("updatedBy")
    .describe("Field for updater user ID"),
});

/**
 * Inferred type for audit fields configuration.
 */
export type AuditFieldsConfig = z.infer<typeof auditFieldsConfigSchema>;

/**
 * Set Audit Fields Hook
 *
 * Automatically sets createdBy and updatedBy fields based on the
 * current user performing the operation.
 *
 * **Runs on:** beforeChange (create and update)
 *
 * @example
 * ```typescript
 * // Configuration in Admin UI:
 * {
 *   createdByField: 'createdBy',
 *   updatedByField: 'updatedBy'
 * }
 *
 * // On create with user ID '123':
 * // Output: { ...data, createdBy: '123', updatedBy: '123' }
 *
 * // On update with user ID '456':
 * // Output: { ...data, updatedBy: '456' }
 * ```
 */
export const auditFields: PrebuiltHookConfig<AuditFieldsConfig> = {
  id: "audit-fields",
  name: "Set Audit Fields",
  description: "Automatically set createdBy and updatedBy fields",
  hookType: "beforeChange",
  category: "audit",
  configSchema: auditFieldsConfigSchema,
  // eslint-disable-next-line @typescript-eslint/require-await
  execute: async (config, context) => {
    const { createdByField, updatedByField } = config;
    const data = context.data as Record<string, unknown> | undefined;

    if (!data) {
      return data;
    }

    const updates: Record<string, unknown> = {};

    // Set createdBy only on create operations
    if (context.operation === "create" && context.user?.id) {
      updates[createdByField] = context.user.id;
    }

    // Set updatedBy on both create and update operations
    if (context.user?.id) {
      updates[updatedByField] = context.user.id;
    }

    // Only return modified data if we have updates
    if (Object.keys(updates).length > 0) {
      return { ...data, ...updates };
    }

    return data;
  },
};

// ============================================================
// Unique Validation Hook
// ============================================================

/**
 * Configuration schema for unique validation hook.
 */
const uniqueValidationConfigSchema = z.object({
  /**
   * Field name to validate for uniqueness.
   */
  field: z.string().describe("Field to validate"),

  /**
   * Custom error message when validation fails.
   * @default 'This value is already in use'
   */
  errorMessage: z
    .string()
    .default("This value is already in use")
    .describe("Error message for duplicate values"),

  /**
   * Whether the check should be case-insensitive.
   * @default false
   */
  caseInsensitive: z
    .boolean()
    .default(false)
    .describe("Case-insensitive comparison"),
});

/**
 * Inferred type for unique validation configuration.
 */
export type UniqueValidationConfig = z.infer<
  typeof uniqueValidationConfigSchema
>;

/**
 * Validate Uniqueness Hook
 *
 * Ensures a field value is unique across the collection.
 * Throws an error if a duplicate value is found.
 *
 * **Runs on:** beforeChange (create and update)
 *
 * **Note:** This hook requires database access to check for existing
 * values. The actual uniqueness check will be performed by the
 * Entry Service when this hook is integrated with runtime execution.
 * Currently provides a placeholder that always passes.
 *
 * @example
 * ```typescript
 * // Configuration in Admin UI:
 * {
 *   field: 'email',
 *   errorMessage: 'This email is already registered',
 *   caseInsensitive: true
 * }
 * ```
 */
export const uniqueValidation: PrebuiltHookConfig<UniqueValidationConfig> = {
  id: "unique-validation",
  name: "Validate Uniqueness",
  description: "Ensure a field value is unique across the collection",
  hookType: "beforeChange",
  category: "validation",
  configSchema: uniqueValidationConfigSchema,
  execute: async (config, context) => {
    const { field, errorMessage, caseInsensitive } = config;
    const data = context.data as Record<string, unknown> | undefined;

    if (!data) {
      return data;
    }

    const fieldValue = data[field];

    // Skip validation if field value is empty
    if (fieldValue === undefined || fieldValue === null || fieldValue === "") {
      return data;
    }

    // Check if queryDatabase function is available
    if (!context.queryDatabase) {
      console.warn(
        `[Nextly] Uniqueness validation for ${field} skipped: queryDatabase function not available`
      );
      return data;
    }

    // Get the document ID for updates (to exclude current document)
    const excludeId = (data.id as string) || undefined;

    // Query database for existing documents with this field value
    const isDuplicate = await context.queryDatabase({
      collection: context.collection,
      field,
      value: fieldValue,
      caseInsensitive,
      excludeId,
    });

    if (isDuplicate) {
      // Typed, so the duplicate reaches the caller as a validation failure
      // against the offending field rather than as a server fault whose
      // message is replaced before anyone sees it.
      throw NextlyError.validation({
        errors: [
          { path: String(field), code: "DUPLICATE", message: errorMessage },
        ],
      });
    }

    return data;
  },
};

// ============================================================
// Pre-built Hooks Registry
// ============================================================

/**
 * Array of all available pre-built hooks.
 *
 * This registry is used by the Admin UI to display available
 * hooks and their configuration options.
 *
 * @example
 * ```typescript
 * import { prebuiltHooks} from '@nextly/hooks/prebuilt';
 *
 * // List all hooks by category
 * const dataTransformHooks = prebuiltHooks.filter(
 *   h => h.category === 'data-transform'
 * );
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const prebuiltHooks: PrebuiltHookConfig<any>[] = [
  autoSlug,
  auditFields,
  uniqueValidation,
];

/**
 * Get a pre-built hook by its ID.
 *
 * @param id - The hook ID to look up
 * @returns The hook configuration, or undefined if not found
 *
 * @example
 * ```typescript
 * import { getPrebuiltHook } from '@nextly/hooks/prebuilt';
 *
 * const hook = getPrebuiltHook('auto-slug');
 * if (hook) {
 *   console.log(hook.name); // 'Auto-generate Slug'
 * }
 * ```
 */

export function getPrebuiltHook(id: string): PrebuiltHookConfig | undefined {
  return prebuiltHooks.find(h => h.id === id);
}

/**
 * Get all pre-built hooks in a specific category.
 *
 * @param category - The category to filter by
 * @returns Array of hooks in that category
 *
 * @example
 * ```typescript
 * import { getPrebuiltHooksByCategory } from '@nextly/hooks/prebuilt';
 *
 * const auditHooks = getPrebuiltHooksByCategory('audit');
 * // [{ id: 'audit-fields', name: 'Set Audit Fields', ... }]
 * ```
 */
export function getPrebuiltHooksByCategory(
  category: PrebuiltHookCategory
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): PrebuiltHookConfig<any>[] {
  return prebuiltHooks.filter(h => h.category === category);
}

/**
 * Get all pre-built hooks of a specific hook type.
 *
 * @param hookType - The hook type to filter by
 * @returns Array of hooks with that type
 *
 * @example
 * ```typescript
 * import { getPrebuiltHooksByType } from '@nextly/hooks/prebuilt';
 *
 * const beforeChangeHooks = getPrebuiltHooksByType('beforeChange');
 * // [autoSlug, auditFields, uniqueValidation]
 * ```
 */
export function getPrebuiltHooksByType(
  hookType: PrebuiltHookType
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): PrebuiltHookConfig<any>[] {
  return prebuiltHooks.filter(h => h.hookType === hookType);
}

/**
 * Maps a PrebuiltHookType to the actual HookType(s) it should register for.
 *
 * Virtual types like 'beforeChange' map to multiple actual hook types.
 *
 * @param prebuiltType - The pre-built hook type
 * @returns Array of actual HookType values
 *
 * @example
 * ```typescript
 * mapHookType('beforeChange'); // ['beforeCreate', 'beforeUpdate']
 * mapHookType('afterChange'); // ['afterCreate', 'afterUpdate']
 * mapHookType('beforeCreate'); // ['beforeCreate']
 * ```
 */
export function mapHookType(prebuiltType: PrebuiltHookType): HookType[] {
  switch (prebuiltType) {
    case "beforeChange":
      return ["beforeCreate", "beforeUpdate"];
    case "afterChange":
      return ["afterCreate", "afterUpdate"];
    default:
      return [prebuiltType];
  }
}
