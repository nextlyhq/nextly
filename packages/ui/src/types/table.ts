// Server-side pagination metadata
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// Sorting information for server
export interface SortInfo {
  field: string;
  direction: "asc" | "desc";
}

// Search/filter information for server
export interface FilterInfo {
  search?: string;
  filters?: Record<string, any>;
}

// Combined parameters for API calls
export interface TableParams {
  pagination: Pick<PaginationMeta, "page" | "pageSize">;
  sorting?: SortInfo[];
  filters?: FilterInfo;
}

// Server response structure
export interface TableResponse<TData> {
  data: TData[];
  meta: PaginationMeta;
}

// Pagination configuration
export interface PaginationConfig {
  pageSize?: number;
  pageSizeOptions?: number[];
  showPageSizeSelector?: boolean;
  maxVisiblePages?: number;
}

// Action callbacks
export interface ActionCallbacks<TData = any> {
  onEdit?: (item: TData) => void;
  onDelete?: (item: TData) => void;
  onView?: (item: TData) => void;
}

// API callback for data fetching
export type DataFetcher<TData> = (
  params: TableParams
) => Promise<TableResponse<TData>>;
