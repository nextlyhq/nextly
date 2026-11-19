"use client";

import { Badge, Button, Skeleton } from "@nextlyhq/ui";
import type { JSX } from "react";

import { Lock, User } from "@admin/components/icons";
import type { OpenActivity } from "@admin/hooks/queries/useEmailActivity";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { formatRelativeTime } from "@admin/lib/dashboard";

import {
  RECIPIENT_KIND_LABELS,
  outcomeBadge,
  providerLabel,
  whatHappened,
  type ActivityRow,
} from "./activity-model";

/** How the list names a template and a provider, from what the hub knows. */
export interface ActivityNames {
  /** A template's name for its slug, or `undefined` when it isn't known. */
  template: (slug: string) => string | undefined;
  /** A stored provider's name for its id, or `undefined` when it isn't known. */
  provider: (id: string) => string | undefined;
}

export interface ActivityListProps {
  rows: ActivityRow[];
  names: ActivityNames;
  /** One reading of the clock for every row's relative time. */
  now: Date;
  isLoading: boolean;
  /** Whether any filter narrows the list, for the empty state's words. */
  filtered: boolean;
  /** Whether the rows are a search by address's, for the empty state's words. */
  searching?: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  /** Opens a row's detail sheet; rows aren't openable without it. */
  onOpen?: (open: OpenActivity) => void;
}

/**
 * "Nov 16, 12:30 PM", in the time zone General Settings names, as every
 * admin date is written, so a row's time and its "1d" agree on the day.
 */
