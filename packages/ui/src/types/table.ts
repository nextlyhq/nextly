// Canonical pagination metadata (matches spec section 5.1 wire shape and
// nextly's response-shapes.ts PaginationMeta). Phase 4.7 unified the admin
// internal type with the wire contract; the legacy {page, pageSize, total,
// totalPages} shape was dropped.
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Sorting information for server
export interface SortInfo {
  field: string;
  direction: "asc" | "desc";
}

// Search/filter information for server
export interface FilterInfo {
  search?: string;
  filters?: Record<string, unknown>;
}

// Combined parameters for API calls. The `pageSize` field here is admin
// internal React state (the user's selected page-size dropdown value) and
// is mapped to the wire `limit` query param by the fetcher. Renaming this
// admin-internal field is intentionally out of Phase 4.7 scope; it stays as
// `pageSize` to avoid churn across every table component's local state.
export interface TableParams {
  pagination: {
    page: number;
    pageSize: number;
  };
  sorting?: SortInfo[];
  filters?: FilterInfo;
}

// Server response structure (canonical wire shape). Renamed from
// TableResponse in Phase 4.7. Field is `items` (not `data`) per spec
// section 5.1.
export interface ListResponse<TData> {
  items: TData[];
  meta: PaginationMeta;
}

// Pagination configuration for the client-side selector
export interface PaginationConfig {
  pageSize?: number;
  pageSizeOptions?: number[];
  showPageSizeSelector?: boolean;
  maxVisiblePages?: number;
}

// Action callbacks
export interface ActionCallbacks<TData = unknown> {
  onEdit?: (item: TData) => void;
  onDelete?: (item: TData) => void;
  onView?: (item: TData) => void;
}

// API callback for data fetching
export type DataFetcher<TData> = (
  params: TableParams
) => Promise<ListResponse<TData>>;
