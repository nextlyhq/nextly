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
import {
  ATTENTION_STATES,
  JOB_DISPLAY_STATUSES,
  DEFAULT_JOB_RETENTION_DAYS,
  jobNeedsAttention,
  type JobListItem,
} from "@admin/types/jobs";

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

/**
 * The jobs a person has to do something about.
 *
 * Two rules, and the second is the one that is easy to leave out. A status the
 * core calls actionable is kept, obviously. A status THIS BUILD DOES NOT KNOW
 * is also kept — because during a rolling deploy a newer server can send one,
 * and `jobNeedsAttention` answers false for it. Dropping those would make the
 * notice go quiet about the new kind of failure nobody has seen yet, which is
 * the one failure mode a notice must not have.
 *
 * What is dropped is only what this build knows to be QUIET: a retry in flight,
 * a job waiting, one that succeeded. That keeps the component honest about a
 * server sending rows it did not ask for, rather than reporting them as
 * failures because they arrived.
 */
export function jobsNeedingAttention(
  items: readonly JobListItem[],
  slug?: string
): JobListItem[] {
  const known = new Set<string>(JOB_DISPLAY_STATUSES);
  return items.filter(job => {
    if (slug !== undefined && job.slug !== slug) return false;
    return jobNeedsAttention(job.status) || !known.has(job.status);
  });
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
  // Narrowed by the SERVER when a task is named. Filtering the global window
  // here would filter rows a busier task had already crowded out, so this
  // notice would stay silent about exactly the failure it was mounted to
  // report.
  const { data, isError } = useJobs(
    {
      limit,
      ...(slug === undefined ? {} : { slug }),
      // Ask for the jobs that NEED ATTENTION, rather than for recent jobs to
      // sift. A window of the most recent rows cannot answer "did anything
      // fail": N healthy jobs running afterwards push the failure out of it,
      // and the notice then reports silence with the confidence of a check it
      // never performed.
      states: ATTENTION_STATES,
    },
    { enabled: canRead }
  );

  if (!canRead) return null;

  /*
   * A read that FAILED is not a read that found nothing.
   *
   * Collapsing them renders the same silence in both cases, which tells an
   * operator that nothing needs attention when the truth is that nothing could
   * be checked — the one wrong answer a safety notice must not give. Said
   * quietly, because it is a degraded monitor rather than a failed job.
   */
  if (isError) {
    return (
      <Alert variant="warning" role="status">
        <AlertTitle>Background job status unavailable</AlertTitle>
        <AlertDescription>
          The queue could not be read, so this page cannot say whether anything
          failed.
        </AlertDescription>
      </Alert>
    );
  }

  if (!data) return null;

  const failures = jobsNeedingAttention(data.items, slug);
  if (failures.length === 0) return null;

  const tasks = failedSlugs(failures);
  const count = failures.length;
  /*
   * The window may not hold every failure.
   *
   * `hasNext` says the server had more rows than this read asked for, so the
   * count is a LOWER BOUND rather than a total — and a notice that reports a
   * bound as a total is the same lie the screen's own truncation notice exists
   * to prevent, made worse by being the headline.
   */
  const truncated = data.meta.hasNext === true;

  return (
    <Alert variant="destructive" role="status">
      <AlertTitle>
        {truncated
          ? `At least ${count} background job${count === 1 ? "" : "s"} failed`
          : count === 1
            ? "A background job failed"
            : `${count} background jobs failed`}
      </AlertTitle>
      <AlertDescription>
        {/* Named rather than counted: "2 failed" tells an operator to go
            looking, "releases:drain failed" tells them what did not happen. */}
        <span>
          {tasks.join(", ")} stopped and will not be retried, so the work will
          not happen without someone.{" "}
          {truncated
            ? "Counted among the most recent jobs loaded; older failures may exist."
            : `Among jobs from roughly the last ${DEFAULT_JOB_RETENTION_DAYS} days, the default retention.`}
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
