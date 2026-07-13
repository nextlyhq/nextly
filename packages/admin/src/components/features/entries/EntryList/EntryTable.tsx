"use client";

/**
 * Entry Table Component
 *
 * Main data table for displaying collection entries. Renders through the unified
 * DataTableView (selection, sortable headers, row actions, responsive card view)
 * with columns generated from the collection schema, and keeps the entries
 * toolbar (search, filters, column visibility), bulk-action bar, and pagination.
 *
 * @module components/entries/EntryList/EntryTable
 * @since 1.0.0
 */

import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Input,
} from "@nextlyhq/ui";
import {
  useState,
  useMemo,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";

import { Pencil, Trash2 } from "@admin/components/icons";
import { DataTableView } from "@admin/components/ui/table/data-table";
import type {
  DataTableSelection,
  RowAction,
} from "@admin/components/ui/table/data-table";
import { ROUTES, buildRoute } from "@admin/constants/routes";

import { BulkActionBar } from "./BulkActionBar";
import {
  buildEntryColumns,
  getEntryTitleField,
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

type EntryRow = Record<string, unknown>;

const rowId = (row: EntryRow): string => String(row.id);

/**
 * Props for the EntryTable component.
 */
export interface EntryTableProps {
  /** Collection configuration with fields and admin settings */
  collection: CollectionForColumns;
  /** Array of entry records to display */
  entries: EntryRow[];
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
  /**
   * Callback for bulk publish (sets `status: "published"` on every selected
   * entry). The bar gates the button on `collection.status === true`, so
   * passing this for non-status collections is harmless but unused.
   */
  onBulkPublish?: (entryIds: string[]) => void;
  /** Callback for bulk unpublish (sets `status: "draft"`). Same gating. */
  onBulkUnpublish?: (entryIds: string[]) => void;
  /** Whether a bulk publish/unpublish request is in flight. */
  isBulkPublishing?: boolean;
  /** Column visibility state (controlled by parent for persistence) */
  columnVisibility?: Record<string, boolean>;
  /** Callback when column visibility changes */
  onColumnVisibilityChange?: (
    updater: (prev: Record<string, boolean>) => Record<string, boolean>
  ) => void;
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
      onBulkPublish,
      onBulkUnpublish,
      isBulkPublishing = false,
      columnVisibility,
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
    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    const [globalFilter, setGlobalFilter] = useState("");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);

    // -------------------------------------------------------------------------
    // Columns
    // -------------------------------------------------------------------------

    const columns = useMemo(
      () => buildEntryColumns(collection, columnVisibility),
      [collection, columnVisibility]
    );

    const titleField = useMemo(
      () => getEntryTitleField(collection),
      [collection]
    );

    // -------------------------------------------------------------------------
    // Sorting
    // -------------------------------------------------------------------------

    const sort = useMemo(():
      | { field: string; order: "asc" | "desc" }
      | undefined => {
      if (!currentSort) return undefined;
      const desc = currentSort.startsWith("-");
      return {
        field: desc ? currentSort.slice(1) : currentSort,
        order: desc ? "desc" : "asc",
      };
    }, [currentSort]);

    // -------------------------------------------------------------------------
    // Selection
    // -------------------------------------------------------------------------

    const selection = useMemo<DataTableSelection<EntryRow>>(
      () => ({
        selectedIds,
        onToggle: row => {
          const id = rowId(row);
          setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
          );
        },
        onToggleAll: (rows, allSelected) => {
          const ids = rows.map(rowId);
          setSelectedIds(prev =>
            allSelected
              ? prev.filter(id => !ids.includes(id))
              : Array.from(new Set([...prev, ...ids]))
          );
        },
      }),
      [selectedIds]
    );

    // Notify parent when selection changes.
    useEffect(() => {
      onSelectionChange?.(selectedIds);
    }, [selectedIds, onSelectionChange]);

    useImperativeHandle(
      ref,
      () => ({
        selectAll: () => setSelectedIds(entries.map(rowId)),
        clearSelection: () => setSelectedIds([]),
        getSelectedIds: () => selectedIds,
      }),
      [entries, selectedIds]
    );

    // -------------------------------------------------------------------------
    // Row navigation + actions
    // -------------------------------------------------------------------------

    const rowActions = useMemo(
      () =>
        (row: EntryRow): RowAction<EntryRow>[] => {
          const id = rowId(row);
          return [
            {
              id: "edit",
              label: "Edit",
              icon: <Pencil className="h-4 w-4" />,
              onSelect: () => onEdit(id),
            },
            {
              id: "delete",
              label: "Delete",
              icon: <Trash2 className="h-4 w-4" />,
              destructive: true,
              onSelect: () => onDelete(id),
            },
          ];
        },
      [onEdit, onDelete]
    );

    // -------------------------------------------------------------------------
    // Search + column visibility helpers
    // -------------------------------------------------------------------------

    const handleGlobalFilterChange = (value: string) => {
      setGlobalFilter(value);
      onSearchChange(value);
    };

    const isColumnVisible = (name: string) =>
      columnVisibility?.[name] !== false;
    const handleToggleColumn = (name: string) => {
      onColumnVisibilityChange?.(prev => ({
        ...prev,
        [name]: prev[name] === false,
      }));
    };

    // -------------------------------------------------------------------------
    // Filters (status + date range) rendered into the toolbar dropdown
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Render
    // -------------------------------------------------------------------------

    return (
      <div className="space-y-4">
        {/* Toolbar */}
        <EntryTableToolbar
          collection={collection}
          columns={columns}
          isColumnVisible={isColumnVisible}
          onToggleColumn={handleToggleColumn}
          onResetColumnVisibility={onResetColumnVisibility}
          globalFilter={globalFilter}
          onGlobalFilterChange={handleGlobalFilterChange}
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
                    <div className="space-y-3 px-2 py-1.5">
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

                      <p className="pt-1 text-xs font-medium text-muted-foreground">
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
                        className="w-full text-left text-xs text-primary hover:underline"
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

        {/* Bulk Action Bar */}
        {selectedIds.length > 0 && (
          <BulkActionBar
            selectedCount={selectedIds.length}
            collection={collection}
            onDelete={() => onBulkDelete(selectedIds)}
            onUpdate={
              onBulkUpdate ? data => onBulkUpdate(selectedIds, data) : undefined
            }
            onPublish={
              onBulkPublish ? () => onBulkPublish(selectedIds) : undefined
            }
            onUnpublish={
              onBulkUnpublish ? () => onBulkUnpublish(selectedIds) : undefined
            }
            isPublishing={isBulkPublishing}
            onClear={() => setSelectedIds([])}
          />
        )}

        {/* Table + Pagination */}
        {isLoading ? (
          <EntryTableSkeleton />
        ) : (
          <div className="table-wrapper overflow-hidden rounded-none border border-border bg-card">
            <DataTableView<EntryRow>
              columns={columns}
              rows={entries}
              getRowId={rowId}
              selection={selection}
              rowActions={rowActions}
              sort={sort}
              onSortChange={onSortChange}
              rowHref={row =>
                buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, {
                  slug: collection.slug,
                  id: rowId(row),
                })
              }
              primaryColumn={titleField}
              bordered={false}
              ariaLabel="Entries table"
              emptyMessage={
                globalFilter
                  ? "No entries found. Try adjusting your search or filters."
                  : "No entries found."
              }
            />

            <EntryTablePagination
              pagination={pagination}
              onPageChange={onPageChange}
              onLimitChange={onLimitChange}
              isLoading={isLoading}
            />
          </div>
        )}
      </div>
    );
  }
);
