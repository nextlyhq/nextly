/**
 * Form Builder Handlers
 *
 * Exports handlers for form submission processing, validation,
 * and spam detection. Submissions reach other systems through Nextly's own
 * `form.submission.created` webhook, so the plugin sends none of its own.
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
  type SpamCheckConfig,
  type SpamCheckOptions,
  type SpamCheckResult,
} from "./spam-detection";
