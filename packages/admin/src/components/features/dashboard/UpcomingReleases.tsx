/**
 * The dashboard's Upcoming releases card, answered by `system:releases` in the
 * dashboard's batch.
 *
 * Above the upcoming releases, at every size, one line says which of the
 * reader's releases need attention ("1 stopped · 2 overdue"), each part linking
 * to the Releases list filtered to that reason. The source sends those counts
 * as rows of their own, because the query selects `reason`; the card draws the
 * rest exactly as core's list cards draw rows, through the same `TieredRows`,
 * so "more exist" counts the release rows alone.
 *
 * @module components/features/dashboard/UpcomingReleases
 */

import type { WidgetComponentProps } from "nextly/widget-result";
import type React from "react";

import { TieredRows } from "@admin/components/features/widgets/archetypes/tiered-rows";
import { FrameState } from "@admin/components/features/widgets/frame/card-state";
import { CardFigure } from "@admin/components/features/widgets/frame/figure";
import { readListSlot } from "@admin/components/features/widgets/frame/list-slot";
import {
  rowsDrawn,
  useCardTier,
  useRowsTier,
} from "@admin/components/features/widgets/frame/tier";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

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

/** "1 stopped · 2 overdue": one part per reason with any, each a link to its list. */
const AttentionLine: React.FC<{
  counts: readonly { reason: Reason; count: number }[];
}> = ({ counts }) => (
  <p className="text-sm text-foreground" data-testid="release-attention">
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
  const drawn = rowsDrawn(useRowsTier(tier), query?.limit);

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
          },
        }}
      />
    );
  }
  // Only the columns a release row draws: the attention fields head nothing.
  const columns = (read.list.fields ?? []).filter(
    field => field.name === "title" || field.name === "scheduledAt"
  );
  return (
    <div className="space-y-3">
      {attention.length > 0 && <AttentionLine counts={attention} />}
      {releases.length > 0 && (
        <TieredRows
          items={releases}
          columns={columns}
          labelField="title"
          detailField="scheduledAt"
          query={query}
        />
      )}
    </div>
  );
};

UpcomingReleasesCard.displayName = "UpcomingReleasesCard";
