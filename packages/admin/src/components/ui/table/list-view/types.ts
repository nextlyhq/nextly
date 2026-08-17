/**
 * The list surface's public contract: everything above the table.
 *
 * `DataTableView` owns rows, cells, sorting and the pager. It does not own the
 * strip above it, and until now nothing did — so the toolbar was composed at
 * each call site and drifted into four different arrangements with three
 * different vertical rhythms. These types name the parts of that strip so a
 * caller supplies CONTENT and never geometry.
 *
 * @module components/ui/table/list-view/types
 */

import type { ReactNode } from "react";

import type { NextlyColumn } from "../data-table";

/**
 * The list's search field.
 *
 * Deliberately not a `ReactNode`: passing markup is what let each surface pick
 * its own width, and the width is exactly what has to agree across surfaces.
 * The caller owns the value and the handler; the toolbar owns the box.
 */
export interface ListSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Shows the field's spinner while a query is in flight. */
  isLoading?: boolean;
  /**
   * Extra attributes for the input itself, for call sites that hang a test or
   * automation hook on it. Kept to data attributes so it cannot be used to
   * reintroduce a per-surface width.
   */
  inputProps?: Record<`data-${string}`, string | boolean>;
}

/**
 * The columns control.
 *
 * Supplying this renders the control; omitting it renders nothing. The caller
 * keeps ownership of the visibility state because several surfaces persist it
 * per collection and one derives its defaults from collection config, so a
 * single storage rule imposed here would be wrong for them.
 */
export interface ListColumnsControl<Row extends object> {
  /** Every toggleable column, including those currently hidden. */
  columns: NextlyColumn<Row>[];
  isColumnVisible: (name: string) => boolean;
  onToggleColumn: (name: string) => void;
  /** Omit to hide the reset affordance entirely. */
  onReset?: () => void;
}

/**
 * The list's empty state.
 *
 * `DataTableView.emptyMessage` is a bare string, which is why every surface
 * wanting an icon, an explanation or a call to action grew its own component.
 * A structured value covers that case without another bespoke one, and the
 * string form stays available for callers that only ever wanted text.
 */
export interface ListEmpty {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Normally a `<Button>`; rendered under the description. */
  action?: ReactNode;
}

/**
 * Injection points around the list.
 *
 * The names match the vocabulary `DataTableSlots` already declared, so the two
 * do not answer the same question with different words. The ordering reads
 * top to bottom exactly as it renders:
 *
 *     beforeList → [ toolbar ] → beforeTable → [ table ] → afterTable → afterList
 *
 * `beforeList` sits ABOVE the toolbar and `beforeTable` below it, which is the
 * distinction a banner (above) and a filter summary (below) need.
 */
export interface ListSlots {
  beforeList?: ReactNode;
  beforeTable?: ReactNode;
  afterTable?: ReactNode;
  afterList?: ReactNode;
}
