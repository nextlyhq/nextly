"use client";

import { Alert, AlertDescription, AlertTitle } from "@nextlyhq/ui";
import type { JSX } from "react";

import { Clock } from "@admin/components/icons";
import { API_PATH_PREFIX } from "@admin/lib/api/fetcher";
import type { QueuedEmailOverdue } from "@admin/services/emailActivityApi";

/** Where the docs say how to run the jobs queue on a schedule. */
export const JOBS_TRIGGER_DOCS =
  "https://nextlyhq.com/docs/jobs#running-the-queue";

/**
 * The call that runs the jobs queue, which a schedule makes every minute,
 * under the same mount the admin's own requests go to, so the instruction
 * moves with it.
 */
export const JOBS_TRIGGER_PATH = `${API_PATH_PREFIX}/jobs/run`;

/** "3 queued emails", or "100+ queued emails" when the count stopped at its ceiling. */
export function overdueCountText(overdue: QueuedEmailOverdue): string {
  const count = `${overdue.overdue}${overdue.capped ? "+" : ""}`;
  return overdue.overdue === 1 && !overdue.capped
    ? "1 queued email has"
    : `${count} queued emails have`;
}

/**
 * Says that queued email is not being sent because the jobs trigger is not
 * running, and what to set up. Nothing is drawn while none is overdue.
 */
export function OverdueBanner({
  overdue,
}: {
  overdue: QueuedEmailOverdue | undefined;
}): JSX.Element | null {
  if (!overdue || overdue.overdue === 0) return null;
  return (
    <Alert variant="warning" role="status">
      <Clock className="h-4 w-4" aria-hidden />
      <AlertTitle>
        {overdueCountText(overdue)} waited more than{" "}
        {overdue.warningAfterMinutes} minutes
      </AlertTitle>
      <AlertDescription>
        <p>
          Queued email only moves when the jobs trigger runs. Set up a scheduled
          call to{" "}
          <code className="break-all font-mono text-xs">
            POST {JOBS_TRIGGER_PATH}
          </code>{" "}
          every minute.
        </p>
        <a
          href={JOBS_TRIGGER_DOCS}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block font-medium underline underline-offset-4"
        >
          How to set it up
        </a>
      </AlertDescription>
    </Alert>
  );
}
