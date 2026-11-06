"use client";

/**
 * Recent entries: a collection's entries changed most recently, every row a link to its entry,
 * and, when there are more than it draws, "View all (N)" to the collection's list under the
 * card's Filter and Sort.
 *
 * Drawn from the data its `load` answers, by the widget kit's table (`Widget.Table`), as core's
 * lists are: stacked rows with when each was updated and its status, or a table at the large
 * tier. It draws the rows its size and density hold, at most the reader's "Number of items"; the
 * load asked one more, which says more exist. The frame drew loading, no permission and error
 * before this is reached.
 *
 * @module components/features/dashboard/RecentEntriesCard
 */

import type { RecentEntriesWidgetData } from "nextly/core-widget-data";
import type { DeclaredComponentProps } from "nextly/widget-result";
import type React from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useNowTick } from "@admin/hooks/useNowTick";

import { FrameState } from "../widgets/frame/card-state";
import { useCollectionLabel } from "../widgets/frame/collection-label";
import { listViewHref } from "../widgets/frame/list-view-href";
import {
  WidgetTable,
  type WidgetTableColumn,
  type WidgetTableProps,
} from "../widgets/kit/list";

import { recentEntriesModel } from "./recent-entries-model";

/** What the Recent entries card is handed: its declaration's props, with the data its `load` answers. */
export type RecentEntriesCardProps = Omit<DeclaredComponentProps, "data"> & {
  data: RecentEntriesWidgetData;
};

/** One row, as the card draws it. */
type Row = Record<string, unknown>;

/**
 * Up to three columns, as the kit's table takes them: a row's meta line and end hold three, and
 * the card asks no more (its Fields setting offers at most three).
 */
function upToThree(
  columns: readonly WidgetTableColumn<Row>[]
): WidgetTableProps<Row>["columns"] {
  const [first, second, third] = columns;
  if (first === undefined) return [];
  if (second === undefined) return [first];
  if (third === undefined) return [first, second];
  return [first, second, third];
}

export const RecentEntriesCard: React.FC<RecentEntriesCardProps> = ({
  data,
  settings,
}) => {
  // The clock ticks, so "5m ago" moves on as time passes.
  const now = useNowTick();
  const labelOf = useCollectionLabel();
  const sources = useBranding().widgetSources;
  const slug =
    typeof settings.collection === "string" ? settings.collection : undefined;
  // Whether the collection has a lifecycle, as its published source says: only
  // then is a `status` column the lifecycle's, drawn as a pill.
  const lifecycle =
    sources?.find(source => source.collection === slug)?.lifecycle === true;
  // A card asked with no title field has no row to name: the collection publishes none to this
  // reader, so nothing was read, and the card says so.
  if (data.title === null || slug === undefined) {
    return <FrameState state={{ kind: "no-access" }} />;
  }
  if (data.rows.length === 0) {
    return (
      <FrameState
        state={{
          kind: "empty",
          empty: {
            title: "No entries yet",
            detail:
              "Entries in this collection show here, most recently changed first.",
          },
        }}
      />
    );
  }
  const model = recentEntriesModel(
    slug,
    data.title,
    data.columns,
    now,
    labelOf,
    lifecycle
  );
  return (
    <WidgetTable<Row>
      rows={data.rows}
      titleLabel={model.titleLabel}
      title={model.titleOf}
      {...(model.hrefOf === undefined ? {} : { href: model.hrefOf })}
      {...(model.leadingOf === undefined ? {} : { leading: model.leadingOf })}
      columns={upToThree(
        model.fields.map(field => ({
          key: field.key,
          label: field.label,
          value: field.present,
          place: field.role,
          ...(field.align === undefined ? {} : { align: field.align }),
        }))
      )}
      {...tableExtras(slug, data, settings)}
    />
  );
};

/**
 * The table's parts the data and settings supply, each only where it has one:
 * how many entries there are, the list the rows come from (under the card's
 * Filter and Sort as its settings name them, the values its rows were read
 * under), and the reader's "Number of items".
 */
function tableExtras(
  slug: string,
  data: RecentEntriesWidgetData,
  settings: RecentEntriesCardProps["settings"]
): Pick<WidgetTableProps<Row>, "total" | "viewAllHref" | "limit"> {
  const viewAllHref = listViewHref({
    source: `collection:${slug}`,
    op: "list",
    ...(isFilter(settings.filter) ? { where: settings.filter } : {}),
    ...(typeof settings.sort === "string" ? { sort: settings.sort } : {}),
    status: "all",
  });
  return {
    ...(data.total === undefined
      ? {}
      : {
          total: {
            count: data.total,
            ...(data.atLeast === true ? { atLeast: true } : {}),
          },
        }),
    ...(viewAllHref === undefined ? {} : { viewAllHref }),
    ...(typeof settings.limit === "number" ? { limit: settings.limit } : {}),
  };
}

/** Whether a setting's value is a Filter: a plain object of conditions. */
function isFilter(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

RecentEntriesCard.displayName = "RecentEntriesCard";
