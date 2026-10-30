/**
 * The dashboard's Upcoming releases card, answered by `system:releases` in the
 * dashboard's batch.
 *
 * Above the upcoming releases, at every size, one line says which of the
 * reader's releases need attention ("1 stopped · 2 overdue"), each part linking
 * to the Releases list filtered to that reason. The source sends those counts
 * as rows of their own, because the query selects `reason`, counted by the
 * releases domain's own rule for the Releases list's Needs attention tab, so
 * the card never decides "stopped" or "overdue" itself. The card draws the
 * rest through the same `ListCard` core's list cards use, so its footer counts
 * the release rows alone: each row is a date chip, the release's name, how many
 * entries it holds, and whether its checks found it Ready or "N issues", and
 * leads to its release.
 *
 * With nothing scheduled, stopped or overdue the answer is empty and the card
 * reports it so; the widget hides when empty, so the dashboard takes it out.
 *
 * @module components/features/dashboard/UpcomingReleases
 */

import type { WidgetComponentProps } from "nextly/widget-result";
import type React from "react";

import { FrameState } from "@admin/components/features/widgets/frame/card-state";
import { CardFigure } from "@admin/components/features/widgets/frame/figure";
import {
  ListCard,
  type ListModel,
} from "@admin/components/features/widgets/frame/list-card";
import { useListDensity } from "@admin/components/features/widgets/frame/list-rows";
import { readListSlot } from "@admin/components/features/widgets/frame/list-slot";
import {
  LeadingChip,
  StatusPill,
} from "@admin/components/features/widgets/frame/row-parts";
import {
  useCardTier,
  useRowsDrawn,
} from "@admin/components/features/widgets/frame/tier";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import {
  formatDateTime,
  getGlobalDateTimeConfig,
  isValidTimezone,
  resolveLocalTimezone,
} from "@admin/lib/dates/format";

/** Why releases need attention, in the order the line names them. */
const REASONS = ["stopped", "overdue"] as const;
type Reason = (typeof REASONS)[number];

/** A `system:releases` row: a reason with its count, or an upcoming release. */
type ReleaseSourceRow =
  | { kind: "attention"; reason: Reason; count: number }
  | { kind: "release"; row: Record<string, unknown> };

/** One answer row as the card reads it, or `undefined` for a row this build cannot read. */
function readRow(row: Record<string, unknown>): ReleaseSourceRow | undefined {
  if (row.kind === "attention") {
    const reason = REASONS.find(candidate => candidate === row.reason);
    return reason && typeof row.count === "number"
      ? { kind: "attention", reason, count: row.count }
      : undefined;
  }
  return row.kind === "release" ? { kind: "release", row } : undefined;
}

/** An answer's rows, split by kind: the attention counts, and the releases. */
function rowsOf(items: readonly Record<string, unknown>[]) {
  const rows = items.flatMap(item => readRow(item) ?? []);
  return {
    attention: rows.flatMap(row => (row.kind === "attention" ? [row] : [])),
    releases: rows.flatMap(row => (row.kind === "release" ? [row.row] : [])),
  };
}

/** The Releases list narrowed to one reason releases need attention. */
function attentionHref(reason: Reason): string {
  return `${ROUTES.RELEASES}?tab=attention&reason=${reason}`;
}

/**
 * The attention line's height and the gap under it, in pixels: what the rows under it may not
 * take. One line that never wraps (20 px, `h-5`) and a 12 px gap (`gap-3`), so the room it takes
 * is known before it is drawn.
 */
const ATTENTION_LINE_PX = 20 + 12;

/** "1 stopped · 2 overdue": one part per reason with any, each a link to its list. */
const AttentionLine: React.FC<{
  counts: readonly { reason: Reason; count: number }[];
}> = ({ counts }) => (
  <p
    className="h-5 truncate whitespace-nowrap text-sm text-foreground"
    data-testid="release-attention"
  >
    {counts.map(({ reason, count }, index) => (
      <span key={reason}>
        {index > 0 && <span aria-hidden="true"> · </span>}
        {index > 0 && <span className="sr-only">, </span>}
        <Link
          href={attentionHref(reason)}
          className="font-medium underline-offset-4 hover:underline"
        >
          <CardFigure value={count} /> {reason}
        </Link>
      </span>
    ))}
  </p>
);

