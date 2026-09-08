"use client";

/**
 * ListView — the layer between an admin list page and the table engine.
 *
 * `DataTableView` is the engine and answers rows, cells, sorting and the pager.
 * Nothing owned the strip above it, so each page composed its own and the
 * codebase carried four arrangements at once: a shell that set only the
 * vertical rhythm, a toolbar that set only the row, one component that did both
 * for a single page, and eight hand-rolled `div`s. They disagreed on the gap
 * above the table and on how wide the search field may grow, which is what made
 * the lists look unrelated to each other.
 *
 * This component owns those decisions so a page supplies content and never
 * geometry. It COMPOSES the engine rather than wrapping or replacing it: every
 * table prop is forwarded untouched, so adopting it changes the strip above the
 * table and nothing about the table.
 *
 * @module components/ui/table/list-view
 */

import type { ReactNode } from "react";

import { cn } from "@admin/lib/utils";

import { DataTableView, type DataTableViewProps } from "../data-table";

import { ListEmptyState } from "./ListEmptyState";
import { ListToolbar, isToolbarEmpty } from "./ListToolbar";
import type {
  ListColumnsControl,
  ListEmpty,
  ListSearch,
  ListSlots,
} from "./types";

export interface ListViewProps<Row extends object>
  extends DataTableViewProps<Row> {
  search?: ListSearch;
  /** Filter controls, rendered inside the toolbar's filter dropdown. */
  filters?: ReactNode;
  /** Filter controls that stay visible in the row rather than in a dropdown. */
  inlineFilters?: ReactNode;
  hasActiveFilters?: boolean;
  columnsControl?: ListColumnsControl<Row>;
  /** Buttons acting on the list as a whole, placed after the toolbar controls. */
  toolbarActions?: ReactNode;
  /**
   * The selection bar, rendered directly above the table.
   *
   * Below the toolbar rather than above it, because it acts on ROWS: putting it
   * above pushes search and filters down the page the moment a checkbox is
   * ticked, so the controls move while the reader is using them. The two
   * surfaces that had a selection bar disagreed about this, and the table is
   * what it refers to.
   */
  bulkBar?: ReactNode;
  /**
   * Stands in for the table while `loading` is true.
   *
   * Supplying it keeps the toolbar mounted through the load, so the search
   * field does not vanish and the page does not jump when rows arrive. Callers
   * that omit it get the engine's own loading treatment.
   */
  skeleton?: ReactNode;
  /** Shown instead of the table when the list is genuinely empty. */
  empty?: ListEmpty;
  /**
   * Shown instead of `empty` when a search term or a filter is applied.
   *
   * Kept separate because the two say opposite things: an unfiltered empty list
   * invites the reader to create the first record, while a filtered one has to
   * tell them their query matched nothing and leave the records alone. A single
   * empty state offering "create your first" after a fruitless search is the
   * defect this pair exists to prevent.
   */
  emptyFiltered?: ListEmpty;
  slots?: ListSlots;
}

export function ListView<Row extends object>({
  search,
  filters,
  inlineFilters,
  hasActiveFilters,
  columnsControl,
  toolbarActions,
  bulkBar,
  skeleton,
  empty,
  emptyFiltered,
  slots,
  className,
  ...table
}: ListViewProps<Row>) {
  const toolbar = {
    search,
    filters,
    inlineFilters,
    hasActiveFilters,
    columnsControl,
    actions: toolbarActions,
  };

  return (
    <div className={cn("w-full space-y-4", className)}>
      {slots?.beforeList}
      {!isToolbarEmpty(toolbar) && <ListToolbar<Row> {...toolbar} />}
      {bulkBar}
      {slots?.beforeTable}
      {resolveBody({
        table,
        skeleton,
        empty,
        emptyFiltered,
        isFiltered: Boolean(search?.value) || Boolean(hasActiveFilters),
      })}
      {slots?.afterTable}
      {slots?.afterList}
    </div>
  );
}

/**
 * Which of the three things stands where the table goes.
 *
 * Written as one ordered decision rather than nested conditionals in the JSX,
 * because the ORDER is the substantive part and it is easy to get wrong: a
 * pending query outranks an empty result, since a list nobody has read yet is
 * not a list with nothing in it. `error` belongs to the engine, which renders
 * it in place of rows and keeps the table's frame.
 */
function resolveBody<Row extends object>({
  table,
  skeleton,
  empty,
  emptyFiltered,
  isFiltered,
}: {
  table: DataTableViewProps<Row>;
  skeleton?: ReactNode;
  empty?: ListEmpty;
  emptyFiltered?: ListEmpty;
  isFiltered: boolean;
}): ReactNode {
  if (table.loading && skeleton) return skeleton;

  const emptyState = isFiltered ? (emptyFiltered ?? empty) : empty;
  const isEmpty =
    !table.loading && !table.error && table.rows.length === 0 && !!emptyState;

  if (isEmpty && emptyState) return <ListEmptyState {...emptyState} />;
  return <DataTableView<Row> {...table} />;
}

export { ListEmptyState } from "./ListEmptyState";
export { ListToolbar } from "./ListToolbar";
export { ListColumnsMenu } from "./ListColumnsMenu";
export { useListColumns } from "./useListColumns";
export type { UseListColumnsOptions } from "./useListColumns";
export { useTableColumns } from "./useTableColumns";
export type {
  UseTableColumnsOptions,
  UseTableColumnsResult,
} from "./useTableColumns";
export type {
  ListColumnsControl,
  ListEmpty,
  ListSearch,
  ListSlots,
} from "./types";
