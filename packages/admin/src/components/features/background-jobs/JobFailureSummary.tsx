"use client";

/**
 * "Something the queue was doing for you did not happen."
 *
 * Mounted on the background jobs screen, and designed to be mounted BESIDE the
 * object whose work failed — a release that was supposed to publish, a webhook
 * endpoint whose deliveries are draining. That is why it fetches and authorizes
 * for itself rather than taking rows from a parent: a page that wants the
 * notice adds one element and nothing else, and a page that has no business
 * showing it renders nothing.
 *
 * It renders NOTHING in three cases, all of them silence rather than emptiness:
 * the viewer may not read jobs, the window is still loading, or nothing failed.
 * A notice that appears only when there is something to say can be placed on a
 * page that is usually fine without adding permanent furniture to it.
 *
 * Retrying jobs are excluded on purpose. They are the system healing itself,
 * and a notice that fires for them teaches its reader to ignore it — which
 * costs exactly the failure this component exists to surface.
 */

import { Alert, AlertDescription, AlertTitle } from "@nextlyhq/ui";
import type React from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useJobs } from "@admin/hooks/queries/useJobs";
import { useCan } from "@admin/hooks/useCan";
import { JOB_RETENTION_DAYS, type JobListItem } from "@admin/types/jobs";

export interface JobFailureSummaryProps {
  /**
   * Restrict to one task, e.g. `releases:drain`.
   *
   * Omitted means every task, which is what the jobs screen itself wants.
   */
  slug?: string;
  /** Render a link to the full monitor. Off where this IS the monitor. */
  linkToMonitor?: boolean;
  /**
   * How many recent rows to consider.
   *
   * The window is the endpoint's own recent history, so this reports failures
   * among what it can see rather than a true count — see the wording below,
   * which never claims to be exhaustive.
   */
  limit?: number;
}

/** Terminal failures only; a retry in flight is not one. */
export function failedJobs(
  items: readonly JobListItem[],
  slug?: string
): JobListItem[] {
  return items.filter(
    job => job.status === "failed" && (slug === undefined || job.slug === slug)
  );
}

/** The distinct task names among a set of failures, in first-seen order. */
export function failedSlugs(failures: readonly JobListItem[]): string[] {
  return [...new Set(failures.map(job => job.slug))];
}

export const JobFailureSummary: React.FC<JobFailureSummaryProps> = ({
  slug,
  linkToMonitor = true,
  limit = 50,
}) => {
  const canRead = useCan("manage-background-jobs");
  const { data } = useJobs({ limit }, { enabled: canRead });

  if (!canRead || !data) return null;

  const failures = failedJobs(data.items, slug);
  if (failures.length === 0) return null;

  const tasks = failedSlugs(failures);
  const count = failures.length;

  return (
    <Alert variant="destructive" role="status">
      <AlertTitle>
        {count === 1
          ? "A background job failed"
          : `${count} background jobs failed`}
      </AlertTitle>
      <AlertDescription>
        {/* Named rather than counted: "2 failed" tells an operator to go
            looking, "releases:drain failed" tells them what did not happen. */}
        <span>
          {tasks.join(", ")} stopped after using every attempt, so the work will
          not happen without someone. Failures within the last{" "}
          {JOB_RETENTION_DAYS} days.
        </span>
        {linkToMonitor && (
          <>
            {" "}
            <Link
              href={ROUTES.SETTINGS_BACKGROUND_JOBS}
              className="font-medium underline underline-offset-4"
            >
              Open background jobs
            </Link>
          </>
        )}
      </AlertDescription>
    </Alert>
  );
};
