/**
 * Removing a document's pending change in one language, judged by the
 * version its caller read before anything is removed.
 *
 * @module domains/versions/remove-pending-change
 * @experimental
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

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
 * @returns How many drafts it removed, and what `judge` answered.
 * @experimental
 */
export async function removePendingChangeJudged<T>(
  tx: TransactionContext,
  draft: { ref: VersionRef; locale: string | null },
  check: VersionCheck,
  judge: () => Promise<T>,
  unjudged: T
): Promise<{ removed: number; judged: T }> {
  const versions = new VersionsRepository(tx);
  const judged =
    check.kind === "unjudged" ||
    !(await versions.hasWorkingDraft(draft.ref, draft.locale))
      ? unjudged
      : await judge();
  const removed = await versions.deleteWorkingDraft(draft.ref, draft.locale);
  await releaseSharedBase(tx, draft.ref, draft.locale);
  return { removed, judged };
}
