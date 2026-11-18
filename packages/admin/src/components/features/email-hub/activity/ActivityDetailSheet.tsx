"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
} from "@nextlyhq/ui";
import type { JSX, ReactNode } from "react";

import { X } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import {
  useActivityDetail,
  type ActivityDetail,
  type OpenActivity,
} from "@admin/hooks/queries/useEmailActivity";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";

import { notStoredLabel } from "./activity-choices";
import {
  attemptText,
  detailState,
  failureKindOf,
  versionText,
} from "./activity-detail-model";
import { RECIPIENT_KIND_LABELS, dueText } from "./activity-model";
import type { ActivityNames } from "./ActivityList";

export interface ActivityDetailSheetProps {
  /** The row whose sheet is open, or null when none is. */
  open: OpenActivity | null;
  onClose: () => void;
  names: ActivityNames;
  now: Date;
  /**
   * Where "Fix template" opens a template in the workbench, or undefined when
   * this reader may not edit it or it is not in the hub's list.
   */
  fixTemplateHref: (slug: string) => string | undefined;
}

/** How many attempts the sheet draws, the newest; the rest are counted. */
const TIMELINE_SHOWN = 100;

/** A time in the site's zone, as every admin date is written. */
function timeText(iso: string): string {
  return formatDateWithAdminTimezone(
    iso,
    {
      locale: "en",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
    ""
  );
}

/** One row of the details list. */
function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

/** What the state box is built from, for a delivery or a queued email alike. */
function stateInput(data: ActivityDetail): Parameters<typeof detailState>[0] {
  if (data.source === "delivery") {
    const d = data.detail;
    return {
      // A delivery with a queued email behind it is one of its attempts, and
      // whether another follows is that queued email's to say.
      source: d.queuedId ? "attempt" : "delivery",
      // Only a queued email knows its failure came from its template; a
      // delivery is a provider's answer.
      templateCaused: false,
      attemptOnRecord: true,
      outcome: d.outcome,
      failureKind: d.failureKind,
      failureStatus: d.failureStatus,
      failureReason: d.failureReason,
    };
  }
  const d = data.detail;
  return {
    source: "queued",
    templateCaused: d.templateCaused,
    attemptOnRecord: d.timeline.length > 0,
    outcome: d.state,
    // The queued email's own failure, which every way it can fail records,
    // read with its newest attempt for an outcome that can't be known.
    failureKind: failureKindOf(d.lastFailure, d.timeline.at(-1)),
    failureStatus: d.lastFailure?.status ?? null,
    failureReason: d.lastFailure?.reason ?? null,
  };
}

/** The sheet's state first: what happened, why, and what to do. */
function StateBox({ data }: { data: ActivityDetail }): JSX.Element {
  const state = detailState(stateInput(data));
  return (
    <Alert variant={state.todo !== null ? "warning" : "info"} role="status">
      <AlertTitle>{state.title}</AlertTitle>
      {(state.reason || state.todo) && (
        <AlertDescription className="space-y-1">
          {state.reason && <p>{state.reason}</p>}
          {state.todo && (
            <p>
              <span className="font-medium">What to do. </span>
              {state.todo}
            </p>
          )}
        </AlertDescription>
      )}
    </Alert>
  );
}

/** Every attempt, oldest first, with each provider's structured answer. */
function Timeline({ data }: { data: ActivityDetail }): JSX.Element {
  const { timeline, timelineTruncated } = data.detail;
  // The server answers up to ten thousand attempts for an email sent to many
  // people; the newest are drawn, and the rest are counted, so opening the
  // sheet never builds a page that large.
  const shown = timeline.slice(-TIMELINE_SHOWN);
  const hidden = timeline.length - shown.length;
  return (
    <section aria-label="Attempts" className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Attempts
      </h3>
      {(timelineTruncated || hidden > 0) && (
        <p className="text-xs text-muted-foreground">
          {hidden > 0
            ? `The newest ${shown.length} are shown; ${hidden}${timelineTruncated ? "+" : ""} earlier ${hidden === 1 ? "attempt isn’t" : "attempts aren’t"}.`
            : "Older attempts aren’t shown."}
        </p>
      )}
      {timeline.length === 0 ? (
        <p className="text-sm text-muted-foreground">No attempt yet.</p>
      ) : (
        <ol className="space-y-3 border-l border-border pl-4">
          {shown.map(attempt => {
            const text = attemptText(attempt);
            return (
              <li key={attempt.id} className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge
                    variant={
                      attempt.outcome === "sent" ? "success" : "destructive"
                    }
                  >
                    {text.outcome}
                  </Badge>
                  <span className="text-muted-foreground">
                    {timeText(attempt.createdAt)}
                  </span>
                </div>
                <p className="break-words text-xs text-muted-foreground">
                  {text.detail}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Who queued an email, as the reader would say it. */
function queuedByText(queuedBy: string): string {
  if (queuedBy === "core") return "Nextly";
  if (queuedBy === "site") return "This site";
  return queuedBy.startsWith("plugin:")
    ? `The ${queuedBy.slice("plugin:".length)} plugin`
    : queuedBy;
}

/** A delivery's own details: its provider, recipient and person. */
function DeliveryDetails({
  data,
  names,
}: {
  data: Extract<ActivityDetail, { source: "delivery" }>;
  names: ActivityNames;
}): JSX.Element {
  const d = data.detail;
  const provider = d.provider.id
    ? (names.provider(d.provider.id) ?? d.provider.type)
    : notStoredLabel(d.provider.type);
  const person = d.erased
    ? "Erased since"
    : d.namedPerson
      ? "Named a person on the site"
      : "Not a person on the site";
  return (
    <>
      <Detail term="Provider">{provider}</Detail>
      <Detail term="Recipient">
        {RECIPIENT_KIND_LABELS[d.recipientKind]} · address not kept
      </Detail>
      <Detail term="Person">{person}</Detail>
    </>
  );
}

/** A queued email's own details: its attempts, next attempt, message and sender. */
function QueuedDetails({
  data,
  now,
}: {
  data: Extract<ActivityDetail, { source: "queued" }>;
  now: Date;
}): JSX.Element {
  const d = data.detail;
  return (
    <>
      <Detail term="Attempts">{d.attempts ?? "Not recorded"}</Detail>
      {d.nextAttemptAt && (
        <Detail term="Next attempt">
          {dueText(new Date(d.nextAttemptAt), now, "Due")}
        </Detail>
      )}
      <Detail term="Message">
        {d.messageHeld
          ? "Held, encrypted, so it can still be sent"
          : "Cleared, so it can’t be sent again"}
      </Detail>
      <Detail term="Queued by">{queuedByText(d.queuedBy)}</Detail>
    </>
  );
}

/** The details below the state: time, template, version, then its own. */
function Details({
  data,
  names,
  now,
}: {
  data: ActivityDetail;
  names: ActivityNames;
  now: Date;
}): JSX.Element {
  const slug = data.detail.templateSlug;
  const version = versionText(data.detail.templateVersion);
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Detail term="Time">{timeText(data.detail.createdAt)}</Detail>
      <Detail term="Template">
        {slug ? (names.template(slug) ?? slug) : "No template recorded"}
      </Detail>
      <Detail term="Version sent">
        {version.label}
        {version.digest && (
          <span className="block font-mono text-xs text-muted-foreground">
            Version {version.digest}
          </span>
        )}
      </Detail>
      {data.source === "delivery" ? (
        <DeliveryDetails data={data} names={names} />
      ) : (
        <QueuedDetails data={data} now={now} />
      )}
    </dl>
  );
}

/** Where "Fix template" goes for this sheet, when it is offered at all. */
function fixHrefOf(
  data: ActivityDetail | undefined,
  fixTemplateHref: (slug: string) => string | undefined
): string | undefined {
  // Only a queued email's failure is known to have come from its template:
  // a direct send that failed to render left no record to open.
  if (data?.source !== "queued" || !data.detail.templateCaused)
    return undefined;
  const slug = data.detail.templateSlug;
  return slug ? fixTemplateHref(slug) : undefined;
}

/**
 * A delivery's or a queued email's detail sheet: its state first, then its
 * details and every attempt. Full-screen on a phone, a side sheet from the
 * small breakpoint up. Read only while open.
 */
export function ActivityDetailSheet({
  open,
  onClose,
  names,
  now,
  fixTemplateHref,
}: ActivityDetailSheetProps): JSX.Element {
  const detail = useActivityDetail(open);
  const data = detail.data;
  const slug = data?.detail.templateSlug ?? null;
  const fixHref = fixHrefOf(data, fixTemplateHref);
  return (
    <Sheet open={open !== null} onOpenChange={next => !next && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:w-[480px] sm:max-w-[480px]"
      >
        <SheetHeader className="relative shrink-0 space-y-0.5 border-b border-border px-5 py-4 pr-14 text-left">
          {/* On a phone the sheet covers the whole screen, overlay included,
              so this is the only way back to the list without a keyboard. */}
          <SheetClose asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close"
              className="absolute right-3 top-3"
            >
              <X className="size-4" aria-hidden />
            </Button>
          </SheetClose>
          <SheetTitle className="break-words text-base">
            {slug ? (names.template(slug) ?? slug) : "Email"}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {open?.source === "queued" ? "Queued email" : "Delivery"}
            {data ? ` · ${timeText(data.detail.createdAt)}` : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {detail.isLoading && (
            <div className="space-y-3" aria-busy="true" aria-label="Loading">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          {detail.isError && data && (
            // A later read failed: what loaded before stays, said to be so,
            // since its state and advice may have moved on.
            <p role="status" className="text-sm text-muted-foreground">
              Couldn’t refresh, so this shows what loaded before.
            </p>
          )}
          {detail.isError && !data && (
            <Alert variant="destructive">
              <AlertTitle>This couldn’t be loaded</AlertTitle>
              <AlertDescription>
                {detail.error?.message ?? "Try again in a moment."}
              </AlertDescription>
            </Alert>
          )}
          {data && (
            <>
              <StateBox data={data} />
              {fixHref && (
                <Button asChild variant="outline" size="sm">
                  <Link href={fixHref}>Fix template</Link>
                </Button>
              )}
              <Details data={data} names={names} now={now} />
              <Timeline data={data} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
