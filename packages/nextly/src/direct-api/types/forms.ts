/**
 * Direct API Forms Type Definitions
 *
 * Configuration and argument types for the `nextly.forms.*` namespace.
 *
 * @packageDocumentation
 */

import type { DirectAPIConfig } from "./shared";

/**
 * Configuration for the forms API namespace.
 *
 * Allows overriding the default collection slugs used by the form builder plugin.
 * If the plugin uses custom collection slugs, provide them here.
 *
 * @example
 * ```typescript
 * const nextly = new Nextly({
 *   forms: {
 *     collectionSlug: 'contact-forms',
 *     submissionCollectionSlug: 'contact-responses',
 *   },
 * });
 * ```
 */
export interface FormsConfig {
  /**
   * Slug of the forms collection.
   *
   * Must match the `formOverrides.slug` in your form builder plugin config.
   *
   * @default "forms"
   */
  collectionSlug?: string;

  /**
   * Slug of the form submissions collection.
   *
   * Must match the `formSubmissionOverrides.slug` in your form builder plugin config.
   *
   * @default "form-submissions"
   */
  submissionCollectionSlug?: string;
}

/**
 * Arguments for finding published forms.
 *
 * @example
 * ```typescript
 * // List all published forms
 * const forms = await nextly.forms.find({ status: 'published' });
 *
 * // List with pagination
 * const forms = await nextly.forms.find({ limit: 10, page: 1 });
 * ```
 */
export interface FindFormsArgs extends DirectAPIConfig {
  /** Filter by form status */
  status?: "published" | "draft" | "closed";

  /** Search by form name */
  search?: string;

  /** Maximum number of forms to return */
  limit?: number;

  /** Page number */
  page?: number;
}

/**
 * Arguments for finding a form by slug.
 *
 * @example
 * ```typescript
 * const form = await nextly.forms.findBySlug({ slug: 'contact-form' });
 * ```
 */
export interface FindFormBySlugArgs extends DirectAPIConfig {
  /** Form slug (required) */
  slug: string;
}

/**
 * Arguments for submitting a form.
 *
 * This performs a basic submission flow:
 * 1. Fetches the form by slug
 * 2. Verifies the form is published
 * 3. Creates a submission record
 *
 * For advanced features (spam detection, Zod validation, webhooks),
 * use the form builder plugin's `submitForm()` handler directly.
 *
 * @example
 * ```typescript
 * const result = await nextly.forms.submit({
 *   form: 'contact-form',
 *   data: {
 *     name: 'John Doe',
 *     email: 'john@example.com',
 *     message: 'Hello!',
 *   },
 * });
 *
 * if (result.success) {
 *   console.log('Submission created:', result.submission.id);
 * }
 * ```
 */
export interface SubmitFormArgs extends DirectAPIConfig {
  /** Form slug (required) */
  form: string;

  /** Form submission data (required) */
  data: Record<string, unknown>;

  /**
   * Optional metadata about the submission.
   *
   * Useful for tracking IP addresses and user agents
   * when processing submissions server-side.
   */
  metadata?: {
    /** Submitter's IP address */
    ipAddress?: string;
    /** Submitter's user agent string */
    userAgent?: string;
  };
}

/**
 * Result of a form submission.
 */
export interface SubmitFormResult {
  /** Whether the submission was successful */
  success: boolean;

  /** The created submission record (on success) */
  submission?: Record<string, unknown>;

  /** Error message (on failure) */
  error?: string;

  /** Redirect URL (if form configured for redirect on success) */
  redirect?: string;
}

/**
 * Arguments for retrieving form submissions.
 *
 * @example
 * ```typescript
 * // Get submissions for a form
 * const result = await nextly.forms.submissions({
 *   form: 'contact-form',
 *   limit: 20,
 *   page: 1,
 * });
 *
 * console.log(result.items);      // Submission records
 * console.log(result.meta.total); // Total count
 * ```
 */
export interface FormSubmissionsArgs extends DirectAPIConfig {
  /** Form slug or ID (required) */
  form: string;

  /** Maximum number of submissions to return */
  limit?: number;

  /** Page number */
  page?: number;

  /** Sort order (e.g., '-submittedAt' for newest first) */
  sort?: string;
}
