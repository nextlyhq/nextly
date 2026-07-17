/**
 * Form Submission Handler
 *
 * Processes form submissions including validation, spam detection,
 * storage, and notification triggering.
 *
 * @module handlers/submit-form
 * @since 0.1.0
 */

import type { PluginContext } from "nextly";

import type {
  FormDocument,
  SubmissionDocument,
  ResolvedFormBuilderConfig,
  FormField,
} from "../types";
import { normalizeFormSettings } from "../utils/form-settings";
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
  const { logger } = pluginContext;

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

    // 2b. Settings come through the one canonical reader — stored settings
    // may carry legacy keys from earlier builder versions.
    const settings = normalizeFormSettings(form.settings);

    // 2c. Single-submission forms: the same visitor (by IP) submits once.
    // Checked before spam so a repeat visitor gets the honest message
    // instead of an inexplicable success that stored nothing new.
    if (settings.allowMultipleSubmissions === false && metadata?.ipAddress) {
      const existing = await collections.count(
        pluginConfig.formSubmissionOverrides.slug,
        {
          where: {
            form: { equals: form.id },
            ipAddress: { equals: metadata.ipAddress },
            status: { not_equals: "spam" },
          },
        },
        { as: "system" }
      );
      if (existing > 0) {
        logger.info?.("Repeat submission rejected (single-submission form)", {
          formSlug,
          ipAddress: metadata.ipAddress,
        });
        return {
          success: false,
          error: "You have already submitted this form.",
        };
      }
    }

    // 3. Spam detection — BEFORE validation, so a bot that trips the trap
    // while also failing validation still receives the same fake success as
    // any other bot instead of a distinguishable validation error.
    // Honeypot fields are by definition NOT declared form fields, so the
    // probe is the raw payload minus the declared schema — a declared field
    // (e.g. a real "website" input) must never trip the trap.
    const declaredFieldNames = new Set(form.fields.map(field => field.name));
    const undeclaredData = Object.fromEntries(
      Object.entries(data).filter(([key]) => !declaredFieldNames.has(key))
    );

    const spamResult = await checkSpam({
      data: undeclaredData,
      ipAddress: metadata?.ipAddress,
      formSlug,
      config: {
        // Per-form overrides win where set; blank inherits the plugin config.
        honeypot:
          settings.honeypotEnabled ?? pluginConfig.spamProtection.honeypot,
        rateLimit: pluginConfig.spamProtection.rateLimit,
        recaptcha: {
          ...pluginConfig.spamProtection.recaptcha,
          enabled:
            settings.captchaEnabled ??
            pluginConfig.spamProtection.recaptcha?.enabled ??
            false,
        },
      },
    });

    // Rate-limit hits are pure volume — storing them would turn the limiter
    // into a database DoS, so they are rejected without a trace (still with
    // fake success so the client learns nothing).
    if (spamResult.isSpam && spamResult.reason === "rate_limit") {
      logger.info?.("Spam submission rejected (rate limit)", {
        formSlug,
        ipAddress: metadata?.ipAddress,
      });
      return { success: true };
    }

    const isContentSpam = spamResult.isSpam;

    // 4. Transform + validate. Content spam skips validation entirely — it
    // is stored for review exactly as the bot shaped it (declared fields
    // only, sanitized), and requiring validity would drop the evidence.
    const transformedData = transformFormData(data, form.fields);
    let storedData: Record<string, unknown>;

    if (isContentSpam) {
      logger.info?.("Spam submission detected — storing flagged", {
        formSlug,
        reason: spamResult.reason,
        ipAddress: metadata?.ipAddress,
      });
      sanitizeSubmissionData(transformedData, form.fields);
      storedData = transformedData;
    } else {
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

      // Sanitize validated submission data (strip HTML from free-text fields)
      sanitizeSubmissionData(validationResult.data, form.fields);
      storedData = validationResult.data;
    }

    // 5. Create submission record. Content spam (honeypot/recaptcha) is
    // stored FLAGGED, never silently dropped: a false positive stays
    // reviewable in the Spam view and recoverable via "Not spam".
    const submissionData = {
      form: form.id,
      data: storedData,
      status: isContentSpam ? ("spam" as const) : ("new" as const),
      spamReason: isContentSpam ? (spamResult.reason ?? null) : null,
      ipAddress: metadata?.ipAddress || null,
      userAgent: metadata?.userAgent || null,
      submittedAt: new Date(),
    };

    const submission = await collections.createEntry(
      pluginConfig.formSubmissionOverrides.slug,
      submissionData,
      // Public form submission — create as system. No ambient user; an
      // empty context already resolves to system, but be explicit.
      { as: "system" }
    );

    logger.info?.("Form submission created successfully", {
      formSlug,
      submissionId: submission.id,
      flaggedAsSpam: isContentSpam,
    });

    // Email notifications are sent via the afterCreate hook registered in
    // plugin.ts init(), so they fire for all submission paths (HTTP + direct).
    // The hook itself skips spam-flagged rows.

    // 6. Determine redirect URL. Spam gets the same success shape as a real
    // submission (minus the stored row reference) so bots can't diff the two.
    const redirect = determineRedirectUrl(form);

    if (isContentSpam) {
      return { success: true, redirect };
    }

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
 * Fetch a form by its slug via a service-level `where` query.
 *
 * @param slug - Form slug
 * @param pluginConfig - Plugin configuration
 * @param pluginContext - Plugin context
 * @returns Form document or null if not found
 */
export async function fetchFormBySlug(
  slug: string,
  pluginConfig: ResolvedFormBuilderConfig,
  pluginContext: PluginContext
): Promise<FormDocument | null> {
  try {
    const { collections } = pluginContext.services;

    // D56: resolve the form by slug via a service-level `where` query
    // instead of fetching every form and filtering client-side. Forms are
    // public config the plugin owns, so the read runs as system.
    const result = await collections.listEntries(
      pluginConfig.formOverrides.slug,
      { where: { slug: { equals: slug } }, pagination: { limit: 1 } },
      { as: "system" }
    );

    const form = result.data?.[0];
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
    const submissionsSlug = pluginConfig.formSubmissionOverrides.slug;
    const sys = { as: "system" } as const;
    const base = { form: { equals: form.id } };

    // D56: count per status server-side instead of listing every
    // submission and counting client-side. Stats run as system (plugin-owned
    // aggregate over submissions for this form).
    const [total, newCount, read, archived] = await Promise.all([
      collections.count(submissionsSlug, { where: base }, sys),
      collections.count(
        submissionsSlug,
        { where: { ...base, status: { equals: "new" } } },
        sys
      ),
      collections.count(
        submissionsSlug,
        { where: { ...base, status: { equals: "read" } } },
        sys
      ),
      collections.count(
        submissionsSlug,
        { where: { ...base, status: { equals: "archived" } } },
        sys
      ),
    ]);

    return { total, new: newCount, read, archived };
  } catch {
    return null;
  }
}
