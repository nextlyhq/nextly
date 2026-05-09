/**
 * Template Attachment Merge
 *
 * Merges template-default attachments with per-send attachments at the
 * point where `EmailService.sendWithTemplate()` hands off to the
 * resolver. Pure function — no I/O — so it's trivially testable.
 *
 * Merge rules:
 *   1. Start with template defaults in their original order.
 *   2. When a per-send attachment shares a `mediaId` with a default,
 *      the per-send entry wins (useful for overriding the default's
 *      `filename`).
 *   3. Any per-send attachments not present in the defaults are
 *      appended in call order.
 *
 * The combined list is then validated against the same count/size
 * caps as a per-send call — no bypass of limits via templates.
 *
 * @module domains/email/services/template-attachment-merge
 */

import type { EmailAttachmentInput } from "../types";

export function mergeTemplateAttachments(
  templateDefaults: EmailAttachmentInput[] | null | undefined,
  callAttachments: EmailAttachmentInput[] | null | undefined
): EmailAttachmentInput[] {
  const defaults = templateDefaults ?? [];
  const calls = callAttachments ?? [];
  if (defaults.length === 0 && calls.length === 0) return [];

  const callByMediaId = new Map(calls.map((a) => [a.mediaId, a]));
  const merged: EmailAttachmentInput[] = [];
  const seen = new Set<string>();

  for (const d of defaults) {
    const winner = callByMediaId.get(d.mediaId) ?? d;
    merged.push(winner);
    seen.add(d.mediaId);
  }
  for (const c of calls) {
    if (!seen.has(c.mediaId)) {
      merged.push(c);
    }
  }
  return merged;
}
