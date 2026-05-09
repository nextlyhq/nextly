/**
 * Form Configuration Defaults
 *
 * Applies default values to form configurations, ensuring all required
 * properties have sensible defaults while preserving user-specified values.
 *
 * @module config/defaults
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { applyFormDefaults } from '@nextly/plugin-form-builder';
 *
 * const config = {
 *   slug: 'contact-form',
 *   fields: [
 *     { type: 'text', name: 'name', label: 'Name' },
 *     { type: 'email', name: 'email', label: 'Email' },
 *   ],
 * };
 *
 * const configWithDefaults = applyFormDefaults(config);
 * // configWithDefaults now has labels, settings, etc. with defaults applied
 * ```
 */

import type { FormConfig, FormSettings, FormNotifications } from "../types";

// ============================================================
// Default Values
// ============================================================

/**
 * Default form settings.
 */
export const DEFAULT_FORM_SETTINGS: Required<
  Pick<
    FormSettings,
    | "submitButtonText"
    | "confirmationType"
    | "successMessage"
    | "allowMultipleSubmissions"
  >
> = {
  submitButtonText: "Submit",
  confirmationType: "message",
  successMessage: "Thank you for your submission!",
  allowMultipleSubmissions: true,
};

/**
 * Default notification settings.
 */
export const DEFAULT_NOTIFICATION_SETTINGS: Pick<
  FormNotifications,
  "enabled" | "replyTo"
> = {
  enabled: true,
  replyTo: true,
};

// ============================================================
// Helper Functions
// ============================================================

/**
 * Converts a slug to title case.
 *
 * @param str - The slug string to convert
 * @returns Title case string
 *
 * @example
 * ```typescript
 * toTitleCase('contact-form'); // 'Contact Form'
 * toTitleCase('newsletter_signup'); // 'Newsletter Signup'
 * ```
 */
export function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Generates a plural form from a singular label.
 * Handles common English pluralization rules.
 *
 * @param singular - The singular form
 * @returns The plural form
 *
 * @example
 * ```typescript
 * pluralize('Form'); // 'Forms'
 * pluralize('Category'); // 'Categories'
 * pluralize('Quiz'); // 'Quizzes'
 * ```
 */
export function pluralize(singular: string): string {
  if (singular.endsWith("y") && !/[aeiou]y$/i.test(singular)) {
    return singular.slice(0, -1) + "ies";
  }
  if (
    singular.endsWith("s") ||
    singular.endsWith("x") ||
    singular.endsWith("z") ||
    singular.endsWith("ch") ||
    singular.endsWith("sh")
  ) {
    return singular + "es";
  }
  return singular + "s";
}

// ============================================================
// Main Default Application Function
// ============================================================

/**
 * Apply default values to form configuration.
 *
 * This function takes a partial form configuration and returns a complete
 * configuration with all default values applied. User-specified values
 * are preserved and take precedence over defaults.
 *
 * @param config - Form configuration (may be partial)
 * @returns Configuration with defaults applied
 *
 * @example
 * ```typescript
 * import { applyFormDefaults } from '@nextly/plugin-form-builder';
 *
 * const config = {
 *   slug: 'contact-form',
 *   fields: [
 *     { type: 'text', name: 'name', label: 'Name' },
 *     { type: 'email', name: 'email', label: 'Email' },
 *   ],
 * };
 *
 * const result = applyFormDefaults(config);
 *
 * // Result:
 * // {
 * //   slug: 'contact-form',
 * //   labels: { singular: 'Contact Form', plural: 'Contact Forms' },
 * //   fields: [...],
 * //   settings: {
 * //     submitButtonText: 'Submit',
 * //     confirmationType: 'message',
 * //     successMessage: 'Thank you for your submission!',
 * //     allowMultipleSubmissions: true,
 * //   },
 * //   access: {
 * //     submit: () => true,
 * //     read: ({ req }) => !!req.user,
 * //   },
 * // }
 * ```
 */
