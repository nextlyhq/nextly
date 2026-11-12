"use client";

/**
 * A submission's emails, on its page: each notification it triggered, every
 * recipient with its latest result (Waiting, Retrying, Sending, Sent, Sent
 * after N retries, Failed, Cancelled and why), and when. A notification whose
 * recipients differ reads Partly sent.
 *
 * Resend is offered to a person who may both update submissions and manage
 * email deliveries, never while a send is in progress: the row says one is.
 * It sends to the recipients who have not received it, and to any the person
 * ticks among those the notification can address now.
 *
 * @module admin/components/submissions/SubmissionEmails
 */
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from "@nextlyhq/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Send } from "lucide-react";
import { type JSX, useState } from "react";

import {
  type AddressableRecipient,
  cancelText,
  notificationLook,
  recipientLook,
  type RecipientStatus,
  type StatusLook,
} from "../../../utils/send-status";

import { shortWhenText } from "./submission-row";

/** Where the plugin's routes answer. */
const ROUTES = "/admin/api/plugins/@nextlyhq/plugin-form-builder";

/** One notification's sends, as `GET /submissions/:id/sends` answers it. */
export interface NotificationSendsView {
  notification: string | null;
  name: string;
  recipients: RecipientStatus[];
  inProgress: boolean;
  sends: Array<{
    queuedId: string;
    state: string;
    attempts: number;
    at: string | null;
    requestedBy: string | null;
    retired: boolean;
  }>;
  addressable: AddressableRecipient[];
}

/** The dot each tone draws, from the admin's tokens. */
const TONE_DOT: Record<StatusLook["tone"], string> = {
  ok: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  quiet: "bg-muted-foreground",
};

