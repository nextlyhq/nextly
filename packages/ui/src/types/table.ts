// Canonical pagination metadata (matches spec §5.1 wire shape and
// nextly's response-shapes.ts PaginationMeta). The admin's internal type and
// the wire contract are one shape; the legacy {page, pageSize, total,
// totalPages} form is gone.
/** @experimental */
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Sorting information for server
/** @experimental */
export interface SortInfo {
  field: string;
  direction: "asc" | "desc";
}

// Search/filter information for server
/** @experimental */
export interface FilterInfo {
  search?: string;
  filters?: Record<string, unknown>;
}

// Combined parameters for API calls. The `pageSize` field here is admin
// internal React state (the user's selected page-size dropdown value) and
// is mapped to the wire `limit` query param by the fetcher. Renaming this
// admin-internal field is deliberately left alone: it stays `pageSize` to
// avoid churn across every table component's local state.
/** @experimental */
export interface TableParams {
  pagination: {
    page: number;
    pageSize: number;
  };
  sorting?: SortInfo[];
  filters?: FilterInfo;
}

// Server response structure (canonical wire shape). Field is `items`, not
// `data`, matching the wire contract in spec section 5.1.
/** @experimental */
export interface ListResponse<TData> {
  items: TData[];
  meta: PaginationMeta;
}

// Pagination configuration for the client-side selector
/** @experimental */
export interface PaginationConfig {
  pageSize?: number;
  pageSizeOptions?: number[];
  showPageSizeSelector?: boolean;
  maxVisiblePages?: number;
}

// Action callbacks
/** @experimental */
export interface ActionCallbacks<TData = unknown> {
  onEdit?: (item: TData) => void;
  onDelete?: (item: TData) => void;
  onView?: (item: TData) => void;
}

// API callback for data fetching
/** @experimental */
export type DataFetcher<TData> = (
  params: TableParams
) => Promise<ListResponse<TData>>;
