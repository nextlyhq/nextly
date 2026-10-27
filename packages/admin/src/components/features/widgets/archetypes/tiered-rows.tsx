/**
 * A list or table card's rows, drawn from the answer the card's query got back.
 *
 * The bridge from a list answer to the one list card: the columns the source described become
 * the list's model (the card's label column is each row's title, a column of choices such as a
 * status sits at the row's end, and every other column joins the meta line), and the answer's
 * total, when the source gave one, is what the footer counts. Stacked rows at the small and
 * medium tiers, a table at the large one, both by {@link ListCard}.
 *
 * @module components/features/widgets/archetypes/tiered-rows
 */

import type { JSX } from "react";

import { fieldLabel } from "@admin/lib/field-label";
import type {
  WidgetResult,
  WidgetResultField,
} from "@admin/types/dashboard/widgets";

import { ListCard, type ListModel, type ListTotal } from "../frame/list-card";
import { useListDensity } from "../frame/list-rows";
import { listViewHref } from "../frame/list-view-href";
import { useCardTier, useRowsDrawn } from "../frame/tier";

import { asPresentedText } from "./cell-text";
import type { ArchetypeBody } from "./types";

type AnswerRow = Record<string, unknown>;

export interface TieredRowsProps {
  items: readonly AnswerRow[];
  /** The columns the source described, in order. */
  columns: readonly WidgetResultField[];
  /** The field that titles each row. */
  labelField: string;
  query: Parameters<ArchetypeBody>[1]["query"];
  /** Where a row leads, for a card whose rows each open a document; plain text when absent. */
  hrefOf?: (item: AnswerRow) => string | undefined;
  /** The list's whole count, when the source gave one. */
  total?: ListTotal;
}

export function TieredRows({
  items,
  columns,
  labelField,
  query,
  hrefOf,
  total,
}: TieredRowsProps): JSX.Element {
  // Medium until the card has measured itself, which it does before its first paint.
  const tier = useCardTier() ?? "medium";
  const density = useListDensity();
  // Laid out at the card's tier, counted at its answer's size when that draws fewer; see
  // `useRowsDrawn`.
  const drawn = useRowsDrawn(tier, query?.limit, density);
  return (
    <ListCard
      model={answerListModel(columns, labelField, hrefOf)}
      rows={items}
      drawn={drawn}
      total={total}
      viewAllHref={listViewHref(query)}
      tier={tier}
      density={density}
    />
  );
}

/**
 * A list answer's columns as a list model: the label column titles each row, a column of
 * choices (a status) sits at the row's end, and every other column joins the meta line, in the
 * order the source described them. Each value is presented by its column's declared kind, so a
 * date reads as a date rather than the ISO string it crossed as.
 */
export function answerListModel(
  columns: readonly WidgetResultField[],
  labelField: string,
  hrefOf?: (item: AnswerRow) => string | undefined
): ListModel<AnswerRow> {
  const label = columns.find(column => column.name === labelField);
  return {
    // The source's label when it has one, else the field's key as the admin writes any
    // field's name: read from the field itself, never invented.
    titleLabel: fieldLabel({ name: labelField, label: label?.label }),
    // An em dash rather than an empty title, so a row whose label is absent still holds its
    // place and the count of rows matches the count of results.
    titleOf: item => asPresentedText(item[labelField], label) ?? "—",
    hrefOf,
    fields: columns
      .filter(column => column.name !== labelField)
      .map(column => ({
        key: column.name,
        label: fieldLabel(column),
        role: column.choices === undefined ? "meta" : "trailing",
        // A time or a number lines up at its column's end in the table form.
        align:
          column.type === "date" || column.type === "number" ? "end" : "start",
        present: item => asPresentedText(item[column.name], column),
      })),
  };
}

/** A list answer's total, as the footer counts it; nothing from a source that did not count. */
export function answerTotal(result: WidgetResult): ListTotal | undefined {
  if (result.op !== "list" || result.total === undefined) return undefined;
  return result.atLeast === true
    ? { count: result.total, atLeast: true }
    : { count: result.total };
}
