"use client";

/**
 * ComponentTable Component
 *
 * Displays a responsive table/card view of Components with search, pagination, and CRUD actions.
 * Uses ResponsiveTable for mobile responsiveness and TanStack Query for data fetching.
 *
 * ## Features
 * - Mobile responsive: Card view (< 768px), table view (>= 768px)
 * - Search components by slug or label (debounced 300ms)
 * - Filter by source (code, ui) and migration status
 * - Server-side pagination (10/25/50 rows per page)
 * - Source badges with color coding (code=primary, ui=success)
 * - Locked indicator for code-first components
 * - Migration status badges
 * - Field count display
 * - Category display
 * - CRUD actions: Edit, Delete
 * - Bulk delete with partial failure handling
 * - Automatic caching: 5-minute staleTime
 * - Cache invalidation: Automatic refetch after delete
 *
 * @see hooks/queries/useComponents.ts - Component query hooks
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
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@revnixhq/ui";
import { MoreHorizontal, Pencil, Trash2, Filter } from "lucide-react";
import { useState, useMemo, useCallback } from "react";

import { BulkActionBar } from "@admin/components/features/entries/EntryList/BulkActionBar";
import * as Icons from "@admin/components/icons";
import { Lock } from "@admin/components/icons";
import { BulkDeleteDialog } from "@admin/components/shared/bulk-action-dialogs";
import { BulkSelectCheckbox } from "@admin/components/shared/bulk-select-checkbox";
import { Pagination } from "@admin/components/shared/pagination";
import { SearchBar } from "@admin/components/shared/search-bar";
import { toast } from "@admin/components/ui";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { UI } from "@admin/constants/ui";
import {
  useComponents,
  useDeleteComponent,
  useBulkDeleteComponents,
} from "@admin/hooks/queries";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import { useRowSelection } from "@admin/hooks/useRowSelection";
import { formatDateTime } from "@admin/lib/dates/format";
import { navigateTo } from "@admin/lib/navigation";
import type {
  ApiComponent,
  ComponentSource,
  ComponentMigrationStatus,
} from "@admin/types/entities";

import { ComponentsEmptyState } from "./ComponentsEmptyState";
import { ComponentTableSkeleton } from "./ComponentTableSkeleton";

/**
 * Get the badge variant and label for a component source
 */
