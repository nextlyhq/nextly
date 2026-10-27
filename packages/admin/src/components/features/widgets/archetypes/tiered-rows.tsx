/**
 * A list or table card's rows at its tier: the one layout both displays draw.
 *
 * The two displays answer the same question -- some rows of a source, by the fields the query
 * selected -- and differ only in how wide the card is: a small card draws three rows, titles
 * only; a medium one draws its number of items with a line of detail; a large one draws them as
 * a table with a heading per column. A component, because the tier is the card's own and is
 * read from the frame's context. The card's query asked one row more than its tier draws, so an
 * answer holding that row is the sign more exist.
 *
 * Nothing is cut: text wraps rather than truncating, and nothing scrolls inside the card.
 *
 * @module components/features/widgets/archetypes/tiered-rows
 */

import type { JSX, ReactNode } from "react";

import { Link } from "@admin/components/ui/link";
import { cn } from "@admin/lib/utils";
import type { WidgetResultField } from "@admin/types/dashboard/widgets";

import {
  LIST_CLASS,
  LIST_DETAIL_CLASS,
  LIST_LABEL_CLASS,
  LIST_ROW_CLASS,
  ROWS_STACK_CLASS,
  TABLE_CELL_CLASS,
  TABLE_CLASS,
  TABLE_HEAD_ROW_CLASS,
  TABLE_HEADING_CLASS,
  TABLE_ROW_CLASS,
} from "../frame/geometry";
import { rowsDrawn, rowsLayout, useCardTier, useRowsTier } from "../frame/tier";

import { asPresentedText } from "./cell-text";
import { MoreExist, ViewAll } from "./more-exist";
import type { ArchetypeBody } from "./types";

export interface TieredRowsProps {
  items: readonly Record<string, unknown>[];
  /** The columns the source described, in order; the large tier's table heads them. */
  columns: readonly WidgetResultField[];
  /** The field that heads each row in the list layout, and the one under it. */
  labelField: string;
  detailField: string | undefined;
  query: Parameters<ArchetypeBody>[1]["query"];
  /** Where a row's label links to, for a card whose rows each open a document; unlinked when absent. */
  hrefOf?: (item: Record<string, unknown>) => string | undefined;
  /** A row's line of detail, for a card whose detail joins several fields; `detailField`'s otherwise. */
  detailOf?: (item: Record<string, unknown>) => string | undefined;
  /** A "View all" link under the rows whether or not more exist, in place of "More exist". */
  viewAll?: boolean;
}

/** Row links and details beyond the fields a list reads, as a card supplies them. */
type RowExtras = Pick<TieredRowsProps, "hrefOf" | "detailOf">;

export function TieredRows({
  items,
  columns,
  labelField,
  detailField,
  query,
  hrefOf,
  detailOf,
  viewAll = false,
}: TieredRowsProps): JSX.Element {
  // Medium until the card has measured itself, which it does before its first paint.
  const tier = useCardTier() ?? "medium";
  // Laid out at the card's tier, counted at its answer's when that is smaller; see `useRowsTier`.
  const drawn = rowsDrawn(useRowsTier(tier), query?.limit);
  const rows = items.slice(0, drawn);
  const columnOf = new Map(columns.map(column => [column.name, column]));

  return (
    <div className={ROWS_STACK_CLASS}>
      {rowsLayout(tier, columns.length).kind === "table" ? (
        <RowsTable rows={rows} columns={columns} hrefOf={hrefOf} />
      ) : (
        <RowsList
          rows={rows}
          columnOf={columnOf}
          labelField={labelField}
          // Small is title only: a line of detail is the medium layout's.
          detailField={tier === "small" ? undefined : detailField}
          hrefOf={hrefOf}
          detailOf={tier === "small" ? undefined : detailOf}
        />
      )}
      {viewAll ? (
        <ViewAll query={query} />
      ) : (
        items.length > drawn && <MoreExist query={query} />
      )}
    </div>
  );
}

