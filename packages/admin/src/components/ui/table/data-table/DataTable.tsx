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
import { useEffect, useMemo, useState } from "react";

import { useServerTable } from "@admin/hooks/useServerTable";

import { DataTableView } from "./DataTableView";
import type { DataTableSelection } from "./DataTableView";
import { getPluginBulkActions } from "./plugin-registry";
import type {
  BulkAction,
  DataTableSlots,
  NextlyColumn,
  RowAction,
} from "./types";

export interface DataTableProps<Row extends object> {
  columns: NextlyColumn<Row>[];
  /** Server mode: a fetcher. */
  fetcher?: DataFetcher<Row>;
  /** Client mode: an in-memory array (used when no `fetcher` is given). */
  data?: Row[];
  /** Stable row id (defaults to `row.id`). */
  getRowId?: (row: Row) => string;
  /** Pure resolver for a row's navigation href (whole-row nav + primary link). */
  rowHref?: (row: Row) => string | undefined;
  /** Side-effect handler for a row click (e.g. open a dialog). */
  onRowClick?: (row: Row) => void;
  /** Which column renders as the primary link when `rowHref` yields an href. */
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
  /** List key for plugin contributions (columns, actions). See DataTableView. */
  registryKey?: string;
}

const DEFAULT_GET_ROW_ID = (row: object): string => {
  const id = (row as { id?: unknown }).id;
  if (typeof id === "string" || typeof id === "number") {
    return String(id);
  }
  // Collapsing ID-less rows to "" produces duplicate React keys and merges their
  // selection state. Require a real id or an explicit getRowId instead.
  throw new Error("DataTable rows require an id or a custom getRowId.");
};

/** Wrap an in-memory array in a fetcher so client + server modes share one path. */
function makeStaticFetcher<Row extends object>(data: Row[]): DataFetcher<Row> {
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
        // `page` is a 0-based index here; the pagination controls expect a
        // 1-based `meta.page`.
        page: page + 1,
        limit: pageSize,
        totalPages,
        hasNext: page < totalPages - 1,
        hasPrev: page > 0,
      },
    });
  };
}

export function DataTable<Row extends object>({
  columns,
  fetcher,
  data,
  getRowId = DEFAULT_GET_ROW_ID,
  rowHref,
  onRowClick,
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
  registryKey,
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

  // Keep selection scoped to the rows currently loaded. When the page, search, or
  // filters change the loaded rows, prune any selected ids that are no longer
  // present so bulk actions and their confirmation always reflect exactly what is
  // shown (never delete off-page rows the user can't see).
  useEffect(() => {
    setSelected(prev => {
      const pageIds = new Set(rows.map(getRowId));
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const id of Object.keys(prev)) {
        if (prev[id] && pageIds.has(id)) next[id] = true;
        else if (prev[id]) changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows, getRowId]);

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
            {[
              ...(bulkActions ?? []),
              ...(registryKey ? getPluginBulkActions<Row>(registryKey) : []),
            ].map(action => (
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
        rowHref={rowHref}
        onRowClick={onRowClick}
        primaryColumn={primaryColumn}
        selection={selection}
        rowActions={rowActions}
        registryKey={registryKey}
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
