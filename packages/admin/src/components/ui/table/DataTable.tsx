import {
  Table,
  TableBody,
  TableCell,
  TableRow,
  TablePagination,
  TableSearch,
  TableError,
  TableEmpty,
  TableLoading,
} from "@revnixhq/ui";
import type { DataFetcher, PaginationConfig, TableParams } from "@revnixhq/ui";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";

import { useServerTable } from "@admin/hooks/useServerTable";

import { TableHeaderComponent } from "./TableHeader";

/**
 * Props for DataTable component
 *
 * @typeParam TData - The data type for table rows (must be an object)
 * @typeParam TValue - The value type for cells (defaults to unknown)
 */
export interface DataTableProps<
  TData extends Record<string, unknown>,
  TValue = unknown,
> {
  /** Column definitions for the table */
  columns: ColumnDef<TData, TValue>[];
  /** Function to fetch data from server */
  fetcher: DataFetcher<TData>;
  /** Optional title for the table */
  title?: string;
  /** Placeholder text for search input */
  searchPlaceholder?: string;
  /** Pagination configuration */
  pagination?: PaginationConfig;
  /** Debounce delay for search input in milliseconds */
  searchDelay?: number;
  /** Initial table parameters */
  initialParams?: Partial<TableParams>;
  /** Enable sorting functionality */
  enableSorting?: boolean;
}

/**
 * Server-Side DataTable Component
 *
 * A fully-featured data table with:
 * - Server-side pagination
 * - Server-side sorting
 * - Server-side search/filtering
 * - Loading states
 * - Error handling
 * - Empty states
 *
 * @example
 * ```tsx
 * <DataTable
 *   columns={userColumns}
 *   fetcher={async (params) => {
 *     const response = await api.getUsers(params);
 *     return response;
 *   }}
 *   title="Users"
 *   searchPlaceholder="Search users..."
 *   pagination={{ pageSize: 20 }}
 * />
 * ```
 */
export function DataTable<
  TData extends Record<string, unknown>,
  TValue = unknown,
>({
  columns,
  fetcher,
  title = "",
  searchPlaceholder = "Search...",
  pagination = {},
  searchDelay = 300,
  initialParams,
  enableSorting = true,
}: DataTableProps<TData, TValue>) {
  // Use server table hook for state management and data fetching
  const {
    data: serverData,
    loading,
    error,
    paginationMeta,
    sorting,
    searchInput,
    currentPage,
    currentPageSize,
    paginationConfig,
    handlePageChange,
    handlePageSizeChange,
    handleSearchChange,
    handleSortingChange,
    handleClearSearch,
    searchInputRef,
  } = useServerTable({
    fetcher,
    pagination,
    searchDelay,
    initialParams,
    enableSorting,
  });

  // Initialize React Table
  const table = useReactTable<TData>({
    data: serverData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableSorting: enableSorting,
    enableMultiSort: false,
    pageCount: paginationMeta.totalPages,
    state: {
      pagination: {
        pageIndex: currentPage,
        pageSize: currentPageSize,
      },
      sorting: sorting,
    },
    onSortingChange: handleSortingChange,
  });

  return (
    <div className="space-y-4 w-full">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {title && (
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h2>
        )}
        <div className="flex items-center gap-2">
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

      {/* Error Message */}
      {error && (
        <div className="rounded-none bg-destructive/10 p-3 text-sm text-destructive">
          <TableError message={error} />
        </div>
      )}

      {/* Table Card */}
      <div className="table-wrapper rounded-none  border border-primary/5 bg-card text-card-foreground overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="w-full">
            <TableHeaderComponent table={table} enableSorting={enableSorting} />
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={table.getAllColumns().length}
                    className="h-24 text-center"
                  >
                    <TableLoading />
                  </TableCell>
                </TableRow>
              ) : serverData.length > 0 ? (
                table.getRowModel().rows.map(row => (
                  <TableRow
                    key={row.id}
                    className={
                      loading
                        ? "opacity-50 pointer-events-none"
                        : "hover-unified-table-row"
                    }
                  >
                    {row.getVisibleCells().map(cell => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={table.getAllColumns().length}
                    className="h-24 text-center"
                  >
                    <TableEmpty
                      message={error ? "Failed to load data." : undefined}
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Footer */}
        <div className="table-footer  border-t border-primary/5 p-4 bg-[hsl(var(--table-header-bg))]">
          <TablePagination
            meta={paginationMeta}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            config={paginationConfig}
            isLoading={loading}
          />
        </div>
      </div>
    </div>
  );
}
