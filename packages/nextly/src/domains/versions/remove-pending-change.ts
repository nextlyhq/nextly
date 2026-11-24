/**
 * Removing a document's pending change in one language, judged by the
 * version its caller read before anything is removed.
 *
 * @module domains/versions/remove-pending-change
 * @experimental
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { SHARED_DRAFT_SLOT } from "./part-drafts";
import { releaseSharedBase } from "./shared-publish-base";
import type { VersionCheck } from "./stale-version";
import { VersionsRepository, type VersionRef } from "./versions-repository";

/**
 * Remove the pending change of `draft.ref` in `draft.locale`, and release the
 * shared base it held, judging the discard first: under the caller's row lock
 * and before anything is removed, so out of date `judge` throws with nothing
 * deleted. Judged only when there is a change to lose, so a discard with
 * nothing to discard answers as before, whatever version it names, and is
 * given `unjudged` as its judgement.
 *
 * `draft.withShared` removes the shared part's draft with the language's: for
 * a document that is not translated, whose one pending change is kept by part
 * (`draftsKeptByPart`), so an edit to a shared field is held in the shared
 * draft and the language's draft holds only its translatable fields. Removing
 * the language's alone would leave the shared edit pending after a discard.
 *
 * @returns How many drafts it removed, and what `judge` answered.
 * @experimental
 */
export async function removePendingChangeJudged<T>(
  tx: TransactionContext,
  draft: { ref: VersionRef; locale: string | null; withShared?: boolean },
  check: VersionCheck,
  judge: () => Promise<T>,
  unjudged: T
): Promise<{ removed: number; judged: T }> {
  const versions = new VersionsRepository(tx);
  const slots =
    draft.withShared === true && draft.locale !== SHARED_DRAFT_SLOT
      ? [draft.locale, SHARED_DRAFT_SLOT]
      : [draft.locale];
  const judged =
    check.kind === "unjudged" || !(await holdsAny(versions, draft.ref, slots))
      ? unjudged
      : await judge();
  let removed = 0;
  for (const slot of slots) {
    removed += await versions.deleteWorkingDraft(draft.ref, slot);
    await releaseSharedBase(tx, draft.ref, slot);
  }
  return { removed, judged };
}

/** Whether `ref` holds a working draft in any of `slots`. */
async function holdsAny(
  versions: VersionsRepository,
  ref: VersionRef,
  slots: readonly (string | null)[]
): Promise<boolean> {
  for (const slot of slots) {
    if (await versions.hasWorkingDraft(ref, slot)) return true;
  }
  return false;
}
