/**
 * Entry Table Component
 *
 * Main data table for displaying collection entries with support for:
 * - Server-side pagination, sorting, and filtering
 * - Row selection for bulk operations
 * - Dynamic columns based on collection schema
 * - Loading and empty states
 *
 * @module components/entries/EntryList/EntryTable
 * @see https://tanstack.com/table/v8/docs/guide/pagination
 * @since 1.0.0
 */

import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@revnixhq/ui";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type SortingState,
  type RowSelectionState,
  type ColumnFiltersState,
  type VisibilityState,
  type OnChangeFn,
} from "@tanstack/react-table";
import {
  useState,
  useMemo,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";

import { SearchBar } from "@admin/components/shared/search-bar";

import { BulkActionBar } from "./BulkActionBar";
import {
  generateEntryColumns,
  type CollectionForColumns,
} from "./EntryTableColumns";
import { EntryTablePagination } from "./EntryTablePagination";
import { EntryTableSkeleton } from "./EntryTableSkeleton";
import { EntryTableToolbar } from "./EntryTableToolbar";

// ============================================================================
// Types
// ============================================================================

/**
 * Pagination state for the entry table.
 * Uses 0-indexed page numbers internally.
 */
export interface EntryTablePagination {
  /** Current page index (0-indexed) */
  page: number;
  /** Number of items per page */
  limit: number;
  /** Total number of items across all pages */
  total: number;
  /** Total number of pages */
  totalPages: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse sort string into TanStack Table sorting state.
 *
 * @param sortString - Sort string (e.g., '-createdAt' for desc, 'title' for asc)
 * @returns SortingState array for TanStack Table
 *
 * @example
 * parseSortString('-createdAt') // [{ id: 'createdAt', desc: true }]
 * parseSortString('title')      // [{ id: 'title', desc: false }]
 * parseSortString(undefined)    // []
 */
function parseSortString(sortString?: string): SortingState {
  if (!sortString) return [];

  const isDesc = sortString.startsWith("-");
  const fieldName = isDesc ? sortString.slice(1) : sortString;

  return [{ id: fieldName, desc: isDesc }];
}

/**
 * Props for the EntryTable component.
 */
export interface EntryTableProps {
  /** Collection configuration with fields and admin settings */
  collection: CollectionForColumns;
  /** Array of entry records to display */
  entries: Record<string, unknown>[];
  /** Pagination state */
  pagination: EntryTablePagination;
  /** Whether data is currently loading */
  isLoading?: boolean;
  /** Current sort value ('-field' for desc, 'field' for asc) */
  currentSort?: string;
  /** Callback when page changes (0-indexed) */
  onPageChange: (page: number) => void;
  /** Callback when page size changes */
  onLimitChange: (limit: number) => void;
  /** Callback when sort changes */
  onSortChange: (sort: string, order: "asc" | "desc") => void;
  /** Callback when search query changes */
  onSearchChange: (search: string) => void;
  /** Callback when edit action is triggered */
  onEdit: (entryId: string) => void;
  /** Callback when delete action is triggered */
  onDelete: (entryId: string) => void;
  /** Callback for bulk delete operation */
  onBulkDelete: (entryIds: string[]) => void;
  /** Callback for bulk update operation */
  onBulkUpdate?: (entryIds: string[], data: Record<string, unknown>) => void;
  /** Column visibility state (controlled by parent for persistence) */
  columnVisibility?: VisibilityState;
  /** Callback when column visibility changes */
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>;
  /** Callback to reset column visibility to defaults */
  onResetColumnVisibility?: () => void;
  /** Callback when row selection changes */
  onSelectionChange?: (selectedIds: string[]) => void;
  /** Current status filter value */
  status?: string;
  /** Callback when status filter changes */
  onStatusChange?: (status: string) => void;
  /** Created date lower bound (YYYY-MM-DD) */
  createdFrom?: string;
  /** Created date upper bound (YYYY-MM-DD) */
  createdTo?: string;
  /** Updated date lower bound (YYYY-MM-DD) */
  updatedFrom?: string;
  /** Updated date upper bound (YYYY-MM-DD) */
  updatedTo?: string;
  /** Callback when created-from filter changes */
  onCreatedFromChange?: (value: string) => void;
  /** Callback when created-to filter changes */
  onCreatedToChange?: (value: string) => void;
  /** Callback when updated-from filter changes */
  onUpdatedFromChange?: (value: string) => void;
  /** Callback when updated-to filter changes */
  onUpdatedToChange?: (value: string) => void;
}

/**
 * Ref handle for the EntryTable component.
 * Provides imperative methods for controlling the table.
 */
export interface EntryTableRef {
  /** Select all rows on the current page */
  selectAll: () => void;
  /** Clear all row selections */
  clearSelection: () => void;
  /** Get the IDs of currently selected rows */
  getSelectedIds: () => string[];
}

// ============================================================================
// Component
// ============================================================================

/**
 * Entry data table with server-side pagination, sorting, and bulk operations.
 *
 * Features:
 * - Dynamic columns generated from collection schema
 * - Row selection with bulk action bar
 * - Server-side sorting and pagination
 * - Search/filter toolbar
 * - Loading skeleton and empty states
 * - Click-to-edit row navigation
 *
 * @param props - Entry table props
 * @returns Entry table component
 *
 * @example
 * ```tsx
 * const tableRef = useRef<EntryTableRef>(null);
 *
 * // Select all with keyboard shortcut
 * const handleSelectAll = () => tableRef.current?.selectAll();
 *
 * <EntryTable
 *   ref={tableRef}
 *   collection={collection}
 *   entries={entries}
 *   pagination={{ page: 0, limit: 10, total: 100, totalPages: 10 }}
 *   isLoading={isLoading}
 *   onPageChange={(page) => setPage(page)}
 *   onLimitChange={(limit) => setLimit(limit)}
 *   onSortChange={(field, order) => setSort({ field, order })}
 *   onSearchChange={(search) => setSearch(search)}
 *   onEdit={(id) => router.push(`/entries/${collection.slug}/${id}`)}
 *   onDelete={(id) => deleteEntry.mutate(id)}
 *   onBulkDelete={(ids) => bulkDelete.mutate(ids)}
 *   onSelectionChange={(ids) => setHasSelection(ids.length > 0)}
 * />
 * ```
 */
export const EntryTable = forwardRef<EntryTableRef, EntryTableProps>(
  function EntryTable(
    {
      collection,
      entries,
      pagination,
      isLoading = false,
      currentSort,
      onPageChange,
      onLimitChange,
      onSortChange,
      onSearchChange,
      onEdit,
      onDelete,
      onBulkDelete,
      onBulkUpdate,
      columnVisibility: controlledColumnVisibility,
      onColumnVisibilityChange,
      onResetColumnVisibility,
      onSelectionChange,
      status = "all",
      onStatusChange,
      createdFrom = "",
      createdTo = "",
      updatedFrom = "",
      updatedTo = "",
      onCreatedFromChange,
      onCreatedToChange,
      onUpdatedFromChange,
      onUpdatedToChange,
    },
    ref
  ) {
    // ---------------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------------

    // Initialize sorting state from currentSort prop
    const [sorting, setSorting] = useState<SortingState>(() =>
      parseSortString(currentSort)
    );
    const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [globalFilter, setGlobalFilter] = useState("");

    // Sync sorting state when currentSort prop changes
    useEffect(() => {
      setSorting(parseSortString(currentSort));
    }, [currentSort]);

    // ---------------------------------------------------------------------------
    // Columns
    // ---------------------------------------------------------------------------

    // Memoized columns generated from collection schema
    const columns = useMemo(() => {
      const baseColumns = generateEntryColumns({
        collection,
        onEdit,
        onDelete,
      });

      return baseColumns;
    }, [collection, onEdit, onDelete]);

    // ---------------------------------------------------------------------------
    // Sorting Handler
    // ---------------------------------------------------------------------------

    const handleSortingChange: OnChangeFn<SortingState> = updater => {
      const newSorting =
        typeof updater === "function" ? updater(sorting) : updater;
      setSorting(newSorting);

      // Notify parent of sort change for server-side sorting
      if (newSorting.length > 0) {
        onSortChange(newSorting[0].id, newSorting[0].desc ? "desc" : "asc");
      }
    };

    // ---------------------------------------------------------------------------
    // Global Filter Handler
    // ---------------------------------------------------------------------------

    const handleGlobalFilterChange = (value: string) => {
      setGlobalFilter(value);
      onSearchChange(value);
    };

    // ---------------------------------------------------------------------------
    // Table Instance
    // ---------------------------------------------------------------------------

    const table = useReactTable({
      data: entries,
      columns,
      state: {
        sorting,
        rowSelection,
        columnFilters,
        globalFilter,
        // Use controlled column visibility if provided
        ...(controlledColumnVisibility !== undefined && {
          columnVisibility: controlledColumnVisibility,
        }),
      },
      // Row selection
      enableRowSelection: true,
      onRowSelectionChange: setRowSelection,
      // Use entry ID as row ID for stable selection across pages
      getRowId: row => row.id as string,
      // Sorting
      onSortingChange: handleSortingChange,
      // Filtering
      onColumnFiltersChange: setColumnFilters,
      onGlobalFilterChange: handleGlobalFilterChange,
      // Column visibility (controlled by parent for persistence)
      ...(onColumnVisibilityChange && {
        onColumnVisibilityChange,
      }),
      // Row models
      getCoreRowModel: getCoreRowModel(),
      getSortedRowModel: getSortedRowModel(),
      getFilteredRowModel: getFilteredRowModel(),
      // Server-side pagination/sorting
      manualPagination: true,
      manualSorting: true,
      manualFiltering: true,
      pageCount: pagination.totalPages,
    });

    // ---------------------------------------------------------------------------
    // Selected Entry IDs
    // ---------------------------------------------------------------------------

    const selectedEntryIds = useMemo(() => {
      return table
        .getSelectedRowModel()
        .rows.map(row => row.original.id as string);
    }, [rowSelection]);

    // Notify parent when selection changes
    useEffect(() => {
      onSelectionChange?.(selectedEntryIds);
    }, [selectedEntryIds]);

    // ---------------------------------------------------------------------------
    // Imperative Handle
    // ---------------------------------------------------------------------------

    useImperativeHandle(
      ref,
      () => ({
        selectAll: () => {
          table.toggleAllRowsSelected(true);
        },
        clearSelection: () => {
          table.toggleAllRowsSelected(false);
        },
        getSelectedIds: () => selectedEntryIds,
      }),
      [table, selectedEntryIds]
    );

    // ---------------------------------------------------------------------------
    // Handlers
    // ---------------------------------------------------------------------------

    const handleClearSelection = () => {
      setRowSelection({});
    };

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    // Check if the collection has a status field to show the filter
    const hasStatusField = useMemo(() => {
      const allFields = collection.fields || [];
      return allFields.some(f => "name" in f && f.name === "status");
    }, [collection]);

    const hasDateFilters =
      !!onCreatedFromChange ||
      !!onCreatedToChange ||
      !!onUpdatedFromChange ||
      !!onUpdatedToChange;

    const hasAnyActiveFilters =
      status !== "all" ||
      !!createdFrom ||
      !!createdTo ||
      !!updatedFrom ||
      !!updatedTo;

    const showFilterDropdown = hasStatusField || hasDateFilters;

    const clearDateFilters = () => {
      onCreatedFromChange?.("");
      onCreatedToChange?.("");
      onUpdatedFromChange?.("");
      onUpdatedToChange?.("");
    };

    // Render toolbar with search and presets
    const renderToolbar = () => (
      <EntryTableToolbar
        table={table}
        collection={collection}
        globalFilter={globalFilter}
        onGlobalFilterChange={handleGlobalFilterChange}
        onResetColumnVisibility={onResetColumnVisibility}
        hasActiveFilters={hasAnyActiveFilters}
        filters={
          showFilterDropdown ? (
            <>
              {hasStatusField && onStatusChange && (
                <>
                  <DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={status === "all"}
                    onCheckedChange={() => onStatusChange("all")}
                  >
                    All Status
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={status === "published"}
                    onCheckedChange={() => onStatusChange("published")}
                  >
                    Published
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={status === "draft"}
                    onCheckedChange={() => onStatusChange("draft")}
                  >
                    Draft
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={status === "archived"}
                    onCheckedChange={() => onStatusChange("archived")}
                  >
                    Archived
                  </DropdownMenuCheckboxItem>
                </>
              )}

              {hasDateFilters && (
                <>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 space-y-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      Created Date
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                      <Input
                        type="date"
                        value={createdFrom}
                        onChange={e => onCreatedFromChange?.(e.target.value)}
                        placeholder="From"
                      />
                      <Input
                        type="date"
                        value={createdTo}
                        onChange={e => onCreatedToChange?.(e.target.value)}
                        placeholder="To"
                      />
                    </div>

                    <p className="text-xs font-medium text-muted-foreground pt-1">
                      Updated Date
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                      <Input
                        type="date"
                        value={updatedFrom}
                        onChange={e => onUpdatedFromChange?.(e.target.value)}
                        placeholder="From"
                      />
                      <Input
                        type="date"
                        value={updatedTo}
                        onChange={e => onUpdatedToChange?.(e.target.value)}
                        placeholder="To"
                      />
                    </div>

                    <button
                      type="button"
                      className="w-full text-xs text-primary hover:underline text-left"
                      onClick={clearDateFilters}
                    >
                      Clear date filters
                    </button>
                  </div>
                </>
              )}
            </>
          ) : null
        }
      />
    );

    return (
      <div className="space-y-4">
        {/* Toolbar */}
        {renderToolbar()}

        {/* Bulk Action Bar */}
        {selectedEntryIds.length > 0 && (
          <BulkActionBar
            selectedCount={selectedEntryIds.length}
            collection={collection}
            onDelete={() => onBulkDelete(selectedEntryIds)}
            onUpdate={
              onBulkUpdate
                ? data => onBulkUpdate(selectedEntryIds, data)
                : undefined
            }
            onClear={handleClearSelection}
          />
        )}

        {/* Table Wrapper */}
        {isLoading ? (
          <EntryTableSkeleton />
        ) : (
          <div className="table-wrapper rounded-md border border-border bg-card overflow-hidden">
            <div className="border-0 rounded-none shadow-none">
              <Table>
                <TableHeader>
                  {/* Normal header */}
                  {table.getHeaderGroups().map(headerGroup => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map(header => (
                        <TableHead
                          key={header.id}
                          style={{ width: header.getSize() }}
                          className={
                            header.column.getCanSort()
                              ? "cursor-pointer select-none hover-unified"
                              : ""
                          }
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <div className="flex items-center gap-1">
                            {header.isPlaceholder
                              ? null
                              : flexRender(
                                  header.column.columnDef.header,
                                  header.getContext()
                                )}
                            {/* Sort indicator */}
                            {header.column.getIsSorted() && (
                              <span className="ml-1 text-muted-foreground">
                                {header.column.getIsSorted() === "asc"
                                  ? "↑"
                                  : "↓"}
                              </span>
                            )}
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.length === 0 ? (
                    // Empty state
                    <TableRow>
                      <TableCell
                        colSpan={columns.length}
                        className="h-24 text-center"
                      >
                        <div className="flex flex-col items-center justify-center text-muted-foreground">
                          <p>No entries found.</p>
                          {globalFilter && (
                            <p className="text-sm">
                              Try adjusting your search or filters.
                            </p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    // Data rows
                    table.getRowModel().rows.map(row => (
                      <TableRow
                        key={row.id}
                        data-state={row.getIsSelected() && "selected"}
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
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="table-footer border-t border-border">
              <EntryTablePagination
                pagination={pagination}
                onPageChange={onPageChange}
                onLimitChange={onLimitChange}
                isLoading={isLoading}
                className="p-4"
              />
            </div>
          </div>
        )}
      </div>
    );
  }
);
