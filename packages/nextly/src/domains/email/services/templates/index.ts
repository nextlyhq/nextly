/**
 * Built-in Email Template Definitions
 *
 * Exports individual template constants and the combined
 * `BUILT_IN_TEMPLATES` array used by `ensureBuiltInTemplates()`
 * to seed the `email_templates` table on first startup.
 *
 * @module services/email/templates
 * @since 1.0.0
 */

import type { EmailTemplateVersion } from "../../../../schemas/email-templates/types";
import type { OwnerTemplate } from "../../template-ownership";

// Re-import for array construction
import {
  DEFAULT_LAYOUT_BEFORE_BRAND,
  DEFAULT_LAYOUT_SLUG,
  defaultLayoutTemplate,
} from "./default-layout";
import {
  EMAIL_VERIFICATION_BEFORE_BRAND,
  emailVerificationTemplate,
} from "./email-verification";
import {
  PASSWORD_RESET_BEFORE_BRAND,
  passwordResetTemplate,
} from "./password-reset";
import { WELCOME_BEFORE_BRAND, welcomeTemplate } from "./welcome";

export {
  DEFAULT_LAYOUT_BEFORE_BRAND,
  defaultLayoutTemplate,
  DEFAULT_LAYOUT_SLUG,
  LAYOUT_CONTENT_PLACEHOLDER,
} from "./default-layout";
export { emailVerificationTemplate } from "./email-verification";
export { passwordResetTemplate } from "./password-reset";
export { welcomeTemplate } from "./welcome";

/**
 * All built-in email templates, ordered for insertion.
 *
 * The default layout is listed first so it exists before any body
 * template with `useLayout: true` is previewed or sent.
 */
export const BUILT_IN_TEMPLATES: OwnerTemplate[] = [
  defaultLayoutTemplate,
  welcomeTemplate,
  passwordResetTemplate,
  emailVerificationTemplate,
];

/**
 * Versions of the built-ins that core shipped before their current ones, by
 * slug. A stored row still holding one was never edited, so when it is first
 * given its owner it follows core rather than being kept as the site's.
 */
export const EARLIER_BUILT_IN_VERSIONS: Readonly<
  Record<string, ReadonlyArray<EmailTemplateVersion>>
> = {
  [DEFAULT_LAYOUT_SLUG]: [DEFAULT_LAYOUT_BEFORE_BRAND],
  [welcomeTemplate.slug]: [WELCOME_BEFORE_BRAND],
  [passwordResetTemplate.slug]: [PASSWORD_RESET_BEFORE_BRAND],
  [emailVerificationTemplate.slug]: [EMAIL_VERIFICATION_BEFORE_BRAND],
};
