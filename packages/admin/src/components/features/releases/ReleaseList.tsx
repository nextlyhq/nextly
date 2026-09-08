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

import { useMemo, useState } from "react";

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
import { DataTableView } from "@admin/components/ui/table/data-table";
import type { NextlyColumn } from "@admin/components/ui/table/data-table";
import { buildRoute, ROUTES } from "@admin/constants/routes";
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
  "default" | "outline" | "success" | "warning" | "destructive"
> = {
  draft: "outline",
  scheduled: "warning",
  published: "success",
  cancelled: "outline",
  // The only state that needs someone to DO something. `cancelled` is quiet
  // because it is a decision somebody made; this is a launch that will not
  // happen and nobody has noticed.
  blocked: "destructive",
};

/**
 * The states offered as a filter, derived from the labels rather than listed.
 *
 * A second list would compile after the engine gained a state and quietly leave
 * it unfilterable — the one release nobody could find would be the one in the
 * new state.
 */
const FILTERABLE_STATES = Object.keys(RELEASE_STATE_LABEL) as ReleaseState[];

/**
 * The bounds a date input MEANS, as instants.
 *
 * `new Date("2026-09-01")` is midnight UTC, and the server compares
 * `scheduledAt <=` it — so a release at 09:00 on the chosen day falls outside a
 * range the editor believes includes it. A date picker names a DAY; the window
 * it implies runs from that day's first instant to its last.
 *
 * Resolved in UTC rather than the reader's zone, matching the instants being
 * compared. A local-zone boundary would make the same filter select different
 * releases for two editors looking at one list, which is harder to explain than
 * an edge that is off by a few hours for someone far from UTC.
 */
function startOfDay(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toISOString();
}

function endOfDay(day: string): string {
  return new Date(`${day}T23:59:59.999Z`).toISOString();
}

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
 * What a release row shows, in the order it is read.
 *
 * State first, because it is what decides whether the rest of the row matters:
 * a cancelled launch and a scheduled one are different KINDS of thing, and
 * putting the title first makes them look like the same thing with a label.
 */
/**
 * NOT sortable, and that is a property of the route rather than a gap here.
 *
 * `DataTableView` sorts SERVER-SIDE — it reports a header click and expects the
 * caller to re-query — and `/api/releases` accepts a state and a window and no
 * ordering. Marking these headers sortable would offer a control that reorders
 * nothing, which is worse than the plain headers webhooks, media and api keys
 * also render. The list's own order is `scheduledAt` descending, chosen so the
 * next thing to happen is the first thing read.
 */
function releaseColumns(): NextlyColumn<Release>[] {
  return [
    {
      name: "state",
      header: "State",
      cell: ({ row }) => (
        <Badge variant={STATE_VARIANT[row.state]}>
          {RELEASE_STATE_LABEL[row.state]}
        </Badge>
      ),
    },
    {
      name: "title",
      header: "Release",
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.title}</span>
      ),
    },
    {
      name: "when",
      header: "When",
      // The same sentence the row carried before, which says what will happen
      // and when rather than printing a bare timestamp the reader has to
      // interpret against the state beside it.
      cell: ({ row }) => (
        <span className="text-muted-foreground">{describeRelease(row)}</span>
      ),
    },
  ];
}

/**
 * The controls that narrow the window.
 *
 * Separated from the list because they are a control surface rather than a
 * view of the data, and because the list already had three states to render
 * before any of this was added. Every change resets the page size: a narrower
 * question deserves a fresh window.
 */
