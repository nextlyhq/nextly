// Local components (staying in admin)
export { DataTable } from "./DataTable";
export type { DataTableProps } from "./DataTable";
export { ActionColumn } from "./ActionColumn";
export { TableHeaderComponent } from "./TableHeader";
export type { TableHeaderProps } from "./TableHeader";

// Re-exported from @revnixhq/ui (moved components)
export {
  TableSearch,
  TablePagination,
  TableError,
  TableLoading,
  TableEmpty,
  TableSkeleton,
} from "@revnixhq/ui";

// Re-exported types from @revnixhq/ui
export type {
  TableSearchProps,
  TablePaginationProps,
  TableErrorProps,
  TableEmptyProps,
  PaginationMeta,
  SortInfo,
  FilterInfo,
  TableParams,
  TableResponse,
  PaginationConfig,
  ActionCallbacks,
  DataFetcher,
} from "@revnixhq/ui";
