"use client";

import {
  Badge,
  Button,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nextlyhq/ui";
import {
  Eye,
  FileCode,
  Layers,
  List,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";

import { BulkActionBar } from "@admin/components/features/entries/EntryList/BulkActionBar";
import * as Icons from "@admin/components/icons";
import { Lock } from "@admin/components/icons";
import { BulkDeleteDialog } from "@admin/components/shared/bulk-action-dialogs";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import type {
  DataTableSelection,
  NextlyColumn,
  RowAction,
} from "@admin/components/ui/table/data-table";
import {
  ListView,
  useTableColumns,
} from "@admin/components/ui/table/list-view";
import { PAGINATION } from "@admin/constants/pagination";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { UI } from "@admin/constants/ui";
import {
  useCollections,
  useDeleteCollection,
  useBulkDeleteCollections,
} from "@admin/hooks/queries";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import { usePagination } from "@admin/hooks/usePagination";
import { useRowSelection } from "@admin/hooks/useRowSelection";
import { formatDateTime } from "@admin/lib/dates/format";
import { navigateTo } from "@admin/lib/navigation";
import type {
  ApiCollection,
  CollectionSource,
  MigrationStatus,
} from "@admin/types/entities";

import { CollectionTableSkeleton } from "./CollectionTableSkeleton";

/** Source badge label + icon. */
function getSourceBadge(source?: CollectionSource): {
  label: string;
  icon: React.ReactNode;
} {
  switch (source) {
    case "code":
      return { label: "Code", icon: <Icons.Code className="mr-1 h-3 w-3" /> };
    case "ui":
      return { label: "UI", icon: <Icons.FileText className="mr-1 h-3 w-3" /> };
    case "built-in":
      return {
        label: "Built-in",
        icon: <Icons.Package className="mr-1 h-3 w-3" />,
      };
    default:
      return { label: "Unknown", icon: null };
  }
}

/** Migration-status badge variant + label. */
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

/** Truncate a string to a maximum number of words. */
function truncateWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + "...";
}

/** Columns pinned as always-visible in the column toggle. */
const ALWAYS_VISIBLE = new Set(["label", "createdAt"]);

/**
 * CollectionTable
 *
 * Lists collections with search, source/migration-status filters, server-side
 * pagination, column visibility, whole-row navigation to the builder, per-row
 * actions, and bulk delete. Locked (code-first) collections cannot be edited,
 * selected, or deleted from the UI. Data + mutations run through TanStack Query;
 * rendering is delegated to the unified DataTableView.
 */
export default function CollectionTable() {
  const { page, pageSize, setPage, setPageSize, resetPage } = usePagination();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, UI.SEARCH_DEBOUNCE_MS);

  // Reset to the first page when the search term changes so a later page does not
  // request out-of-range results and show a false empty state.
  useEffect(() => {
    resetPage();
  }, [debouncedSearch, resetPage]);

  const [sourceFilter, setSourceFilter] = useState<CollectionSource | "all">(
    "all"
  );
  const [migrationFilter, setMigrationFilter] = useState<
    MigrationStatus | "all"
  >("all");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [collectionToDelete, setCollectionToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  const { data, isLoading, isFetching, isError, error } = useCollections({
    pagination: { page, pageSize },
    sorting: [],
    filters: { search: debouncedSearch },
  });

  const { mutate: deleteCollection, isPending: isDeleting } =
    useDeleteCollection();

  const {
    selectedIds,
    selectedCount,
    toggleSelection,
    selectAllOnPage,
    deselectAllOnPage,
    clearSelection,
  } = useRowSelection();

  const { mutate: bulkDeleteCollections, isPending: isBulkDeleting } =
    useBulkDeleteCollections();

  // Exclude plugin collections and apply the client-side filters.
  const filteredData = useMemo(() => {
    if (!data?.items) return [];
    return data.items.filter(collection => {
      if (collection.admin?.isPlugin) return false;
      if (sourceFilter !== "all" && collection.source !== sourceFilter) {
        return false;
      }
      if (
        migrationFilter !== "all" &&
        collection.migrationStatus !== migrationFilter
      ) {
        return false;
      }
      return true;
    });
  }, [data?.items, sourceFilter, migrationFilter]);

  // Code-first (locked) collections open the same builder route; the builder
  // renders read-only when the loaded collection is locked.
  const handleEdit = useCallback((collection: ApiCollection) => {
    navigateTo(
      buildRoute(ROUTES.BUILDER_COLLECTIONS_EDIT, { slug: collection.name })
    );
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
      onError: err => {
        toast.error("Delete failed", {
          description:
            err instanceof Error
              ? err.message
              : "Failed to delete the collection.",
        });
      },
    });
  };

  const handleBulkDelete = () => {
    if (selectedCount === 0) {
      toast.error("No collections selected");
      return;
    }
    setBulkDeleteDialogOpen(true);
  };

  const handleConfirmBulkDelete = () => {
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

  const getFieldCount = (collection: ApiCollection): number => {
    if (collection.fieldCount !== undefined) return collection.fieldCount;
    return (
      collection.fields?.length ||
      collection.schemaDefinition?.fields?.length ||
      0
    );
  };

  const allColumns = useMemo((): NextlyColumn<ApiCollection>[] => {
    return [
      {
        name: "label",
        header: "COLLECTION",
        cell: ({ row }) => {
          const iconName = row.admin?.icon || "Database";
          const IconComponent =
            (Icons as Record<string, React.ElementType>)[iconName] ||
            Icons.Database;
          return (
            <div className="flex items-center gap-3">
              <div className="table-row-icon-cover">
                <IconComponent className="h-4 w-4" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {row.label}
                  </span>
                  {row.locked && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Locked: Cannot be edited or deleted from UI</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <span className="truncate text-xs text-muted-foreground">
                  {row.name}
                </span>
              </div>
            </div>
          );
        },
      },
      {
        name: "source",
        header: "SOURCE",
        cell: ({ row }) => {
          const sourceBadge = getSourceBadge(row.source);
          return (
            <Badge
              variant="default"
              className="whitespace-nowrap font-normal text-muted-foreground"
            >
              {sourceBadge.icon}
              {sourceBadge.label}
            </Badge>
          );
        },
      },
      {
        name: "migrationStatus",
        header: "STATUS",
        cell: ({ row }) => {
          const migrationBadge = getMigrationBadge(row.migrationStatus);
          return (
            <Badge variant={migrationBadge.variant}>
              {migrationBadge.label}
            </Badge>
          );
        },
      },
      {
        name: "description",
        header: "DESCRIPTION",
        hideOnMobile: true,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.description ? truncateWords(row.description, 10) : "__"}
          </span>
        ),
      },
      {
        name: "schemaDefinition",
        header: "FIELDS",
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">{getFieldCount(row)}</span>
        ),
      },
      {
        name: "createdAt",
        header: "CREATED",
        hideOnMobile: true,
        cell: ({ value }) => (
          <span className="text-sm text-muted-foreground">
            {formatDateTime(value as string | undefined)}
          </span>
        ),
      },
    ];
  }, []);

  const { columns, columnsControl } = useTableColumns({
    storageKey: "collections",
    columns: allColumns,
    alwaysVisible: ALWAYS_VISIBLE,
  });

  const handleSourceFilterChange = (value: string) => {
    setSourceFilter(value as CollectionSource | "all");
    resetPage();
  };

  const handleMigrationFilterChange = (value: string) => {
    setMigrationFilter(value as MigrationStatus | "all");
    resetPage();
  };

  const selection = useMemo<DataTableSelection<ApiCollection>>(
    () => ({
      selectedIds,
      isSelectable: collection => !collection.locked,
      onToggle: collection => toggleSelection(collection.id),
      onToggleAll: (rows, allSelected) => {
        const ids = rows.map(r => r.id);
        if (allSelected) deselectAllOnPage(ids);
        else selectAllOnPage(ids);
      },
    }),
    [selectedIds, toggleSelection, deselectAllOnPage, selectAllOnPage]
  );

  const rowActions = useCallback(
    (collection: ApiCollection): RowAction<ApiCollection>[] => [
      {
        id: "edit",
        label: collection.locked ? "View" : "Edit",
        icon: collection.locked ? (
          <Eye className="h-4 w-4" />
        ) : (
          <Pencil className="h-4 w-4" />
        ),
        onSelect: () => handleEdit(collection),
      },
      {
        id: "view-entries",
        label: "View Entries",
        icon: <List className="h-4 w-4" />,
        onSelect: () => handleViewEntries(collection),
      },
      {
        id: "generate-types",
        label: "Generate Types",
        icon: <FileCode className="h-4 w-4" />,
        onSelect: () => handleGenerateTypes(collection),
      },
      {
        id: "delete",
        label: "Delete",
        icon: <Trash2 className="h-4 w-4" />,
        destructive: true,
        isDisabled: () => Boolean(collection.locked),
        onSelect: () => handleDelete(collection),
      },
    ],
    [handleEdit, handleViewEntries, handleGenerateTypes, handleDelete]
  );

  const showLoadingSkeleton =
    (isLoading || isFetching) && (!data || data.items.length === 0);
  const isFiltering = sourceFilter !== "all" || migrationFilter !== "all";

  return (
    <>
      <ListView<ApiCollection>
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search collections...",
          isLoading: isFetching,
        }}
        hasActiveFilters={isFiltering}
        // Withheld while the first response is outstanding: a filter menu built
        // from data nobody has yet would open onto nothing. The skeletons below
        // hold their place so the row does not resize when they arrive.
        filters={
          showLoadingSkeleton ? undefined : (
            <>
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
                onCheckedChange={() => handleMigrationFilterChange("generated")}
              >
                Generated
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={migrationFilter === "applied"}
                onCheckedChange={() => handleMigrationFilterChange("applied")}
              >
                Applied
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={migrationFilter === "failed"}
                onCheckedChange={() => handleMigrationFilterChange("failed")}
              >
                Failed
              </DropdownMenuCheckboxItem>
            </>
          )
        }
        columnsControl={showLoadingSkeleton ? undefined : columnsControl}
        toolbarActions={
          showLoadingSkeleton ? (
            <>
              <Skeleton className="h-9 w-20" />
              <Skeleton className="h-9 w-24" />
            </>
          ) : undefined
        }
        bulkBar={
          selectedCount > 0 ? (
            <BulkActionBar
              selectedCount={selectedCount}
              collection={undefined}
              onDelete={handleBulkDelete}
              onClear={clearSelection}
              itemLabel="collection"
            />
          ) : undefined
        }
        loading={showLoadingSkeleton}
        skeleton={<CollectionTableSkeleton />}
        // The failure is a table state, so the list reports it the way every
        // other list does rather than through an Alert of its own beside a
        // table that is still drawn.
        error={
          isError
            ? error instanceof Error
              ? error.message
              : "Failed to load collections. Please try again."
            : null
        }
        empty={{
          icon: <Layers className="h-5 w-5" aria-hidden="true" />,
          title: "No collections yet",
          description:
            "Get started by creating your first collection to organize and manage your content.",
          action: (
            <Link href={ROUTES.BUILDER_COLLECTIONS_NEW}>
              <Button size="md">
                <Plus className="h-4 w-4" />
                Create Collection
              </Button>
            </Link>
          ),
        }}
        emptyFiltered={{
          icon: <Layers className="h-5 w-5" aria-hidden="true" />,
          title: "No collections found",
          description:
            "No collections match your search. Try adjusting your search terms or filters.",
        }}
        columns={columns}
        rows={filteredData}
        onRowClick={collection => handleEdit(collection)}
        primaryColumn="label"
        selection={selection}
        rowActions={rowActions}
        registryKey="collections"
        ariaLabel="Collections table"
        emptyMessage="No collections found. Try adjusting your search or filters."
        // The table owns the pager so it lands inside the card on desktop,
        // in the column's gap on mobile. The gate is
        // unchanged and still hides the pager before the first response, so
        // an empty list shows no controls to page through.
        pagination={
          data && data.meta.totalPages > 0
            ? {
                currentPage: page,
                totalPages: data.meta.totalPages,
                pageSize,
                pageSizeOptions: PAGINATION.TABLE_PAGE_SIZE_OPTIONS,
                onPageChange: setPage,
                onPageSizeChange: setPageSize,
                isLoading: isFetching,
                totalItems: data.meta.total,
              }
            : undefined
        }
      />

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

      <BulkDeleteDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={setBulkDeleteDialogOpen}
        entityType="Collection"
        entityTypePlural="Collections"
        items={filteredData
          .filter(c => selectedIds.includes(c.id) && !c.locked)
          .map(c => ({ id: c.id, name: c.label, secondary: c.name }))}
        onConfirm={handleConfirmBulkDelete}
        isLoading={isBulkDeleting}
      />
    </>
  );
}
