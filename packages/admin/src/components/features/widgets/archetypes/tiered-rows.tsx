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

import type { WidgetResultField } from "@admin/types/dashboard/widgets";

import { rowsDrawn, useCardTier, useRowsTier } from "../frame/tier";

import { asPresentedText } from "./cell-text";
import { MoreExist } from "./more-exist";
import type { ArchetypeBody } from "./types";

export interface TieredRowsProps {
  items: readonly Record<string, unknown>[];
  /** The columns the source described, in order; the large tier's table heads them. */
  columns: readonly WidgetResultField[];
  /** The field that heads each row in the list layout, and the one under it. */
  labelField: string;
  detailField: string | undefined;
  query: Parameters<ArchetypeBody>[1]["query"];
}

export function TieredRows({
  items,
  columns,
  labelField,
  detailField,
  query,
}: TieredRowsProps) {
  // Medium until the card has measured itself, which it does before its first paint.
  const tier = useCardTier() ?? "medium";
  // Laid out at the card's tier, counted at its answer's when that is smaller; see `useRowsTier`.
  const drawn = rowsDrawn(useRowsTier(tier), query?.limit);
  const rows = items.slice(0, drawn);
  const columnOf = new Map(columns.map(column => [column.name, column]));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {tier === "large" && columns.length > 0 ? (
        <RowsTable rows={rows} columns={columns} />
      ) : (
        <RowsList
          rows={rows}
          columnOf={columnOf}
          labelField={labelField}
          // Small is title only: a line of detail is the medium layout's.
          detailField={tier === "small" ? undefined : detailField}
        />
      )}
      {items.length > drawn && <MoreExist query={query} />}
    </div>
  );
}

function RowsList({
  rows,
  columnOf,
  labelField,
  detailField,
}: {
  rows: readonly Record<string, unknown>[];
  columnOf: ReadonlyMap<string, WidgetResultField>;
  labelField: string;
  detailField: string | undefined;
}) {
  return (
    <ul data-testid="widget-list" className="flex flex-col gap-2">
      {rows.map((item, index) => {
        const label = asPresentedText(
          item[labelField],
          columnOf.get(labelField)
        );
        const detail = detailField
          ? asPresentedText(item[detailField], columnOf.get(detailField))
          : undefined;
        return (
          <li
            // The index, because a widget's rows have no identity core can
            // rely on: `select` need not include a key, and two rows may be
            // identical in the fields it did select. The list is replaced
            // wholesale on every refetch and nothing in it is stateful or
            // reorderable, so there is no state for a wrong key to strand.
            key={index}
            data-testid="widget-list-row"
            className="flex min-w-0 flex-col gap-0.5"
          >
            {/* An em dash rather than an empty line, so a row whose label is absent or
                unprintable still occupies its place and the count of rows matches the
                count of results. */}
            <span className="break-words text-sm text-foreground">
              {label ?? "—"}
            </span>
            {detail !== undefined && (
              <span className="break-words text-xs text-muted-foreground">
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
}: {
  rows: readonly Record<string, unknown>[];
  columns: readonly WidgetResultField[];
}) {
  return (
    <table data-testid="widget-table" className="w-full table-fixed text-sm">
      <thead>
        <tr className="border-b border-border">
          {columns.map(column => (
            <th
              key={column.name}
              scope="col"
              data-testid="widget-table-heading"
              className="break-words pb-1 pr-4 text-left text-xs font-medium text-muted-foreground last:pr-0"
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
            className="border-b border-border last:border-0"
          >
            {columns.map(column => (
              <td
                key={column.name}
                // Fixed layout and wrapping cells: the columns share the card's width, so a
                // long value takes more lines rather than widening the card or scrolling it.
                className="break-words py-1 pr-4 align-top text-foreground last:pr-0"
              >
                {/* Presented by the column's declared kind, so a date column reads as a date
                    rather than as the ISO string it crossed the wire as. An em dash rather than
                    an empty cell, so a missing value is visibly a missing value. */}
                {asPresentedText(item[column.name], column) ?? "—"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
