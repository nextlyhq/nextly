"use client";

/**
 * Says, above the document itself, that this is going to change on its own.
 *
 * The document is editable and looks entirely ordinary, which is exactly the
 * problem: nothing else on the screen distinguishes a post from a post that
 * goes live on Friday whether anyone touches it again or not.
 *
 * ## Why it states the CONSEQUENCE rather than naming the release
 *
 * Sanity locks the documents in a scheduled release, so "are my edits
 * included?" is unanswerable there by construction — there is nothing to edit.
 * Nextly leaves them editable, deliberately, which means the question is live
 * every time somebody opens one and the document is the only place it can be
 * answered. A banner that named the release without answering it would be
 * strictly worse than the lock: the same information, none of the safety.
 *
 * The answer is YES, and it is a property of the engine rather than a choice
 * made here: a release member POINTS AT its document rather than carrying a
 * copy, and materialisation promotes whatever the working draft holds at the
 * instant. So an edit saved now ships.
 *
 * ## Why several releases are listed rather than summarised
 *
 * A document belonging to more than one release is the ordinary case — "publish
 * on the 1st, take down on the 20th" — so the rows are ordered by instant, the
 * order the changes will actually happen in. Reading the last row gives the
 * final state, which is what the engine's own ordering concludes; restating
 * that conclusion here would be a second implementation of it.
 *
 * @module components/features/releases/ScheduledReleaseBanner
 */

import { CalendarClock } from "@admin/components/icons";
import { Badge } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useReleasesContaining } from "@admin/hooks/queries/useReleases";
import { useCan } from "@admin/hooks/useCan";
import type { Release, ReleaseDocumentRef } from "@admin/types/releases";

import { formatScheduledAt } from "./release-schedule";

/** What a membership will do, said as the consequence rather than the verb. */
const ACTION_SENTENCE: Record<string, string> = {
  publish: "goes live",
  unpublish: "comes down",
};

function ReleaseLine({ release }: { release: Release }) {
  const at = formatScheduledAt(release);
  // An action the admin does not recognise is NAMED as unknown rather than
  // guessed at. Defaulting to "goes live" would state the opposite of the truth
  // for an unpublish the engine gained after this shipped.
  const consequence = release.memberAction
    ? ACTION_SENTENCE[release.memberAction]
    : undefined;

  return (
    <li className="text-sm text-foreground">
      {consequence ? (
        <>
          This document <strong className="font-medium">{consequence}</strong>
        </>
      ) : (
        <>This document changes</>
      )}
      {at ? ` ${at}` : " when this release takes effect"}, with{" "}
      <Link
        href={buildRoute(ROUTES.RELEASES_DETAIL, { id: release.id })}
        className="underline"
      >
        {release.title}
      </Link>
      .
    </li>
  );
}

export interface ScheduledReleaseBannerProps {
  document: ReleaseDocumentRef | undefined;
}

export function ScheduledReleaseBanner({
  document,
}: ScheduledReleaseBannerProps) {
  // The list endpoint is gated, so a reader without the grant must not issue a
  // request whose only outcome is a 403 under every document they open.
  const canRead = useCan("read-content-releases");
  const { data } = useReleasesContaining(document, canRead);

  const releases = data?.items ?? [];
  // Nothing scheduled is the overwhelmingly common case, and it deserves no
  // chrome at all: a bar saying "not in any release" on every document would
  // be noise on the screens where this matters least.
  if (releases.length === 0) return null;

  return (
    // `status`, not `alert`: this is a standing fact about the document rather
    // than something going wrong, and it is present on every visit — an
    // assertive live region would interrupt a screen-reader user each time.
    <div
      role="status"
      className="flex flex-wrap items-start gap-3 border-b border-border bg-primary/5 px-6 py-3"
    >
      <CalendarClock
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <Badge variant="warning">
            {releases.length === 1
              ? "Scheduled"
              : `${releases.length} scheduled`}
          </Badge>
        </div>
        <ul className="flex flex-col gap-0.5">
          {releases.map(release => (
            <ReleaseLine key={release.id} release={release} />
          ))}
        </ul>
        {/* The sentence the whole banner exists for. Stated once, below the
            rows, so it reads as true of all of them. */}
        <p className="mt-1.5 text-sm text-muted-foreground">
          Changes you save now are included — the release publishes this
          document as it stands at that moment.
        </p>
      </div>
    </div>
  );
}
