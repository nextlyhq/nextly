"use client";

/**
 * The recent-jobs table.
 *
 * Presentational: the parent owns the window size and the status filter, and
 * every change is reported back. There is no pagination, because the endpoint
 * has none to offer — it answers "the most recent N" over a table that is
 * pruned behind you, and a page number into that is a promise it cannot keep.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import type React from "react";
import { useMemo } from "react";

import { DataTableView } from "@admin/components/ui/table/data-table";
import type { NextlyColumn } from "@admin/components/ui/table/data-table";
import {
  JOB_DISPLAY_STATUSES,
  JOB_WINDOW_SIZES,
  type JobDisplayStatus,
  type JobListItem,
  type JobWindowSize,
} from "@admin/types/jobs";

import {
  formatJobAge,
  formatJobTimestamp,
  JobStatusBadge,
  jobStatusPresentation,
} from "./jobStatus";

/** Sentinel for the "no filter" option (Radix Select forbids an empty value). */
const ALL = "all" as const;

/**
 * When this job is next expected to run, or `null` when nothing is scheduled.
 *
 * `runAt` is the SCHEDULE and `nextAttemptAt` is the RETRY, and the core's own
 * due rule reads both — a job scheduled for next Tuesday and never attempted
 * has `runAt` set and `nextAttemptAt` null. Reading only the retry showed a
 * dash for exactly the case that motivates this screen: a release scheduled to
 * publish, which an operator opens the monitor to ask about.
 *
 * The retry wins when both are present, because it is the later decision: a
 * job that failed an attempt runs at its backoff, not at its original time.
 */
export function dueAt(job: JobListItem): string | null {
  return job.nextAttemptAt ?? job.runAt;
}

/** Longer than this and the cell offers to expand rather than clipping. */
const ERROR_INLINE_LIMIT = 90;

/**
 * A recorded error, readable on every input device.
 *
 * A clipped line with the full text in `title` reads fine with a mouse and is
 * unreadable without one: touch devices have no reliable hover, so the only
 * complete copy was unreachable on exactly the screens an operator checks a
 * queue from. A short error is shown whole and wrapped; a long one becomes a
 * native disclosure, which is operable by pointer, touch and keyboard alike and
 * needs no script.
 */
const JobErrorCell: React.FC<{ error: string | null }> = ({ error }) => {
  if (error === null) {
    return <span className="text-sm text-muted-foreground">-</span>;
  }
  if (error.length <= ERROR_INLINE_LIMIT) {
    return (
      <span className="block max-w-80 font-mono text-xs break-words text-muted-foreground">
        {error}
      </span>
    );
  }
  return (
    <details className="max-w-80 group">
      <summary className="cursor-pointer list-none font-mono text-xs text-muted-foreground marker:content-none">
        <span className="line-clamp-2 break-words group-open:hidden">
          {error}
        </span>
        <span className="underline underline-offset-2 group-open:hidden">
          Show full error
        </span>
      </summary>
      <span className="mt-1 block font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">
        {error}
      </span>
    </details>
  );
};

export interface JobsTableProps {
  rows: JobListItem[];
  isLoading?: boolean;
  /** Active status filter; undefined means every status. */
  status?: JobDisplayStatus;
  windowSize: JobWindowSize;
  /** The instant ages are measured against, so a test can fix it. */
  now: Date;
  onStatusChange: (status?: JobDisplayStatus) => void;
  onWindowSizeChange: (size: JobWindowSize) => void;
}

export const JobsTable: React.FC<JobsTableProps> = ({
  rows,
  isLoading = false,
  status,
  windowSize,
  now,
  onStatusChange,
  onWindowSizeChange,
}) => {
  const columns = useMemo(
    (): NextlyColumn<JobListItem>[] => [
      {
        name: "status",
        header: "Status",
        cell: ({ row }) => <JobStatusBadge status={row.status} />,
      },
      {
        name: "slug",
        header: "Job",
        cell: ({ row }) => (
          <span className="font-medium text-foreground">{row.slug}</span>
        ),
      },
      {
        name: "attemptCount",
        header: "Attempts",
        hideOnMobile: true,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {row.attemptCount}
          </span>
        ),
      },
      {
        // Kept in the card view. `hideOnMobile` does not truncate a column, it
        // REMOVES it, so hiding this one leaves a phone showing that a job
        // failed with no way to read why — the single fact this screen exists
        // to deliver.
        name: "lastError",
        header: "Last error",
        cell: ({ row }) => <JobErrorCell error={row.lastError} />,
      },
      {
        name: "dueAt",
        header: "Due",
        hideOnMobile: true,
        cell: ({ row }) => {
          const due = dueAt(row);
          return due === null ? (
            <span className="text-sm text-muted-foreground">-</span>
          ) : (
            <span
              className="text-sm text-muted-foreground"
              title={formatJobTimestamp(due)}
            >
              {formatJobAge(due, now)}
            </span>
          );
        },
      },
      {
        name: "updatedAt",
        header: "Last activity",
        cell: ({ row }) => (
          <span
            className="text-sm text-muted-foreground"
            title={formatJobTimestamp(row.updatedAt)}
          >
            {formatJobAge(row.updatedAt, now)}
          </span>
        ),
      },
    ],
    [now]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <label
            className="text-sm text-muted-foreground"
            htmlFor="job-status-filter"
          >
            Status
          </label>
          <Select
            value={status ?? ALL}
            onValueChange={next =>
              onStatusChange(
                next === ALL ? undefined : (next as JobDisplayStatus)
              )
            }
          >
            <SelectTrigger id="job-status-filter" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {JOB_DISPLAY_STATUSES.map(value => (
                <SelectItem key={value} value={value}>
                  {jobStatusPresentation(value).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <label
            className="text-sm text-muted-foreground"
            htmlFor="job-window-size"
          >
            Show
          </label>
          <Select
            value={String(windowSize)}
            onValueChange={next =>
              onWindowSizeChange(Number(next) as JobWindowSize)
            }
          >
            <SelectTrigger id="job-window-size" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {JOB_WINDOW_SIZES.map(size => (
                <SelectItem key={size} value={String(size)}>
                  {size} rows
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTableView<JobListItem>
        columns={columns}
        rows={rows}
        // Declared rather than left to the reflective fallback, which the admin
        // conventions require and which keeps row identity part of this table's
        // contract instead of a property of whatever shape the row has today.
        getRowId={row => row.id}
        loading={isLoading}
        ariaLabel="Background jobs"
        emptyMessage={
          status === undefined
            ? "No background jobs have run recently."
            : `No ${jobStatusPresentation(status).label.toLowerCase()} jobs in this window.`
        }
      />
    </div>
  );
};
