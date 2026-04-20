/**
 * Form Submission Handler
 *
 * Processes form submissions including validation, spam detection,
 * storage, and notification triggering.
 *
 * @module handlers/submit-form
 * @since 0.1.0
 */

import type { PluginContext } from "@revnixhq/nextly";

import type {
  FormDocument,
  SubmissionDocument,
  ResolvedFormBuilderConfig,
  FormField,
} from "../types";
import {
  generateZodSchema,
  transformFormData,
  getValidationErrors,
} from "../utils/generate-schema";

import { checkSpam } from "./spam-detection";

// ============================================================
// Types
// ============================================================

/**
 * Options for submitting a form.
 */
export interface SubmitFormOptions {
  /** Form slug (URL-friendly identifier) */
  formSlug: string;

  /** Form submission data */
  data: Record<string, unknown>;

  /** Optional metadata about the submission */
  metadata?: {
    /** Submitter's IP address */
    ipAddress?: string;
    /** Submitter's user agent string */
    userAgent?: string;
  };
}

/**
 * Result of form submission.
 */
export interface SubmitFormResult {
  /** Whether the submission was successful */
  success: boolean;

  /** The created submission document (on success) */
  submission?: SubmissionDocument;

  /** Error message (on failure) */
  error?: string;

  /** Field-level validation errors */
  validationErrors?: Record<string, string>;

  /** Redirect URL (if form configured for redirect on success) */
  redirect?: string;
}

/**
 * Context for the submission handler.
 */
export interface SubmitFormContext {
  /** Plugin context with access to services */
  pluginContext: PluginContext;

  /** Resolved plugin configuration */
  pluginConfig: ResolvedFormBuilderConfig;
}

// ============================================================
// Main Submission Handler
// ============================================================

/**
 * Process a form submission.
 *
 * This is the main entry point for handling form submissions.
 * It performs the following steps:
 *
 * 1. Fetch form configuration by slug
 * 2. Verify form status (must be "published")
 * 3. Transform and validate submission data
 * 4. Check for spam (honeypot, rate limiting)
 * 5. Create submission record in database
 * 6. Return result with redirect info if configured
 *
 * Note: Email notifications are triggered separately via collection
 * hooks in the submissions collection (see Phase 4.2).
 *
 * @param options - Submission options
 * @param context - Handler context with services
 * @returns Submission result
 *
 * @example
 * ```typescript
 * const result = await submitForm(
 *   {
 *     formSlug: 'contact-form',
 *     data: { name: 'John', email: 'john@example.com', message: 'Hello!' },
 *     metadata: { ipAddress: '127.0.0.1', userAgent: 'Mozilla/5.0...' },
 *   },
 *   { pluginContext, pluginConfig }
 * );
 *
 * if (result.success) {
 *   console.log('Submission created:', result.submission?.id);
 *   if (result.redirect) {
 *     // Redirect user
 *   }
 * } else {
 *   console.error('Submission failed:', result.error);
 * }
 * ```
 */
