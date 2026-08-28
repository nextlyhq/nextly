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
import { Eye, FileEdit, Pencil, Plus, Trash2 } from "lucide-react";
import React, { useState, useEffect, useMemo, useCallback } from "react";

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
  useSingles,
  useDeleteSingle,
  useBulkDeleteSingles,
} from "@admin/hooks/queries";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import { usePagination } from "@admin/hooks/usePagination";
import { useRowSelection } from "@admin/hooks/useRowSelection";
import { formatDateTime } from "@admin/lib/dates/format";
import { navigateTo } from "@admin/lib/navigation";
import type {
  ApiSingle,
  SingleSource,
  SingleMigrationStatus,
} from "@admin/types/entities";

import { SinglesTableSkeleton } from "./SinglesTableSkeleton";

/** Source badge label + icon. */
function getSourceBadge(source?: SingleSource): {
  label: string;
  icon: React.ReactNode;
} {
  switch (source) {
    case "code":
      return { label: "Code", icon: <Code className="mr-1 h-3 w-3" /> };
    case "ui":
      return { label: "UI", icon: <FileText className="mr-1 h-3 w-3" /> };
    case "built-in":
      return { label: "Built-in", icon: <Package className="mr-1 h-3 w-3" /> };
    default:
      return { label: "Unknown", icon: null };
  }
}

/** Migration-status badge variant + label. */
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

/** Columns pinned as always-visible in the column toggle. */
const ALWAYS_VISIBLE = new Set(["label", "createdAt"]);

/**
 * SinglesTable
 *
 * Lists singles with search, source/migration-status filters, server-side
 * pagination, column visibility, whole-row navigation, per-row actions, and bulk
 * delete. Locked (code-first) singles cannot be edited, selected, or deleted from
 * the UI. Data + mutations run through TanStack Query; rendering is delegated to
 * the unified DataTableView.
 */
