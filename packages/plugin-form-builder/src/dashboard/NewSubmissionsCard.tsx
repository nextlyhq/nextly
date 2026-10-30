"use client";

/**
 * The New form submissions card's body: the newest new submissions as core's
 * list rows, each opening its submission, with the card's footer leading to
 * every submission.
 *
 * Drawn only with data: the frame draws loading, the empty state ("No new
 * submissions", from the declaration) and every failure itself. Built from the
 * widget kit alone, so it reads like core's list cards beside it.
 *
 * @module dashboard/NewSubmissionsCard
 */

import { Widget } from "@nextlyhq/plugin-sdk/admin";
import { useState, type JSX } from "react";

import type { NewSubmissionRow, NewSubmissionsData } from "./new-submissions";
import { relativeTime } from "./relative-time";

/** What a row says under its title: its form, and the first line of its first text answer. */
function metaOf(row: NewSubmissionRow): readonly string[] {
  return [row.form, row.excerpt].filter(
    (part): part is string => part !== undefined
  );
}

/** The card's rows, as many as its size holds. */
export function NewSubmissionsCard({
  data,
}: {
  data: NewSubmissionsData;
}): JSX.Element {
  // One instant for every row, read once when the card mounts, so two rows a
  // second apart never read from two clocks and a render stays pure.
  const [now] = useState(() => Date.now());
  return (
    <Widget.List
      rows={data.items}
      title={row => row.title}
      href={row => row.href}
      meta={metaOf}
      trailing={row =>
        row.at === undefined ? undefined : (
          <time dateTime={row.at}>{relativeTime(row.at, now)}</time>
        )
      }
      viewAllHref={data.allHref}
    />
  );
}
