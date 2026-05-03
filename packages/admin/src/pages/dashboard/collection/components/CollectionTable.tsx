"use client";

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
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  List,
  FileCode,
  Table as Filter,
} from "lucide-react";
import { useState, useMemo, useCallback } from "react";

import { BulkActionBar } from "@admin/components/features/entries/EntryList/BulkActionBar";
import * as Icons from "@admin/components/icons";
import { Lock } from "@admin/components/icons";
import { BulkDeleteDialog } from "@admin/components/shared/bulk-action-dialogs";
import { BulkSelectCheckbox } from "@admin/components/shared/bulk-select-checkbox";
import { Pagination } from "@admin/components/shared/pagination";
import { SearchBar } from "@admin/components/shared/search-bar";
import { toast } from "@admin/components/ui";
import type { RouteValue } from "@admin/constants/routes";
import { ROUTES, withQuery, buildRoute } from "@admin/constants/routes";
import { UI } from "@admin/constants/ui";
import {
  useCollections,
  useDeleteCollection,
  useBulkDeleteCollections,
} from "@admin/hooks/queries";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import { useRowSelection } from "@admin/hooks/useRowSelection";
import { formatDateTime } from "@admin/lib/dates/format";
import { navigateTo } from "@admin/lib/navigation";
import type {
  ApiCollection,
  CollectionSource,
  MigrationStatus,
} from "@admin/types/entities";

import { CollectionsEmptyState } from "./CollectionsEmptyState";
import { CollectionTableSkeleton } from "./CollectionTableSkeleton";

// Extended navigation function that accepts query parameters
const navigateToWithQuery = (
  route: RouteValue,
  query: Record<string, string | number | boolean | undefined>
) => {
  const routeWithQuery = withQuery(route, query);
  window.history.pushState(null, "", routeWithQuery);
  window.dispatchEvent(new Event("locationchange"));
};

/**
 * Get the badge variant and label for a collection source
 */
function getSourceBadge(source?: CollectionSource): {
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
    case "built-in":
      return {
        variant: "default",
        label: "Built-in",
        icon: <Icons.Package className="h-3 w-3 mr-1" />,
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
function getMigrationBadge(status?: MigrationStatus): {
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
      return { variant: "default", label: "—" };
  }
}

/**
 * Truncate a string to a specific number of words
 */
function truncateWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + "...";
}

/**
 * CollectionTable Component
 *
 * Displays a responsive table/card view of collections with search, pagination, and CRUD actions.
 * Uses ResponsiveTable for mobile responsiveness and TanStack Query for data fetching.
 *
 * ## Features
 * - Mobile responsive: Card view (< 768px), table view (≥ 768px)
 * - Search collections by name or label (debounced 300ms)
 * - Filter by source (code, ui, built-in) and migration status
 * - Server-side pagination (10/25/50 rows per page)
 * - Source badges with color coding (code=primary, ui=success, built-in=default)
 * - Locked indicator for code-first collections
 * - Migration status badges
 * - Field count display
 * - CRUD actions: Edit, View Entries, Generate Types, Delete
 * - Actions disabled appropriately for locked collections
 * - Automatic caching: 5-minute staleTime (no unnecessary refetches)
 * - Cache invalidation: Automatic refetch after delete
 *
 * @example
 * ```tsx
 * <CollectionTable />
 * ```
 *
 * @see hooks/queries/useCollections.ts - Collection query hooks
 * @see https://tanstack.com/query/v5/docs/react/overview - TanStack Query docs
 */
