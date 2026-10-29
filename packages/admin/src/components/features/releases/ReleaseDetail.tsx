"use client";

/**
 * One release, and everything in it.
 *
 * This is where a release becomes safe to commit to: the moment and the
 * contents are on screen together, so "what ships on Friday" is answered by
 * looking rather than by remembering. Its documents are named by title and
 * grouped by collection, each says whether it is ready, the release says how
 * ready it is as a whole, and its history says who did what to it.
 *
 * What the reader may do comes from the capabilities the server sent with the
 * release; nothing on this page decides a permission.
 *
 * @module components/features/releases/ReleaseDetail
 */

import type { JSX } from "react";
import { useState } from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import {
  useEveryReleaseId,
  useRelease,
  useReleaseDocumentNames,
  useReleaseMembers,
  useReleaseReadiness,
  useReleaseTitles,
} from "@admin/hooks/queries/useReleases";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";
import { useDocumentTitle } from "@admin/hooks/useDocumentTitle";
import { navigateTo } from "@admin/lib/navigation";
import type { Release } from "@admin/types/releases";

import { releaseCalendarStatus } from "./release-calendar";
import { hiddenTotal } from "./release-hidden";
import type { ReleaseHistoryContext } from "./release-history";
import type { ReleaseRowStatus } from "./release-list";
import { commitBlockedBy, releaseIsAhead } from "./release-page";
import { otherReleaseIds } from "./release-problems";
import { readerZone as browserZone } from "./release-timezone";
import { ReleaseAboutPanel } from "./ReleaseAboutPanel";
import { ReleaseDocuments } from "./ReleaseDocuments";
import { ReleasePageHeader } from "./ReleasePageHeader";
import { ReleaseRowDialogs, type OpenDialog } from "./ReleaseRowMenu";
import { useMinuteClock } from "./useMinuteClock";

export function ReleaseDetail({ id }: { id: string }): JSX.Element {
  const release = useRelease(id);
  // The tab names the release, as its heading does, once it has arrived.
  useDocumentTitle(release.data?.title);

  if (release.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading release…
      </p>
    );
  }

  if (release.isError || !release.data) {
    // A release that cannot be read and one that does not exist are the same
    // thing to an editor standing here: either way this is not their release.
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-destructive">
          This release could not be loaded.
        </p>
        <Link href={ROUTES.RELEASES} className="text-sm underline">
          Back to all releases
        </Link>
      </div>
    );
  }

  return <ReleasePage release={release.data} />;
}

/**
 * Where the release stands in the list's words, or `null` while that is not
 * known.
 *
 * A scheduled release past its time is overdue only by the server's rule, so
 * it is asked of the same Needs attention read the list and the calendar ask,
 * narrowed to this release's instant, and read through the calendar's own
 * status rule: "Overdue" where the read holds it, "Scheduled" where it does
 * not, and no state at all while the read is on its way or failed. A release
 * whose time is still ahead cannot be overdue, so nothing is asked for it.
 */
function useReleasePageStatus(
  release: Release,
  now: number
): ReleaseRowStatus | null {
  const at = release.scheduledAt ? Date.parse(release.scheduledAt) : NaN;
  const asked = release.state === "scheduled" && at < now;
  const read = useEveryReleaseId(
    {
      tab: "attention",
      reason: "overdue",
      // One second either side of the instant: the window is inclusive, and
      // a stored time may have lost its milliseconds.
      scheduledAfter: new Date((asked ? at : now) - 1000).toISOString(),
      scheduledBefore: new Date((asked ? at : now) + 1000).toISOString(),
    },
    asked
  );
  if (!asked) return releaseCalendarStatus(release, NOT_OVERDUE);
  const ids = read.isError ? undefined : read.data;
  return releaseCalendarStatus(release, ids ? new Set(ids) : null);
}

/** Nothing is overdue: the answer for a release whose time is still ahead. */
const NOT_OVERDUE: ReadonlySet<string> = new Set();

function ReleasePage({ release }: { release: Release }) {
  const now = useMinuteClock();
  const [zone] = useState(browserZone);
  const members = useReleaseMembers(release.id);
  const items = members.data?.items ?? [];
  const ahead = releaseIsAhead(release);
  const readiness = useReleaseReadiness(release.id, ahead);
  const names = useReleaseDocumentNames(release.id, items);
  const releaseTitleOf = useReleaseTitles(otherReleaseIds(readiness.data));
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const commitBlockedReason = commitBlockedBy(
    ahead ? readiness : { data: undefined, isPending: false, isError: false },
    items.length + hiddenTotal(members.data?.meta.hidden)
  );
  const status = useReleasePageStatus(release, now);
  const { user: viewer } = useDashboardUser();
  const [dialogOpen, setDialogOpen] = useState(false);

  const historyContext: ReleaseHistoryContext = {
    titleOf: document => {
      const member = items.find(
        m =>
          m.scopeSlug === document.scopeSlug && m.entryId === document.entryId
      );
      return member ? (names.documentOf(member)?.title ?? null) : null;
    },
    pluralOf: slug =>
      names.scopeNamesOf(slug)?.plural ??
      members.data?.meta.hidden?.find(entry => entry.scopeSlug === slug)?.labels
        ?.plural ??
      slug,
    readerZone: zone,
    now,
    viewerId: viewer?.id ?? null,
  };

  return (
    <div className="flex flex-col gap-6">
      <ReleasePageHeader
        release={release}
        readerZone={zone}
        now={now}
        status={status}
        commitBlockedReason={commitBlockedReason}
        onOpenDialog={next => {
          setDialog(next);
          setDialogOpen(true);
        }}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <ReleaseDocuments
          release={release}
          members={items}
          hidden={members.data?.meta.hidden}
          membersPending={members.isPending}
          membersFailed={members.isError}
          names={names}
          readiness={{
            ahead,
            data: readiness.data,
            isPending: readiness.isPending,
            isError: readiness.isError,
            refetch: () => void readiness.refetch(),
          }}
          releaseTitleOf={releaseTitleOf}
        />
        <ReleaseAboutPanel release={release} historyContext={historyContext} />
      </div>

      <ReleaseRowDialogs
        dialog={dialog}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        // A deleted release has no page to stay on.
        onDone={action => {
          if (action === "delete") navigateTo(ROUTES.RELEASES);
        }}
      />
    </div>
  );
}
