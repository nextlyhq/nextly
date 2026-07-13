/**
 * DataTable — batteries-included unified table.
 *
 * Owns data fetching (server `fetcher` OR in-memory `data`), search, pagination,
 * internal row selection, and the bulk-action bar, then delegates all row/cell
 * rendering to the presentational `DataTableView`. Use this for new or simple
 * standalone lists that don't already manage their own state.
 *
 * Pages that already own their state with TanStack Query should render
 * `DataTableView` directly and keep their existing pagination/search/selection.
 *
 * @module components/ui/table/data-table/DataTable
 */

import { TablePagination, TableSearch, Button } from "@nextlyhq/ui";
import type { DataFetcher, PaginationConfig } from "@nextlyhq/ui";
import { X } from "lucide-react";
import { useMemo, useState } from "react";

import { useServerTable } from "@admin/hooks/useServerTable";

import { DataTableView } from "./DataTableView";
import type { DataTableSelection } from "./DataTableView";
import type {
  BulkAction,
  DataTableSlots,
  NextlyColumn,
  RowAction,
  RowClick,
} from "./types";

export interface DataTableProps<Row extends Record<string, unknown>> {
  columns: NextlyColumn<Row>[];
  /** Server mode: a fetcher. */
  fetcher?: DataFetcher<Row>;
  /** Client mode: an in-memory array (used when no `fetcher` is given). */
  data?: Row[];
  /** Stable row id (defaults to `row.id`). */
  getRowId?: (row: Row) => string;
  /** Row-click behavior: navigate, open a dialog (return void), select, or none. */
  rowClick?: RowClick<Row>;
  /** Which column renders as the primary link when `rowClick` yields an href. */
  primaryColumn?: string;
  /** Enable row selection checkboxes + bulk-action bar. */
  enableSelection?: boolean;
  /** Per-row action menu (three-dots). */
  rowActions?: (row: Row) => RowAction<Row>[];
  /** Bulk actions (shown when rows are selected). */
  bulkActions?: BulkAction<Row>[];
  title?: string;
  searchPlaceholder?: string;
  searchDelay?: number;
  pagination?: PaginationConfig;
  enableSorting?: boolean;
  slots?: DataTableSlots;
  /** Label shown in the selection bar, e.g. "user". */
  itemLabel?: string;
  emptyMessage?: string;
}

const DEFAULT_GET_ROW_ID = (row: Record<string, unknown>): string => {
  const id = row.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : "";
};

/** Wrap an in-memory array in a fetcher so client + server modes share one path. */
function makeStaticFetcher<Row extends Record<string, unknown>>(
  data: Row[]
): DataFetcher<Row> {
  return params => {
    const search = (params.filters?.search ?? "").toLowerCase();
    let rows = data;
    if (search) {
      rows = rows.filter(r =>
        Object.values(r).some(v =>
          typeof v === "string" || typeof v === "number"
            ? String(v).toLowerCase().includes(search)
            : false
        )
      );
    }
    const total = rows.length;
    const pageSize = params.pagination.pageSize || total || 1;
    const page = params.pagination.page;
    const start = page * pageSize;
    const paged = rows.slice(start, start + pageSize);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return Promise.resolve({
      items: paged,
      meta: {
        total,
        page,
        limit: pageSize,
        totalPages,
        hasNext: page < totalPages - 1,
        hasPrev: page > 0,
      },
    });
  };
}

export function DataTable<Row extends Record<string, unknown>>({
  columns,
  fetcher,
  data,
  getRowId = DEFAULT_GET_ROW_ID,
  rowClick = false,
  primaryColumn,
  enableSelection = false,
  rowActions,
  bulkActions,
  title = "",
  searchPlaceholder = "Search...",
  searchDelay = 300,
  pagination = {},
  enableSorting = true,
  slots,
  itemLabel = "item",
  emptyMessage,
}: DataTableProps<Row>) {
  const effectiveFetcher = useMemo<DataFetcher<Row>>(
    () => fetcher ?? makeStaticFetcher(data ?? []),
    [fetcher, data]
  );

  const {
    data: rows,
    loading,
    error,
    paginationMeta,
    searchInput,
    paginationConfig,
    handlePageChange,
    handlePageSizeChange,
    handleSearchChange,
    handleClearSearch,
    searchInputRef,
  } = useServerTable<Row>({
    fetcher: effectiveFetcher,
    pagination,
    searchDelay,
    enableSorting,
  });

  // Internal selection state (parent-owned selection is the DataTableView path).
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedRows = useMemo(
    () => rows.filter(r => selected[getRowId(r)]),
    [rows, selected, getRowId]
  );
  const clearSelection = () => setSelected({});

  const selection = useMemo<DataTableSelection<Row> | undefined>(() => {
    if (!enableSelection) return undefined;
    return {
      selectedIds: Object.keys(selected).filter(id => selected[id]),
      onToggle: row => {
        const id = getRowId(row);
        setSelected(s => ({ ...s, [id]: !s[id] }));
      },
      onToggleAll: (selectableRows, allSelected) => {
        if (allSelected) {
          setSelected({});
        } else {
          const next: Record<string, boolean> = {};
          for (const r of selectableRows) next[getRowId(r)] = true;
          setSelected(next);
        }
      },
    };
  }, [enableSelection, selected, getRowId]);

  return (
    <div className="space-y-4 w-full">
      {/* Header + controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {title && (
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h2>
        )}
        <div className="flex items-center gap-2">
          {slots?.toolbarActions}
          <TableSearch
            value={searchInput}
            onChange={handleSearchChange}
            onClear={handleClearSearch}
            placeholder={searchPlaceholder}
            isLoading={loading}
            inputRef={searchInputRef}
          />
        </div>
      </div>

      {slots?.beforeTable}

      {/* Selection bar */}
      {enableSelection && selectedRows.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-none border border-border bg-muted px-4 py-2 text-sm">
          <span className="text-foreground">
            {selectedRows.length} {itemLabel}
            {selectedRows.length === 1 ? "" : "s"} selected
          </span>
          <div className="flex items-center gap-2">
            {bulkActions?.map(action => (
              <Button
                key={action.id}
                size="sm"
                variant={action.destructive ? "destructive" : "outline"}
                onClick={() => {
                  action.onSelect(selectedRows);
                  clearSelection();
                }}
              >
                {action.icon}
                {action.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={clearSelection}
              className="text-muted-foreground"
            >
              <X className="h-4 w-4" /> Clear
            </Button>
          </div>
        </div>
      )}

      <DataTableView<Row>
        columns={columns}
        rows={rows}
        getRowId={getRowId}
        rowClick={rowClick}
        primaryColumn={primaryColumn}
        selection={selection}
        rowActions={rowActions}
        loading={loading}
        error={error}
        emptyMessage={emptyMessage}
      />

      <div className="rounded-none border border-border bg-card p-4">
        <TablePagination
          meta={paginationMeta}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          config={paginationConfig}
          isLoading={loading}
        />
      </div>

      {slots?.afterTable}
    </div>
  );
}
