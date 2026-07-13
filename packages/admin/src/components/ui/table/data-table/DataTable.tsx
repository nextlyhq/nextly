/**
 * Unified DataTable
 *
 * ONE table component for the whole admin. Built on TanStack Table v8 internally
 * (never exposed), styled with the `@nextlyhq/ui` Table primitives. Supersedes the
 * old `ui/table/DataTable` and the bespoke `EntryTable`/`ApiKeyTable`/media list.
 *
 * Features: server (`fetcher`) OR client (`data`) data, whole-row navigation with a
 * primary-cell link, a `rowClick` escape hatch that can open a dialog instead of
 * routing (media popup), row selection + bulk-action bar, per-row action menu,
 * column visibility, search, pagination, loading/empty/error, and list-view slots.
 *
 * Cell rendering resolves via the field-type registry (`cell-registry`), so
 * user-defined schemas and plugins can contribute renderers.
 *
 * See tasks/admin-tasks/03-unified-datatable-plan.md.
 *
 * @module components/ui/table/data-table/DataTable
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TablePagination,
  TableSearch,
  TableError,
  TableEmpty,
  TableLoading,
  Checkbox,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import type { DataFetcher, PaginationConfig } from "@nextlyhq/ui";
import { MoreHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";

import { useServerTable } from "@admin/hooks/useServerTable";
import { navigateTo } from "@admin/lib/navigation";
import { cn } from "@admin/lib/utils";

import { resolveCellRenderer } from "./cell-registry";
import type {
  BulkAction,
  CellContext,
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

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedRows = useMemo(
    () => rows.filter(r => selected[getRowId(r)]),
    [rows, selected, getRowId]
  );
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const someSelected = selectedRows.length > 0 && !allSelected;

  const visibleColumns = useMemo(
    () => columns.filter(c => !c.hidden),
    [columns]
  );
  const firstColName = primaryColumn ?? visibleColumns[0]?.name;

  const toggleAll = () => {
    if (allSelected) {
      setSelected({});
    } else {
      const next: Record<string, boolean> = {};
      for (const r of rows) next[getRowId(r)] = true;
      setSelected(next);
    }
  };
  const toggleRow = (row: Row) => {
    const id = getRowId(row);
    setSelected(s => ({ ...s, [id]: !s[id] }));
  };
  const clearSelection = () => setSelected({});

  // Resolve a cell's rendered content via explicit cell -> registry -> text.
  const renderCell = (col: NextlyColumn<Row>, row: Row, href?: string) => {
    const value = col.accessor ? col.accessor(row) : row[col.name];
    const ctx: CellContext<Row> = {
      value,
      row,
      column: col,
      field: col.field,
      href,
      viewType: "list",
    };
    const renderer = resolveCellRenderer<Row>(col.cell, col.fieldType);
    const content = renderer(ctx);
    // Primary column becomes the navigation link when rowClick yields an href.
    if (href && col.name === firstColName) {
      return (
        <a
          href={href}
          onClick={e => {
            e.preventDefault();
            e.stopPropagation();
            navigateTo(href);
          }}
          className="text-foreground font-medium hover:underline"
        >
          {content}
        </a>
      );
    }
    return content;
  };

  // Compute per-row navigation: href (navigate), or a void action (dialog), or none.
  const resolveRow = (row: Row): { href?: string; onClick?: () => void } => {
    if (rowClick === false) return {};
    if (rowClick === "select") return { onClick: () => toggleRow(row) };
    if (rowClick === "edit") return {}; // page supplies its own accessor via function form
    if (typeof rowClick === "function") {
      const result = rowClick(row);
      if (typeof result === "string") return { href: result };
      // returned void -> the function already performed its side-effect (e.g. dialog);
      // give the row an onClick that re-invokes it.
      return { onClick: () => rowClick(row) };
    }
    return {};
  };

  const colSpan =
    visibleColumns.length + (enableSelection ? 1 : 0) + (rowActions ? 1 : 0);

  return (
    <div className="@container/table space-y-4 w-full">
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

      {error && (
        <div className="rounded-none bg-destructive/10 p-3 text-sm text-destructive">
          <TableError message={error} />
        </div>
      )}

      {/* Table card */}
      <div className="rounded-none border border-border bg-card text-card-foreground overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="w-full">
            <TableHeader>
              <TableRow>
                {enableSelection && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                )}
                {visibleColumns.map(col => (
                  <TableHead
                    key={col.name}
                    className={cn(
                      col.align === "right" && "text-right",
                      col.align === "center" && "text-center"
                    )}
                  >
                    {col.header}
                  </TableHead>
                ))}
                {rowActions && <TableHead className="w-12 text-right" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={colSpan} className="h-24 text-center">
                    <TableLoading />
                  </TableCell>
                </TableRow>
              ) : rows.length > 0 ? (
                rows.map(row => {
                  const id = getRowId(row);
                  const nav = resolveRow(row);
                  const clickable = Boolean(nav.href || nav.onClick);
                  const actions = rowActions?.(row) ?? [];
                  return (
                    <TableRow
                      key={id}
                      data-state={selected[id] ? "selected" : undefined}
                      className={cn(
                        "hover-unified-table-row",
                        clickable && "cursor-pointer",
                        selected[id] && "bg-muted/50"
                      )}
                      onClick={() => {
                        if (nav.href) navigateTo(nav.href);
                        else nav.onClick?.();
                      }}
                    >
                      {enableSelection && (
                        <TableCell
                          className="w-10"
                          onClick={e => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={!!selected[id]}
                            onCheckedChange={() => toggleRow(row)}
                            aria-label="Select row"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.map(col => (
                        <TableCell
                          key={col.name}
                          className={cn(
                            col.align === "right" && "text-right",
                            col.align === "center" && "text-center"
                          )}
                        >
                          {renderCell(col, row, nav.href)}
                        </TableCell>
                      ))}
                      {rowActions && (
                        <TableCell
                          className="w-12 text-right"
                          onClick={e => e.stopPropagation()}
                        >
                          {actions.length > 0 && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label="Row actions"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {actions
                                  .filter(a => a.isVisible?.(row) ?? true)
                                  .map(a => (
                                    <DropdownMenuItem
                                      key={a.id}
                                      disabled={a.isDisabled?.(row) ?? false}
                                      onSelect={() => a.onSelect(row)}
                                      className={cn(
                                        a.destructive && "text-destructive"
                                      )}
                                    >
                                      {a.icon}
                                      {a.label}
                                    </DropdownMenuItem>
                                  ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={colSpan} className="h-24 text-center">
                    <TableEmpty />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="border-t border-border p-4">
          <TablePagination
            meta={paginationMeta}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            config={paginationConfig}
            isLoading={loading}
          />
        </div>
      </div>

      {slots?.afterTable}
    </div>
  );
}