function ReleaseFilters({
  state,
  after,
  before,
  onState,
  onAfter,
  onBefore,
}: {
  state: ReleaseState | typeof ANY_STATE;
  after: string;
  before: string;
  onState: (next: ReleaseState | typeof ANY_STATE) => void;
  onAfter: (next: string) => void;
  onBefore: (next: string) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <label
        htmlFor="release-state-filter"
        className="text-sm text-muted-foreground"
      >
        State
      </label>
      <Select
        value={state}
        onValueChange={next => onState(next as ReleaseState | typeof ANY_STATE)}
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
        onChange={event => onAfter(event.target.value)}
      />
      <label htmlFor="release-before" className="text-sm text-muted-foreground">
        To
      </label>
      <Input
        id="release-before"
        type="date"
        className="w-40"
        value={before}
        onChange={event => onBefore(event.target.value)}
      />
    </div>
  );
}

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
      {/* Names the FILTERS rather than the state: a date-only window reaches
          this too, and "no releases in this state" is then simply untrue. */}
      <p className="text-sm text-muted-foreground">
        No releases match these filters.
      </p>
      <Button variant="outline" size="sm" onClick={onClear}>
        Show all releases
      </Button>
    </Card>
  );
}

/**
 * What to say when the window did not hold everything that matched.
 *
 * Truncation is stated rather than implied — the server over-fetches one row to
 * know it, precisely so a partial schedule is never presented as the whole one.
 * At the ceiling there is no larger window to offer, so the only honest
 * instruction is a narrower QUESTION, and it must not be one the editor has
 * already asked: telling someone who has filtered to filter reads as the UI not
 * knowing what it is showing.
 */
function TruncationNotice({
  truncated,
  canWiden,
  filtering,
  onWiden,
}: {
  truncated: boolean;
  canWiden: boolean;
  filtering: boolean;
  onWiden: () => void;
}) {
  if (!truncated) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <p className="text-sm text-muted-foreground">
        More releases match than are shown here.
      </p>
      {canWiden ? (
        <Button variant="outline" size="sm" onClick={onWiden}>
          Show more
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          {filtering
            ? "Narrow the dates to see releases before these."
            : "Filter by state, or narrow the dates, to see more."}
        </p>
      )}
    </div>
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
    ...(before ? { scheduledBefore: endOfDay(before) } : {}),
    ...(after ? { scheduledAfter: startOfDay(after) } : {}),
    limit,
  });

  const filtering = state !== ANY_STATE || Boolean(after) || Boolean(before);
  const columns = useMemo(() => releaseColumns(), []);

  // ALL of them. Clearing only the state leaves a date window narrowing the
  // list, so "Show all releases" can render the same empty result it was
  // offered to escape.
  const clearFilters = () => {
    setState(ANY_STATE);
    setAfter("");
    setBefore("");
    setLimit(PAGE);
  };

  const filter = (
    <ReleaseFilters
      state={state}
      after={after}
      before={before}
      onState={next => {
        setState(next);
        // A narrower question deserves a fresh window. Carrying a widened limit
        // across filters asks the server for 200 rows of a state that may have
        // three.
        setLimit(PAGE);
      }}
      onAfter={next => {
        setAfter(next);
        setLimit(PAGE);
      }}
      onBefore={next => {
        setBefore(next);
        setLimit(PAGE);
      }}
    />
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
          <NoneInThisState onClear={clearFilters} />
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
      {/* The SAME table every other list surface uses — entries, media, api
          keys, webhooks, deliveries. Releases was the last one hand-built from
          cards, which cost it column alignment, the shared empty and loading
          states, and the row semantics a reader has already learned everywhere
          else in the admin. */}
      <DataTableView<Release>
        columns={columns}
        rows={releases}
        loading={isPending}
        getRowId={release => release.id}
        // An HREF, not a click handler. The hand-built rows were deliberately
        // links — "the whole row is the link… it cannot be middle-clicked or
        // opened in a new tab, which is how anyone compares two releases" — and
        // navigating as a side effect of a click throws that away while looking
        // identical. `rowHref` also makes the primary column a real anchor.
        rowHref={release =>
          buildRoute(ROUTES.RELEASES_DETAIL, { id: release.id })
        }
        primaryColumn="title"
        registryKey="releases"
        ariaLabel="Releases"
        emptyMessage="No releases match these filters yet."
      />

      <TruncationNotice
        truncated={truncated}
        canWiden={canWiden}
        filtering={filtering}
        onWiden={() => setLimit(MAX_PAGE)}
      />
    </>
  );
}
