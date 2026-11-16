/**
 * `@nextlyhq/admin/kit/table`: the data table and list view.
 *
 * The data table, the list view and its columns, search, pagination and the
 * bulk-action bars.
 *
 * One of the kit's areas, each its own entry, so a plugin page importing a
 * part through `@nextlyhq/plugin-sdk/admin` loads that part's area and not
 * the rest of the kit. INTERNAL, and unstable as a path: plugins import
 * through the SDK, never from here (see `../kit.ts`).
 *
 * @module kit/table
 */
// Unified DataTable + plugin registries — author surface re-exported by
// `@nextlyhq/plugin-sdk/admin`. Plugins can render the shared table and add cell
// renderers, columns, column transforms, and row/bulk actions to any admin list.
export {
  DataTable,
  DataTableView,
  registerCellRenderer,
  registerColumns,
  transformColumns,
  registerRowAction,
  registerBulkAction,
} from "../components/ui/table/data-table";

export type {
  DataTableProps,
  DataTableViewProps,
  DataTableSelection,
  DataTableTarget,
  DataTableContext,
  ColumnProvider,
  ColumnTransform,
  NextlyColumn,
  NextlyFieldType,
  NextlyFieldSchema,
  CellContext,
  CellRenderer,
  CellRendererDefinition,
  RowAction,
  BulkAction,
  DataTableGroup,
  DataTableGrouping,
  DataTableRowDetail,
} from "../components/ui/table/data-table";

// The list surface around that table — search, filters, the columns menu, the
// empty state and the slots above and below — and the hooks that remember a
// reader's column choice. Re-exported by `@nextlyhq/plugin-sdk/admin` so a
// plugin's list page is the admin's own list, not a copy of its look.
export {
  ListView,
  ListToolbar,
  ListColumnsMenu,
  ListEmptyState,
  useListColumns,
  useTableColumns,
} from "../components/ui/table/list-view";

export type {
  ListViewProps,
  ListToolbarProps,
  ListColumnsControl,
  ListEmpty,
  ListSearch,
  ListSlots,
  UseListColumnsOptions,
  UseTableColumnsOptions,
  UseTableColumnsResult,
} from "../components/ui/table/list-view";

export { BulkActionBar } from "../components/shared/bulk-action-bar";

export { BulkDeleteDialog } from "../components/shared/bulk-action-dialogs";

export type {
  BulkActionBarProps,
  BulkDeleteDialogProps,
} from "../types/ui/bulk-operations";

// Table Components
export { SearchBar } from "../components/shared/search-bar";

export type { SearchBarProps } from "../components/shared/search-bar/types";

export { Pagination } from "../components/shared/pagination";

export type { PaginationProps } from "../components/shared/pagination/types";
