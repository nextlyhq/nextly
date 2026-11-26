"use client";

/**
 * The panel's Publishing section: the release this document is scheduled in
 * and when, drawn only while it is in one.
 *
 * Scheduling in Nextly is a release: a document goes live, or comes down, when
 * a release holding it falls due. So this reads the same answer the
 * scheduled-release banner reads, with the same request (`useReleasesContaining`
 * keyed by the same document), which the two share rather than ask twice.
 *
 * Shown only to someone who may read releases: the list is gated. A document
 * in no release draws no section at all, rather than a "Not scheduled" card on
 * every document: scheduling is a row of the main button's menu, the one place
 * it is offered, and the panel shows the time only once one is set.
 *
 * @module components/features/entries/EntryForm/panels/PublishingSection
 */

import type { JSX } from "react";

import { SCHEDULE_OUTCOME_ATTRIBUTE } from "@admin/components/features/releases/dialog-opener";
import {
  describeRelease,
  formatScheduledAt,
} from "@admin/components/features/releases/release-schedule";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useReleasesContaining } from "@admin/hooks/queries/useReleasesContaining";
import { useCan } from "@admin/hooks/useCan";
import type { Release, ReleaseDocumentRef } from "@admin/types/releases";

import { PanelSection } from "./PanelSection";

/** What a release will do to this document, when it falls due. */
const CONSEQUENCE: Record<string, string> = {
  publish: "Goes live",
  unpublish: "Comes down",
};

export function PublishingSection({
  document,
}: {
  /** The document as releases address it; absent before it is saved. */
  document: ReleaseDocumentRef | undefined;
}): JSX.Element | null {
  const canRead = useCan("read-content-releases");
  const { data, isError } = useReleasesContaining(document, canRead);
  if (!canRead || document === undefined) return null;
  const releases = data?.items ?? [];
  // Nothing to say while the answer is out, or once it says no release holds
  // the document. A lookup that failed is not an empty schedule, so it says
  // so: silence would hide a pending change exactly when the admin cannot
  // confirm it.
  if (!isError && releases.length === 0) return null;

  return (
    // Marked as the place that shows a schedule's outcome, which
    // `focusAfterScheduling` moves focus to when the dialog's opener sits
    // inside it.
    <PanelSection title="Publishing" focusTarget={SCHEDULE_OUTCOME_ATTRIBUTE}>
      {isError ? (
        <p className="text-sm text-muted-foreground">
          Whether this is in a scheduled release could not be checked.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {releases.map(release => (
            <li key={release.id} className="flex flex-col gap-0.5">
              <Link
                href={buildRoute(ROUTES.RELEASES_DETAIL, { id: release.id })}
                className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
              >
                {release.title}
              </Link>
              <span className="text-xs text-muted-foreground">
                {whenItHappens(release)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  );
}

/**
 * What a stopped release still holding this document means for it: nothing
 * happens until somebody fixes it. Said without naming the change, as the
 * scheduled-release banner says it, because the release's own description
 * ("cannot go live") reads as a failed publish beside a stopped unpublish.
 */
const STOPPED =
  "Stopped. It will not change this document until somebody fixes it.";

/**
 * When the release changes this document, and how. A stopped release says
 * so rather than a time, since it will not happen on its own.
 */
function whenItHappens(release: Release): string {
  if (release.state === "blocked") return STOPPED;
  if (release.state !== "scheduled") return describeRelease(release);
  const at = formatScheduledAt(release);
  const consequence =
    (release.memberAction && CONSEQUENCE[release.memberAction]) ?? "Changes";
  return at ? `${consequence} ${at}` : `${consequence} when it is scheduled`;
}
