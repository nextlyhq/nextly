"use client";

/**
 * Recently edited: the entries and Singles most recently saved, newest first,
 * one row each, every row a link to its document.
 *
 * Drawn from the card's own slot, which the dashboard batch fills from
 * `system:recent-edits`. A custom card rather than the generic list, because a
 * row here is a link and four facts read from the answer's own row shape.
 *
 * Drawn by the one list card: each row's collection, who saved it and when on
 * its meta line, its status at its end, and a table at the large tier. It draws
 * the rows its body holds, at most the "Number of items" its reader chose, and
 * one footer when the answer holds more.
 *
 * @module components/features/dashboard/RecentlyEdited
 */

import type { WidgetComponentProps } from "nextly/widget-result";
import type React from "react";

import { answerTotal } from "@admin/components/features/widgets/archetypes/tiered-rows";
import { FrameState } from "@admin/components/features/widgets/frame/card-state";
import { useCollectionLabel } from "@admin/components/features/widgets/frame/collection-label";
import {
  ListCard,
  type ListModel,
} from "@admin/components/features/widgets/frame/list-card";
import { useListCard } from "@admin/components/features/widgets/frame/list-slot";
import { listViewHref } from "@admin/components/features/widgets/frame/list-view-href";
import {
  LeadingChip,
  StatusPill,
} from "@admin/components/features/widgets/frame/row-parts";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { formatRelativeTime } from "@admin/lib/dashboard";

import {
  noEditsText,
  recentEditRows,
  statusTone,
  type RecentEditRow,
} from "./recently-edited-model";

/**
 * The card's rows as a list: each titled by its document and leading to it, its collection's
 * initial before it, its collection, who saved it and when on the meta line, and its status as
 * a pill at the row's end.
 *
 * The relative time is the line's; the absolute instant, in the admin's time zone, is the
 * element's title and its `dateTime`, so the exact moment is a hover away and machine-readable
 * either way.
 */
function recentEditsModel(
  now: number,
  labelOf: (slug: string) => string
): ListModel<RecentEditRow> {
  return {
    titleLabel: "Document",
    titleOf: edit => edit.title,
    hrefOf: edit => edit.href,
    // The initial of the collection's label, or "S" for a Single, which belongs to none.
    leadingOf: edit => (
      <LeadingChip>
        {edit.collection === undefined
          ? "S"
          : labelOf(edit.collection).charAt(0).toUpperCase()}
      </LeadingChip>
    ),
    fields: [
      {
        key: "collection",
        label: "Collection",
        role: "meta",
        present: edit =>
          edit.collection === undefined ? undefined : labelOf(edit.collection),
      },
      {
        key: "savedBy",
        label: "Saved by",
        role: "meta",
        present: edit => edit.savedBy,
      },
      {
        key: "savedAt",
        label: "Saved",
        role: "meta",
        present: edit => (
          <time
            dateTime={edit.savedAt}
            title={formatDateWithAdminTimezone(edit.savedAt, {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZoneName: "short",
            })}
          >
            {formatRelativeTime(edit.savedAt, now)}
          </time>
        ),
      },
      {
        key: "status",
        label: "Status",
        role: "trailing",
        present: edit =>
          edit.status === undefined ? undefined : (
            <StatusPill tone={statusTone(edit.status)}>
              {edit.status}
            </StatusPill>
          ),
      },
    ],
  };
}

export const RecentlyEdited: React.FC<WidgetComponentProps> = props => {
  const { tier, drawn, density, now, read } = useListCard(props);
  const labelOf = useCollectionLabel();
  const { query } = props;
  if ("node" in read) return read.node;
  // A row this build cannot read is left out rather than drawn from guesses.
  const edits = recentEditRows(read.list);
  if (edits.length === 0) {
    return (
      <FrameState
        state={{
          kind: "empty",
          empty: {
            title: noEditsText(read.list),
            detail: "Entries and Singles people save show here.",
          },
        }}
      />
    );
  }
  return (
    <ListCard
      model={recentEditsModel(now, labelOf)}
      rows={edits}
      drawn={drawn}
      total={answerTotal(read.list)}
      viewAllHref={listViewHref(query)}
      tier={tier}
      density={density}
    />
  );
};

RecentlyEdited.displayName = "RecentlyEdited";