function whenText(at: Date): string {
  return formatDateWithAdminTimezone(
    at,
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

/** Everything one row shows, worked out once for the table and the card alike. */
interface RowView {
  key: string;
  /** Which sheet this row opens. */
  open: OpenActivity;
  when: string;
  ago: string;
  badge: ReturnType<typeof outcomeBadge>;
  attempt: string | null;
  email: string;
  emailIsSlug: boolean;
  queued: boolean;
  person: string | null;
  provider: string;
  recipient: string;
  /**
   * Provider and recipient on one line, for widths that hide their columns:
   * whichever of the two is known, or null when neither is.
   */
  compact: string | null;
  happened: ReturnType<typeof whatHappened>;
}

/** The email a row names: the template's name, else its slug, else that it had none. */
function emailOf(
  row: ActivityRow,
  names: ActivityNames
): { email: string; emailIsSlug: boolean } {
  if (row.template === "none")
    return { email: "No template", emailIsSlug: false };
  if (row.template === "not-recorded") {
    return { email: "Template not recorded", emailIsSlug: false };
  }
  const { slug } = row.template;
  const name = names.template(slug);
  return name === undefined
    ? { email: slug, emailIsSlug: true }
    : { email: name, emailIsSlug: false };
}

/** Whether a delivery's recipient was erased since. */
function personOf(row: ActivityRow): string | null {
  return row.erased ? "Erased" : null;
}

/** To, Cc or Bcc, every kind a row went to; none to show before it is tried. */
function recipientOf(row: ActivityRow): string {
  if (row.recipientKinds === null || row.recipientKinds.length === 0) {
    return "—";
  }
  return row.recipientKinds.map(kind => RECIPIENT_KIND_LABELS[kind]).join(", ");
}

/**
 * Provider and recipient as one line: a queued email not yet tried still
 * knows who it goes to, so each part shows when it is known.
 */
function compactOf(provider: string, recipient: string): string | null {
  const known = [provider, recipient].filter(part => part !== "—");
  return known.length > 0 ? known.join(" · ") : null;
}

/** Which attempt a queued email is on, once it has made one. */
function attemptOf(row: ActivityRow): string | null {
  return row.source === "queued" && row.attempts !== null && row.attempts > 0
    ? `Attempt ${row.attempts}`
    : null;
}

function viewOf(row: ActivityRow, names: ActivityNames, now: Date): RowView {
  return {
    key: `${row.source}:${row.id}`,
    open: { source: row.source, id: row.id },
    when: whenText(row.at),
    ago: formatRelativeTime(row.at.toISOString(), now.getTime(), "short"),
    badge: outcomeBadge(row),
    attempt: attemptOf(row),
    ...emailOf(row, names),
    queued: row.source === "queued",
    person: personOf(row),
    provider: providerLabel(row.provider, names.provider),
    compact: compactOf(
      providerLabel(row.provider, names.provider),
      recipientOf(row)
    ),
    recipient: recipientOf(row),
    happened: whatHappened(row, now),
  };
}

function EmailCell({
  view,
  onOpen,
}: {
  view: RowView;
  onOpen?: (open: OpenActivity) => void;
}) {
  const nameClass = view.emailIsSlug
    ? "break-all font-mono text-xs"
    : "break-words font-medium";
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {onOpen ? (
          // The way into the row's sheet from the keyboard; a click anywhere
          // on the row opens it too.
          <button
            type="button"
            className={`${nameClass} rounded-sm text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
            onClick={event => {
              event.stopPropagation();
              onOpen(view.open);
            }}
          >
            {view.email}
          </button>
        ) : (
          <span className={nameClass}>{view.email}</span>
        )}
        {view.queued && (
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Queued
          </span>
        )}
      </div>
      {view.person && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <User className="h-3 w-3" aria-hidden />
          {view.person}
        </span>
      )}
    </div>
  );
}

function OutcomeCell({ view }: { view: RowView }) {
  return (
    <div className="space-y-1">
      <Badge variant={view.badge.variant}>{view.badge.label}</Badge>
      {view.attempt && (
        <div className="text-xs text-muted-foreground">{view.attempt}</div>
      )}
    </div>
  );
}

function HappenedCell({ view }: { view: RowView }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="font-medium">{view.happened.title}</div>
      {view.happened.detail && (
        <div className="break-words text-sm text-muted-foreground">
          {view.happened.detail}
        </div>
      )}
    </div>
  );
}

/** At tablet width and up: a table, one row per delivery or queued email. */
function ActivityTable({
  views,
  onOpen,
}: {
  views: RowView[];
  onOpen?: (open: OpenActivity) => void;
}) {
  return (
    <div className="hidden overflow-hidden rounded-lg border border-border md:block">
      <table className="w-full table-fixed text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th scope="col" className="w-40 px-4 py-3 font-medium">
              Time
            </th>
            <th scope="col" className="w-28 px-4 py-3 font-medium">
              Outcome
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Email
            </th>
            <th
              scope="col"
              className="hidden w-32 px-4 py-3 font-medium xl:table-cell"
            >
              Provider
            </th>
            <th
              scope="col"
              className="hidden w-24 px-4 py-3 font-medium xl:table-cell"
            >
              Recipient
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              What happened
            </th>
          </tr>
        </thead>
        <tbody>
          {views.map(view => (
            <tr
              key={view.key}
              className={`border-b border-border align-top last:border-b-0${onOpen ? " cursor-pointer hover:bg-muted/40" : ""}`}
              onClick={onOpen ? () => onOpen(view.open) : undefined}
            >
              <td className="px-4 py-3">
                <div className="whitespace-nowrap">{view.when}</div>
                <div className="text-xs text-muted-foreground">{view.ago}</div>
              </td>
              <td className="px-4 py-3">
                <OutcomeCell view={view} />
              </td>
              <td className="px-4 py-3">
                <EmailCell view={view} onOpen={onOpen} />
                {view.compact && (
                  // Below the width that shows the Provider and Recipient
                  // columns, carried under the email instead.
                  <div
                    data-compact-details
                    className="mt-1 break-words text-xs text-muted-foreground xl:hidden"
                  >
                    {view.compact}
                  </div>
                )}
              </td>
              <td className="hidden break-words px-4 py-3 xl:table-cell">
                {view.provider}
              </td>
              <td className="hidden px-4 py-3 xl:table-cell">
                {view.recipient}
              </td>
              <td className="px-4 py-3">
                <HappenedCell view={view} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** At phone width: a card per delivery or queued email, carrying the same. */
function ActivityCards({
  views,
  onOpen,
}: {
  views: RowView[];
  onOpen?: (open: OpenActivity) => void;
}) {
  return (
    <div className="space-y-3 md:hidden">
      {views.map(view => (
        <article
          key={view.key}
          className={`space-y-3 rounded-lg border border-border bg-card p-4${onOpen ? " cursor-pointer" : ""}`}
          onClick={onOpen ? () => onOpen(view.open) : undefined}
        >
          <div className="flex items-start justify-between gap-3">
            <EmailCell view={view} onOpen={onOpen} />
            <OutcomeCell view={view} />
          </div>
          <HappenedCell view={view} />
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <dt className="sr-only">Time</dt>
            <dd className="col-span-2">
              {view.when} · {view.ago}
            </dd>
            <dt>Provider</dt>
            <dd className="break-words text-foreground">{view.provider}</dd>
            <dt>Recipient</dt>
            <dd className="text-foreground">{view.recipient}</dd>
          </dl>
        </article>
      ))}
    </div>
  );
}

/**
 * The Activity list: every delivery and queued email, newest first, as a
 * table at tablet width and up and as cards on a phone, with "Load more" at
 * its end. It shows no address, subject or body, and says so.
 */
export function ActivityList({
  rows,
  names,
  now,
  isLoading,
  filtered,
  searching = false,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onOpen,
}: ActivityListProps): JSX.Element {
  const views = rows.map(row => viewOf(row, names, now));
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        This log keeps no addresses, subjects or bodies: only what happened, the
        template, the provider and the kind of recipient. A queued email&rsquo;s
        own message is held, encrypted, only while it can still be sent.
      </p>
      {isLoading ? (
        <div
          className="space-y-2"
          aria-busy="true"
          aria-label="Loading activity"
        >
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : views.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {searching
            ? "Nothing was sent to this address in this time."
            : filtered
              ? "Nothing matches these filters."
              : "No email has been sent in this time."}
        </div>
      ) : (
        <>
          <ActivityTable views={views} onOpen={onOpen} />
          <ActivityCards views={views} onOpen={onOpen} />
        </>
      )}
      {hasMore && !isLoading && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={onLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
