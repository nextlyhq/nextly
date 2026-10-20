/**
 * What to tell someone whose release action got no answer.
 *
 * A request that never answered may still have done its work: the server can
 * publish a release and lose only the reply. Saying "nothing changed" then is
 * how an editor comes to publish twice, or to report a launch that already
 * happened as one that did not. So the release is read again, and the answer
 * says what is true now; if even that read fails, it says the outcome is
 * unknown.
 *
 * @module components/features/releases/release-lost-answer
 */
import { fetchRelease } from "@admin/services/releaseApi";
import type { Release, ReleaseState } from "@admin/types/releases";

/** The release as it stands after an action whose answer was lost. */
export type ReleaseAfterLostAnswer =
  | { kind: "found"; release: Release }
  | { kind: "gone" }
  | { kind: "unknown" };

/** The actions the row menu confirms. */
export type ConfirmedReleaseAction = "publish" | "cancel" | "delete";

/** Read the release again, telling "gone" apart from "could not read". */
export async function readReleaseAfterLostAnswer(
  releaseId: string
): Promise<ReleaseAfterLostAnswer> {
  try {
    return { kind: "found", release: await fetchRelease(releaseId) };
  } catch (error) {
    const { status, code } = (error ?? {}) as {
      status?: unknown;
      code?: unknown;
    };
    return status === 404 && code === "NOT_FOUND"
      ? { kind: "gone" }
      : { kind: "unknown" };
  }
}

/** How each state reads in "it is …". */
const NOW: Record<ReleaseState, string> = {
  published: "it is published",
  scheduled: "it is still scheduled",
  cancelled: "it is cancelled",
  draft: "it is still a draft",
  blocked: "it has stopped on a problem",
};

/** Whether the release now stands where the action would have put it. */
function wentThrough(
  action: ConfirmedReleaseAction,
  after: ReleaseAfterLostAnswer
): boolean {
  if (after.kind === "gone") return action === "delete";
  if (after.kind !== "found") return false;
  if (action === "publish") return after.release.state === "published";
  if (action === "cancel") return after.release.state === "cancelled";
  return false;
}

const PAST: Record<ConfirmedReleaseAction, string> = {
  publish: "published",
  cancel: "cancelled",
  delete: "deleted",
};

/** The sentence the dialog shows once the release has been read again. */
export function describeAfterLostAnswer(
  action: ConfirmedReleaseAction,
  after: ReleaseAfterLostAnswer
): string {
  const lost = "The connection was lost before the server answered.";
  if (after.kind === "unknown") {
    return `${lost} We could not tell whether the release was ${PAST[action]}. Check the release before trying again.`;
  }
  const now =
    after.kind === "gone" ? "it was deleted" : NOW[after.release.state];
  return wentThrough(action, after)
    ? `${lost} We checked: ${now}.`
    : `${lost} We checked: ${now}, so you can try again.`;
}
