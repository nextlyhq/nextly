"use client";

/**
 * Continue where you left off: the reader's pins and their latest saves
 * (Mine), or what other people saved (Team), one row per document, every row
 * a link to it and a menu that pins or unpins it.
 *
 * While the reader has pins, Mine is drawn in two groups, "Pinned" then
 * "Recent", each pinned row led by a pin; when they have more pins than it
 * shows, its footer says "View all pins (N)", which opens every pin.
 *
 * Drawn from the rows its `load` read from `system:continue`; the tab is the
 * card's one quick setting, on its header, and its `load` asks the source for
 * the tab chosen. The frame drew loading, no permission and error before this
 * is reached. Every title in the answer was
 * read as the reader, so the card draws what it is given and never a stand-in.
 *
 * Drawn by the one list card: each row's collection icon, its title, its
 * collection and when it was edited (and on Team, who saved it) on its meta
 * line, its status at its end, and a table at the large tier. It draws the
 * "Number of entries" its reader chose.
 *
 * @module components/features/dashboard/ContinueCard
 */

import { Pin } from "lucide-react";
import type { CoreListWidgetData } from "nextly/core-widget-data";
import type { DeclaredComponentProps } from "nextly/widget-result";
import type React from "react";

import { resolveIconName } from "@admin/components/features/widgets/archetypes/icon";
import { FrameState } from "@admin/components/features/widgets/frame/card-state";
import { useCollectionLabel } from "@admin/components/features/widgets/frame/collection-label";
import type { EntityRowMenuItem } from "@admin/components/features/widgets/frame/entity-row";
import {
  CARD_FOOTER_LINK_CLASS,
  CardFooterContent,
} from "@admin/components/features/widgets/frame/footer-slot";
import { ROWS_STACK_CLASS } from "@admin/components/features/widgets/frame/geometry";
import {
  ListCard,
  type ListModel,
} from "@admin/components/features/widgets/frame/list-card";
import { useListCard } from "@admin/components/features/widgets/frame/list-card-hook";
import { StatusChip } from "@admin/components/features/widgets/frame/row-parts";
import type { PinTarget } from "@admin/hooks/queries/useDashboardPins";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { formatRelativeTime } from "@admin/lib/dashboard";
import { useDocumentAddress } from "@admin/lib/navigation/useDocumentAddress";

import { openAllPins } from "./all-pins";
import {
  continueEmpty,
  continueRows,
  continueSections,
  continueTab,
  statusTone,
  type ContinueRow,
  type ContinueSections,
  type ContinueTab,
} from "./continue-model";
import { usePinRowItem } from "./pin-action";

/**
 * The icon a row leads with: a pin on one of Mine's pinned rows, otherwise its
 * collection's or Single's own, or the one each kind is drawn with.
 */
function rowIcon(row: ContinueRow): React.ReactNode {
  const fallback = row.collection === undefined ? "FileText" : "Database";
  return (
    <span
      aria-hidden="true"
      data-pin={row.group === "pinned" ? "" : undefined}
      className="flex size-full items-center justify-center rounded-md bg-muted text-muted-foreground"
    >
      {row.group === "pinned" ? (
        <Pin className="h-4 w-4" />
      ) : (
        (resolveIconName(row.icon) ?? resolveIconName(fallback))
      )}
    </span>
  );
}

/** A group's name over its rows: quiet, small capitals, as the card's sections are named. */
const GROUP_HEADING_CLASS =
  "px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

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
 * Team, who saved it), its status as a quiet chip at its end, and Pin or Unpin in
 * its menu.
 */
function continueModel(
  tab: ContinueTab,
  now: number,
  labelOf: (slug: string) => string,
  pinItem: (target: PinTarget, pinned: boolean) => EntityRowMenuItem,
  titleLabel = "Entry"
): ListModel<ContinueRow> {
  return {
    titleLabel,
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
            <StatusChip tone={statusTone(row.status)}>{row.status}</StatusChip>
          ),
      },
    ],
    menuOf: row => [pinItem(row.target, row.pinned)],
  };
}

/**
 * Mine in its groups: "Pinned" then "Recent", each its own list under its
 * name. At the large tier each is a table whose title column carries the
 * group's name, so no heading repeats the table's own. "View all pins (N)" in
 * the card's footer while the reader has more pins than it shows.
 */
function GroupedRows({
  sections,
  model,
  tier,
  density,
}: {
  sections: ContinueSections;
  model: (titleLabel: string) => ListModel<ContinueRow>;
  tier: NonNullable<ReturnType<typeof useListCard>["tier"]>;
  density: ReturnType<typeof useListCard>["density"];
}): React.ReactElement {
  const groups = [
    { key: "pinned", name: "Pinned", rows: sections.pinned },
    { key: "recent", name: "Recent", rows: sections.recent },
  ].filter(group => group.rows.length > 0);
  const more = sections.pinTotal > sections.pinned.length;
  return (
    <div data-testid="continue-groups" className={ROWS_STACK_CLASS}>
      {groups.map(group => (
        <div
          key={group.key}
          role="group"
          data-testid={`continue-group-${group.key}`}
          aria-label={group.name}
          className="flex min-w-0 flex-col gap-1"
        >
          {tier !== "large" && (
            // Named for assistive technology by the group itself.
            <p aria-hidden="true" className={GROUP_HEADING_CLASS}>
              {group.name}
            </p>
          )}
          <ListCard
            model={model(group.name)}
            rows={group.rows}
            drawn={group.rows.length}
            tier={tier}
            density={density}
          />
        </div>
      ))}
      {more && (
        <CardFooterContent>
          <button
            type="button"
            data-testid="continue-view-all-pins"
            onClick={openAllPins}
            className={CARD_FOOTER_LINK_CLASS}
          >
            View all pins ({sections.pinTotal})
          </button>
        </CardFooterContent>
      )}
    </div>
  );
}

/** What the Continue card is handed: its declaration's props, with the rows its `load` read. */
export type ContinueCardProps = Omit<DeclaredComponentProps, "data"> & {
  data: CoreListWidgetData;
};

export const ContinueCard: React.FC<ContinueCardProps> = ({
  data,
  settings,
}) => {
  const { tier, drawn, density, now } = useListCard(settings.limit);
  const labelOf = useCollectionLabel();
  const pinItem = usePinRowItem();
  // Each row opens where every other link to its document opens.
  const addressOf = useDocumentAddress();
  const tab = continueTab(settings);
  // A row this build cannot read is left out rather than drawn from guesses.
  const rows = continueRows(data, addressOf);
  if (rows.length === 0) {
    return (
      <FrameState state={{ kind: "empty", empty: continueEmpty(tab, data) }} />
    );
  }
  const sections = tab === "mine" ? continueSections(rows, drawn) : undefined;
  if (sections !== undefined) {
    return (
      <GroupedRows
        sections={sections}
        model={titleLabel =>
          continueModel(tab, now, labelOf, pinItem, titleLabel)
        }
        tier={tier}
        density={density}
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