function getSourceBadge(source?: ComponentSource): {
  variant: "default";
  label: string;
  icon: React.ReactNode;
} {
  switch (source) {
    case "code":
      return {
        variant: "default",
        label: "Code",
        icon: <Icons.Code className="h-3 w-3 mr-1" />,
      };
    case "ui":
      return {
        variant: "default",
        label: "UI",
        icon: <Icons.FileText className="h-3 w-3 mr-1" />,
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
function getMigrationBadge(status?: ComponentMigrationStatus): {
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

/**
 * ComponentTable Component
 */
export default function ComponentTable() {
  // Pagination state
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  // Search state (debounced to reduce API calls)
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, UI.SEARCH_DEBOUNCE_MS);

  // Filter state
  const [sourceFilter, setSourceFilter] = useState<ComponentSource | "all">(
    "all"
  );
  const [migrationFilter, setMigrationFilter] = useState<
    ComponentMigrationStatus | "all"
  >("all");

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [componentToDelete, setComponentToDelete] = useState<{
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
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  };

  // TanStack Query: Fetch components with automatic caching
  const { data, isLoading, isFetching, isError, error } = useComponents({
    pagination: { page, pageSize },
    sorting: [],
    filters: { search: debouncedSearch },
  });

  // TanStack Query: Delete mutation with automatic cache invalidation
  const { mutate: deleteComponent, isPending: isDeleting } =
    useDeleteComponent();

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
  const { mutate: bulkDeleteComponents, isPending: isBulkDeleting } =
    useBulkDeleteComponents();

  // Filter data client-side (until API supports these filters)
  const filteredData = useMemo(() => {
    if (!data?.data) return [];

    return data.data.filter(component => {
      // Filter by source
      if (sourceFilter !== "all" && component.source !== sourceFilter) {
        return false;
      }
      // Filter by migration status
      if (
        migrationFilter !== "all" &&
        component.migrationStatus !== migrationFilter
      ) {
        return false;
      }
      return true;
    });
  }, [data?.data, sourceFilter, migrationFilter]);

  // Action handlers
  const handleEdit = useCallback((component: ApiComponent) => {
    if (component.locked) {
      toast.error("Cannot edit locked component", {
        description: "Code-first components cannot be edited from the UI.",
      });
      return;
    }
    navigateTo(
      buildRoute(ROUTES.COMPONENTS_BUILDER_EDIT, { slug: component.slug })
    );
  }, []);

  const handleDelete = useCallback((component: ApiComponent) => {
    if (component.locked) {
      toast.error("Cannot delete locked component", {
        description: "Code-first components cannot be deleted from the UI.",
      });
      return;
    }
    setComponentToDelete({
      id: component.id,
      slug: component.slug,
      label: component.label,
    });
    setDeleteDialogOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!componentToDelete) return;

    deleteComponent(componentToDelete.slug, {
      onSuccess: () => {
        toast.success("Component deleted", {
          description: `${componentToDelete.label} has been deleted successfully.`,
        });
        setDeleteDialogOpen(false);
        setComponentToDelete(null);
      },
      onError: error => {
        toast.error("Delete failed", {
          description:
            error instanceof Error
              ? error.message
              : "Failed to delete the component.",
        });
      },
    });
  }, [componentToDelete, deleteComponent]);

  // Bulk delete handlers
  const handleBulkDelete = useCallback(() => {
    if (selectedCount === 0) {
      toast.error("No components selected");
      return;
    }
    setBulkDeleteDialogOpen(true);
  }, [selectedCount]);

  const handleConfirmBulkDelete = useCallback(() => {
    const selectedComponentSlugs = filteredData
      .filter(c => selectedIds.includes(c.id) && !c.locked)
      .map(c => c.slug);

    void bulkDeleteComponents(selectedComponentSlugs, undefined, {
      onSuccess: result => {
        if (result.failed === 0) {
          toast.success("Components deleted", {
            description: `${result.succeeded} components deleted successfully.`,
          });
        } else {
          toast.warning("Partially completed", {
            description: `${result.succeeded} deleted, ${result.failed} failed.`,
          });
          console.error("Failed to delete components:", result.failedIds);
        }
        setBulkDeleteDialogOpen(false);
        clearSelection();
      },
      onError: result => {
        toast.error("Deletion failed", {
          description: `Failed to delete ${result.failed} components.`,
        });
        console.error("Failed components:", result.failedIds);
      },
    });
  }, [filteredData, selectedIds, bulkDeleteComponents, clearSelection]);

  // Helper: Get page component IDs for select all
  const pageComponentIds = useMemo(() => {
    return filteredData.map(c => c.id) || [];
  }, [filteredData]);

  // Determine "select all on page" checkbox state
  const selectedOnPage = getSelectedCountOnPage(pageComponentIds);
  const selectAllCheckboxState: boolean | "indeterminate" =
    selectedOnPage === 0
      ? false
      : selectedOnPage === pageComponentIds.length
        ? true
        : "indeterminate";

  // Handle select all on page toggle
  const handleToggleSelectAllOnPage = useCallback(() => {
    const selectedOnPage = getSelectedCountOnPage(pageComponentIds);
    if (selectedOnPage === pageComponentIds.length) {
      deselectAllOnPage(pageComponentIds);
    } else {
      selectAllOnPage(pageComponentIds);
    }
  }, [
    pageComponentIds,
    getSelectedCountOnPage,
    deselectAllOnPage,
    selectAllOnPage,
  ]);

  // No-op handlers for bulk actions not applicable to components

  const _handleBulkAssignRole = useCallback(() => {
    // Not applicable to components
  }, []);

  const _handleBulkToggleStatus = useCallback(() => {
    // Not applicable to components
  }, []);

  // Format date helper (using centralized utility)
  const formatDate = useCallback(
    (dateValue?: string) => formatDateTime(dateValue),
    []
  );

  // Get field count from component
  const getFieldCount = useCallback((component: ApiComponent): number => {
    if (component.fieldCount !== undefined) {
      return component.fieldCount;
    }
    return component.fields?.length || 0;
  }, []);

  // ResponsiveTable columns
  const ALWAYS_VISIBLE = new Set(["select", "actions", "label", "createdAt"]);

  const columnDefs = useMemo<Column<ApiComponent>[]>(() => [
    // Checkbox column for bulk selection
    {
      key: "select" as keyof ApiComponent,
      label: (
        <BulkSelectCheckbox
          checked={selectAllCheckboxState}
          onCheckedChange={handleToggleSelectAllOnPage}
          rowId="select-all"
          rowLabel="Select all components on page"
        />
      ),
      hideLabelOnMobile: true,
      render: (_value, component) => (
        <BulkSelectCheckbox
          checked={isSelected(component.id)}
          onCheckedChange={() => toggleSelection(component.id)}
          rowId={component.id}
          rowLabel={component.label}
        />
      ),
    },
    {
      key: "label",
      label: "COMPONENT",
      hideLabelOnMobile: true,
      render: (_value, component) => {
        const iconName = component.admin?.icon || "Puzzle";
        const IconComponent =
          (Icons as Record<string, React.ElementType>)[iconName] || Icons.Box;

        return (
          <div className="flex items-center gap-3">
            <div className="table-row-icon-cover">
              <IconComponent className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1 flex flex-col">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    handleEdit(component);
                  }}
                  disabled={component.locked}
                  className="font-medium text-sm text-foreground truncate text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {component.label}
                </button>
                {component.locked && (
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
                {component.slug}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: "admin",
      label: "CATEGORY",
      render: (_value, component) => {
        const category = component.admin?.category;
        if (!category) {
          return <span className="text-muted-foreground">-</span>;
        }
        return (
          <Badge variant="default" className="whitespace-nowrap">
            {category}
          </Badge>
        );
      },
    },
    {
      key: "source",
      label: "SOURCE",
      render: (_value, component) => {
        const sourceBadge = getSourceBadge(component.source);
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
      render: (_value, component) => {
        const migrationBadge = getMigrationBadge(component.migrationStatus);
        return (
          <Badge variant={migrationBadge.variant}>{migrationBadge.label}</Badge>
        );
      },
    },
    {
      key: "fields",
      label: "FIELDS",
      render: (_value, component) => (
        <span className="text-sm tabular-nums">{getFieldCount(component)}</span>
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
      key: "actions" as keyof ApiComponent,
      label: "ACTIONS",
      render: (_, component) => {
        const isLocked = component.locked;
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
                  handleEdit(component);
                }}
                className={isLocked ? "opacity-50" : ""}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Edit
                {isLocked && (
                  <Lock className="h-3 w-3 ml-auto text-muted-foreground" />
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={e => {
                  e.stopPropagation();
                  handleDelete(component);
                }}
                disabled={isLocked}
                className={`text-destructive focus:text-destructive ${isLocked ? "opacity-50" : ""}`}
              >
                <Trash2 className="h-4 w-4 mr-2" />
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
  ], [
    selectAllCheckboxState,
    handleToggleSelectAllOnPage,
    isSelected,
    toggleSelection,
    handleEdit,
    handleDelete,
    formatDate,
    getFieldCount,
  ]);

  const columns = useMemo(
    () => columnDefs.filter(col => !hiddenColumns.has(String(col.key))),
    [columnDefs, hiddenColumns]
  );

  const toggleableColumns = columnDefs.filter(
    col => !ALWAYS_VISIBLE.has(String(col.key))
  );

  // Handle page size change (reset to first page)
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(0);
  };

  // Handle filter changes (reset to first page)
  const handleSourceFilterChange = (value: string) => {
    setSourceFilter(value as ComponentSource | "all");
    setPage(0);
  };

  const handleMigrationFilterChange = (value: string) => {
    setMigrationFilter(value as ComponentMigrationStatus | "all");
    setPage(0);
  };

  // Error and loading states within the unified layout
  const showLoadingSkeleton =
    (isLoading || isFetching) && (!data || data.data.length === 0);

  // Render table with data
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
          itemLabel="component"
        />
      )}

      {/* Search and filters */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto mt-1">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search components..."
            isLoading={isFetching}
            className="w-full md:max-w-sm bg-white text-black border-primary/5"
          />
        </div>

        {/* Right: Column visibility & Filters */}
        <div className="flex items-center justify-between sm:justify-end gap-2 w-full md:w-auto">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {showLoadingSkeleton ? (
              <>
                <Skeleton className="w-20" />
                <Skeleton className="w-24" />
              </>
            ) : (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="md"
                      className="relative bg-white text-black border-primary/5 hover:bg-white/90"
                    >
                      <Filter className="mr-2 h-4 w-4" />
                      Filter
                      {(sourceFilter !== "all" ||
                        migrationFilter !== "all") && (
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
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      checked={migrationFilter === "all"}
                      onCheckedChange={() => handleMigrationFilterChange("all")}
                    >
                      All Status
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={migrationFilter === "synced"}
                      onCheckedChange={() =>
                        handleMigrationFilterChange("synced")
                      }
                    >
                      Synced
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={migrationFilter === "pending"}
                      onCheckedChange={() =>
                        handleMigrationFilterChange("pending")
                      }
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
                      onCheckedChange={() =>
                        handleMigrationFilterChange("applied")
                      }
                    >
                      Applied
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={migrationFilter === "failed"}
                      onCheckedChange={() =>
                        handleMigrationFilterChange("failed")
                      }
                    >
                      Failed
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="md">
                      <Icons.Columns className="mr-2 h-4 w-4" />
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
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main content area (States) */}
      {isError ? (
        <Alert variant="destructive">
          {error instanceof Error
            ? error.message
            : "Failed to load components. Please try again."}
        </Alert>
      ) : showLoadingSkeleton ? (
        <ComponentTableSkeleton />
      ) : isEmpty ? (
        <ComponentsEmptyState isSearching={isSearching || isFiltering} />
      ) : (
        <div className="table-wrapper rounded-none  border border-primary/5 bg-card overflow-hidden">
          <ResponsiveTable
            data={filteredData}
            columns={columns}
            emptyMessage="No components found. Try adjusting your search or filters."
            ariaLabel="Components table"
            tableWrapperClassName="border-0 rounded-none shadow-none"
          />
          {data && (
            <div className="table-footer border-t border-primary/5 p-4 bg-[hsl(var(--table-header-bg))]">
              <Pagination
                currentPage={page}
                totalPages={data.meta.totalPages > 0 ? data.meta.totalPages : 1}
                pageSize={pageSize}
                pageSizeOptions={[10, 25, 50]}
                onPageChange={setPage}
                onPageSizeChange={handlePageSizeChange}
                isLoading={isFetching}
                totalItems={data.meta.total}
              />
            </div>
          )}
        </div>
      )}

      {/* Single delete confirmation dialog */}
      <BulkDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        entityType="Component"
        entityTypePlural="Components"
        items={
          componentToDelete
            ? [
                {
                  id: componentToDelete.id,
                  name: componentToDelete.label,
                  secondary: componentToDelete.slug,
                },
              ]
            : []
        }
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />

      {/* Bulk delete confirmation dialog */}
      <BulkDeleteDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={setBulkDeleteDialogOpen}
        entityType="Component"
        entityTypePlural="Components"
        items={filteredData
          .filter(c => selectedIds.includes(c.id) && !c.locked)
          .map(c => ({
            id: c.id,
            name: c.label,
            secondary: c.slug,
          }))}
        onConfirm={handleConfirmBulkDelete}
        isLoading={isBulkDeleting}
      />
    </div>
  );
}
