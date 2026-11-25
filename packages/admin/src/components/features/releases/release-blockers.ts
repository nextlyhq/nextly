/**
 * Why a document stops a release, said once.
 *
 * The schedule dialog lists these while somebody is choosing a moment, and the
 * release page says them beside the document they are on
 * (`release-problems`). One definition per reason, so the two never explain
 * the same failure two different ways.
 *
 * @module components/features/releases/release-blockers
 */
import type {
  ReleaseBlockerReason,
  ReleaseFieldStopReason,
  ReleaseStopsView,
} from "@admin/types/releases";

export interface BlockerReasonCopy {
  /** The clause, written to follow the document it is about. */
  summary: string;
}

export const BLOCKER_REASON: Record<ReleaseBlockerReason, BlockerReasonCopy> = {
  AUTHOR_GONE: {
    summary: "the person who added it has been deleted or deactivated",
  },
  NO_AUTHOR: {
    summary: "no author was recorded for it",
  },
  LOCALE_SCOPED: {
    summary: "it names a single language, which a release cannot act on",
  },
};

/** The clause alone, for a list. */
export function blockerSummary(reason: ReleaseBlockerReason): string {
  return BLOCKER_REASON[reason].summary;
}

/**
 * What happened to the field, by why the run stopped, written to follow the field's name. Keyed by
 * every reason, so one added on the server is a compile error here rather than a blank sentence.
 */
const FIELD_STOP: Record<ReleaseFieldStopReason, string> = {
  FIELD_REMOVED: "was removed in the Builder",
  FIELD_CHANGED: "had its type or storage changed in the Builder",
  FIELD_UNSETTLED: "was changed by a Builder save that did not finish",
};

/** One field stop as a sentence, with what to do: "The field “subtitle” of posts was removed…". */
export function fieldStopSentence(
  stop: ReleaseStopsView["items"][number]
): string {
  const field = stop.field === null ? "A field" : `The field “${stop.field}”`;
  return (
    `${field} of ${stop.scopeSlug} ${FIELD_STOP[stop.reason]}. ` +
    `Start dev or save ${stop.scopeSlug} in the Builder, then run the release again.`
  );
}

/**
 * Why a stopped release's run stopped over a field, as one line: the first stop's sentence, and
 * how many more there are, the ones on documents the reader may not open counted with them. Null
 * where no field stopped it.
 */
export function fieldStopsLine(
  view: ReleaseStopsView | undefined
): string | null {
  if (view === undefined) return null;
  const [first, ...rest] = view.items;
  const more = rest.length + view.hidden;
  if (first === undefined) {
    return more === 0
      ? null
      : `A field changed in the Builder stopped ${more === 1 ? "a document" : `${more} documents`} you can't open. Run the release again once the Builder save is settled.`;
  }
  return more === 0
    ? fieldStopSentence(first)
    : `${fieldStopSentence(first)} (${more} more ${more === 1 ? "document" : "documents"} too.)`;
}
