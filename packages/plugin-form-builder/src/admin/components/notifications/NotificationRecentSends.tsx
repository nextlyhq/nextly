"use client";

/**
 * A notification's recent sends, on its page: the latest submissions it went
 * out for, each with what became of it (Sent, Sent after a retry, Partly
 * sent, Failed, and the rest), who it went to by masked hint, and when, each
 * opening its submission. Shown to a person who may read submissions; the
 * route refuses anyone else, and the section then says nothing.
 *
 * @module admin/components/notifications/NotificationRecentSends
 */
import { FormSection } from "@nextlyhq/ui";
import { useQuery } from "@tanstack/react-query";
import type { JSX } from "react";

import {
  notificationLook,
  type RecipientStatus,
} from "../../../utils/send-status";
import { submissionPageAddress } from "../submissions/submission-list-scope";
import { shortWhenText } from "../submissions/submission-row";
import { recipientsText, SendChip } from "../submissions/SubmissionEmails";

/** Where the plugin's routes answer. */
const ROUTES = "/admin/api/plugins/@nextlyhq/plugin-form-builder";

/** How many recent sends the page lists. */
const RECENT = 10;

/** One recent send, as `GET /notification-sends` answers it. */
export interface RecentSendView {
  submission: string;
  title: string;
  recipients: RecipientStatus[];
  at: string | null;
}

/** The notification's recent sends, or undefined while unknown or refused. */
function useRecentSends(formId: string | undefined, notificationId: string) {
  return useQuery({
    enabled: formId !== undefined,
    queryKey: ["form-builder", "notification-sends", formId, notificationId],
    retry: false,
    queryFn: async (): Promise<RecentSendView[] | null> => {
      const response = await fetch(
        `${ROUTES}/notification-sends?${new URLSearchParams({
          form: formId ?? "",
          notification: notificationId,
          limit: String(RECENT),
        })}`,
        { credentials: "include" }
      );
      // A person who may not read submissions: nothing to show.
      if (response.status === 403) return null;
      if (!response.ok) throw new Error("Recent sends could not be read.");
      return (
        ((await response.json()) as { items?: RecentSendView[] }).items ?? []
      );
    },
  });
}

/** One recent send's row. */
function RecentRow({
  send,
  submissionsSlug,
}: {
  send: RecentSendView;
  submissionsSlug: string | undefined;
}): JSX.Element {
  const label = send.title || "Submission";
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-2.5 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <SendChip look={notificationLook(send.recipients)} />
      <span className="min-w-0 truncate text-foreground">
        {submissionsSlug ? (
          <a
            href={submissionPageAddress(submissionsSlug, send.submission, {
              status: "all",
            })}
            className="underline decoration-muted-foreground underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {label}
          </a>
        ) : (
          label
        )}
        <span className="text-muted-foreground">
          {" "}
          · {recipientsText(send.recipients)}
        </span>
      </span>
      <span className="col-start-2 whitespace-nowrap text-xs text-muted-foreground tabular-nums sm:col-start-auto">
        {send.at ? shortWhenText(send.at) : ""}
      </span>
    </li>
  );
}

/** The notification's Recent sends section. */
export function NotificationRecentSends({
  formId,
  notificationId,
  submissionsSlug,
}: {
  formId: string | undefined;
  notificationId: string;
  submissionsSlug: string | undefined;
}): JSX.Element | null {
  const { data, error } = useRecentSends(formId, notificationId);
  // Not saved yet, or not the person's to read: no section.
  if (formId === undefined || data === null) return null;
  return (
    <FormSection label="Recent sends">
      {error ? (
        <p className="text-sm text-muted-foreground">{error.message}</p>
      ) : data === undefined ? (
        <p className="text-sm text-muted-foreground">Reading recent sends…</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing sent yet. Each submission&apos;s email shows here once it goes
          out.
        </p>
      ) : (
        <ol className="divide-y divide-border">
          {data.map(send => (
            <RecentRow
              key={`${send.submission}:${send.at ?? ""}`}
              send={send}
              submissionsSlug={submissionsSlug}
            />
          ))}
        </ol>
      )}
    </FormSection>
  );
}
