/**
 * What an email template mutation records about itself.
 *
 * A template decides what a password-reset or verification message says, and
 * `from_override` decides who it appears to come from — so an actor who can
 * edit one can make Nextly's own mail say something it never said, from an
 * address the operator never configured. Until now that was indistinguishable
 * from no action after the fact: the activity log existed and this domain never
 * wrote to it.
 *
 * **Field NAMES only.** EVERY changed top-level name is recorded, content
 * fields included: `subject` and `htmlContent` are named when they move, because
 * a name is not a value and "the wording changed" is the fact worth keeping.
 * What must never reach the row is anything from INSIDE them — that row is read
 * by more people than can read the template.
 *
 * `fromOverride` and `layoutId` are the highest-signal of those names rather
 * than the only ones: one changes who the mail claims to be from, the other
 * changes the shell every message is rendered into.
 *
 * @module domains/email/template-activity
 */

import type { RequestActor } from "../../auth/request-actor";
import type { ActivityLogAction } from "../../services/dashboard/activity-log-service";
import {
  changedTopLevelFields,
  recordSettingsActivity,
} from "../audit/record-settings-activity";

/**
 * The activity-log `collection` these entries are filed under.
 *
 * Not a content collection, and deliberately distinct from the providers' own:
 * the feed groups by this column, and filing both under one name would render a
 * template edit and a credential change as the same kind of event.
 */
export const EMAIL_TEMPLATE_ACTIVITY_COLLECTION = "email-templates";

/** One recorded template mutation. */
export interface EmailTemplateActivityInput {
  action: ActivityLogAction;
  /** The template row's id. */
  templateId: string;
  /** The template's name at the time of the action, for the feed heading. */
  templateName: string;
  /**
   * `template` or `layout`. Not a secret, and worth reading later: a layout
   * change reaches every message rendered through it, not just one.
   */
  templateKind: string;
  /** Field NAMES the action touched. Never values. */
  changedFields?: ReadonlyArray<string>;
  actor?: RequestActor | null;
}

/**
 * Record one template mutation.
 *
 * Delegates to the shared settings seam, which owns the actor gate, the rule
 * that an update moving nothing produces no entry, and the post-commit write
 * that never throws.
 */
export async function recordTemplateActivity(
  input: EmailTemplateActivityInput
): Promise<void> {
  await recordSettingsActivity({
    action: input.action,
    collection: EMAIL_TEMPLATE_ACTIVITY_COLLECTION,
    entityId: input.templateId,
    entityTitle: input.templateName,
    changedFields: input.changedFields,
    metadata: { templateKind: input.templateKind },
    actor: input.actor,
  });
}

/**
 * The top-level template fields a change touched, as names.
 *
 * Derived from the shared comparison so a template and a provider cannot come
 * to disagree about what counts as a change.
 */
export function changedTemplateFields(
  previous: Record<string, unknown>,
  incoming: Record<string, unknown>
): string[] {
  return changedTopLevelFields(previous, incoming);
}
