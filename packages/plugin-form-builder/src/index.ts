/**
 * @nextly/plugin-form-builder
 *
 * Visual form builder plugin for Nextly CMS.
 * Provides drag-and-drop form building, submission management,
 * email notifications, and spam protection.
 *
 * @packageDocumentation
 */

// ============================================================
// Main Plugin Export
// ============================================================

// ============================================================
// Default Plugin Instance
// ============================================================

/**
 * Pre-configured form builder plugin for simple usage.
 *
 * This is a default instance with all defaults applied.
 * For customization, use `formBuilder()` instead.
 *
 * @example Simple usage - just add the plugin!
 * ```typescript
 * // nextly.config.ts
 * import { defineConfig } from '@revnixhq/nextly';
 * import { formBuilderPlugin } from '@nextly/plugin-form-builder';
 *
 * export default defineConfig({
 *   plugins: [formBuilderPlugin],
 *   collections: [Posts, Users, Media], // Your collections only
 * });
 * ```
 *
 * @example With customization
 * ```typescript
 * import { formBuilder } from '@nextly/plugin-form-builder';
 *
 * const myFormPlugin = formBuilder({
 *   notifications: { defaultFrom: 'noreply@example.com' },
 * });
 *
 * export default defineConfig({
 *   plugins: [myFormPlugin.plugin],
 * });
 * ```
 */
import { formBuilder } from "./plugin";

export {
  formBuilder,
  getFormBuilderConfig,
  type NextlyPlugin,
  type FormBuilderPluginResult,
} from "./plugin";
export const formBuilderPlugin = formBuilder().plugin;

// ============================================================
// Type Exports
// ============================================================

// Plugin configuration types
export type {
  FormBuilderPluginOptions,
  ResolvedFormBuilderConfig,
  FieldBlockConfig,
} from "./types";

// Form field types (discriminated union)
export type {
  FormField,
  FormFieldType,
  BaseFormField,
  TextFormField,
  EmailFormField,
  NumberFormField,
  PhoneFormField,
  UrlFormField,
  TextareaFormField,
  SelectFormField,
  CheckboxFormField,
  RadioFormField,
  FileFormField,
  DateFormField,
  TimeFormField,
  HiddenFormField,
} from "./types";

// Form configuration types
export type {
  FormConfig,
  FormSettings,
  FormNotifications,
  FormAccess,
  FormHooks,
  FormHookContext,
} from "./types";

// Document types
export type { FormDocument, SubmissionDocument, FormSubmission } from "./types";

// Validation and conditional logic types
export type {
  ValidationRules,
  ConditionalLogic,
  ConditionalLogicCondition,
} from "./types";

// Email types
export type { EmailConfig } from "./types";

// Webhook types
export type { WebhookConfig, WebhookEvent } from "./types";

// ============================================================
// Utility Exports
// ============================================================

// Type guards
export {
  isFormField,
  isFormFieldType,
  isTextFormField,
  isEmailFormField,
  isSelectFormField,
  isCheckboxFormField,
  isFileFormField,
} from "./types";

// ============================================================
// Config Utilities (validation & defaults)
// ============================================================

// Validation utilities
export {
  validateFormConfig,
  assertValidFormConfig,
  RESERVED_FORM_SLUGS,
  type FormValidationError,
  type FormValidationErrorCode,
  type FormValidationResult,
} from "./config";

// Default application utilities
export {
  applyFormDefaults,
  applyFieldDefaults,
  createFormConfig,
  toTitleCase,
  pluralize,
  DEFAULT_FORM_SETTINGS,
  DEFAULT_NOTIFICATION_SETTINGS,
} from "./config";

// ============================================================
// Field Helper Functions
// ============================================================

// Utility helper
export { option, type FormFieldOption } from "./config";

// Text input field helpers
export { text, email, phone, url, textarea } from "./config";

// Numeric field helpers
export { number } from "./config";

// Selection field helpers
export { select, checkbox, radio } from "./config";

// File field helpers
export { file } from "./config";

// Date/time field helpers
export { date, time } from "./config";

// Special field helpers
export { hidden } from "./config";

// ============================================================
// Conditional Logic Utilities
// ============================================================

// Conditional logic evaluation
export {
  evaluateConditions,
  isValidComparisonOperator,
  getSupportedComparisonOperators,
  type ComparisonOperator,
} from "./utils";

// ============================================================
// Schema Generation & Validation Utilities
// ============================================================

// Zod schema generation for form validation
export {
  generateZodSchema,
  transformFormData,
  validateFormData,
  getValidationErrors,
} from "./utils";

// ============================================================
// Export Utilities (CSV, JSON)
// ============================================================

// Export format utilities
export {
  exportToCSV,
  exportToJSON,
  formatExportValue,
  downloadFile,
  generateExportFilename,
  exportAndDownload,
  type CSVExportOptions,
  type JSONExportOptions,
  type ExportedJSON,
} from "./utils";

// ============================================================
// Form Submission Handlers
// ============================================================

// Main submission handler
export {
  submitForm,
  validateSubmission,
  isFormAcceptingSubmissions,
  getFormSubmissionStats,
  type SubmitFormOptions,
  type SubmitFormResult,
  type SubmitFormContext,
} from "./handlers";

// Spam detection utilities
export {
  checkSpam,
  cleanupRateLimitStore,
  getRateLimitStoreSize,
  clearRateLimitStore,
  isRateLimited,
  type SpamCheckConfig,
  type SpamCheckOptions,
  type SpamCheckResult,
} from "./handlers";

// Webhook utilities
export {
  triggerWebhooks,
  fireWebhooks,
  isValidWebhookUrl,
  getSupportedWebhookEvents,
  type WebhookPayload,
  type TriggerWebhooksOptions,
  type WebhookDeliveryResult,
  type TriggerWebhooksResult,
} from "./handlers";

// ============================================================
// Collection Exports (for advanced usage)
// ============================================================

export { formsCollection, submissionsCollection } from "./collections";

// ============================================================
// Component Exports
// ============================================================
// Note: React components are exported from `@nextly/plugin-form-builder/components`
// to avoid "use client" issues when importing the plugin in server contexts.
// Use: import { SubmissionList, SubmissionDetail } from '@nextly/plugin-form-builder/components';

// Type-only exports are safe for server contexts
export type { SubmissionListProps, SubmissionDetailProps } from "./components";
