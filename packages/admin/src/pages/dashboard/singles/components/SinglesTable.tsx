"use client";

import {
  Alert,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nextlyhq/ui";
import { Pencil, Trash2, FileEdit, Filter } from "lucide-react";
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
import { Pagination } from "@admin/components/shared/pagination";
import { SearchBar } from "@admin/components/shared/search-bar";
import { toast } from "@admin/components/ui";
import { DataTableView } from "@admin/components/ui/table/data-table";
import type {
  DataTableSelection,
  NextlyColumn,
  RowAction,
} from "@admin/components/ui/table/data-table";
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
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, UI.SEARCH_DEBOUNCE_MS);

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
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  const toggleColumn = (key: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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

  const columns = useMemo(
    () =>
      allColumns.map(col => ({ ...col, hidden: hiddenColumns.has(col.name) })),
    [allColumns, hiddenColumns]
  );

  const toggleableColumns = useMemo(
    () => allColumns.filter(col => !ALWAYS_VISIBLE.has(col.name)),
    [allColumns]
  );

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(0);
  }, []);

  const handleSourceFilterChange = useCallback((value: string) => {
    setSourceFilter(value as SingleSource | "all");
    setPage(0);
  }, []);

  const handleMigrationFilterChange = useCallback((value: string) => {
    setMigrationFilter(value as SingleMigrationStatus | "all");
    setPage(0);
  }, []);

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
        label: "Edit",
        icon: <Pencil className="h-4 w-4" />,
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

  if (isError) {
    return (
      <div className="space-y-4">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search Singles..."
          isLoading={false}
          className="max-w-sm flex-1"
        />
        <Alert variant="destructive">
          {error instanceof Error
            ? error.message
            : "Failed to load Singles. Please try again."}
        </Alert>
      </div>
    );
  }

  if ((isLoading || isFetching) && (!data || data.items.length === 0)) {
    return (
      <div className="space-y-4">
        <span className="sr-only">Loading Singles...</span>
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search Singles..."
          isLoading={true}
          className="max-w-sm flex-1"
        />
        <SinglesTableSkeleton />
      </div>
    );
  }

  const isEmpty = filteredData.length === 0;
  const isSearching = search.trim() !== "";
  const isFiltering = sourceFilter !== "all" || migrationFilter !== "all";

  return (
    <div className="space-y-4">
      {selectedCount > 0 && (
        <BulkActionBar
          selectedCount={selectedCount}
          collection={undefined}
          onDelete={handleBulkDelete}
          onClear={clearSelection}
          itemLabel="single"
        />
      )}

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search Singles..."
          isLoading={isLoading}
          className="w-full border-border bg-background text-foreground md:max-w-sm"
        />

        <div className="flex w-full items-center justify-between gap-2 sm:justify-end md:w-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="md"
                className="relative border-border bg-background text-foreground hover:bg-accent/10"
              >
                <Filter className="h-4 w-4" />
                Filter
                {isFiltering && (
                  <span className="absolute -right-1 -top-1 flex h-3 w-3 rounded-none bg-primary" />
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
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="md"
                className="border-border bg-background text-foreground hover:bg-accent/10"
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
                  key={col.name}
                  checked={!hiddenColumns.has(col.name)}
                  onCheckedChange={() => toggleColumn(col.name)}
                >
                  {typeof col.header === "string" ? col.header : col.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isEmpty ? (
        <SinglesEmptyState isSearching={isSearching || isFiltering} />
      ) : (
        <>
          <DataTableView<ApiSingle>
            columns={columns}
            rows={filteredData}
            onRowClick={single => {
              // Locked singles are read-only from the UI.
              if (!single.locked) handleEdit(single);
            }}
            primaryColumn="label"
            selection={selection}
            rowActions={rowActions}
            ariaLabel="Singles table"
            emptyMessage="No Singles found. Try adjusting your search or filters."
          />
          {data && (
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
        </>
      )}

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
    </div>
  );
}
