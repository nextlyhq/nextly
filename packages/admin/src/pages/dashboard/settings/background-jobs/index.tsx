"use client";

/**
 * Background jobs — what the queue recently did.
 *
 * A background job that fails is invisible. There is no request to inspect, no
 * status code, and no page that went blank, so a scheduled release that did not
 * publish looks exactly like one that was not due yet. This screen is the place
 * that difference becomes visible.
 *
 * READ-ONLY, deliberately. No retry, cancel or requeue: each is a write on
 * already-authorized work and needs its own decision about who may perform it,
 * and offering them beside a read would settle those questions by omission.
 *
 * Two honesty rules shape the layout. Failures are stated ABOVE the table,
 * because an operator opening this page is nearly always answering "did the
 * thing I expected happen", and a red row twelve lines down is a worse answer
 * than a sentence at the top. And the retention window is stated at the bottom,
 * because a list that silently forgets is one an operator will read as proof
 * that a job never ran.
 */

import { Alert, AlertDescription, TableSkeleton } from "@nextlyhq/ui";
import type React from "react";
import { useEffect, useState } from "react";

import {
  JobFailureSummary,
  JobsTable,
} from "@admin/components/features/background-jobs";
import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { JOBS_POLL_INTERVAL_MS, useJobs } from "@admin/hooks/queries/useJobs";
import { useCan } from "@admin/hooks/useCan";
import {
  DEFAULT_JOB_RETENTION_DAYS,
  storedStatesFor,
  type JobDisplayStatus,
  type JobWindowSize,
  type ListJobsParams,
} from "@admin/types/jobs";

const BACKGROUND_JOBS_PAGE = {
  title: "Background Jobs",
  description:
    "What the queue recently ran, and what it could not finish. Read-only.",
  crumb: "Background Jobs",
} as const;

const DEFAULT_WINDOW: JobWindowSize = 50;

/**
 * What the table asks the server for.
 *
 * A window is the most recent N rows, so narrowing it only after it arrives
 * showed an empty table under a notice reporting a failure — the summary asked
 * the database and the table did not, and one screen contradicted itself.
 *
 * The display vocabulary does not map onto the stored column one-for-one, so
 * this narrows to the states that CAN produce the chosen status and the caller
 * separates the ones that share a state. Exported because it is the decision
 * worth asserting, and driving it through the select control would test the
 * control rather than the query.
 */
export function jobsQueryFor(
  windowSize: JobWindowSize,
  status: JobDisplayStatus | undefined
): ListJobsParams {
  if (status === undefined) return { limit: windowSize };
  return { limit: windowSize, states: storedStatesFor(status) };
}

export const BackgroundJobsContent: React.FC = () => {
  const canRead = useCan("manage-background-jobs");
  const [windowSize, setWindowSize] = useState<JobWindowSize>(DEFAULT_WINDOW);
  const [status, setStatus] = useState<JobDisplayStatus | undefined>();

  /*
   * The status filter is sent to the SERVER, not only applied to what came
   * back.
   *
   * A window is the most recent N rows, so filtering it locally showed an empty
   * table under a notice reporting a failure — the summary asks the database
   * and the table did not, and the two disagreed on one screen. The display
   * vocabulary does not map onto the column one-for-one, so the query narrows
   * by the stored states that CAN produce the chosen status and the refinement
   * below separates the ones sharing a state.
   */
  const { data, isLoading, isError, error, isPlaceholderData } = useJobs(
    jobsQueryFor(windowSize, status),
    { enabled: canRead }
  );

  /*
   * The clock ages are measured against, advanced on the poll's own cadence.
   *
   * Read once per render from `new Date()` instead, and every row's "4 minutes
   * ago" would freeze between fetches while the page looks live — and any
   * render for an unrelated reason would jump them forward. One ticking value
   * keeps every row's age consistent with every other row's.
   */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), JOBS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  if (!canRead) {
    return (
      <Alert variant="info" role="status">
        <AlertDescription>
          You do not have permission to view background jobs.
        </AlertDescription>
      </Alert>
    );
  }

  if (isError) {
    return (
      <PageErrorFallback error={error ?? new Error("Failed to load jobs")} />
    );
  }

  if (isLoading && !data) {
    return <TableSkeleton columns={6} rowCount={8} />;
  }

  const items = data?.items ?? [];
  // The remaining refinement, and it is a property of the vocabulary rather
  // than a shortcut: `waiting` and `retrying` are the SAME stored state, and a
  // live lease makes any state display as `running`, so the column cannot
  // separate them. The query above has already narrowed to the states that can
  // produce this status, so what is dropped here is only the rows that share a
  // state with it.
  const visible =
    status === undefined ? items : items.filter(job => job.status === status);

  return (
    <div className="space-y-6">
      <JobFailureSummary linkToMonitor={false} limit={windowSize} />

      <JobsTable
        rows={visible}
        isLoading={isPlaceholderData}
        status={status}
        windowSize={windowSize}
        now={now}
        onStatusChange={setStatus}
        onWindowSizeChange={setWindowSize}
      />

      <p className="text-xs text-muted-foreground">
        {status === undefined
          ? `Showing ${items.length} of the most recently active jobs.`
          : `Showing ${visible.length} of ${items.length} loaded jobs.`}{" "}
        {data?.meta.hasNext === true && (
          <>
            More exist than this window holds — raise &ldquo;Show&rdquo; to load
            them.{" "}
          </>
        )}
        Finished jobs are pruned — after {DEFAULT_JOB_RETENTION_DAYS} days
        unless this installation configured otherwise — so a job missing from
        this list may have run and been cleaned up rather than never having run.
        Refreshes every {Math.round(JOBS_POLL_INTERVAL_MS / 1000)} seconds while
        this tab is open.
      </p>
    </div>
  );
};

export default function BackgroundJobsPage() {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer width="wide">
        <SettingsLayout {...BACKGROUND_JOBS_PAGE}>
          <BackgroundJobsContent />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}