export const UpcomingReleasesCard: React.FC<WidgetComponentProps> = ({
  slot,
  isFetching,
  query,
  onRetry,
}) => {
  // Medium until the card has measured itself, which it does before its first paint.
  const tier = useCardTier() ?? "medium";
  const density = useListDensity();
  const drawn = useRowsDrawn(tier, query?.limit, density);
  // With the attention line above them, the rows have its room the less.
  const drawnUnderLine = useRowsDrawn(
    tier,
    query?.limit,
    density,
    ATTENTION_LINE_PX
  );

  const read = readListSlot({ slot, isFetching, rows: drawn, onRetry });
  if ("node" in read) return read.node;
  const { attention, releases } = rowsOf(read.list.items);
  if (attention.length === 0 && releases.length === 0) {
    return (
      <FrameState
        state={{
          kind: "empty",
          empty: {
            title: "Nothing scheduled",
            detail: "Releases you schedule appear here, soonest first.",
            // The card's one way on when it has no rows to list: the card is offered only to a
            // reader who may open Releases.
            action: { label: "Open Releases", href: ROUTES.RELEASES },
          },
        }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {attention.length > 0 && <AttentionLine counts={attention} />}
      {releases.length > 0 && (
        // The release rows alone, so the footer counts releases and never the attention line's
        // counts; each row leads to its release, and "View all (N)" to Releases.
        <ListCard
          model={RELEASE_LIST_MODEL}
          rows={releases}
          drawn={attention.length > 0 ? drawnUnderLine : drawn}
          viewAllHref={ROUTES.RELEASES}
          tier={tier}
          density={density}
        />
      )}
    </div>
  );
};

UpcomingReleasesCard.displayName = "UpcomingReleasesCard";

/** A count from the answer, when it is one. */
function countOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** "1 entry", "4 entries"; nothing from an answer that did not count them. */
function entriesText(value: unknown): string | undefined {
  const count = countOf(value);
  if (count === undefined) return undefined;
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

/**
 * What the release's checks found, as its row's status: Ready with no issue, "N issues" where
 * the releases domain reports any. Nothing for a release the source did not check, which only
 * its own page checks in full.
 */
function statusOf(value: unknown): React.ReactNode {
  const issues = countOf(value);
  if (issues === undefined) return undefined;
  if (issues === 0) return <StatusPill tone="good">Ready</StatusPill>;
  return (
    <StatusPill tone="bad">
      {issues} {issues === 1 ? "issue" : "issues"}
    </StatusPill>
  );
}

/**
 * The day of the month a release is scheduled for, for its date chip, in the zone the admin
 * shows dates in, so the chip and the date beside it name the same day.
 */
function dayOf(value: unknown): string {
  if (typeof value !== "string" && !(value instanceof Date)) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "—";
  const config = getGlobalDateTimeConfig();
  const timeZone = isValidTimezone(config.timezone)
    ? config.timezone
    : resolveLocalTimezone();
  return new Intl.DateTimeFormat(config.locale ?? "en-US", {
    day: "numeric",
    ...(timeZone ? { timeZone } : {}),
  }).format(at);
}

/**
 * A release row: its date chip leads, its name is the title, the meta line says when and how
 * many entries it holds, and its status trails. The chip is decorative, since the meta line
 * says the date in full.
 */
const RELEASE_LIST_MODEL: ListModel<Record<string, unknown>> = {
  titleLabel: "Release",
  // An em dash rather than an empty title, so a row whose name is absent still holds its place.
  titleOf: row =>
    typeof row.title === "string" && row.title !== "" ? row.title : "—",
  hrefOf: row => releaseHref(row),
  leadingOf: row => <LeadingChip>{dayOf(row.scheduledAt)}</LeadingChip>,
  fields: [
    {
      key: "scheduledAt",
      label: "Scheduled",
      role: "meta",
      present: row =>
        typeof row.scheduledAt === "string" || row.scheduledAt instanceof Date
          ? formatDateTime(row.scheduledAt)
          : undefined,
    },
    {
      key: "entries",
      label: "Entries",
      role: "meta",
      present: row => entriesText(row.entries),
    },
    {
      key: "status",
      label: "Status",
      role: "trailing",
      align: "end",
      present: row => statusOf(row.issues),
    },
  ],
};

/** A release row's page; nothing for a row without an id to open. */
function releaseHref(row: Record<string, unknown>): string | undefined {
  return typeof row.id === "string" && row.id !== ""
    ? buildRoute(ROUTES.RELEASES_DETAIL, { id: row.id })
    : undefined;
}
