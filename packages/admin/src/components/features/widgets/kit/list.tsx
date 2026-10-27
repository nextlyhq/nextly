/**
 * `Widget.List` and `Widget.Table`: a widget's own rows, drawn by the list card core's own list
 * and table cards draw with (`ListCard`, its rows `EntityRow`s), so a plugin's list reads like
 * core's beside it.
 *
 * Both draw as many rows as the card's size and density hold, with the shared footer ("View all
 * (N)", "N more"), and give a row at most one visible action and no menu. `Widget.List` is rows
 * at every size; `Widget.Table` is rows on a narrow card and a table of its columns on a wide
 * one, as core's table card is.
 *
 * @module components/features/widgets/kit/list
 */

import type { JSX, ReactNode } from "react";

import { ListCard, type ListField, type ListModel } from "../frame/list-card";
import { useListDensity } from "../frame/list-rows";
import { useCardTier, useRowsDrawn } from "../frame/tier";

/** A row's one visible action: a link, drawn at the row's end. */
export interface WidgetRowAction {
  label: string;
  href: string;
}

/** How many rows there are in all, when the widget's data counts them. */
export interface WidgetListTotal {
  count: number;
  /** The count is a floor: there are at least this many. */
  atLeast?: boolean;
}

/** What `Widget.List` and `Widget.Table` share: the rows, where they lead, and the footer. */
interface WidgetRowsProps<Row> {
  /** Every row the widget has; the card draws as many as its size holds. */
  rows: readonly Row[];
  /** A row's title, drawn on one line and read whole by assistive technology. */
  title: (row: Row) => string;
  /** Where a row leads; a row without one is plain text. */
  href?: (row: Row) => string | undefined;
  /** The row's leading slot: an icon, an avatar or a chip. */
  leading?: (row: Row) => ReactNode;
  /** What assistive technology hears for a row, where its visible text reads badly aloud. */
  spoken?: (row: Row) => string | undefined;
  /** The row's one visible action. */
  action?: (row: Row) => WidgetRowAction | undefined;
  /** How many rows there are in all, for the footer. */
  total?: WidgetListTotal;
  /** The full list the rows come from, for the footer's "View all". */
  viewAllHref?: string;
}

export interface WidgetListProps<Row> extends WidgetRowsProps<Row> {
  /** Up to three fields under the title; any beyond three are not drawn. */
  meta?: (row: Row) => readonly ReactNode[];
  /** The row's end: a status, a relative time or a number. */
  trailing?: (row: Row) => ReactNode;
}

/** One column of `Widget.Table`. */
export interface WidgetTableColumn<Row> {
  key: string;
  /** The column's heading in the table. */
  label: string;
  /** The column's value in `row`, or `undefined` where the row has none. */
  value: (row: Row) => ReactNode | undefined;
  /** Where it sits in a row on a narrow card: under the title (default) or at the row's end. */
  place?: "meta" | "trailing";
  /** Where its column is set: at the end for a time or a number. */
  align?: "start" | "end";
}

export interface WidgetTableProps<Row> extends WidgetRowsProps<Row> {
  /** The title column's heading. */
  titleLabel: string;
  columns: readonly WidgetTableColumn<Row>[];
}

/** The most fields a row's meta line draws, as `EntityRow` draws them. */
const META_FIELDS = 3;

/** The model both share, from the props both share, with the fields each draws. */
function modelOf<Row>(
  props: WidgetRowsProps<Row>,
  titleLabel: string,
  fields: readonly ListField<Row>[]
): ListModel<Row> {
  const { title, href, leading, spoken, action } = props;
  return {
    titleLabel,
    titleOf: title,
    fields,
    ...(href === undefined ? {} : { hrefOf: href }),
    ...(leading === undefined ? {} : { leadingOf: leading }),
    ...(spoken === undefined ? {} : { spokenOf: spoken }),
    ...(action === undefined ? {} : { actionOf: action }),
  };
}

/** The card's tier, density and the rows it holds, as core's list cards read them. */
function useRowsLayout() {
  // Medium until the card has measured itself, which it does before its first paint.
  const tier = useCardTier() ?? "medium";
  const density = useListDensity();
  const drawn = useRowsDrawn(tier, undefined, density);
  return { tier, density, drawn };
}

/** A widget's rows: titles, up to three fields under each, its end, and one action. */
function List<Row>(props: WidgetListProps<Row>): JSX.Element {
  const { meta, trailing, rows, total, viewAllHref } = props;
  const { tier, density, drawn } = useRowsLayout();
  const fields: ListField<Row>[] = [
    ...(meta === undefined
      ? []
      : Array.from({ length: META_FIELDS }, (_, index) => ({
          key: `meta-${index}`,
          label: "",
          role: "meta" as const,
          present: (row: Row) => meta(row)[index],
        }))),
    ...(trailing === undefined
      ? []
      : [
          {
            key: "trailing",
            label: "",
            role: "trailing" as const,
            present: trailing,
          },
        ]),
  ];
  return (
    <ListCard
      model={modelOf(props, "", fields)}
      rows={rows}
      drawn={drawn}
      {...(total === undefined ? {} : { total })}
      {...(viewAllHref === undefined ? {} : { viewAllHref })}
      // Rows at every size: the list card draws a table only at the large tier, and a table is
      // `Widget.Table`. The rows it holds are still counted at the card's own tier.
      tier={tier === "large" ? "medium" : tier}
      density={density}
    />
  );
}

/** A widget's rows across named columns: a table on a wide card, rows on a narrow one. */
function Table<Row>(props: WidgetTableProps<Row>): JSX.Element {
  const { columns, titleLabel, rows, total, viewAllHref } = props;
  const { tier, density, drawn } = useRowsLayout();
  const fields = columns.map(
    (column): ListField<Row> => ({
      key: column.key,
      label: column.label,
      role: column.place ?? "meta",
      ...(column.align === undefined ? {} : { align: column.align }),
      present: column.value,
    })
  );
  return (
    <ListCard
      model={modelOf(props, titleLabel, fields)}
      rows={rows}
      drawn={drawn}
      {...(total === undefined ? {} : { total })}
      {...(viewAllHref === undefined ? {} : { viewAllHref })}
      tier={tier}
      density={density}
    />
  );
}

export { List as WidgetList, Table as WidgetTable };
