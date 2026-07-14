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

import type { EmailTemplateInsert } from "../../../../schemas/email-templates/types";

// Re-import for array construction
import { defaultLayoutTemplate } from "./default-layout";
import { emailVerificationTemplate } from "./email-verification";
import { passwordResetTemplate } from "./password-reset";
import { welcomeTemplate } from "./welcome";

export {
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
export const BUILT_IN_TEMPLATES: EmailTemplateInsert[] = [
  defaultLayoutTemplate,
  welcomeTemplate,
  passwordResetTemplate,
  emailVerificationTemplate,
];
