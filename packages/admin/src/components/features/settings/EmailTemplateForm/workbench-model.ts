/**
 * What the workbench decides apart from how it is drawn: which arrangement a
 * width gets, and which parts of a template the site may change right now.
 *
 * @module components/features/settings/EmailTemplateForm/workbench-model
 */

import { ownerGroupOf } from "@admin/components/features/email-hub/messages/messages-model";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

/**
 * The three arrangements, by the workbench's own width (not the window's: the
 * admin's navigation takes part of the window).
 *
 * - `desktop`: the content column and the preview side by side, resizable,
 *   with the side sheet as a third column when it is open.
 * - `tablet`: two equal panes; an open sheet takes the content column's place
 *   beside the preview, so the preview is never covered.
 * - `phone`: one pane at a time behind four tabs, with Save and Send test in a
 *   bar fixed to the bottom.
 */
export type WorkbenchTier = "phone" | "tablet" | "desktop";

/** Below this width the workbench is a phone's. */
export const PHONE_BELOW = 640;
/** Below this width (and from `PHONE_BELOW`) it is a tablet's. */
export const DESKTOP_FROM = 1180;

/**
 * The arrangement for a measured width. Unmeasured (`null`: before the first
 * layout, or in a test without layout) is the desktop's, the arrangement that
 * shows every region.
 */
export function tierFor(width: number | null): WorkbenchTier {
  if (width === null) return "desktop";
  if (width < PHONE_BELOW) return "phone";
  if (width < DESKTOP_FROM) return "tablet";
  return "desktop";
}

/**
 * Whether the site may change the parts an owner versions: the subject, the
 * preview text, both bodies, and what the owner says about the template (its
 * description and declared variables).
 *
 * The site's own templates, an override, and the template of a plugin that is
 * no longer installed are the site's. Core's and an installed plugin's are
 * their owner's until the site overrides them. A new template is the site's.
 *
 * Everything else (name, layout, provider, sending, From, Reply-To, copies,
 * attachments) is the site's setting on any template, so it stays editable,
 * and saving it doesn't override anything.
 */
export function ownsContent(record: EmailTemplateRecord | undefined): boolean {
  if (!record) return true;
  if (record.overridden) return true;
  switch (record.owner.kind) {
    case "site":
      return true;
    case "plugin":
      return !record.owner.installed;
    case "core":
      return false;
  }
}

/** The owner's name as a person reads it: "Nextly", a plugin's, "This site". */
export function ownerName(record: EmailTemplateRecord): string {
  return ownerGroupOf(record.owner).label;
}
