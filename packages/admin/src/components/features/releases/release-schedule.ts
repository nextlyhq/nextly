/**
 * How a release's schedule is put into words.
 *
 * Kept out of the components because the same sentence appears on the list, on
 * the detail page and — in PR 3b — on the document itself, and three spellings
 * of "goes live Friday at 9am Berlin time" is how they start to disagree.
 *
 * @module components/features/releases/release-schedule
 */

import type { Release, ReleaseState } from "@admin/types/releases";

/** What each state means to an editor, in their words rather than the schema's. */
export const RELEASE_STATE_LABEL: Record<ReleaseState, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  cancelled: "Cancelled",
};

/**
 * The instant, rendered in the ZONE THE AUTHOR CHOSE.
 *
 * Not the reader's zone. A release is a statement about when content goes live,
 * and the author made it in a particular place — "9am Berlin" is the intent, and
 * it survives a daylight-saving boundary where a converted local time does not.
 * A reader in Tokyo needs to know what was promised, not what it happens to be
 * on their clock.
 *
 * The zone is NAMED alongside, because a time without one is exactly the
 * ambiguity this avoids.
 */
export function formatScheduledAt(release: Release): string | null {
  if (!release.scheduledAt) return null;
  const at = new Date(release.scheduledAt);
  if (Number.isNaN(at.getTime())) return null;

  const zone = release.timezone ?? "UTC";
  try {
    const formatted = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone,
    }).format(at);
    return `${formatted} (${zone})`;
  } catch {
    // A zone the platform cannot format is not a reason to show nothing. The
    // route validates zones on the way in, so this is a stored value from
    // before that guard or from another writer — and an editor is better served
    // by the instant in UTC than by a blank where a date should be.
    return `${at.toISOString()} (UTC)`;
  }
}

/**
 * One line saying where this release stands.
 *
 * A release with no instant is not "not scheduled yet" in a vague sense — it is
 * assembled and uncommitted, which is a state an editor can act on.
 */
export function describeRelease(release: Release): string {
  const at = formatScheduledAt(release);
  switch (release.state) {
    case "scheduled":
      return at ? `Goes live ${at}` : "Scheduled";
    case "published":
      return release.publishedAt
        ? `Published ${new Date(release.publishedAt).toLocaleString()}`
        : "Published";
    case "cancelled":
      return "Cancelled — nothing will go live";
    case "draft":
      return "Not scheduled yet";
  }
}
