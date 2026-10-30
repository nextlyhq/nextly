"use client";

/**
 * Continue where you left off: the reader's pins and their latest saves
 * (Mine), or what other people saved (Team), one row per document, every row
 * a link to it and a menu that pins or unpins it.
 *
 * Drawn from the card's own slot, which the dashboard batch fills from
 * `system:continue`; the tab is the card's one quick setting, on its header,
 * and reaches the source as the query's `where`. Every title in the answer was
 * read as the reader, so the card draws what it is given and never a stand-in.
 *
 * Drawn by the one list card: each row's collection icon, its title, its
 * collection and when it was edited (and on Team, who saved it) on its meta
 * line, its status at its end, and a table at the large tier. It draws the
 * rows its body holds, at most the "Number of items" its reader chose.
 *
 * @module components/features/dashboard/ContinueCard
 */

import type { WidgetComponentProps } from "nextly/widget-result";
import type React from "react";

import { resolveIconName } from "@admin/components/features/widgets/archetypes/icon";
import { FrameState } from "@admin/components/features/widgets/frame/card-state";
import { useCollectionLabel } from "@admin/components/features/widgets/frame/collection-label";
import type { EntityRowMenuItem } from "@admin/components/features/widgets/frame/entity-row";
import {
  ListCard,
  type ListModel,
} from "@admin/components/features/widgets/frame/list-card";
import { useListCard } from "@admin/components/features/widgets/frame/list-slot";
import { StatusPill } from "@admin/components/features/widgets/frame/row-parts";
import type { PinTarget } from "@admin/hooks/queries/useDashboardPins";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { formatRelativeTime } from "@admin/lib/dashboard";

import {
  continueEmpty,
  continueRows,
  continueTab,
  statusTone,
  type ContinueRow,
  type ContinueTab,
} from "./continue-model";
import { usePinRowItem } from "./pin-action";

/** The icon a row leads with: its collection's or Single's own, or the one each kind is drawn with. */
function rowIcon(row: ContinueRow): React.ReactNode {
  const fallback = row.collection === undefined ? "FileText" : "Database";
  return (
    <span
      aria-hidden="true"
      className="flex size-full items-center justify-center rounded-md bg-muted text-muted-foreground"
    >
      {resolveIconName(row.icon) ?? resolveIconName(fallback)}
    </span>
  );
}

/**
 * When a row was edited, relative on the line, with the absolute instant in
 * the admin's time zone as the element's title and its `dateTime`, so the
 * exact moment is a hover away and machine-readable either way.
 */
function editedAt(row: ContinueRow, now: number): React.ReactNode {
  if (row.editedAt === undefined) return undefined;
  return (
    <time
      dateTime={row.editedAt}
      title={formatDateWithAdminTimezone(row.editedAt, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      })}
    >
      edited {formatRelativeTime(row.editedAt, now)}
    </time>
  );
}

/**
 * The card's rows as a list: each titled by its document and leading to it,
 * its icon before it, "<collection> · edited <time>" on the meta line (and on
 * Team, who saved it), its status as a pill at its end, and Pin or Unpin in
 * its menu.
 */
function continueModel(
  tab: ContinueTab,
  now: number,
  labelOf: (slug: string) => string,
  pinItem: (target: PinTarget, pinned: boolean) => EntityRowMenuItem
): ListModel<ContinueRow> {
  return {
    titleLabel: "Entry",
    titleOf: row => row.title,
    hrefOf: row => row.href,
    leadingOf: rowIcon,
    fields: [
      {
        key: "collection",
        label: "Collection",
        role: "meta",
        // A Single is its own heading, so its row says what it is instead.
        present: row =>
          row.collection === undefined ? "Single" : labelOf(row.collection),
      },
      {
        key: "editedAt",
        label: "Edited",
        role: "meta",
        align: "end",
        present: row => editedAt(row, now),
      },
      ...(tab === "team"
        ? [
            {
              key: "savedBy",
              label: "Saved by",
              role: "meta" as const,
              present: (row: ContinueRow) => row.savedBy,
            },
          ]
        : []),
      {
        key: "status",
        label: "Status",
        role: "trailing",
        present: row =>
          row.status === undefined ? undefined : (
            <StatusPill tone={statusTone(row.status)}>{row.status}</StatusPill>
          ),
      },
    ],
    menuOf: row => [pinItem(row.target, row.pinned)],
  };
}

export const ContinueCard: React.FC<WidgetComponentProps> = props => {
  const { tier, drawn, density, now, read } = useListCard(props);
  const labelOf = useCollectionLabel();
  const pinItem = usePinRowItem();
  const tab = continueTab(props.settings);
  if ("node" in read) return read.node;
  // A row this build cannot read is left out rather than drawn from guesses.
  const rows = continueRows(read.list);
  if (rows.length === 0) {
    return (
      <FrameState
        state={{ kind: "empty", empty: continueEmpty(tab, read.list) }}
      />
    );
  }
  return (
    <ListCard
      model={continueModel(tab, now, labelOf, pinItem)}
      rows={rows}
      drawn={drawn}
      tier={tier}
      density={density}
    />
  );
};

ContinueCard.displayName = "ContinueCard";