function RowsList({
  rows,
  columnOf,
  labelField,
  detailField,
  hrefOf,
  detailOf,
}: {
  rows: readonly Record<string, unknown>[];
  columnOf: ReadonlyMap<string, WidgetResultField>;
  labelField: string;
  detailField: string | undefined;
} & RowExtras) {
  return (
    <ul data-testid="widget-list" className={LIST_CLASS}>
      {rows.map((item, index) => {
        const label = asPresentedText(
          item[labelField],
          columnOf.get(labelField)
        );
        const detail = rowDetail(item, columnOf, detailField, detailOf);
        return (
          <li
            // The index, because a widget's rows have no identity core can
            // rely on: `select` need not include a key, and two rows may be
            // identical in the fields it did select. The list is replaced
            // wholesale on every refetch and nothing in it is stateful or
            // reorderable, so there is no state for a wrong key to strand.
            key={index}
            data-testid="widget-list-row"
            className={LIST_ROW_CLASS}
          >
            {/* An em dash rather than an empty line, so a row whose label is absent or
                unprintable still occupies its place and the count of rows matches the
                count of results. */}
            <RowLabel href={hrefOf?.(item)} className={LIST_LABEL_CLASS}>
              {label ?? "—"}
            </RowLabel>
            {detail !== undefined && (
              <span className={cn(LIST_DETAIL_CLASS, "text-muted-foreground")}>
                {detail}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RowsTable({
  rows,
  columns,
  hrefOf,
}: {
  rows: readonly Record<string, unknown>[];
  columns: readonly WidgetResultField[];
} & Pick<RowExtras, "hrefOf">) {
  return (
    <table data-testid="widget-table" className={TABLE_CLASS}>
      <thead>
        <tr className={TABLE_HEAD_ROW_CLASS}>
          {columns.map(column => (
            <th
              key={column.name}
              scope="col"
              data-testid="widget-table-heading"
              className={cn(TABLE_HEADING_CLASS, "text-muted-foreground")}
            >
              {/* The source's label when it has one. A field name is a poor heading, but it is
                  true, which an invented one would not be. */}
              {column.label ?? column.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((item, index) => (
          <tr
            // The index, for the reason the list's rows use it.
            key={index}
            data-testid="widget-table-row"
            // Full-strength `border-border`, matching the header rule above and the resting
            // edge every other admin surface draws; the half-alpha variant measured 1.11:1
            // against the card, which is not a lighter separator but an absent one. Not a 3:1
            // claim: `styles/contrast/pairings.ts` excludes this token deliberately, since a
            // table whose rows are identified by their content needs no rule to be operable.
            className={TABLE_ROW_CLASS}
          >
            {columns.map(column => (
              <td
                key={column.name}
                // Fixed layout and wrapping cells: the columns share the card's width, so a
                // long value takes more lines rather than widening the card or scrolling it.
                className={cn(TABLE_CELL_CLASS, "text-foreground")}
              >
                {/* Presented by the column's declared kind, so a date column reads as a date
                    rather than as the ISO string it crossed the wire as. An em dash rather than
                    an empty cell, so a missing value is visibly a missing value. */}
                {column === columns[0] ? (
                  // The first column names the row, so it is the link to its document.
                  <RowLabel href={hrefOf?.(item)}>
                    {asPresentedText(item[column.name], column) ?? "—"}
                  </RowLabel>
                ) : (
                  (asPresentedText(item[column.name], column) ?? "—")
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A row's label: a link to its document where the card gives one, plain text otherwise. */
function RowLabel({
  href,
  className,
  children,
}: {
  href: string | undefined;
  className?: string;
  children: ReactNode;
}) {
  return href === undefined ? (
    <span className={cn(className, "text-foreground")}>{children}</span>
  ) : (
    <Link
      href={href}
      className={cn(className, "font-medium text-foreground hover:underline")}
    >
      {children}
    </Link>
  );
}

/** A row's line of detail: the card's own, or its detail field's, or none. */
function rowDetail(
  item: Record<string, unknown>,
  columnOf: ReadonlyMap<string, WidgetResultField>,
  detailField: string | undefined,
  detailOf: RowExtras["detailOf"]
): string | undefined {
  if (detailOf) return detailOf(item);
  return detailField
    ? asPresentedText(item[detailField], columnOf.get(detailField))
    : undefined;
}
