/**
 * Scheduling one document to go live, as rules without React: when the
 * editor's "Schedule publish…" is usable, what the release it makes is
 * called, and what is wrong with a time someone picked.
 *
 * Scheduling in Nextly is a release. A document scheduled from its editor
 * goes into a release holding only it, at the chosen time, so the same
 * scheduler runs it and the same banner and list show it as any release.
 *
 * @module components/features/releases/schedule-publish
 */
import { wallTimeIn } from "./release-timezone";

/** The action's id in the editor's action model. */
export const SCHEDULE_PUBLISH_ACTION_ID = "schedule-publish";

/** What the action says: it opens a dialog, so it ends in an ellipsis. */
export const SCHEDULE_PUBLISH_LABEL = "Schedule publish…";

/**
 * Why scheduling is refused for THIS person and document, or undefined when
 * it is not.
 *
 * Order matters: the reason someone could act on last. Permission over
 * releases comes first, since switching language would not help a person who
 * may not schedule at all.
 */
export function schedulePublishRefusal(facts: {
  /** May create a release and schedule it: the two the server asks. */
  canSchedule: boolean;
  /** May publish this document, which the release does for them later. */
  canPublish: boolean;
  onDefaultLocale: boolean;
}): string | undefined {
  if (!facts.canSchedule) {
    return "You do not have permission to schedule releases.";
  }
  if (!facts.canPublish) {
    return "You do not have permission to publish this document.";
  }
  /*
   * A release publishes the whole document, so scheduling from a translation
   * would put every language live while the screen is about one of them.
   * The same rule, in the same words, as Add to release beside it.
   */
  if (!facts.onDefaultLocale) {
    return "Schedule publishing from the document's default locale.";
  }
  return undefined;
}

/** The longest release name the server takes. */
const MAX_RELEASE_TITLE_LENGTH = 255;

/**
 * The name of the release a scheduled document goes into: the document's
 * own title, which is what the releases list and calendar then show beside
 * their "Single document" mark.
 */
export function scheduledReleaseTitle(
  documentTitle: string | undefined
): string {
  const title = documentTitle?.trim() || "Untitled";
  return title.length <= MAX_RELEASE_TITLE_LENGTH
    ? title
    : `${title.slice(0, MAX_RELEASE_TITLE_LENGTH - 1)}…`;
}

/**
 * The time the dialog opens on: nine in the morning, tomorrow, on the clock
 * of `zone`. A sensible first answer, read back in words before anything is
 * sent, rather than an empty box to fill.
 */
export function defaultScheduleWall(now: number, zone: string): string {
  const tomorrow = wallTimeIn(new Date(now + 86_400_000), zone);
  return `${tomorrow.slice(0, 10)}T09:00`;
}

/** What is wrong with the chosen time, or `null` when it can be sent. */
export type ScheduleTimeProblem = "missing" | "no-such-time" | "passed";

/**
 * What stops a chosen time being scheduled, given the instant it resolved
 * to (`null` where the zone has no such time, as on a spring-forward night).
 *
 * A passed time is refused rather than warned about: the server refuses it
 * too, and a document meant to go live now has Publish beside this.
 */
export function scheduleTimeProblem(
  wall: string,
  instant: string | null,
  now: number
): ScheduleTimeProblem | null {
  if (wall === "") return "missing";
  if (instant === null) return "no-such-time";
  return new Date(instant).getTime() <= now ? "passed" : null;
}

/** Each problem in words, as the dialog says it. */
export function scheduleTimeProblemText(
  problem: ScheduleTimeProblem,
  zone: string
): string {
  switch (problem) {
    case "missing":
      return "Choose a date and time.";
    case "no-such-time":
      return `That time doesn't exist in ${zone} on that date: the clocks go forward past it. Pick a time before or after.`;
    case "passed":
      return "That time has already passed. Pick a later one, or use Publish to publish now.";
  }
}
