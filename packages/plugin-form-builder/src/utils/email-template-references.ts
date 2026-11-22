/**
 * The email templates forms send, as core asks for them.
 *
 * A form's notification rule names a template by slug. Core shows each
 * template's senders, and names them before the template is deleted, through
 * its `email.templateReferences` seam: this answers for the forms. A rule
 * that is switched off, or names no template, sends nothing and is left out.
 */
import type { FormNotification } from "../types";

/** One setting that sends a template, as core's seam takes it. */
export interface TemplateReference {
  slug: string;
  label: string;
}

/** A form as the collection hands it back: loose, so read with care. */
interface StoredForm {
  name?: unknown;
  notifications?: unknown;
}

/** The rules of a form, whether stored parsed or as JSON text. */
function rulesOf(form: StoredForm): unknown[] {
  let rules = form.notifications;
  if (typeof rules === "string") {
    try {
      rules = JSON.parse(rules);
    } catch {
      return [];
    }
  }
  return Array.isArray(rules) ? rules : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * The templates these forms' notification rules send, each labelled with
 * the form and the rule: "Form: Contact us, Notify team".
 */
export function formTemplateReferences(
  forms: readonly StoredForm[]
): TemplateReference[] {
  const references: TemplateReference[] = [];
  for (const form of forms) {
    const formName = text(form.name) ?? "Untitled form";
    for (const rule of rulesOf(form)) {
      if (!rule || typeof rule !== "object") continue;
      const { enabled, templateSlug, name } = rule as Partial<FormNotification>;
      const slug = text(templateSlug);
      if (enabled === false || !slug) continue;
      const ruleName = text(name);
      references.push({
        slug,
        label: ruleName
          ? `Form: ${formName}, ${ruleName}`
          : `Form: ${formName}`,
      });
    }
  }
  return references;
}
