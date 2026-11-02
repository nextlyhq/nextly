"use client";

/**
 * The New form submissions card's body: the newest new submissions as core's
 * list rows, each opening its submission and marking it read, with the
 * card's footer leading to every submission, and how many are new beside its
 * title. While nothing is new it says so, with a link to every submission,
 * and its title carries no count.
 *
 * Drawn only with data: the frame draws loading and every failure itself.
 * The empty state is drawn here rather than by the frame, because its link
 * is the submissions collection the site installed, which only the card's
 * data knows; the frame's would name the slug the plugin declared. Built from
 * the widget kit alone, so it reads like core's list cards beside it.
 *
 * @module dashboard/NewSubmissionsCard
 */

import {
  formatWidgetTime,
  FrameState,
  useRefreshDashboard,
  useWidgetClock,
  Widget,
} from "@nextlyhq/plugin-sdk/admin";
import type { JSX, MouseEvent } from "react";

import { markRead } from "./mark-read";
import type { NewSubmissionRow, NewSubmissionsData } from "./new-submissions";

/** The mouse button that opens a link in a new tab. */
const MIDDLE_BUTTON = 1;

/** What a row says under its title: its form, and the first line of its first text answer. */
function metaOf(row: NewSubmissionRow): readonly string[] {
  return [row.form, row.excerpt].filter(
    (part): part is string => part !== undefined
  );
}

/** The row whose link a click landed on, if it landed on one. */
function openedRow(
  event: MouseEvent,
  rows: readonly NewSubmissionRow[]
): NewSubmissionRow | undefined {
  if (!(event.target instanceof Element)) return undefined;
  const href = event.target.closest("a[href]")?.getAttribute("href");
  return href === null || href === undefined
    ? undefined
    : rows.find(row => row.href === href);
}

/**
 * Nothing new, with a way to every submission. Offered to whoever sees the
 * card: the card is shown only to a reader who may read the submissions
 * collection the site installed, which is where the link leads.
 */
function NothingNew({ allHref }: { allHref: string }): JSX.Element {
  return (
    <FrameState
      state={{
        kind: "empty",
        empty: {
          title: "No new submissions",
          action: { label: "All submissions", href: allHref },
        },
      }}
    />
  );
}

/** The card's rows, as many as its size holds. */
export function NewSubmissionsCard({
  data,
}: {
  data: NewSubmissionsData;
}): JSX.Element {
  // One instant for every row, moved on each minute while the card is
  // mounted, so "just now" becomes "1m ago" without the card being reloaded.
  const now = useWidgetClock();
  const refresh = useRefreshDashboard();
  // The title carries how many are new, the total the header's part counts
  // from the same read ("1000+" where that is a floor); nothing while none
  // are, as the empty state says so.
  Widget.useTitleCount(
    data.total > 0 ? data.total : undefined,
    data.atLeast === true
  );
  if (data.total === 0) return <NothingNew allHref={data.allHref} />;
  // Opening a row, by a click or a middle click into a new tab, marks its
  // submission read; a click anywhere else in the card does nothing. Once it
  // is taken, the cards and the header's count are asked again: a dashboard
  // left open behind a new tab would otherwise go on listing it.
  const opened = (event: MouseEvent) => {
    const row = openedRow(event, data.items);
    if (row === undefined) return;
    void markRead(data.collection, row.id).then(taken => {
      if (taken) refresh();
    });
  };
  return (
    // Laid out as if absent (`contents`), so the list sits in the card's body
    // exactly as it would alone; it is here to hear a row being opened.
    <div
      className="contents"
      onClickCapture={opened}
      onAuxClickCapture={event => {
        if (event.button === MIDDLE_BUTTON) opened(event);
      }}
    >
      <Widget.List
        rows={data.items}
        title={row => row.title}
        href={row => row.href}
        meta={metaOf}
        trailing={row =>
          row.at === undefined ? undefined : (
            <time dateTime={row.at}>{formatWidgetTime(row.at, now)}</time>
          )
        }
        viewAllHref={data.allHref}
      />
    </div>
  );
}
