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

import { useState } from "react";

import { CalendarClock } from "@admin/components/icons";
import {
  Badge,
  Button,
  Card,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useReleases } from "@admin/hooks/queries/useReleases";
import type { ReleaseState } from "@admin/types/releases";

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
  scheduled: "warning",
  published: "success",
  cancelled: "outline",
};

/**
 * The states offered as a filter, derived from the labels rather than listed.
 *
 * A second list would compile after the engine gained a state and quietly leave
 * it unfilterable — the one release nobody could find would be the one in the
 * new state.
 */
const FILTERABLE_STATES = Object.keys(RELEASE_STATE_LABEL) as ReleaseState[];

/** The sentinel for "every state", which is not itself a state. */
const ANY_STATE = "all";

/**
 * How many rows a window asks for, and how far it can be widened.
 *
 * The route's own default is 50 and its ceiling 200. Widening in one step
 * rather than paging is deliberate: the read port behind this exposes `where`,
 * `orderBy` and `limit` and no offset, and an offset over a list whose rows move
 * would skip and repeat releases rather than page through them. Narrowing by
 * state is what makes the far end reachable; the wider window is what makes the
 * near end complete.
 */
const PAGE = 50;
const MAX_PAGE = 200;

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

/**
 * The empty result of a FILTER, which is a different fact from having none.
 *
 * Showing the teaching empty state here would tell an editor who has fifty
 * releases that they have never made one.
 */
function NoneInThisState({ onClear }: { onClear: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">
        No releases in this state.
      </p>
      <Button variant="outline" size="sm" onClick={onClear}>
        Show all releases
      </Button>
    </Card>
  );
}

export interface ReleaseListProps {
  /** Offered only to a caller who may assemble a release. */
  onCreate?: () => void;
}

export function ReleaseList({ onCreate }: ReleaseListProps) {
  const [state, setState] = useState<ReleaseState | typeof ANY_STATE>(
    ANY_STATE
  );
  const [limit, setLimit] = useState(PAGE);
  // The window's own bounds, so a release past the server's 200-row ceiling is
  // still reachable: moving the range is the only narrowing that partitions a
  // single state. Both filter the INSTANT, so they cannot reach a draft, which
  // has none — that limit is stated where the editor can see it rather than
  // left to be discovered.
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");

  const { data, isPending, isError } = useReleases({
    ...(state === ANY_STATE ? {} : { state }),
    ...(before ? { scheduledBefore: new Date(before).toISOString() } : {}),
    ...(after ? { scheduledAfter: new Date(after).toISOString() } : {}),
    limit,
  });

  const filtering = state !== ANY_STATE || Boolean(after) || Boolean(before);

  const filter = (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <label
        htmlFor="release-state-filter"
        className="text-sm text-muted-foreground"
      >
        State
      </label>
      <Select
        value={state}
        onValueChange={next => {
          setState(next as ReleaseState | typeof ANY_STATE);
          // A narrower question deserves a fresh window. Carrying a widened
          // limit across filters asks the server for 200 rows of a state that
          // may have three.
          setLimit(PAGE);
        }}
      >
        <SelectTrigger id="release-state-filter" className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY_STATE}>All releases</SelectItem>
          {FILTERABLE_STATES.map(value => (
            <SelectItem key={value} value={value}>
              {RELEASE_STATE_LABEL[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <label htmlFor="release-after" className="text-sm text-muted-foreground">
        From
      </label>
      <Input
        id="release-after"
        type="date"
        className="w-40"
        value={after}
        onChange={event => {
          setAfter(event.target.value);
          setLimit(PAGE);
        }}
      />
      <label htmlFor="release-before" className="text-sm text-muted-foreground">
        To
      </label>
      <Input
        id="release-before"
        type="date"
        className="w-40"
        value={before}
        onChange={event => {
          setBefore(event.target.value);
          setLimit(PAGE);
        }}
      />
    </div>
  );

  if (isPending) {
    return (
      <>
        {filter}
        <p className="text-sm text-muted-foreground" role="status">
          Loading releases…
        </p>
      </>
    );
  }

  if (isError) {
    // The list failing and the list being empty are different facts, and an
    // editor who cannot tell them apart concludes nothing is scheduled.
    return (
      <>
        {filter}
        <p className="text-sm text-destructive" role="alert">
          Releases could not be loaded.
        </p>
      </>
    );
  }

  const releases = data?.items ?? [];
  if (releases.length === 0) {
    return (
      <>
        {filter}
        {filtering ? (
          <NoneInThisState onClear={() => setState(ANY_STATE)} />
        ) : (
          <NoReleasesYet onCreate={onCreate} />
        )}
      </>
    );
  }

  const truncated = data?.meta.hasNext ?? false;
  const canWiden = truncated && limit < MAX_PAGE;

  return (
    <>
      {filter}
      <ul className="flex flex-col gap-2">
        {releases.map(release => (
          <li key={release.id}>
            <Card className="p-0">
              {/* The whole row is the link. A separate "Open" button beside a
                  title reads as two destinations, and it cannot be
                  middle-clicked or opened in a new tab — which is how anyone
                  compares two releases. */}
              <Link
                href={buildRoute(ROUTES.RELEASES_DETAIL, { id: release.id })}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[inherit] px-4 py-3 no-underline outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant={STATE_VARIANT[release.state]}>
                      {RELEASE_STATE_LABEL[release.state]}
                    </Badge>
                    <span className="truncate font-medium text-foreground">
                      {release.title}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {describeRelease(release)}
                  </p>
                </div>
              </Link>
            </Card>
          </li>
        ))}
      </ul>

      {truncated ? (
        // Truncation is stated rather than implied. The server over-fetches one
        // row to know this, precisely so a partial schedule is never presented
        // as the whole one.
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            More releases match than are shown here.
          </p>
          {canWiden ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLimit(MAX_PAGE)}
            >
              Show more
            </Button>
          ) : (
            // At the ceiling there is no larger window to offer, so the only
            // honest instruction is a narrower QUESTION — and it must not be one
            // the editor has already asked. Telling someone who has filtered by
            // state to filter by state reads as the UI not knowing what it is
            // showing.
            <p className="text-sm text-muted-foreground">
              {filtering
                ? "Narrow the dates to see releases before these."
                : "Filter by state, or narrow the dates, to see more."}
            </p>
          )}
        </div>
      ) : null}
    </>
  );
}