export async function submitForm(
  options: SubmitFormOptions,
  context: SubmitFormContext
): Promise<SubmitFormResult> {
  const { formSlug, data, metadata } = options;
  const { pluginContext, pluginConfig } = context;
  const { collections } = pluginContext.services;
  const { logger } = pluginContext.infra;

  try {
    // 1. Fetch form configuration
    const form = await fetchFormBySlug(formSlug, pluginConfig, pluginContext);

    if (!form) {
      logger.warn?.("Form submission attempted for non-existent form", {
        formSlug,
      });
      return {
        success: false,
        error: "Form not found",
      };
    }

    // 2. Check form status
    if (form.status !== "published") {
      logger.info?.("Form submission rejected - form not published", {
        formSlug,
        status: form.status,
      });
      return {
        success: false,
        error: "This form is not currently accepting submissions",
      };
    }

    // 3. Transform and validate submission data
    const transformedData = transformFormData(data, form.fields);
    const schema = generateZodSchema(form.fields);
    const validationResult = schema.safeParse(transformedData);

    if (!validationResult.success) {
      const validationErrors = getValidationErrors(validationResult);
      logger.debug?.("Form validation failed", {
        formSlug,
        errors: validationErrors,
      });
      return {
        success: false,
        error: "Validation failed",
        validationErrors,
      };
    }

    // 3b. Sanitize validated submission data (strip HTML from free-text fields)
    sanitizeSubmissionData(
      validationResult.data as Record<string, unknown>,
      form.fields
    );

    // 4. Spam detection
    const spamResult = await checkSpam({
      data: transformedData,
      ipAddress: metadata?.ipAddress,
      formSlug,
      config: {
        honeypot: pluginConfig.spamProtection.honeypot,
        rateLimit: pluginConfig.spamProtection.rateLimit,
        recaptcha: pluginConfig.spamProtection.recaptcha,
      },
    });

    if (spamResult.isSpam) {
      // Silently reject spam - return fake success to avoid tipping off bots
      logger.info?.("Spam submission detected and rejected", {
        formSlug,
        reason: spamResult.reason,
        ipAddress: metadata?.ipAddress,
      });

      // Return fake success (don't tell spammers their submission was rejected)
      return {
        success: true,
      };
    }

    // 5. Create submission record
    const submissionData = {
      form: form.id,
      data: validationResult.data,
      status: "new" as const,
      ipAddress: metadata?.ipAddress || null,
      userAgent: metadata?.userAgent || null,
      submittedAt: new Date(),
    };

    const submission = await collections.createEntry(
      pluginConfig.formSubmissionOverrides.slug,
      submissionData,
      {} // Empty context - submission creation is public
    );

    logger.info?.("Form submission created successfully", {
      formSlug,
      submissionId: submission.id,
    });

    // Email notifications are sent via the afterCreate hook registered in
    // plugin.ts init(), so they fire for all submission paths (HTTP + direct).

    // 6. Determine redirect URL
    const redirect = determineRedirectUrl(form);

    return {
      success: true,
      submission: submission as unknown as SubmissionDocument,
      redirect,
    };
  } catch (error) {
    logger.error?.("Form submission error", {
      formSlug,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      error: "An error occurred processing your submission. Please try again.",
    };
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Fetch a form by its slug.
 *
 * Uses listEntries and filters by slug client-side.
 * Note: For production with large numbers of forms, consider using
 * direct database queries with WHERE clause support.
 *
 * @param slug - Form slug
 * @param pluginConfig - Plugin configuration
 * @param pluginContext - Plugin context
 * @returns Form document or null if not found
 */
async function fetchFormBySlug(
  slug: string,
  pluginConfig: ResolvedFormBuilderConfig,
  pluginContext: PluginContext
): Promise<FormDocument | null> {
  try {
    const { collections } = pluginContext.services;

    // List all forms and filter by slug
    // Note: This approach works for small-medium form counts.
    // For large-scale deployments, use direct database queries.
    const result = await collections.listEntries(
      pluginConfig.formOverrides.slug,
      {
        pagination: { limit: 100 }, // Fetch enough to find the form
      },
      {} // Empty context for public access
    );

    if (!result.data || result.data.length === 0) {
      return null;
    }

    // Find form by slug
    const form = result.data.find(
      (entry: unknown) => (entry as FormDocument).slug === slug
    );

    return form ? (form as unknown as FormDocument) : null;
  } catch {
    return null;
  }
}

/**
 * Determine the redirect URL based on form settings.
 *
 * @param form - Form document
 * @returns Redirect URL or undefined
 */
function determineRedirectUrl(form: FormDocument): string | undefined {
  if (!form.settings) {
    return undefined;
  }

  // Check confirmation type
  if (form.settings.confirmationType !== "redirect") {
    return undefined;
  }

  // Direct URL redirect
  if (form.settings.redirectUrl) {
    return form.settings.redirectUrl;
  }

  // Relationship-based redirect (requires additional lookup)
  // Note: For relationship redirects, the admin UI should resolve
  // the URL before saving to redirectUrl, or the frontend should
  // handle the relationship lookup.
  if (form.settings.redirectRelation) {
    // Return a placeholder that the frontend can resolve
    // Format: relationship://{collection}/{id}
    const { relationTo, value } = form.settings.redirectRelation;
    return `relationship://${relationTo}/${value}`;
  }

  return undefined;
}

// ============================================================
// Validation-Only Function
// ============================================================

/**
 * Validate form data without creating a submission.
 *
 * Useful for real-time validation in the frontend.
 *
 * @param formSlug - Form slug
 * @param data - Form data to validate
 * @param context - Handler context
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = await validateSubmission(
 *   'contact-form',
 *   { name: 'John', email: 'invalid-email' },
 *   { pluginContext, pluginConfig }
 * );
 *
 * if (!result.valid) {
 *   console.log('Validation errors:', result.errors);
 * }
 * ```
 */
export async function validateSubmission(
  formSlug: string,
  data: Record<string, unknown>,
  context: SubmitFormContext
): Promise<{ valid: boolean; errors?: Record<string, string> }> {
  const { pluginContext, pluginConfig } = context;

  // Fetch form
  const form = await fetchFormBySlug(formSlug, pluginConfig, pluginContext);

  if (!form) {
    return { valid: false, errors: { _form: "Form not found" } };
  }

  // Transform and validate
  const transformedData = transformFormData(data, form.fields);
  const schema = generateZodSchema(form.fields);
  const result = schema.safeParse(transformedData);

  if (result.success) {
    return { valid: true };
  }

  return {
    valid: false,
    errors: getValidationErrors(result),
  };
}

// ============================================================
// Form Status Check
// ============================================================

/**
 * Check if a form is accepting submissions.
 *
 * @param formSlug - Form slug
 * @param context - Handler context
 * @returns Whether the form accepts submissions
 */
export async function isFormAcceptingSubmissions(
  formSlug: string,
  context: SubmitFormContext
): Promise<boolean> {
  const { pluginContext, pluginConfig } = context;

  const form = await fetchFormBySlug(formSlug, pluginConfig, pluginContext);

  if (!form) {
    return false;
  }

  return form.status === "published";
}

// ============================================================
// Submission Data Sanitization
// ============================================================

/**
 * Form field types that accept free-text string input from end users.
 * These fields can contain HTML injection vectors and must be sanitized.
 *
 * Fields NOT in this set (select, radio, checkbox, number, date, time, file)
 * are constrained by Zod enum/type validation and don't need sanitization.
 */
const TEXT_FORM_FIELDS = new Set([
  "text",
  "email",
  "textarea",
  "phone",
  "url",
  "hidden",
]);

/**
 * Remove all HTML tags from a string, collapse whitespace, and trim.
 *
 * Uses a regex that matches both complete tags (`<b>`) and unclosed tags
 * at end-of-string (`<script`) to prevent browsers from interpreting
 * incomplete markup.
 */
function stripHtmlTags(input: string): string {
  return input
    .replace(/<[^>]*(?:>|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sanitize form submission data by stripping HTML tags from free-text fields.
 *
 * Iterates over the form's field definitions and applies `stripHtmlTags()`
 * to values whose field type is in `TEXT_FORM_FIELDS`. Non-string values
 * and constrained fields (select, radio, checkbox, etc.) are left unchanged.
 *
 * Mutates the data object in place for efficiency.
 *
 * @param data - Validated submission data (mutated in place)
 * @param fields - Form field definitions (used for type-aware dispatch)
 */
function sanitizeSubmissionData(
  data: Record<string, unknown>,
  fields: FormField[]
): void {
  for (const field of fields) {
    if (!TEXT_FORM_FIELDS.has(field.type)) continue;

    const value = data[field.name];
    if (typeof value !== "string") continue;

    data[field.name] = stripHtmlTags(value);
  }
}

// ============================================================
// Bulk Operations (Admin)
// ============================================================

/**
 * Get submission statistics for a form.
 *
 * Note: This function uses client-side filtering which works for
 * small-medium submission counts. For large-scale deployments,
 * consider using direct database queries with COUNT aggregation.
 *
 * @param formSlug - Form slug
 * @param context - Handler context
 * @returns Submission statistics
 */
export async function getFormSubmissionStats(
  formSlug: string,
  context: SubmitFormContext
): Promise<{
  total: number;
  new: number;
  read: number;
  archived: number;
} | null> {
  const { pluginContext, pluginConfig } = context;
  const { collections } = pluginContext.services;

  // Get form ID
  const form = await fetchFormBySlug(formSlug, pluginConfig, pluginContext);
  if (!form) {
    return null;
  }

  try {
    // Fetch all submissions for this form
    // Note: For large-scale use, implement pagination or direct DB queries
    const result = await collections.listEntries(
      pluginConfig.formSubmissionOverrides.slug,
      {
        pagination: { limit: 1000 }, // Reasonable limit for stats
      },
      {}
    );

    if (!result.data) {
      return { total: 0, new: 0, read: 0, archived: 0 };
    }

    // Filter submissions for this form and count by status
    const submissions = result.data.filter(
      (entry: unknown) => (entry as { form: string }).form === form.id
    );

    const stats = {
      total: submissions.length,
      new: 0,
      read: 0,
      archived: 0,
    };

    for (const sub of submissions) {
      const status = (sub as unknown as { status: string }).status;
      if (status === "new") stats.new++;
      else if (status === "read") stats.read++;
      else if (status === "archived") stats.archived++;
    }

    return stats;
  } catch {
    return null;
  }
}
