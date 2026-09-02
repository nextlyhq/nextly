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
        name: "lastError",
        header: "Last error",
        hideOnMobile: true,
        cell: ({ row }) =>
          row.lastError === null ? (
            <span className="text-sm text-muted-foreground">-</span>
          ) : (
            // Full text in the tooltip: the truncation is for the table's
            // shape, and an error an operator cannot read is not reported.
            <span
              className="block max-w-80 truncate font-mono text-xs text-muted-foreground"
              title={row.lastError}
            >
              {row.lastError}
            </span>
          ),
      },
      {
        name: "nextAttemptAt",
        header: "Next attempt",
        hideOnMobile: true,
        cell: ({ row }) =>
          row.nextAttemptAt === null ? (
            <span className="text-sm text-muted-foreground">-</span>
          ) : (
            <span
              className="text-sm text-muted-foreground"
              title={formatJobTimestamp(row.nextAttemptAt)}
            >
              {formatJobAge(row.nextAttemptAt, now)}
            </span>
          ),
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