export function applyFormDefaults(config: FormConfig): FormConfig {
  // Generate singular label from slug if not provided
  const singularLabel = config.labels?.singular || toTitleCase(config.slug);

  return {
    ...config,

    // Generate labels from slug if not provided
    labels: {
      singular: singularLabel,
      plural: config.labels?.plural || pluralize(singularLabel),
    },

    // Apply settings defaults
    settings: {
      submitButtonText:
        config.settings?.submitButtonText ||
        DEFAULT_FORM_SETTINGS.submitButtonText,
      confirmationType:
        config.settings?.confirmationType ||
        DEFAULT_FORM_SETTINGS.confirmationType,
      successMessage:
        config.settings?.successMessage || DEFAULT_FORM_SETTINGS.successMessage,
      allowMultipleSubmissions:
        config.settings?.allowMultipleSubmissions ??
        DEFAULT_FORM_SETTINGS.allowMultipleSubmissions,
      // Preserve other settings that don't have defaults
      redirectUrl: config.settings?.redirectUrl,
      redirectRelation: config.settings?.redirectRelation,
      captcha: config.settings?.captcha,
    },

    // Apply notification defaults if notifications are configured
    notifications: config.notifications
      ? {
          enabled:
            config.notifications.enabled ??
            DEFAULT_NOTIFICATION_SETTINGS.enabled,
          recipients: config.notifications.recipients || [],
          subject:
            config.notifications.subject ||
            `New submission for ${singularLabel}`,
          replyTo:
            config.notifications.replyTo ??
            DEFAULT_NOTIFICATION_SETTINGS.replyTo,
          template: config.notifications.template,
        }
      : undefined,

    // Apply access defaults
    access: {
      // Default: anyone can submit the form
      submit: config.access?.submit || (() => true),
      // Default: only authenticated users can view submissions
      read: config.access?.read || (({ req }) => !!req.user),
    },
  };
}

/**
 * Apply default values to individual form field.
 *
 * This is a utility function for applying defaults to a single field,
 * useful when processing fields individually (e.g., in the Schema Builder).
 *
 * @param field - The field to apply defaults to
 * @returns Field with defaults applied
 *
 * @example
 * ```typescript
 * import { applyFieldDefaults } from '@nextly/plugin-form-builder';
 *
 * const field = { type: 'text', name: 'firstName' };
 * const fieldWithDefaults = applyFieldDefaults(field);
 * // { type: 'text', name: 'firstName', label: 'First Name', required: false }
 * ```
 */
export function applyFieldDefaults<
  T extends { type: string; name?: string; label?: string; required?: boolean },
>(field: T): T {
  // Generate label from name if not provided
  const label =
    field.label ||
    (field.name
      ? toTitleCase(field.name.replace(/([A-Z])/g, " $1").trim())
      : "");

  return {
    ...field,
    label,
    required: field.required ?? false,
  };
}

/**
 * Creates a complete form config with minimal input.
 *
 * This is a convenience function for quickly creating form configs
 * with sensible defaults. Only the slug and fields are required.
 *
 * @param slug - The form slug
 * @param fields - Array of form fields
 * @param options - Optional additional configuration
 * @returns Complete form configuration
 *
 * @example
 * ```typescript
 * import { createFormConfig } from '@nextly/plugin-form-builder';
 *
 * const config = createFormConfig('contact', [
 *   { type: 'text', name: 'name', label: 'Name', required: true },
 *   { type: 'email', name: 'email', label: 'Email', required: true },
 *   { type: 'textarea', name: 'message', label: 'Message' },
 * ]);
 * ```
 */
export function createFormConfig(
  slug: string,
  fields: FormConfig["fields"],
  options?: Partial<Omit<FormConfig, "slug" | "fields">>
): FormConfig {
  return applyFormDefaults({
    slug,
    fields,
    ...options,
  });
}