/** A status as a quiet chip with a dot. */
export function SendChip({ look }: { look: StatusLook }): JSX.Element {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-card px-2 text-xs font-medium text-foreground">
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[look.tone]}`}
      />
      {look.label}
    </span>
  );
}

/** The line a recipient takes in words. */
function lineOf(recipient: RecipientStatus): string {
  return recipient.kind === "to"
    ? "To"
    : recipient.kind === "cc"
      ? "Cc"
      : "Bcc";
}

/** Who a notification went to, by line: `To t•••@acme.test · Cc …`. */
export function recipientsText(recipients: readonly RecipientStatus[]): string {
  const lines = new Map<string, string[]>();
  for (const recipient of recipients) {
    const line = lineOf(recipient);
    lines.set(line, [...(lines.get(line) ?? []), recipient.hint]);
  }
  return [...lines]
    .map(([line, hints]) => `${line} ${hints.join(", ")}`)
    .join(" · ");
}

/**
 * What the row says under the notification's name: who it went to, and,
 * when its recipients differ, what became of each; a cancel's cause; a send
 * made again; a send in progress.
 */
function detailOf(group: NotificationSendsView, look: StatusLook): string[] {
  const parts = [recipientsText(group.recipients)];
  if (look.label === "Partly sent") {
    parts.push(
      group.recipients
        .map(
          recipient =>
            `${recipient.hint} ${recipientLook(recipient).label.toLowerCase()}`
        )
        .join("; ")
    );
  }
  const cancelled = group.recipients.find(
    recipient => recipient.state === "cancelled"
  );
  if (cancelled) parts.push(cancelText(cancelled.cancel));
  if (group.sends.some(send => send.requestedBy !== null)) {
    parts.push("Sent again on request");
  }
  return parts;
}

/** The latest time a notification's sends changed. */
function latestAt(group: NotificationSendsView): string | null {
  return group.sends.reduce<string | null>(
    (latest, send) =>
      send.at !== null && (latest === null || send.at > latest)
        ? send.at
        : latest,
    null
  );
}

/** Asks which recipients to send a notification to again. */
function ResendDialog({
  group,
  open,
  onOpenChange,
  onSend,
  pending,
  error,
}: {
  group: NotificationSendsView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (tick: string[]) => void;
  pending: boolean;
  error: string | null;
}): JSX.Element {
  const [ticked, setTicked] = useState<string[]>([]);
  const missed = group.addressable.filter(recipient => !recipient.reached);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send “{group.name}” again</DialogTitle>
          <DialogDescription>
            It goes to everyone below who has not received it. Tick anyone who
            has, to send it to them again.
          </DialogDescription>
        </DialogHeader>
        <ul aria-label="Recipients" className="flex flex-col gap-2">
          {group.addressable.map(recipient => {
            const id = `resend-${recipient.digest}`;
            return (
              <li key={recipient.digest} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={
                    !recipient.reached || ticked.includes(recipient.digest)
                  }
                  disabled={!recipient.reached}
                  onCheckedChange={checked =>
                    setTicked(
                      checked === true
                        ? [...ticked, recipient.digest]
                        : ticked.filter(digest => digest !== recipient.digest)
                    )
                  }
                />
                <Label htmlFor={id} className="text-sm font-normal">
                  {recipient.hint}{" "}
                  <span className="text-muted-foreground">
                    {recipient.reached
                      ? "· received it"
                      : "· has not received it"}
                  </span>
                </Label>
              </li>
            );
          })}
        </ul>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || (missed.length === 0 && ticked.length === 0)}
            onClick={() => onSend(ticked)}
          >
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What a refused resend says, from the route's error envelope. */
async function refusalOf(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return body?.error?.message ?? "It could not be sent again.";
}

/** Resend for one notification, as its row offers it. */
function useResend(submissionId: string, notification: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (tick: string[]) => {
      const response = await fetch(
        `${ROUTES}/submissions/${encodeURIComponent(submissionId)}/resend`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ notification, tick }),
        }
      );
      if (!response.ok) throw new Error(await refusalOf(response));
    },
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: ["form-builder", "submission-sends", submissionId],
      }),
  });
}

/** The row's action: Resend, or why it is not offered now. */
function ResendAction({
  submissionId,
  group,
}: {
  submissionId: string;
  group: NotificationSendsView;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const resend = useResend(submissionId, group.notification);
  if (group.inProgress) {
    return (
      <span className="block text-xs text-muted-foreground" role="status">
        A send is in progress.
      </span>
    );
  }
  if (group.addressable.length === 0) return null;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        // Pulled left by its own padding, so its icon lines up with the
        // notification's name above it.
        className="-ml-2 h-7 gap-1.5 px-2"
        onClick={() => {
          resend.reset();
          setOpen(true);
        }}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        Resend
      </Button>
      <ResendDialog
        group={group}
        open={open}
        onOpenChange={setOpen}
        pending={resend.isPending}
        error={resend.error ? resend.error.message : null}
        onSend={tick =>
          resend.mutate(tick, { onSuccess: () => setOpen(false) })
        }
      />
    </>
  );
}

/** One notification's row. */
function NotificationRow({
  submissionId,
  group,
  canResend,
}: {
  submissionId: string;
  group: NotificationSendsView;
  canResend: boolean;
}): JSX.Element {
  const look = notificationLook(group.recipients);
  const at = latestAt(group);
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-3 py-2.5">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"
      >
        <Send className="h-3 w-3" />
      </span>
      <div className="min-w-0 text-sm">
        <span className="font-medium text-foreground">{group.name}</span>
        {detailOf(group, look).map(part => (
          <span
            key={part}
            className="block break-words text-xs text-muted-foreground"
          >
            {part}
          </span>
        ))}
        {canResend ? (
          <div className="mt-1">
            <ResendAction submissionId={submissionId} group={group} />
          </div>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-1">
        <SendChip look={look} />
        {at ? (
          <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
            {shortWhenText(at)}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/** How often the emails are read again while a send is in progress. */
const IN_PROGRESS_REFRESH_MS = 5000;

/** The submission's sends, as its route answers them. */
function useSubmissionSends(submissionId: string, status: string | undefined) {
  return useQuery({
    // By status too: marking Spam cancels what is waiting.
    queryKey: ["form-builder", "submission-sends", submissionId, status],
    // A send in progress settles in the background, and the admin does not
    // refetch on focus: read again until every send has settled, so the page
    // stops saying "in progress" and offers Resend once it may.
    refetchInterval: query =>
      query.state.data?.some(group => group.inProgress)
        ? IN_PROGRESS_REFRESH_MS
        : false,
    queryFn: async (): Promise<NotificationSendsView[]> => {
      const response = await fetch(
        `${ROUTES}/submissions/${encodeURIComponent(submissionId)}/sends`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("The emails could not be read.");
      const body = (await response.json()) as {
        items?: NotificationSendsView[];
      };
      return body.items ?? [];
    },
  });
}

/** A submission's emails, inside its page's Emails box. */
export function SubmissionEmails({
  submissionId,
  status,
  canResend,
}: {
  submissionId: string;
  status?: string;
  canResend: boolean;
}): JSX.Element {
  const { data, error } = useSubmissionSends(submissionId, status);
  if (error) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground sm:px-5">
        {error.message}
      </p>
    );
  }
  if (data === undefined) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground sm:px-5">
        Reading emails…
      </p>
    );
  }
  if (data.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground sm:px-5">
        This submission sent no emails.
      </p>
    );
  }
  return (
    <ol className="divide-y divide-border px-4 sm:px-5">
      {data.map(group => (
        <NotificationRow
          key={group.notification ?? group.sends[0]?.queuedId ?? group.name}
          submissionId={submissionId}
          group={group}
          canResend={canResend}
        />
      ))}
    </ol>
  );
}
