/**
 * Pre-built Hook Definitions (Admin-side mirror of nextly hooks)
 *
 * Contains hook types, Zod config schemas, pre-built hooks registry,
 * category/label constants, and utility functions.
 *
 * @module components/features/schema-builder/HooksEditor/utils/prebuiltHooks
 */

import { z } from "zod";

import * as Icons from "@admin/components/icons";

// ============================================================
// Pre-built Hook Definitions
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
 */
export type PrebuiltHookType =
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
 * Pre-built hook configuration for the Admin UI.
 * This mirrors the structure from @nextly/hooks/prebuilt.
 */
export interface PrebuiltHookConfig {
  id: string;
  name: string;
  description: string;
  hookType: PrebuiltHookType;
  category: PrebuiltHookCategory;
  configSchema: z.ZodSchema;
}

/**
 * Configuration schema for auto-slug hook.
 */
const autoSlugConfigSchema = z.object({
  sourceField: z.string().describe("Field to generate slug from"),
  targetField: z.string().default("slug").describe("Field to store slug in"),
  overwriteExisting: z
    .boolean()
    .default(false)
    .describe("Overwrite existing slug values"),
});

/**
 * Configuration schema for audit fields hook.
 */
const auditFieldsConfigSchema = z.object({
  createdByField: z
    .string()
    .default("createdBy")
    .describe("Field for creator user ID"),
  updatedByField: z
    .string()
    .default("updatedBy")
    .describe("Field for updater user ID"),
});

/**
 * Configuration schema for webhook notification hook.
 */
const webhookNotificationConfigSchema = z.object({
  url: z.string().url().describe("Webhook URL"),
  includeData: z
    .boolean()
    .default(true)
    .describe("Include document data in payload"),
  operations: z
    .array(z.enum(["create", "update", "delete"]))
    .default(["create", "update"])
    .describe("Operations that trigger the webhook"),
  secret: z
    .string()
    .optional()
    .describe("Secret key for signature verification"),
});

/**
 * Configuration schema for unique validation hook.
 */
const uniqueValidationConfigSchema = z.object({
  field: z.string().describe("Field to validate"),
  errorMessage: z
    .string()
    .default("This value is already in use")
    .describe("Error message for duplicate values"),
  caseInsensitive: z
    .boolean()
    .default(false)
    .describe("Case-insensitive comparison"),
});

/**
 * Pre-built hooks registry for the Admin UI.
 * This mirrors the hooks available in @nextly/hooks/prebuilt.
 */
export const prebuiltHooks: PrebuiltHookConfig[] = [
  {
    id: "auto-slug",
    name: "Auto-generate Slug",
    description: "Automatically generate a URL-safe slug from another field",
    hookType: "beforeChange",
    category: "data-transform",
    configSchema: autoSlugConfigSchema,
  },
  {
    id: "audit-fields",
    name: "Set Audit Fields",
    description: "Automatically set createdBy and updatedBy fields",
    hookType: "beforeChange",
    category: "audit",
    configSchema: auditFieldsConfigSchema,
  },
  {
    id: "webhook-notification",
    name: "Send Webhook",
    description: "Send HTTP POST notification to a URL when documents change",
    hookType: "afterChange",
    category: "notification",
    configSchema: webhookNotificationConfigSchema,
  },
  {
    id: "unique-validation",
    name: "Validate Uniqueness",
    description: "Ensure a field value is unique across the collection",
    hookType: "beforeChange",
    category: "validation",
    configSchema: uniqueValidationConfigSchema,
  },
];

/**
 * Get a pre-built hook by its ID.
 */
export function getPrebuiltHook(id: string): PrebuiltHookConfig | undefined {
  return prebuiltHooks.find(h => h.id === id);
}

// ============================================================
// Constants
// ============================================================

/**
 * Category labels and icons for the hook selector
 */
export const HOOK_CATEGORIES: Record<
  PrebuiltHookCategory,
  { label: string; icon: keyof typeof Icons; description: string }
> = {
  "data-transform": {
    label: "Data Transform",
    icon: "RefreshCw",
    description: "Modify document data before saving",
  },
  validation: {
    label: "Validation",
    icon: "Shield",
    description: "Validate data before operations",
  },
  notification: {
    label: "Notification",
    icon: "Bell",
    description: "Send notifications on changes",
  },
  audit: {
    label: "Audit",
    icon: "Clipboard",
    description: "Track who and when changes occurred",
  },
};

/**
 * Hook type labels
 */
export const HOOK_TYPE_LABELS: Record<string, string> = {
  beforeChange: "Before Create/Update",
  afterChange: "After Create/Update",
  beforeCreate: "Before Create",
  afterCreate: "After Create",
  beforeUpdate: "Before Update",
  afterUpdate: "After Update",
  beforeDelete: "Before Delete",
  afterDelete: "After Delete",
  beforeRead: "Before Read",
  afterRead: "After Read",
};

// ============================================================
// Utility Functions
// ============================================================

/**
 * Generate a unique ID for a hook instance
 */
export function generateHookInstanceId(): string {
  return `hook_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
