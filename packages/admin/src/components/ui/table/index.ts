// Local components (staying in admin)
export { DataTable } from "./DataTable";
export type { DataTableProps } from "./DataTable";
export { ActionColumn } from "./ActionColumn";
export { TableHeaderComponent } from "./TableHeader";
export type { TableHeaderProps } from "./TableHeader";

// Re-exported from @nextlyhq/ui (moved components)
export {
  TableSearch,
  TablePagination,
  TableError,
  TableLoading,
  TableEmpty,
  TableSkeleton,
} from "@nextlyhq/ui";

// Re-exported types from @nextlyhq/ui
export type {
  TableSearchProps,
  TablePaginationProps,
  TableErrorProps,
  TableEmptyProps,
  PaginationMeta,
  SortInfo,
  FilterInfo,
  TableParams,
  ListResponse,
  PaginationConfig,
  ActionCallbacks,
  DataFetcher,
} from "@nextlyhq/ui";