export default function SinglesTable({ mode = "builder" }: SinglesTableProps) {
  const { page, pageSize, setPage, setPageSize, resetPage } = usePagination();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, UI.SEARCH_DEBOUNCE_MS);

  // Reset to the first page when the search term changes so a later page does not
  // request out-of-range results and show a false empty state.
  useEffect(() => {
    resetPage();
  }, [debouncedSearch, resetPage]);

  const [sourceFilter, setSourceFilter] = useState<SingleSource | "all">("all");
  const [migrationFilter, setMigrationFilter] = useState<
    SingleMigrationStatus | "all"
  >("all");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [singleToDelete, setSingleToDelete] = useState<{
    id: string;
    slug: string;
    label: string;
  } | null>(null);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  const { data, isLoading, isFetching, isError, error } = useSingles({
    pagination: { page, pageSize },
    sorting: [],
    filters: { search: debouncedSearch },
  });

  const { mutate: deleteSingle, isPending: isDeleting } = useDeleteSingle();

  const {
    selectedIds,
    selectedCount,
    toggleSelection,
    selectAllOnPage,
    deselectAllOnPage,
    clearSelection,
  } = useRowSelection();

  const { mutate: bulkDeleteSingles, isPending: isBulkDeleting } =
    useBulkDeleteSingles();

  const filteredData = useMemo(() => {
    if (!data?.items) return [];
    return data.items.filter(single => {
      if (sourceFilter !== "all" && single.source !== sourceFilter) {
        return false;
      }
      if (
        migrationFilter !== "all" &&
        single.migrationStatus !== migrationFilter
      ) {
        return false;
      }
      return true;
    });
  }, [data?.items, sourceFilter, migrationFilter]);

  // Code-first (locked) Singles open the same builder route; the builder
  // renders read-only when the loaded Single is locked.
  const handleEdit = useCallback(
    (single: ApiSingle) => {
      if (mode === "content") {
        navigateTo(buildRoute(ROUTES.SINGLE_EDIT, { slug: single.slug }));
        return;
      }
      navigateTo(
        buildRoute(ROUTES.BUILDER_SINGLES_EDIT, { slug: single.slug })
      );
    },
    [mode]
  );

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

  const handleBulkDelete = useCallback(() => {
    if (selectedCount === 0) {
      toast.error("No Singles selected");
      return;
    }
    setBulkDeleteDialogOpen(true);
  }, [selectedCount]);

  const handleConfirmBulkDelete = useCallback(() => {
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

  const getFieldCount = useCallback((single: ApiSingle): number => {
    if (single.fieldCount !== undefined) return single.fieldCount;
    return single.fields?.length || 0;
  }, []);

  const allColumns = useMemo<NextlyColumn<ApiSingle>[]>(
    () => [
      {
        name: "label",
        header: "SINGLE",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <div className="table-row-icon-cover">
              {React.createElement(iconMap[row.admin?.icon || ""] || FileText, {
                className: "h-4 w-4",
              })}
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
                {row.slug}
              </span>
            </div>
          </div>
        ),
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
        name: "fields",
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
    ],
    [getFieldCount]
  );

  const { columns, columnsControl } = useTableColumns({
    storageKey: "singles",
    columns: allColumns,
    alwaysVisible: ALWAYS_VISIBLE,
  });

  const handleSourceFilterChange = useCallback(
    (value: string) => {
      setSourceFilter(value as SingleSource | "all");
      resetPage();
    },
    [resetPage]
  );

  const handleMigrationFilterChange = useCallback(
    (value: string) => {
      setMigrationFilter(value as SingleMigrationStatus | "all");
      resetPage();
    },
    [resetPage]
  );

  const selection = useMemo<DataTableSelection<ApiSingle>>(
    () => ({
      selectedIds,
      isSelectable: single => !single.locked,
      onToggle: single => toggleSelection(single.id),
      onToggleAll: (rows, allSelected) => {
        const ids = rows.map(r => r.id);
        if (allSelected) deselectAllOnPage(ids);
        else selectAllOnPage(ids);
      },
    }),
    [selectedIds, toggleSelection, deselectAllOnPage, selectAllOnPage]
  );

  const rowActions = useCallback(
    (single: ApiSingle): RowAction<ApiSingle>[] => [
      {
        id: "edit",
        label: single.locked ? "View" : "Edit",
        icon: single.locked ? (
          <Eye className="h-4 w-4" />
        ) : (
          <Pencil className="h-4 w-4" />
        ),
        onSelect: () => handleEdit(single),
      },
      {
        id: "view-document",
        label: "View Document",
        icon: <FileEdit className="h-4 w-4" />,
        onSelect: () => handleViewDocument(single),
      },
      {
        id: "delete",
        label: "Delete",
        icon: <Trash2 className="h-4 w-4" />,
        destructive: true,
        isDisabled: () => Boolean(single.locked),
        onSelect: () => handleDelete(single),
      },
    ],
    [handleEdit, handleViewDocument, handleDelete]
  );

  /*
   * Loading and failure are TABLE states rather than replacements for the page.
   * Rendering either one in place of the whole surface takes the search field
   * away from the reader who just typed in it, and hands back a different one
   * at a different width when the response lands.
   */
  const showLoadingSkeleton =
    (isLoading || isFetching) && (!data || data.items.length === 0);
  const isFiltering = sourceFilter !== "all" || migrationFilter !== "all";

  return (
    <>
      <ListView<ApiSingle>
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search singles...",
          isLoading: isFetching,
        }}
        hasActiveFilters={isFiltering}
        loading={showLoadingSkeleton}
        skeleton={
          <>
            <span className="sr-only">Loading Singles...</span>
            <SinglesTableSkeleton />
          </>
        }
        error={
          isError
            ? error instanceof Error
              ? error.message
              : "Failed to load Singles. Please try again."
            : null
        }
        // Withheld while the first response is outstanding: a filter menu built
        // from data nobody has yet would open onto nothing.
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
              itemLabel="single"
            />
          ) : undefined
        }
        empty={{
          icon: <FileText className="h-5 w-5" aria-hidden="true" />,
          title: "No Singles yet",
          description:
            "Get started by creating your first Single to manage site-wide settings like headers, footers, and navigation.",
          action: (
            <Link href={ROUTES.BUILDER_SINGLES_NEW}>
              <Button size="md">
                <Plus className="h-4 w-4" />
                Create Single
              </Button>
            </Link>
          ),
        }}
        emptyFiltered={{
          icon: <FileText className="h-5 w-5" aria-hidden="true" />,
          title: "No Singles found",
          description:
            "No Singles match your search. Try adjusting your search terms or filters.",
        }}
        columns={columns}
        rows={filteredData}
        onRowClick={single => handleEdit(single)}
        primaryColumn="label"
        selection={selection}
        rowActions={rowActions}
        registryKey="singles"
        ariaLabel="Singles table"
        emptyMessage="No Singles found. Try adjusting your search or filters."
        // The table owns the pager, so it is placed for whichever view is
        // showing. Same `data` gate as the field group
        // list, and for the same reason: the rows are filtered client-side
        // after fetching, so only the server's meta says a response landed.
        pagination={
          data
            ? {
                currentPage: page,
                totalPages: data.meta.totalPages > 0 ? data.meta.totalPages : 1,
                pageSize,
                pageSizeOptions: PAGINATION.TABLE_PAGE_SIZE_OPTIONS,
                onPageChange: setPage,
                onPageSizeChange: setPageSize,
                isLoading,
                totalItems: data.meta.total,
              }
            : undefined
        }
      />

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

      <BulkDeleteDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={setBulkDeleteDialogOpen}
        items={filteredData
          .filter(s => selectedIds.includes(s.id) && !s.locked)
          .map(s => ({ id: s.id, name: s.label, secondary: s.slug }))}
        entityType="Single"
        entityTypePlural="Singles"
        onConfirm={handleConfirmBulkDelete}
        isLoading={isBulkDeleting}
      />
    </>
  );
}
