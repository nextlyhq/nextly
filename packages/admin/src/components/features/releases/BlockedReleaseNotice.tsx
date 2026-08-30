"use client";

/**
 * Why a release stopped, and what to do about it.
 *
 * The state alone is a dead end. "Blocked" tells an operator the launch will
 * not happen and nothing else — not which document, not why, not whether
 * waiting helps. It does not help: the drain has already stopped retrying,
 * because every reason listed here is one that retrying cannot change.
 *
 * Each reason names the MEMBER, because the fix is per member — remove that
 * document, or restore that user — and a release-level "something is wrong"
 * leaves someone opening every row to find which.
 *
 * @module components/features/releases/BlockedReleaseNotice
 */

import { Card } from "@admin/components/ui";
import type { ReleaseBlocker } from "@admin/types/releases";

/**
 * What each reason means, and what resolves it.
 *
 * Written as a consequence and a remedy rather than a code, because the reader
 * is someone who did not schedule this release and is finding out now why a
 * launch did not happen.
 */
const REASON: Record<ReleaseBlocker["reason"], string> = {
  AUTHOR_GONE:
    "the person who added it has been deleted or deactivated. A release publishes each document as its author, so there is nobody left to act as. Restore that user, or remove the document and add it again.",
  NO_AUTHOR:
    "no author was recorded for it, so there is nobody to publish it as. Remove the document and add it again.",
  LOCALE_SCOPED:
    "it names a single language, which releases cannot publish on their own. Remove it and add the document without a language.",
};

export function BlockedReleaseNotice({
  blockers,
}: {
  blockers: ReleaseBlocker[];
}) {
  // A blocked release with nothing to report means the cause has been fixed
  // since it stopped — which is the point of deriving this rather than storing
  // it. Saying so beats an empty list, and beats silence.
  if (blockers.length === 0) {
    return (
      <Card className="mb-6 border-warning bg-warning/5 px-4 py-3">
        <p className="text-sm text-foreground">
          This release stopped, but nothing is blocking it any more. Schedule it
          again to let it run.
        </p>
      </Card>
    );
  }

  return (
    <Card className="mb-6 border-destructive bg-destructive/5 px-4 py-3">
      <h2 className="text-sm font-medium text-foreground">
        This release stopped and will not run on its own
      </h2>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
        {blockers.map(blocker => (
          <li key={blocker.memberId} className="text-sm text-muted-foreground">
            One document could not be published: {REASON[blocker.reason]}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-muted-foreground">
        Once it is fixed, schedule the release again.
      </p>
    </Card>
  );
}
