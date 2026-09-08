/**
 * The email template editor.
 *
 * Re-exported here so the two route files keep importing from the specifier
 * they always used: this was one 1878-line module and is now a directory, and
 * a barrel is what makes that a refactor rather than a change to every caller.
 *
 * Only what those routes actually consume is published. The regions are
 * internal — a caller reaching past this barrel into `SettingsRail` would be
 * depending on an arrangement the shell adoption is about to change — and an
 * export nothing imports is a claim about a consumer that does not exist.
 */
export { EmailTemplateForm } from "./EmailTemplateForm";
export {
  formValuesToCreatePayload,
  formValuesToUpdatePayload,
  templateToFormValues,
  type TemplateFormValues,
} from "./schema";
