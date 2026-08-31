/**
 * How a release's schedule is put into words.
 *
 * Kept out of the components because the same sentence belongs on the list, on
 * the detail page and on a document that is scheduled inside a release. Three
 * spellings of "goes live Friday at 9am Berlin time" is how they start to
 * disagree, and a schedule that reads differently in two places is one an
 * editor cannot trust in either.
 *
 * @module components/features/releases/release-schedule
 */

import { formatGlobalDateTime, isValidTimezone } from "@admin/lib/dates/format";
import type { Release, ReleaseState } from "@admin/types/releases";

/** What each state means to an editor, in their words rather than the schema's. */
export const RELEASE_STATE_LABEL: Record<ReleaseState, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  cancelled: "Cancelled",
  blocked: "Blocked",
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
 *
 * Rendered through the admin's own formatter so an installation's configured
 * date and time format still applies; only the ZONE is overridden here, which
 * is the one part of the presentation the release itself decides. A second
 * `Intl.DateTimeFormat` would ignore those settings and make this the one screen
 * that spells a date differently from every other.
 *
 * The zone is validated before it is NAMED, because the formatter falls back to
 * the reader's own zone for one it cannot use — sensible for rendering, and a
 * lie once a label claims the time is Berlin's.
 */
export function formatScheduledAt(release: Release): string | null {
  if (!release.scheduledAt) return null;
  const at = new Date(release.scheduledAt);
  if (Number.isNaN(at.getTime())) return null;

  const zone = release.timezone ?? "UTC";
  // A zone the platform cannot format is not a reason to show nothing. The
  // route validates zones on the way in, so this is a stored value from before
  // that guard or from another writer — and an editor is better served by the
  // instant in UTC, said so, than by a blank where a date should be.
  const usable = isValidTimezone(zone) ? zone : "UTC";
  const formatted = formatGlobalDateTime(
    at,
    { timeZone: usable, dateStyle: "medium", timeStyle: "short" },
    at.toISOString()
  );
  return `${formatted} (${usable})`;
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
      // The reader's own zone, unlike the schedule above: this is a record of
      // when something happened rather than a promise made from somewhere, so
      // the useful question is "how long ago for me", not "when there".
      return release.publishedAt
        ? `Published ${formatGlobalDateTime(release.publishedAt, {
            dateStyle: "medium",
            timeStyle: "short",
          })}`
        : "Published";
    case "cancelled":
      return "Cancelled — nothing will go live";
    case "blocked":
      // The one state whose name does not carry its consequence. "Blocked"
      // alone reads as a warning; what an operator needs is that this will not
      // happen on its own and that waiting will not help, because the drain has
      // already stopped retrying it.
      return "Blocked — it cannot go live until something is fixed";
    case "draft":
      return "Not scheduled yet";
  }
}
