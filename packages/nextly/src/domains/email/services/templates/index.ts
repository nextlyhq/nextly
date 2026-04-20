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
import { emailVerificationTemplate } from "./email-verification";
import { layoutFooterTemplate } from "./layout-footer";
import { layoutHeaderTemplate } from "./layout-header";
import { passwordResetTemplate } from "./password-reset";
import { welcomeTemplate } from "./welcome";

export { emailVerificationTemplate } from "./email-verification";
export { layoutFooterTemplate } from "./layout-footer";
export { layoutHeaderTemplate } from "./layout-header";
export { passwordResetTemplate } from "./password-reset";
export { welcomeTemplate } from "./welcome";

/**
 * All built-in email templates, ordered for insertion.
 *
 * Layout templates (`_email-header`, `_email-footer`) are listed
 * first so they exist before any body template with `useLayout: true`
 * is previewed.
 */
export const BUILT_IN_TEMPLATES: EmailTemplateInsert[] = [
  layoutHeaderTemplate,
  layoutFooterTemplate,
  welcomeTemplate,
  passwordResetTemplate,
  emailVerificationTemplate,
];
