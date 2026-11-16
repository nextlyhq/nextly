"use client";

import { Badge, Button, Skeleton } from "@nextlyhq/ui";
import type { JSX } from "react";

import { Lock, User } from "@admin/components/icons";
import { formatRelativeTime } from "@admin/lib/dashboard";

import {
  RECIPIENT_KIND_LABELS,
  outcomeBadge,
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
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}

/** "16 Nov, 12:30", in the reader's own time zone. */
const WHEN = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Everything one row shows, worked out once for the table and the card alike. */
interface RowView {
  key: string;
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
  happened: ReturnType<typeof whatHappened>;
}

function viewOf(row: ActivityRow, names: ActivityNames, now: Date): RowView {
  const name = row.templateSlug ? names.template(row.templateSlug) : undefined;
  const email =
    name ??
    row.templateSlug ??
    (row.source === "queued" ? "Template not recorded" : "No template");
  return {
    key: `${row.source}:${row.id}`,
    when: WHEN.format(row.at),
    ago: formatRelativeTime(row.at.toISOString(), now.getTime(), "short"),
    badge: outcomeBadge(row),
    attempt:
      row.source === "queued" && row.attempts > 0
        ? `Attempt ${row.attempts}`
        : null,
    email,
    emailIsSlug: name === undefined && row.templateSlug !== null,
    queued: row.source === "queued",
    person:
      row.source === "delivery"
        ? row.erased
          ? "Erased"
          : row.namedPerson
            ? "Named a person"
            : null
        : null,
    provider:
      row.source === "delivery"
        ? row.provider.id
          ? (names.provider(row.provider.id) ?? row.provider.type)
          : `${row.provider.type} (deleted)`
        : "—",
    recipient:
      row.source === "delivery"
        ? RECIPIENT_KIND_LABELS[row.recipientKind]
        : "—",
    happened: whatHappened(row, now),
  };
}

function EmailCell({ view }: { view: RowView }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={
            view.emailIsSlug
              ? "break-all font-mono text-xs"
              : "break-words font-medium"
          }
        >
          {view.email}
        </span>
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
      {view.happened.note && (
        <div className="text-xs text-muted-foreground">
          {view.happened.note}
        </div>
      )}
    </div>
  );
}

/** At tablet width and up: a table, one row per delivery or queued email. */
function ActivityTable({ views }: { views: RowView[] }) {
  return (
    <div className="hidden overflow-hidden rounded-lg border border-border md:block">
      <table className="w-full table-fixed text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th scope="col" className="w-32 px-4 py-3 font-medium">
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
              className="hidden w-32 px-4 py-3 font-medium lg:table-cell"
            >
              Provider
            </th>
            <th
              scope="col"
              className="hidden w-24 px-4 py-3 font-medium lg:table-cell"
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
              className="border-b border-border align-top last:border-b-0"
            >
              <td className="px-4 py-3">
                <div>{view.when}</div>
                <div className="text-xs text-muted-foreground">{view.ago}</div>
              </td>
              <td className="px-4 py-3">
                <OutcomeCell view={view} />
              </td>
              <td className="px-4 py-3">
                <EmailCell view={view} />
              </td>
              <td className="hidden break-words px-4 py-3 lg:table-cell">
                {view.provider}
              </td>
              <td className="hidden px-4 py-3 lg:table-cell">
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
function ActivityCards({ views }: { views: RowView[] }) {
  return (
    <div className="space-y-3 md:hidden">
      {views.map(view => (
        <article
          key={view.key}
          className="space-y-3 rounded-lg border border-border bg-card p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <EmailCell view={view} />
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
  hasMore,
  isLoadingMore,
  onLoadMore,
}: ActivityListProps): JSX.Element {
  const views = rows.map(row => viewOf(row, names, now));
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        No addresses, subjects or bodies are kept: only what happened, the
        template, the provider and the kind of recipient.
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
          {filtered
            ? "Nothing matches these filters."
            : "No email has been sent in this time."}
        </div>
      ) : (
        <>
          <ActivityTable views={views} />
          <ActivityCards views={views} />
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