export default function CollectionTable() {
  // Pagination state
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  // Search state (debounced to reduce API calls)
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, UI.SEARCH_DEBOUNCE_MS);

  // Filter state
  const [sourceFilter, setSourceFilter] = useState<CollectionSource | "all">(
    "all"
  );
  const [migrationFilter, setMigrationFilter] = useState<
    MigrationStatus | "all"
  >("all");

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [collectionToDelete, setCollectionToDelete] = useState<{
    id: string;
    name: string;
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

  // TanStack Query: Fetch collections with automatic caching
  const { data, isLoading, isFetching, isError, error } = useCollections({
    pagination: { page, pageSize },
    sorting: [],
    filters: { search: debouncedSearch },
  });

  // TanStack Query: Delete mutation with automatic cache invalidation
  const { mutate: deleteCollection, isPending: isDeleting } =
    useDeleteCollection();

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
  const { mutate: bulkDeleteCollections, isPending: isBulkDeleting } =
    useBulkDeleteCollections();

  // Filter data client-side (until API supports these filters)
  const filteredData = useMemo(() => {
    if (!data?.items) return [];

    return data.items.filter(collection => {
      // Exclude plugin collections - they are managed separately in the Plugins section
      if (collection.admin?.isPlugin) {
        return false;
      }
      // Filter by source
      if (sourceFilter !== "all" && collection.source !== sourceFilter) {
        return false;
      }
      // Filter by migration status
      if (
        migrationFilter !== "all" &&
        collection.migrationStatus !== migrationFilter
      ) {
        return false;
      }
      return true;
    });
  }, [data?.items, sourceFilter, migrationFilter]);

  // Action handlers
  const handleEdit = useCallback((collection: ApiCollection) => {
    // Use builder for UI collections, old edit for others
    if (collection.source === "ui" && !collection.locked) {
      navigateTo(
        buildRoute(ROUTES.COLLECTIONS_BUILDER_EDIT, { slug: collection.name })
      );
    } else {
      navigateToWithQuery(ROUTES.COLLECTIONS_EDIT, {
        name: collection.name,
      });
    }
  }, []);

  const handleDelete = useCallback((collection: ApiCollection) => {
    if (collection.locked) {
      toast.error("Cannot delete locked collection", {
        description: "Code-first collections cannot be deleted from the UI.",
      });
      return;
    }
    setCollectionToDelete({ id: collection.id, name: collection.name });
    setDeleteDialogOpen(true);
  }, []);

  const handleViewEntries = useCallback((collection: ApiCollection) => {
    // Navigate to collection entries page (placeholder for now)
    toast.info(`Viewing entries for ${collection.label}`, {
      description: "Entry view will be implemented in a future update.",
    });
  }, []);

  const handleGenerateTypes = useCallback((_collection: ApiCollection) => {
    toast.info("Coming Soon", {
      description:
        "Type generation will be available when CLI commands are implemented.",
    });
  }, []);

  const handleConfirmDelete = () => {
    if (!collectionToDelete) return;

    deleteCollection(collectionToDelete.name, {
      onSuccess: () => {
        toast.success("Collection deleted", {
          description: `${collectionToDelete.name} has been deleted successfully.`,
        });
        setDeleteDialogOpen(false);
        setCollectionToDelete(null);
      },
      onError: error => {
        toast.error("Delete failed", {
          description:
            error instanceof Error
              ? error.message
              : "Failed to delete the collection.",
        });
      },
    });
  };

  // Bulk delete handlers
  const handleBulkDelete = () => {
    if (selectedCount === 0) {
      toast.error("No collections selected");
      return;
    }
    setBulkDeleteDialogOpen(true);
  };

  const handleConfirmBulkDelete = () => {
    // Only delete non-locked collections
    const selectedCollectionNames = filteredData
      .filter(c => selectedIds.includes(c.id) && !c.locked)
      .map(c => c.name);

    void bulkDeleteCollections(selectedCollectionNames, undefined, {
      onSuccess: result => {
        if (result.failed === 0) {
          toast.success("Collections deleted", {
            description: `${result.succeeded} collections deleted successfully.`,
          });
        } else {
          toast.warning("Partially completed", {
            description: `${result.succeeded} deleted, ${result.failed} failed.`,
          });
          console.error("Failed to delete collections:", result.failedIds);
        }
        setBulkDeleteDialogOpen(false);
        clearSelection();
      },
      onError: result => {
        toast.error("Deletion failed", {
          description: `Failed to delete ${result.failed} collections.`,
        });
        console.error("Failed collections:", result.failedIds);
      },
    });
  };

  // Helper: Get page collection IDs for select all
  const pageCollectionIds = useMemo(() => {
    return filteredData.map(c => c.id) || [];
  }, [filteredData]);

  // Determine "select all on page" checkbox state
  const selectedOnPage = getSelectedCountOnPage(pageCollectionIds);
  const selectAllCheckboxState: boolean | "indeterminate" =
    selectedOnPage === 0
      ? false
      : selectedOnPage === pageCollectionIds.length
        ? true
        : "indeterminate";

  // Handle select all on page toggle
  const handleToggleSelectAllOnPage = useCallback(() => {
    const selectedOnPage = getSelectedCountOnPage(pageCollectionIds);
    if (selectedOnPage === pageCollectionIds.length) {
      deselectAllOnPage(pageCollectionIds);
    } else {
      selectAllOnPage(pageCollectionIds);
    }
  }, [
    getSelectedCountOnPage,
    pageCollectionIds,
    deselectAllOnPage,
    selectAllOnPage,
  ]);

  // Format date helper (using centralized utility)
  const formatDate = (dateValue?: string) => formatDateTime(dateValue);

  // Get field count from collection
  const getFieldCount = (collection: ApiCollection): number => {
    if (collection.fieldCount !== undefined) {
      return collection.fieldCount;
    }
    return (
      collection.fields?.length ||
      collection.schemaDefinition?.fields?.length ||
      0
    );
  };

  // ResponsiveTable columns
  const ALWAYS_VISIBLE = new Set(["select", "actions", "label", "createdAt"]);

  const columnDefs: Column<ApiCollection>[] = useMemo(
    () => [
      // Checkbox column for bulk selection
      {
        key: "select" as keyof ApiCollection,
        label: (
          <BulkSelectCheckbox
            checked={selectAllCheckboxState}
            onCheckedChange={handleToggleSelectAllOnPage}
            rowId="select-all"
            rowLabel="Select all collections on page"
          />
        ),
        hideLabelOnMobile: true,
        render: (_value, collection) => (
          <BulkSelectCheckbox
            checked={isSelected(collection.id)}
            onCheckedChange={() => toggleSelection(collection.id)}
            rowId={collection.id}
            rowLabel={collection.label}
          />
        ),
      },
      {
        key: "label",
        label: "COLLECTION",
        hideLabelOnMobile: true,
        render: (_value, collection) => {
          const iconName = collection.admin?.icon || "Database";
          const IconComponent =
            (Icons as Record<string, React.ElementType>)[iconName] ||
            Icons.Database;

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
                      handleEdit(collection);
                    }}
                    disabled={collection.locked}
                    className="font-medium text-sm text-foreground truncate text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {collection.label}
                  </button>
                  {collection.locked && (
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
                  {collection.name}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        key: "source",
        label: "SOURCE",
        render: (_value, collection) => {
          const sourceBadge = getSourceBadge(collection.source);
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
        render: (_value, collection) => {
          const migrationBadge = getMigrationBadge(collection.migrationStatus);
          return (
            <Badge variant={migrationBadge.variant}>
              {migrationBadge.label}
            </Badge>
          );
        },
      },
      {
        key: "description",
        label: "DESCRIPTION",
        hideOnMobile: true,
        render: (_value, collection) => (
          <span className="text-sm text-muted-foreground">
            {collection.description
              ? truncateWords(collection.description, 10)
              : "__"}
          </span>
        ),
      },
      {
        key: "schemaDefinition",
        label: "FIELDS",
        render: (_value, collection) => (
          <span className="text-sm tabular-nums">
            {getFieldCount(collection)}
          </span>
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
        key: "actions" as keyof ApiCollection,
        label: "ACTIONS",
        render: (_, collection) => {
          const isLocked = collection.locked;
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
                    handleEdit(collection);
                  }}
                  disabled={isLocked}
                  className={isLocked ? "opacity-50" : ""}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                  {isLocked && (
                    <Lock className="h-3 w-3 ml-auto text-muted-foreground" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={e => {
                    e.stopPropagation();
                    handleViewEntries(collection);
                  }}
                >
                  <List className="h-4 w-4 mr-2" />
                  View Entries
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={e => {
                    e.stopPropagation();
                    handleGenerateTypes(collection);
                  }}
                >
                  <FileCode className="h-4 w-4 mr-2" />
                  Generate Types
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={e => {
                    e.stopPropagation();
                    handleDelete(collection);
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
    ],
    [
      selectAllCheckboxState,
      handleToggleSelectAllOnPage,
      isSelected,
      toggleSelection,
      handleEdit,
      handleDelete,
      handleViewEntries,
      handleGenerateTypes,
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
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(0);
  };

  // Handle filter changes (reset to first page)
  const handleSourceFilterChange = (value: string) => {
    setSourceFilter(value as CollectionSource | "all");
    setPage(0);
  };

  const handleMigrationFilterChange = (value: string) => {
    setMigrationFilter(value as MigrationStatus | "all");
    setPage(0);
  };

  // Error and loading states within the unified layout
  const showLoadingSkeleton =
    (isLoading || isFetching) && (!data || data.items.length === 0);

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
          itemLabel="collection"
        />
      )}

      {/* Search and filters */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search collections..."
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
                    <DropdownMenuCheckboxItem
                      checked={sourceFilter === "built-in"}
                      onCheckedChange={() =>
                        handleSourceFilterChange("built-in")
                      }
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
            : "Failed to load collections. Please try again."}
        </Alert>
      ) : showLoadingSkeleton ? (
        <CollectionTableSkeleton />
      ) : isEmpty ? (
        <CollectionsEmptyState isSearching={isSearching || isFiltering} />
      ) : (
        <div className="table-wrapper md:rounded-none md :border border-primary/5 md:border-primary/5 md:bg-card overflow-hidden">
          <ResponsiveTable
            data={filteredData}
            columns={columns}
            emptyMessage="No collections found. Try adjusting your search or filters."
            ariaLabel="Collections table"
            tableWrapperClassName="border-0 rounded-none shadow-none"
          />
          {data && data.meta.totalPages > 0 && (
            <Pagination
              currentPage={page}
              totalPages={data.meta.totalPages}
              pageSize={pageSize}
              pageSizeOptions={[10, 25, 50]}
              onPageChange={setPage}
              onPageSizeChange={handlePageSizeChange}
              isLoading={isFetching}
              totalItems={data.meta.total}
            />
          )}
        </div>
      )}

      {/* Single delete confirmation dialog */}
      <BulkDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        entityType="Collection"
        entityTypePlural="Collections"
        items={
          collectionToDelete
            ? [
                {
                  id: collectionToDelete.id,
                  name: collectionToDelete.name,
                  secondary: collectionToDelete.name,
                },
              ]
            : []
        }
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />

      {/* Bulk delete confirmation dialog */}
      {/* Bulk delete confirmation dialog */}
      <BulkDeleteDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={setBulkDeleteDialogOpen}
        entityType="Collection"
        entityTypePlural="Collections"
        items={
          filteredData
            .filter(c => selectedIds.includes(c.id) && !c.locked)
            .map(c => ({
              id: c.id,
              name: c.label,
              secondary: c.name, // Use collection name as secondary info
            })) || []
        }
        onConfirm={handleConfirmBulkDelete}
        isLoading={isBulkDeleting}
      />
    </div>
  );
}
