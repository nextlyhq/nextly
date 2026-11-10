/**
 * Scheduling one document, as rules without React: when the editor's
 * "Schedule…" is usable, what a release of one is called, what is wrong with a
 * time someone picked, and how a refusal's problems are said.
 *
 * Scheduling in Nextly is a release. A document scheduled from its editor
 * goes into a release holding only it, at the chosen time, so the same
 * scheduler runs it and the same banner and list show it as any release.
 *
 * @module components/features/releases/schedule-publish
 */
import { isApiError } from "@admin/lib/api/parseApiError";
import type {
  HiddenReleaseMembers,
  ReleaseMemberAction,
  ReleaseReadinessFinding,
} from "@admin/types/releases";

import { describeHiddenNeedFix, hiddenTotal } from "./release-hidden";
import { refusalProblemText } from "./release-problems";
import { wallTimeIn } from "./release-timezone";

/** The action's id in the editor's action model. */
export const SCHEDULE_PUBLISH_ACTION_ID = "schedule-publish";

/** What the action says: it opens a dialog, so it ends in an ellipsis. */
export const SCHEDULE_PUBLISH_LABEL = "Schedule…";

/** How a document goes out: on its own, with a release, or in a new one. */
export type ScheduleWay = "own" | "existing" | "new";

/** Why "on its own" is held for a person who may not schedule releases. */
export const OWN_NEEDS_SCHEDULING =
  "Scheduling on its own needs permission to schedule releases.";

/**
 * "Every language moves together: English, Spanish and the shared fields." A
 * release moves the whole document, every language at once.
 */
export function languagesSentence(languages: readonly string[]): string {
  const named =
    languages.length < 2
      ? languages.join("")
      : `${languages.slice(0, -1).join(", ")} and ${languages[languages.length - 1]}`;
  return `Every language moves together: ${named}, and the shared fields.`;
}

/**
 * The hard problems a refusal named, one line each in the release page's
 * words, said to the reader, then how many more are on documents they may not
 * view. Empty for a refusal that names none.
 */
export function refusalLines(
  error: unknown,
  action: ReleaseMemberAction
): string[] {
  if (!isApiError(error) || error.data === undefined) return [];
  const problems = Array.isArray(error.data.problems)
    ? (error.data.problems as Array<{
        code?: unknown;
        detail?: ReleaseReadinessFinding["detail"];
      }>)
    : [];
  const lines = problems
    .filter(
      (
        problem
      ): problem is {
        code: string;
        detail?: ReleaseReadinessFinding["detail"];
      } => typeof problem.code === "string"
    )
    .map(problem => refusalProblemText(problem, action));
  const hidden = Array.isArray(error.data.hidden)
    ? (error.data.hidden as HiddenReleaseMembers[])
    : [];
  const unseen = hiddenTotal(hidden);
  return unseen > 0 ? [...lines, describeHiddenNeedFix(unseen)] : lines;
}

/**
 * Why scheduling is refused for THIS person and document, or undefined when
 * it is not.
 *
 * Order matters: the reason someone could act on last. Permission over the
 * document comes first, since switching language would not help a person who
 * may neither publish nor unpublish it. A person who may not create releases
 * is offered nothing at all (`useScheduleDocumentAction`).
 */
export function schedulePublishRefusal(facts: {
  /**
   * A request to schedule this document is still out. Asked first: a second
   * would make a second release for the document, and the person who sent
   * the first has every permission the rest ask about.
   */
  scheduling: boolean;
  /**
   * May publish or unpublish this document: what the release does for them
   * later, going live or coming down.
   */
  canChangeDocument: boolean;
  onDefaultLocale: boolean;
}): string | undefined {
  if (facts.scheduling) {
    return "This document is being scheduled. Wait for it to finish.";
  }
  if (!facts.canChangeDocument) {
    return "You do not have permission to publish or unpublish this document.";
  }
  /*
   * A release publishes the whole document, so scheduling from a translation
   * would put every language live while the screen is about one of them.
   */
  if (!facts.onDefaultLocale) {
    return "Schedule from the document's default language.";
  }
  return undefined;
}

/**
 * The longest release name the server takes, counted as it counts: in UTF-16
 * code units, JavaScript's `length`.
 */
const MAX_RELEASE_TITLE_LENGTH = 255;

/**
 * The name of the release a scheduled document goes into: the document's
 * own title, which is what the releases list and calendar then show beside
 * their "Single document" mark.
 *
 * A title too long for the server is cut at a whole character, so the name
 * never ends in half of an emoji or in part of a joined one such as a family.
 */
export function scheduledReleaseTitle(
  documentTitle: string | undefined
): string {
  const title = documentTitle?.trim() || "Untitled";
  if (title.length <= MAX_RELEASE_TITLE_LENGTH) return title;
  // Room for the ellipsis, which is one unit.
  const room = MAX_RELEASE_TITLE_LENGTH - 1;
  let kept = "";
  for (const character of userCharacters(title)) {
    if (kept.length + character.length > room) break;
    kept += character;
  }
  return `${kept}…`;
}

/**
 * The characters a reader sees: grapheme clusters where the runtime can
 * segment them, otherwise code points, which at least never split a UTF-16
 * pair.
 */
function userCharacters(text: string): Iterable<string> {
  if (typeof Intl.Segmenter !== "function") return Array.from(text);
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segments.segment(text), part => part.segment);
}

/**
 * The time the dialog opens on: nine in the morning, tomorrow, on the clock
 * of `zone`. A sensible first answer, read back in words before anything is
 * sent, rather than an empty box to fill.
 *
 * Tomorrow is the next date on that zone's calendar, not the date 24 hours
 * from now: on a night the clocks go back the day is 25 hours long, and 24
 * hours on is still today.
 */
export function defaultScheduleWall(now: number, zone: string): string {
  const today = wallTimeIn(new Date(now), zone).slice(0, 10);
  const [year, month, day] = today.split("-").map(Number);
  // Calendar arithmetic in UTC, where every day is 24 hours long; the
  // date alone is kept, so the zone's clock changes cannot reach it.
  const tomorrow = new Date(
    Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 1)
  )
    .toISOString()
    .slice(0, 10);
  return `${tomorrow}T09:00`;
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
