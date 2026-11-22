/**
 * What sends each email template, as settings say it.
 *
 * A template's owner says what sends it (`sentBy`). The site's own settings
 * send templates too: a form's notification rule names one by slug, and so
 * may any plugin's settings. Those report through the
 * `email.templateReferences` seam, each handler appending the references its
 * plugin's settings make.
 *
 * Each handler is run here, one at a time, rather than through
 * `applyFilters`, which logs and skips a handler that throws. Skipped, a
 * failed plugin would read as "nothing sends this", and a template a form
 * still uses could be deleted on that word. Run one at a time, a failure is
 * known, and the answer says the references could not all be checked.
 *
 * @module domains/email/template-references
 */
import { getFilterRegistry } from "../../filters/filter-registry";
import {
  FilterSeams,
  type EmailTemplateReference,
  type EmailTemplateReferencesContext,
} from "../../filters/seams";

/** The references found, and whether every handler answered. */
export interface TemplateReferences {
  references: EmailTemplateReference[];
  /** False when a handler threw or answered with something else than a list. */
  complete: boolean;
}

/** A reference as the seam promises it; anything else from a plugin is dropped. */
function isReference(value: unknown): value is EmailTemplateReference {
  const candidate = value as Partial<EmailTemplateReference> | null;
  return (
    typeof candidate?.slug === "string" &&
    typeof candidate.label === "string" &&
    candidate.label.trim() !== ""
  );
}

/**
 * Every reference the site's settings make to email templates, or only those
 * to `slug`.
 *
 * @param log - Told about a handler that failed, for the server log.
 */
export async function collectTemplateReferences(
  context: EmailTemplateReferencesContext = {},
  log?: (error: unknown) => void
): Promise<TemplateReferences> {
  const handlers = getFilterRegistry().handlersFor(
    FilterSeams.EmailTemplateReferences
  );
  const references: EmailTemplateReference[] = [];
  let complete = true;
  for (const handler of handlers) {
    try {
      const answer: unknown = await handler([], context);
      if (!Array.isArray(answer)) {
        complete = false;
        continue;
      }
      references.push(...answer.filter(isReference));
    } catch (error) {
      complete = false;
      log?.(error);
    }
  }
  return {
    references: context.slug
      ? references.filter(reference => reference.slug === context.slug)
      : references,
    complete,
  };
}

/** What sends one template: what its owner says, and what settings say. */
export interface TemplateSenders {
  /** As its owner declares it. */
  declared: string[];
  /** The settings that send it, such as a form's notification rules. */
  referenced: string[];
}

/** The senders of each slug, from the owner's word and the references. */
export function sendersBySlug(
  slugs: readonly string[],
  ownerSentBy: (slug: string) => string[],
  references: readonly EmailTemplateReference[]
): Map<string, TemplateSenders> {
  const senders = new Map<string, TemplateSenders>();
  for (const slug of slugs) {
    senders.set(slug, { declared: ownerSentBy(slug), referenced: [] });
  }
  for (const reference of references) {
    const entry = senders.get(reference.slug);
    if (entry && !entry.referenced.includes(reference.label)) {
      entry.referenced.push(reference.label);
    }
  }
  return senders;
}
