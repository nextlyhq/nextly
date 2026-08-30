"use client";

/**
 * Every release, newest instant first.
 *
 * The list answers one question — what is going live, and when — so it shows
 * the state, the instant in the author's zone, and nothing else that would
 * compete with it. Membership counts live on the detail page, where the
 * documents themselves are.
 *
 * @module components/features/releases/ReleaseList
 */

import { CalendarClock } from "@admin/components/icons";
import { Badge, Button, Card } from "@admin/components/ui";
import { useReleases } from "@admin/hooks/queries/useReleases";
import type { Release, ReleaseState } from "@admin/types/releases";

import { describeRelease, RELEASE_STATE_LABEL } from "./release-schedule";

/**
 * How each state reads at a glance.
 *
 * `scheduled` is the only one given emphasis: it is the state with a
 * consequence still ahead of it, and the one an editor is scanning for.
 */
const STATE_VARIANT: Record<
  ReleaseState,
  "default" | "outline" | "success" | "warning"
> = {
  draft: "outline",
  // The only state with a consequence still ahead of it, and the one an editor
  // is scanning for.
  scheduled: "warning",
  published: "success",
  cancelled: "outline",
};

/**
 * What an editor sees before they have ever made a release.
 *
 * Most sites will never schedule anything, so this is the FIRST and often only
 * thing anyone sees here. It therefore explains what a release is rather than
 * reporting that a list is empty — "No releases" tells someone who does not
 * know the concept nothing they can act on.
 */
function NoReleasesYet({ onCreate }: { onCreate?: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <CalendarClock className="size-8 text-muted-foreground" aria-hidden />
      <h2 className="text-lg font-medium">Nothing is scheduled</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        A release groups documents that should go live together at one moment —
        a launch, an embargo lifting, a price change. Add documents to it, pick
        the instant, and Nextly publishes them all at once.
      </p>
      {onCreate ? (
        <Button className="mt-1" onClick={onCreate}>
          Create a release
        </Button>
      ) : null}
    </Card>
  );
}

export interface ReleaseListProps {
  /** Offered only to a caller who may assemble a release. */
  onCreate?: () => void;
  onOpen: (release: Release) => void;
}

export function ReleaseList({ onCreate, onOpen }: ReleaseListProps) {
  const { data, isPending, isError } = useReleases();

  if (isPending) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading releases…
      </p>
    );
  }

  if (isError) {
    // The list failing and the list being empty are different facts, and an
    // editor who cannot tell them apart concludes nothing is scheduled.
    return (
      <p className="text-sm text-destructive" role="alert">
        Releases could not be loaded.
      </p>
    );
  }

  const releases = data?.items ?? [];
  if (releases.length === 0) return <NoReleasesYet onCreate={onCreate} />;

  return (
    <ul className="flex flex-col gap-2">
      {releases.map(release => (
        <li key={release.id}>
          <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant={STATE_VARIANT[release.state]}>
                  {RELEASE_STATE_LABEL[release.state]}
                </Badge>
                <span className="truncate font-medium">{release.title}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {describeRelease(release)}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpen(release)}
              // Named, not "Open": a screen reader hears the rows in sequence
              // and "Open, Open, Open" identifies none of them.
              aria-label={`Open release ${release.title}`}
            >
              Open
            </Button>
          </Card>
        </li>
      ))}
      {data?.meta.hasNext ? (
        // Truncation is stated rather than implied. The server over-fetches one
        // row to know this, precisely so a partial schedule is never presented
        // as the whole one.
        <li className="px-1 pt-1 text-sm text-muted-foreground">
          More releases match than are shown here.
        </li>
      ) : null}
    </ul>
  );
}
