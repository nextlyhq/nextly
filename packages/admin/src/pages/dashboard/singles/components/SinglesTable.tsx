"use client";

/**
 * SinglesTable Component
 *
 * Displays a responsive table/card view of Singles with search, pagination, and CRUD actions.
 * Uses ResponsiveTable for mobile responsiveness and TanStack Query for data fetching.
 *
 * ## Features
 * - Mobile responsive: Card view (< 768px), table view (>= 768px)
 * - Search Singles by label or slug (debounced 300ms)
 * - Filter by source (code, ui, built-in) and migration status
 * - Server-side pagination (10/25/50 rows per page)
 * - Source badges with color coding (code=primary, ui=success, built-in=default)
 * - Locked indicator for code-first Singles
 * - Migration status badges
 * - Field count display
 * - CRUD actions: Edit (smart routing), View Document, Delete
 * - Actions disabled appropriately for locked Singles
 *
 * @example
 * ```tsx
 * <SinglesTable />
 * ```
 */

import type { Column } from "@revnixhq/ui";
import {
  Alert,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ResponsiveTable,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@revnixhq/ui";
import { MoreHorizontal, Pencil, Trash2, FileEdit, Filter } from "lucide-react";
import React, { useState, useMemo, useCallback } from "react";

import { BulkActionBar } from "@admin/components/features/entries/EntryList/BulkActionBar";
import * as Icons from "@admin/components/icons";
import {
  Code,
  FileText,
  Lock,
  Package,
  type LucideIcon,
} from "@admin/components/icons";
import { BulkDeleteDialog } from "@admin/components/shared/bulk-action-dialogs";
import { BulkSelectCheckbox } from "@admin/components/shared/bulk-select-checkbox";
import { Pagination } from "@admin/components/shared/pagination";
import { SearchBar } from "@admin/components/shared/search-bar";
import { toast } from "@admin/components/ui";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { UI } from "@admin/constants/ui";
import {
  useSingles,
  useDeleteSingle,
  useBulkDeleteSingles,
} from "@admin/hooks/queries";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import { useRowSelection } from "@admin/hooks/useRowSelection";
import { formatDateTime } from "@admin/lib/dates/format";
import { navigateTo } from "@admin/lib/navigation";
import type {
  ApiSingle,
  SingleSource,
  SingleMigrationStatus,
} from "@admin/types/entities";

import { SinglesEmptyState } from "./SinglesEmptyState";
import { SinglesTableSkeleton } from "./SinglesTableSkeleton";

/**
 * Get the badge variant and label for a Single source
 */
function getSourceBadge(source?: SingleSource): {
  variant: "default";
  label: string;
  icon: React.ReactNode;
} {
  switch (source) {
    case "code":
      return {
        variant: "default",
        label: "Code",
        icon: <Code className="h-3 w-3 mr-1" />,
      };
    case "ui":
      return {
        variant: "default",
        label: "UI",
        icon: <FileText className="h-3 w-3 mr-1" />,
      };
    case "built-in":
      return {
        variant: "default",
        label: "Built-in",
        icon: <Package className="h-3 w-3 mr-1" />,
      };
    default:
      return {
        variant: "default",
        label: "Unknown",
        icon: null,
      };
  }
}

/**
 * Get the badge variant and label for a migration status
 */
function getMigrationBadge(status?: string): {
  variant: "success" | "warning" | "primary" | "default" | "destructive";
  label: string;
} {
  switch (status) {
    case "synced":
      return { variant: "success", label: "Synced" };
    case "pending":
      return { variant: "warning", label: "Pending" };
    case "generated":
      return { variant: "primary", label: "Generated" };
    case "applied":
      return { variant: "success", label: "Applied" };
    case "failed":
      return { variant: "destructive", label: "Failed" };
    default:
      return { variant: "default", label: "-" };
  }
}

interface SinglesTableProps {
  mode?: "builder" | "content";
}

const iconMap = Icons as unknown as Record<string, LucideIcon>;

/**
 * SinglesTable Component
 */
export default function SinglesTable({ mode = "builder" }: SinglesTableProps) {
  // Pagination state
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  // Search state (debounced to reduce API calls)
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, UI.SEARCH_DEBOUNCE_MS);

  // Filter state
  const [sourceFilter, setSourceFilter] = useState<SingleSource | "all">("all");
  const [migrationFilter, setMigrationFilter] = useState<
    SingleMigrationStatus | "all"
  >("all");

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [singleToDelete, setSingleToDelete] = useState<{
    id: string;
    slug: string;
    label: string;
  } | null>(null);

  // Bulk delete dialog state
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  // Column visibility state
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  const toggleColumn = (key: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // TanStack Query: Fetch Singles with automatic caching
  const { data, isLoading, isFetching, isError, error } = useSingles({
    pagination: { page, pageSize },
    sorting: [],
    filters: { search: debouncedSearch },
  });

  // TanStack Query: Delete mutation with automatic cache invalidation
  const { mutate: deleteSingle, isPending: isDeleting } = useDeleteSingle();

  // Row selection state management
  const {
    selectedIds,
    selectedCount,
    toggleSelection,
    selectAllOnPage,
    deselectAllOnPage,
    clearSelection,
    isSelected,
    getSelectedCountOnPage,
  } = useRowSelection();

  // Bulk mutation hooks
  const { mutate: bulkDeleteSingles, isPending: isBulkDeleting } =
    useBulkDeleteSingles();

  // Filter data client-side (until API supports these filters)
  const filteredData = useMemo(() => {
    if (!data?.items) return [];

    return data.items.filter(single => {
      // Filter by source
      if (sourceFilter !== "all" && single.source !== sourceFilter) {
        return false;
      }
      // Filter by migration status
      if (
        migrationFilter !== "all" &&
        single.migrationStatus !== migrationFilter
      ) {
        return false;
      }
      return true;
    });
  }, [data?.items, sourceFilter, migrationFilter]);

  // Action handlers
  // Smart edit handler: UI Singles go to schema builder, locked Singles show error
  const handleEdit = useCallback(
    (single: ApiSingle) => {
      if (single.locked) {
        toast.error("Cannot edit locked Single", {
          description: "Code-first Singles cannot be modified from the UI.",
        });
        return;
      }
      if (mode === "content") {
        navigateTo(buildRoute(ROUTES.SINGLE_EDIT, { slug: single.slug }));
        return;
      }
      // Route to schema builder for editing
      navigateTo(
        buildRoute(ROUTES.SINGLES_BUILDER_EDIT, { slug: single.slug })
      );
    },
    [mode]
  );

  // View/edit the document data (content) for this Single
  const handleViewDocument = useCallback((single: ApiSingle) => {
    navigateTo(buildRoute(ROUTES.SINGLE_EDIT, { slug: single.slug }));
  }, []);

  const handleDelete = useCallback((single: ApiSingle) => {
    if (single.locked) {
      toast.error("Cannot delete locked Single", {
        description: "Code-first Singles cannot be deleted from the UI.",
      });
      return;
    }
    setSingleToDelete({
      id: single.id,
      slug: single.slug,
      label: single.label,
    });
    setDeleteDialogOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!singleToDelete) return;

    deleteSingle(singleToDelete.slug, {
      onSuccess: () => {
        toast.success("Single deleted", {
          description: `${singleToDelete.label} has been deleted successfully.`,
        });
        setDeleteDialogOpen(false);
        setSingleToDelete(null);
      },
      onError: err => {
        toast.error("Delete failed", {
          description:
            err instanceof Error ? err.message : "Failed to delete the Single.",
        });
      },
    });
  }, [singleToDelete, deleteSingle]);

  // Bulk delete handlers
  const handleBulkDelete = useCallback(() => {
    if (selectedCount === 0) {
      toast.error("No Singles selected");
      return;
    }
    setBulkDeleteDialogOpen(true);
  }, [selectedCount]);

  const handleConfirmBulkDelete = useCallback(() => {
    // Only delete non-locked singles
    const selectedSingleSlugs = filteredData
      .filter(s => selectedIds.includes(s.id) && !s.locked)
      .map(s => s.slug);

    void bulkDeleteSingles(selectedSingleSlugs, undefined, {
      onSuccess: result => {
        if (result.failed === 0) {
          toast.success("Singles deleted", {
            description: `${result.succeeded} Singles deleted successfully.`,
          });
        } else {
          toast.warning("Partially completed", {
            description: `${result.succeeded} deleted, ${result.failed} failed.`,
          });
        }
        setBulkDeleteDialogOpen(false);
        clearSelection();
      },
      onError: result => {
        toast.error("Deletion failed", {
          description: `Failed to delete ${result.failed} Singles.`,
        });
      },
    });
  }, [selectedIds, bulkDeleteSingles, clearSelection, filteredData]);

  // Helper: Get page Single IDs for select all
  const pageSingleIds = useMemo(() => {
    return filteredData.map(s => s.id) || [];
  }, [filteredData]);

  // Determine "select all on page" checkbox state
  const selectedOnPage = getSelectedCountOnPage(pageSingleIds);
  const selectAllCheckboxState: boolean | "indeterminate" =
    selectedOnPage === 0
      ? false
      : selectedOnPage === pageSingleIds.length
        ? true
        : "indeterminate";

  // Handle select all on page toggle
  const handleToggleSelectAllOnPage = useCallback(() => {
    const selectedOnPage = getSelectedCountOnPage(pageSingleIds);
    if (selectedOnPage === pageSingleIds.length) {
      deselectAllOnPage(pageSingleIds);
    } else {
      selectAllOnPage(pageSingleIds);
    }
  }, [
    pageSingleIds,
    getSelectedCountOnPage,
    deselectAllOnPage,
    selectAllOnPage,
  ]);

  // Format date helper (using centralized utility)
  const formatDate = useCallback(
    (dateValue?: string) => formatDateTime(dateValue),
    []
  );

  // Get field count from Single
  const getFieldCount = useCallback((single: ApiSingle): number => {
    if (single.fieldCount !== undefined) {
      return single.fieldCount;
    }
    return single.fields?.length || 0;
  }, []);

  const ALWAYS_VISIBLE = new Set(["select", "actions", "label", "createdAt"]);

  const columnDefs = useMemo<Column<ApiSingle>[]>(
    () => [
      // Checkbox column for bulk selection
      {
        key: "select" as keyof ApiSingle,
        label: (
          <BulkSelectCheckbox
            checked={selectAllCheckboxState}
            onCheckedChange={handleToggleSelectAllOnPage}
            rowId="select-all"
            rowLabel="Select all Singles on page"
          />
        ),
        hideLabelOnMobile: true,
        render: (_value, single) => (
          <BulkSelectCheckbox
            checked={isSelected(single.id)}
            onCheckedChange={() => toggleSelection(single.id)}
            rowId={single.id}
            rowLabel={single.label}
          />
        ),
      },
      {
        key: "label",
        label: "SINGLE",
        hideLabelOnMobile: true,
        render: (_value, single) => {
          return (
            <div className="flex items-center gap-3">
              <div className="table-row-icon-cover">
                {React.createElement(
                  iconMap[single.admin?.icon || ""] || FileText,
                  { className: "h-4 w-4" }
                )}
              </div>
              <div className="min-w-0 flex-1 flex flex-col">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      handleEdit(single);
                    }}
                    disabled={single.locked}
                    className="font-medium text-sm text-foreground truncate text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {single.label}
                  </button>
                  {single.locked && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Locked: Cannot be edited or deleted from UI</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {single.slug}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        key: "source",
        label: "SOURCE",
        render: (_value, single) => {
          const sourceBadge = getSourceBadge(single.source);
          return (
            <Badge
              variant={sourceBadge.variant}
              className="whitespace-nowrap text-muted-foreground font-normal"
            >
              {sourceBadge.icon}
              {sourceBadge.label}
            </Badge>
          );
        },
      },
      {
        key: "migrationStatus",
        label: "STATUS",
        render: (_value, single) => {
          const migrationBadge = getMigrationBadge(single.migrationStatus);
          return (
            <Badge variant={migrationBadge.variant}>
              {migrationBadge.label}
            </Badge>
          );
        },
      },
      {
        key: "fields",
        label: "FIELDS",
        render: (_value, single) => (
          <span className="text-sm tabular-nums">{getFieldCount(single)}</span>
        ),
      },
      {
        key: "createdAt",
        label: "CREATED",
        hideOnMobile: true,
        render: createdAt => (
          <span className="text-sm text-muted-foreground">
            {formatDate(createdAt as string | undefined)}
          </span>
        ),
      },
      {
        key: "actions" as keyof ApiSingle,
        label: "ACTIONS",
        render: (_, single) => {
          const isLocked = single.locked;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={e => {
                    e.stopPropagation();
                    handleEdit(single);
                  }}
                  className={isLocked ? "opacity-50" : ""}
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                  {isLocked && (
                    <Lock className="h-3 w-3 ml-auto text-muted-foreground" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={e => {
                    e.stopPropagation();
                    handleViewDocument(single);
                  }}
                >
                  <FileEdit className="h-4 w-4" />
                  View Document
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={e => {
                    e.stopPropagation();
                    handleDelete(single);
                  }}
                  disabled={isLocked}
                  className={`text-destructive focus:text-destructive ${isLocked ? "opacity-50" : ""}`}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                  {isLocked && (
                    <Lock className="h-3 w-3 ml-auto text-muted-foreground" />
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [
      selectAllCheckboxState,
      handleToggleSelectAllOnPage,
      isSelected,
      toggleSelection,
      handleEdit,
      handleViewDocument,
      handleDelete,
      formatDate,
      getFieldCount,
    ]
  );

  const columns = useMemo(
    () => columnDefs.filter(col => !hiddenColumns.has(String(col.key))),
    [columnDefs, hiddenColumns]
  );

  const toggleableColumns = columnDefs.filter(
    col => !ALWAYS_VISIBLE.has(String(col.key))
  );

  // Handle page size change (reset to first page)
  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(0);
  }, []);

  // Handle filter changes (reset to first page)
  const handleSourceFilterChange = useCallback((value: string) => {
    setSourceFilter(value as SingleSource | "all");
    setPage(0);
  }, []);

  const handleMigrationFilterChange = useCallback((value: string) => {
    setMigrationFilter(value as SingleMigrationStatus | "all");
    setPage(0);
  }, []);

  // Error state
  if (isError) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search Singles..."
              isLoading={false}
              className="flex-1 max-w-sm"
            />
          </div>
        </div>
        <Alert variant="destructive">
          {error instanceof Error
            ? error.message
            : "Failed to load Singles. Please try again."}
        </Alert>
      </div>
    );
  }

  // Loading state (initial load only)
  if ((isLoading || isFetching) && (!data || data.items.length === 0)) {
    return (
      <div className="space-y-4">
        <span className="sr-only">Loading Singles...</span>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search Singles..."
              isLoading={true}
              className="flex-1 max-w-sm"
            />
          </div>
        </div>
        <SinglesTableSkeleton />
      </div>
    );
  }

  // Render table with data
  const hasData = filteredData.length > 0;
  const isEmpty = filteredData.length === 0;
  const isSearching = search.trim() !== "";
  const isFiltering = sourceFilter !== "all" || migrationFilter !== "all";

  return (
    <div className="space-y-4">
      {/* Bulk selection toolbar */}
      {selectedCount > 0 && (
        <BulkActionBar
          selectedCount={selectedCount}
          collection={undefined}
          onDelete={handleBulkDelete}
          onClear={clearSelection}
          itemLabel="single"
        />
      )}

      {/* Search and filters */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search Singles..."
            isLoading={isLoading}
            className="w-full md:max-w-sm bg-background text-foreground border-primary/5"
          />
        </div>

        {/* Right: Column visibility & Filters */}
        <div className="flex items-center justify-between sm:justify-end gap-2 w-full md:w-auto">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="md"
                  className="relative bg-background text-foreground border-primary/5 hover:bg-accent/10"
                >
                  <Filter className="h-4 w-4" />
                  Filter
                  {(sourceFilter !== "all" || migrationFilter !== "all") && (
                    <span className="absolute -top-1 -right-1 flex h-3 w-3 rounded-none bg-primary" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Filter by</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={sourceFilter === "all"}
                  onCheckedChange={() => handleSourceFilterChange("all")}
                >
                  All Sources
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={sourceFilter === "code"}
                  onCheckedChange={() => handleSourceFilterChange("code")}
                >
                  Code
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={sourceFilter === "ui"}
                  onCheckedChange={() => handleSourceFilterChange("ui")}
                >
                  UI
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={sourceFilter === "built-in"}
                  onCheckedChange={() => handleSourceFilterChange("built-in")}
                >
                  Built-in
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={migrationFilter === "all"}
                  onCheckedChange={() => handleMigrationFilterChange("all")}
                >
                  All Status
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={migrationFilter === "synced"}
                  onCheckedChange={() => handleMigrationFilterChange("synced")}
                >
                  Synced
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={migrationFilter === "pending"}
                  onCheckedChange={() => handleMigrationFilterChange("pending")}
                >
                  Pending
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={migrationFilter === "generated"}
                  onCheckedChange={() =>
                    handleMigrationFilterChange("generated")
                  }
                >
                  Generated
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={migrationFilter === "applied"}
                  onCheckedChange={() => handleMigrationFilterChange("applied")}
                >
                  Applied
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="md"
                  className="bg-background text-foreground border-primary/5 hover:bg-accent/10"
                >
                  <Icons.Columns className="h-4 w-4" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {toggleableColumns.map(col => (
                  <DropdownMenuCheckboxItem
                    key={String(col.key)}
                    checked={!hiddenColumns.has(String(col.key))}
                    onCheckedChange={() => toggleColumn(String(col.key))}
                  >
                    {typeof col.label === "string"
                      ? col.label
                      : String(col.key)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {isEmpty ? (
        <SinglesEmptyState isSearching={isSearching || isFiltering} />
      ) : (
        /* Responsive table */
        /* Responsive table and Pagination Card */
        <div className="table-wrapper rounded-none  border border-primary/5 bg-card overflow-hidden">
          <ResponsiveTable
            data={filteredData}
            columns={columns}
            emptyMessage="No Singles found. Try adjusting your search or filters."
            ariaLabel="Singles table"
            tableWrapperClassName="border-0 rounded-none shadow-none"
          />
          {hasData && data && (
            <Pagination
              currentPage={page}
              totalPages={data.meta.totalPages > 0 ? data.meta.totalPages : 1}
              pageSize={pageSize}
              pageSizeOptions={[10, 25, 50]}
              onPageChange={setPage}
              onPageSizeChange={handlePageSizeChange}
              isLoading={isLoading}
              totalItems={data.meta.total}
            />
          )}
        </div>
      )}

      {/* Single delete confirmation dialog */}
      <BulkDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        items={
          singleToDelete
            ? [
                {
                  id: singleToDelete.id,
                  name: singleToDelete.label,
                  secondary: singleToDelete.slug,
                },
              ]
            : []
        }
        entityType="Single"
        entityTypePlural="Singles"
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />

      {/* Bulk delete confirmation dialog */}
      <BulkDeleteDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={setBulkDeleteDialogOpen}
        items={
          filteredData
            .filter(s => selectedIds.includes(s.id) && !s.locked)
            .map(s => ({
              id: s.id,
              name: s.label,
              secondary: s.slug,
            })) || []
        }
        entityType="Single"
        entityTypePlural="Singles"
        onConfirm={handleConfirmBulkDelete}
        isLoading={isBulkDeleting}
      />
    </div>
  );
}
