"use client";

/**
 * The side of a release's page: who owns it, the zone it was scheduled in,
 * when it was made, and its history from the record of content events.
 *
 * The owner is named as the release list names one (`ReleaseOwnerCell`):
 * "You" for the reader's own, otherwise by name, and "Owner unavailable" for
 * one who cannot be named. The name comes from the event that created the
 * release, since a release's own read does not carry it.
 *
 * @module components/features/releases/ReleaseAboutPanel
 */

import type { JSX } from "react";

import {
  dayHeading,
  timeOfDay,
} from "@admin/components/features/versions/history-story-text";
import { StoryActorName } from "@admin/components/features/versions/HistoryStoryRows";
import { Button, Skeleton } from "@admin/components/ui";
import {
  useReleaseCreation,
  useReleaseHistory,
} from "@admin/hooks/queries/useReleases";
import { formatGlobalDateTime } from "@admin/lib/dates/format";
import type { Release } from "@admin/types/releases";

import {
  ownerFromHistory,
  releaseHistoryRows,
  type ReleaseHistoryContext,
} from "./release-history";
import { dayKeyIn } from "./release-timezone";
import { ReleaseOwnerCell } from "./ReleaseListCells";

export function ReleaseAboutPanel({
  release,
  historyContext,
}: {
  release: Release;
  historyContext: ReleaseHistoryContext;
}): JSX.Element {
  return (
    <aside
      aria-label="About this release"
      className="flex flex-col gap-4 lg:sticky lg:top-6"
    >
      <AboutCard release={release} />
      <HistoryCard release={release} context={historyContext} />
    </aside>
  );
}

function AboutCard({ release }: { release: Release }) {
  const created = useReleaseCreation(release.id);
  const owner = ownerFromHistory(created.data ?? undefined);
  return (
    <section
      aria-labelledby="release-about"
      className="rounded-lg border border-border bg-card p-4"
    >
      <h2
        id="release-about"
        className="mb-3 text-sm font-semibold text-foreground"
      >
        About
      </h2>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5 text-sm">
        <dt className="text-muted-foreground">Owner</dt>
        <dd className="min-w-0 justify-self-end">
          {created.isPending ? (
            <Skeleton className="h-6 w-24" />
          ) : (
            <ReleaseOwnerCell release={{ ...release, owner }} />
          )}
        </dd>
        <dt className="text-muted-foreground">Time zone</dt>
        <dd className="min-w-0 justify-self-end truncate text-right text-foreground">
          {release.timezone ?? (
            <span className="text-muted-foreground">Set when scheduled</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Created</dt>
        <dd className="justify-self-end text-right tabular-nums text-foreground">
          {formatGlobalDateTime(release.createdAt, {
            weekday: "short",
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </dd>
      </dl>
    </section>
  );
}

function HistoryCard({
  release,
  context,
}: {
  release: Release;
  context: ReleaseHistoryContext;
}) {
  const history = useReleaseHistory(release.id);
  return (
    <section
      aria-labelledby="release-history"
      className="rounded-lg border border-border bg-card p-4"
    >
      <h2
        id="release-history"
        className="mb-3 text-sm font-semibold text-foreground"
      >
        History
      </h2>
      <HistoryBody history={history} context={context} />
    </section>
  );
}

/** The history's events, or why there are none to show. */
function HistoryBody({
  history,
  context,
}: {
  history: ReturnType<typeof useReleaseHistory>;
  context: ReleaseHistoryContext;
}) {
  if (history.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (history.isError) {
    return (
      <p
        role="alert"
        className="text-sm text-destructive-700 dark:text-destructive"
      >
        The history of this release could not be loaded.
      </p>
    );
  }
  const events = history.data.pages.flatMap(page => page.items);
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing recorded yet. A release made before releases kept a history
        starts its history with its next change.
      </p>
    );
  }
  return (
    <>
      <HistoryRows
        rows={releaseHistoryRows(events, context)}
        context={context}
      />
      {history.hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 w-full"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? "Loading…" : "Show earlier"}
        </Button>
      ) : null}
    </>
  );
}

/**
 * The history's rows, under a heading for each day: "Today", "Yesterday", or
 * the date, each row leading with who did it and saying when.
 */
function HistoryRows({
  rows,
  context,
}: {
  rows: ReturnType<typeof releaseHistoryRows>;
  context: ReleaseHistoryContext;
}) {
  const days: Array<{ day: string; rows: typeof rows }> = [];
  for (const row of rows) {
    const day = dayHeading(
      dayKeyIn(new Date(row.at), context.readerZone),
      new Date(context.now)
    );
    const last = days[days.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else days.push({ day, rows: [row] });
  }
  return (
    <div className="flex flex-col gap-4">
      {days.map(({ day, rows: dayRows }) => (
        <section key={day} aria-label={day}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {day}
          </h3>
          <ol className="flex flex-col gap-3 border-l border-border pl-4">
            {dayRows.map(row => (
              <li key={row.id} className="relative text-sm">
                <span
                  aria-hidden
                  className="absolute -left-[21px] top-1.5 size-2 rounded-full border border-border bg-background"
                />
                <p className="leading-snug text-foreground">
                  {row.actor ? (
                    <>
                      <StoryActorName actor={row.actor} />{" "}
                      <span>{row.text}</span>
                    </>
                  ) : (
                    <span className="font-medium">{row.text}</span>
                  )}
                </p>
                <time
                  dateTime={row.at}
                  className="mt-0.5 block text-xs tabular-nums text-muted-foreground"
                >
                  {timeOfDay(row.at)}
                </time>
                {row.details ? (
                  <details className="group mt-1 text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none rounded-sm font-medium text-foreground/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Show them
                    </summary>
                    <ul className="mt-1 flex flex-col gap-0.5 pl-3">
                      {row.details.map((detail, index) => (
                        // Two documents can read alike while their names
                        // load, so the place keys them as well.
                        <li key={`${index}:${detail}`}>{detail}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
