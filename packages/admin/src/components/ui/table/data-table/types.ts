/**
 * Unified DataTable — public type contract.
 *
 * These are the only table types that plugins / extension authors and app code
 * should see. They are intentionally engine-agnostic: the underlying table
 * library (TanStack Table v8 today) is never referenced here, so an eventual
 * engine upgrade stays a contained internal change and third-party cell
 * renderers keep working.
 *
 * - A cell renderer receives `value`/`row`/`field`/`href`/`onClick`.
 * - A cell is resolved from a field-type-keyed renderer registry.
 * - Row navigation is a `rowClick` union; a function form may return void to run
 *   a side-effect (e.g. open a dialog) instead of routing.
 *
 * @module components/ui/table/data-table/types
 */

import type React from "react";

/** A field type string (matches the admin `FieldType` enum values). */
export type NextlyFieldType = string;

/**
 * Context handed to every cell renderer. Framework-agnostic on purpose: no
 * TanStack `CellContext` leaks here, so renderers survive an engine change.
 */
export interface CellContext<Row extends object = Record<string, unknown>> {
  /** The value for this cell. */
  value: unknown;
  /** The full row record. */
  row: Row;
  /** The column this cell belongs to. */
  column: NextlyColumn<Row>;
  /** The field schema, when the column was generated from a collection field. */
  field?: NextlyFieldSchema;
  /** If the row navigates via href, the resolved href (so the cell can wrap in a link). */
  href?: string;
  /** Row-click handler, when the row is interactive but not a plain link (e.g. opens a dialog). */
  onClick?: () => void;
  /** Always "list" for now; reserved for future card/compact modes. */
  viewType: "list";
}

/** A single cell renderer function. */
export type CellRenderer<Row extends object = Record<string, unknown>> = (
  ctx: CellContext<Row>
) => React.ReactNode;

/**
 * A cell renderer registration: a renderer advertises
 * which field `types` it can render; the registry resolves a column's cell by
 * looking up its `fieldType`.
 */
export interface CellRendererDefinition {
  /** Unique id (e.g. "date", "relationship"). */
  id: string;
  /** Human label (for future column-config UI). */
  name?: string;
  /** Field types this renderer handles. */
  types: NextlyFieldType[];
  /** The renderer. */
  component: CellRenderer;
}

/** Minimal field schema shape a column may carry (subset of the admin FieldConfig). */
export interface NextlyFieldSchema {
  name: string;
  label?: string;
  type: NextlyFieldType;
  [key: string]: unknown;
}

/**
 * A single column definition. Engine-agnostic; internally mapped to a TanStack
 * `ColumnDef`. Columns can be hand-authored (config lists) or generated from a
 * collection schema (dynamic content lists), and appended/mutated by plugins.
 */
export interface NextlyColumn<Row extends object = Record<string, unknown>> {
  /** Accessor key into the row, or a synthetic id for computed/action columns. */
  name: string;
  /** Column header content. */
  header: React.ReactNode;
  /** Custom value accessor; defaults to `row[name]`. */
  accessor?: (row: Row) => unknown;
  /** Explicit cell renderer; if omitted, resolved from `fieldType` via the registry. */
  cell?: CellRenderer<Row>;
  /** Field type used to resolve a cell renderer from the registry. */
  fieldType?: NextlyFieldType;
  /** Field schema, when generated from a collection field. */
  field?: NextlyFieldSchema;
  /** Whether this column is sortable. */
  sortable?: boolean;
  /** Whether this column participates in search. */
  searchable?: boolean;
  /** Hidden by default (still toggleable in the column selector). */
  hidden?: boolean;
  /** Hide this column in the responsive card view (narrow container). */
  hideOnMobile?: boolean;
  /** Hide the label prefix for this column in the card view (value only). */
  hideLabelOnMobile?: boolean;
  /** Text alignment. */
  align?: "left" | "center" | "right";
  /** Fixed/So min width (px) hint. */
  width?: number;
  /** Arbitrary bag for plugin/extension metadata (fieldType, pluginId, editable, ...). */
  meta?: Record<string, unknown>;
}

/** A per-row action (rendered into the row's three-dots menu). */
export interface RowAction<Row extends object = Record<string, unknown>> {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Hide the action for specific rows. */
  isVisible?: (row: Row) => boolean;
  /** Disable (but still show) for specific rows. */
  isDisabled?: (row: Row) => boolean;
  /** Destructive styling (e.g. delete). */
  destructive?: boolean;
  onSelect: (row: Row) => void;
}

/** A bulk action (rendered in the selection bar shown when rows are selected). */
export interface BulkAction<Row extends object = Record<string, unknown>> {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  destructive?: boolean;
  onSelect: (selectedRows: Row[]) => void;
}

/** List-view injection slots for non-column UI. */
export interface DataTableSlots {
  beforeTable?: React.ReactNode;
  afterTable?: React.ReactNode;
  /** Rendered next to the search/filter controls. */
  toolbarActions?: React.ReactNode;
}

/**
 * A group of rows in a list: what its header row says. The group's rows are
 * the list's rows that `DataTableGrouping.groupOf` places in it, in the order
 * the list gives them.
 */
export interface DataTableGroup {
  /** Names the group to `groupOf`, and to the collapsed ids. */
  id: string;
  /** What the group is; it also names the group to assistive technology. */
  title: React.ReactNode;
  /** One line under the title, saying more about the group. */
  description?: React.ReactNode;
  /** A status beside the title, usually a `Badge`. */
  badge?: React.ReactNode;
  /**
   * What the header counts. By default the number of the group's rows in the
   * list; pass the full total when the list is paginated and a page holds only
   * part of the group.
   */
  count?: React.ReactNode;
  /** The group's own buttons or links, at the end of its header row. */
  actions?: React.ReactNode;
}

/**
 * Rows drawn in groups, each under a header row. Every group listed is drawn,
 * in the order listed, even one with no rows, since its header can carry a
 * count and actions of its own. A row whose group is not listed is drawn after
 * the groups, under no header.
 */
export interface DataTableGrouping<
  Row extends object = Record<string, unknown>,
> {
  groups: readonly DataTableGroup[];
  /** The id of the group a row belongs to. */
  groupOf: (row: Row) => string;
  /**
   * Whether a group's rows can be folded away under its header, by a button
   * on the header that says whether they are shown. Default: false.
   */
  collapsible?: boolean;
  /** The folded groups, when the page owns that state. */
  collapsedIds?: readonly string[];
  /** The groups folded at first, when the list owns that state. */
  defaultCollapsedIds?: readonly string[];
  /** Called with every folded group's id after one is folded or unfolded. */
  onCollapsedChange?: (collapsedIds: string[]) => void;
}

/**
 * A region below a row that its toggle opens: more about the row than its
 * cells hold, such as the items it counts.
 */
export interface DataTableRowDetail<
  Row extends object = Record<string, unknown>,
> {
  /** What the open region holds. Called only while the row is open. */
  render: (row: Row) => React.ReactNode;
  /** Whether a row has a region to open. Default: every row has one. */
  hasDetail?: (row: Row) => boolean;
  /**
   * The toggle's accessible name. By default "Details" followed by the text of
   * the row's identifying cell, so each row's toggle is told apart.
   */
  toggleLabel?: (row: Row) => string;
  /** The open rows' ids, when the page owns that state. */
  expandedIds?: readonly string[];
  /** The rows open at first, when the list owns that state. */
  defaultExpandedIds?: readonly string[];
  /** Called with every open row's id after one is opened or closed. */
  onExpandedChange?: (expandedIds: string[]) => void;
}
