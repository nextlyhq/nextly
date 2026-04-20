/**
 * Form Builder Handlers
 *
 * Exports handlers for form submission processing, validation,
 * spam detection, and webhook triggering.
 *
 * @module handlers
 */

// Form submission handler
export {
  submitForm,
  validateSubmission,
  isFormAcceptingSubmissions,
  getFormSubmissionStats,
  type SubmitFormOptions,
  type SubmitFormResult,
  type SubmitFormContext,
} from "./submit-form";

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
} from "./spam-detection";

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
} from "./webhooks";
