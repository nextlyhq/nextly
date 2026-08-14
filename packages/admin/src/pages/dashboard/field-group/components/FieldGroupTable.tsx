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
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nextlyhq/ui";
import { Eye, Pencil, Trash2, Filter } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";

import { BulkActionBar } from "@admin/components/features/entries/EntryList/BulkActionBar";
import * as Icons from "@admin/components/icons";
import { Lock } from "@admin/components/icons";
import { BulkDeleteDialog } from "@admin/components/shared/bulk-action-dialogs";
import { SearchBar } from "@admin/components/shared/search-bar";
import { toast } from "@admin/components/ui";
import { DataTableView } from "@admin/components/ui/table/data-table";
import type {
  DataTableSelection,
  NextlyColumn,
  RowAction,
} from "@admin/components/ui/table/data-table";
import { PAGINATION } from "@admin/constants/pagination";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { UI } from "@admin/constants/ui";
import {
  useFieldGroups,
  useDeleteFieldGroup,
  useBulkDeleteFieldGroups,
} from "@admin/hooks/queries";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import { usePagination } from "@admin/hooks/usePagination";
import { useRowSelection } from "@admin/hooks/useRowSelection";
import { formatDateTime } from "@admin/lib/dates/format";
import { navigateTo } from "@admin/lib/navigation";
import type {
  ApiFieldGroup,
  FieldGroupSource,
  FieldGroupMigrationStatus,
} from "@admin/types/entities";

import { FieldGroupsEmptyState } from "./FieldGroupsEmptyState";
import { FieldGroupTableSkeleton } from "./FieldGroupTableSkeleton";

/** Source badge label + icon. */
function getSourceBadge(source?: FieldGroupSource): {
  label: string;
  icon: React.ReactNode;
} {
  switch (source) {
    case "code":
      return { label: "Code", icon: <Icons.Code className="mr-1 h-3 w-3" /> };
    case "ui":
      return { label: "UI", icon: <Icons.FileText className="mr-1 h-3 w-3" /> };
    default:
      return { label: "Unknown", icon: null };
  }
}

/** Migration-status badge variant + label. */
function getMigrationBadge(status?: FieldGroupMigrationStatus): {
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

/** Columns pinned as always-visible in the column toggle. */
const ALWAYS_VISIBLE = new Set(["label", "createdAt"]);

/**
 * FieldGroupTable
 *
 * Lists components with search, source/migration-status filters, server-side
 * pagination, column visibility, whole-row navigation to the builder, per-row
 * actions, and bulk delete. Locked (code-first) components cannot be edited,
 * selected, or deleted from the UI. Data + mutations run through TanStack Query;
 * rendering is delegated to the unified DataTableView.
 */
export default function FieldGroupTable() {
  const { page, pageSize, setPage, setPageSize, resetPage } = usePagination();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, UI.SEARCH_DEBOUNCE_MS);

  // Reset to the first page when the search term changes so a later page does not
  // request out-of-range results and show a false empty state.
  useEffect(() => {
    resetPage();
  }, [debouncedSearch, resetPage]);

  const [sourceFilter, setSourceFilter] = useState<FieldGroupSource | "all">(
    "all"
  );
  const [migrationFilter, setMigrationFilter] = useState<
    FieldGroupMigrationStatus | "all"
  >("all");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [fieldGroupToDelete, setFieldGroupToDelete] = useState<{
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

  const { data, isLoading, isFetching, isError, error } = useFieldGroups({
    pagination: { page, pageSize },
    sorting: [],
    filters: { search: debouncedSearch },
  });

  const { mutate: deleteFieldGroup, isPending: isDeleting } =
    useDeleteFieldGroup();

  const {
    selectedIds,
    selectedCount,
    toggleSelection,
    selectAllOnPage,
    deselectAllOnPage,
    clearSelection,
  } = useRowSelection();

  // Selection is page-scoped: clear it whenever the page, search, or source
  // filter changes so a bulk action never targets rows that are no longer
  // shown/confirmed.
  useEffect(() => {
    clearSelection();
  }, [page, debouncedSearch, sourceFilter, clearSelection]);

  const { mutate: bulkDeleteFieldGroups, isPending: isBulkDeleting } =
    useBulkDeleteFieldGroups();

  const filteredData = useMemo(() => {
    if (!data?.items) return [];
    return data.items.filter(fieldGroup => {
      if (sourceFilter !== "all" && fieldGroup.source !== sourceFilter) {
        return false;
      }
      if (
        migrationFilter !== "all" &&
        fieldGroup.migrationStatus !== migrationFilter
      ) {
        return false;
      }
      return true;
    });
  }, [data?.items, sourceFilter, migrationFilter]);

  // Code-first (locked) components open the same builder route; the builder
  // renders read-only when the loaded component is locked.
  const handleEdit = useCallback((fieldGroup: ApiFieldGroup) => {
    navigateTo(
      buildRoute(ROUTES.BUILDER_FIELD_GROUPS_EDIT, { slug: fieldGroup.slug })
    );
  }, []);

  const handleDelete = useCallback((fieldGroup: ApiFieldGroup) => {
    if (fieldGroup.locked) {
      toast.error("Cannot delete locked field group", {
        description: "Code-first field groups cannot be deleted from the UI.",
      });
      return;
    }
    setFieldGroupToDelete({
      id: fieldGroup.id,
      slug: fieldGroup.slug,
      label: fieldGroup.label,
    });
    setDeleteDialogOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!fieldGroupToDelete) return;
    deleteFieldGroup(fieldGroupToDelete.slug, {
      onSuccess: () => {
        toast.success("Field group deleted", {
          description: `${fieldGroupToDelete.label} has been deleted successfully.`,
        });
        setDeleteDialogOpen(false);
        setFieldGroupToDelete(null);
      },
      onError: err => {
        toast.error("Delete failed", {
          description:
            err instanceof Error
              ? err.message
              : "Failed to delete the field group.",
        });
      },
    });
  }, [fieldGroupToDelete, deleteFieldGroup]);

  const handleBulkDelete = useCallback(() => {
    if (selectedCount === 0) {
      toast.error("No field groups selected");
      return;
    }
    setBulkDeleteDialogOpen(true);
  }, [selectedCount]);

  const handleConfirmBulkDelete = useCallback(() => {
    const selectedFieldGroupSlugs = filteredData
      .filter(c => selectedIds.includes(c.id) && !c.locked)
      .map(c => c.slug);
    void bulkDeleteFieldGroups(selectedFieldGroupSlugs, undefined, {
      onSuccess: result => {
        if (result.failed === 0) {
          toast.success("Field groups deleted", {
            description: `${result.succeeded} field groups deleted successfully.`,
          });
        } else {
          toast.warning("Partially completed", {
            description: `${result.succeeded} deleted, ${result.failed} failed.`,
          });
          console.error("Failed to delete field groups:", result.failedIds);
        }
        setBulkDeleteDialogOpen(false);
        clearSelection();
      },
      onError: result => {
        toast.error("Deletion failed", {
          description: `Failed to delete ${result.failed} field groups.`,
        });
        console.error("Failed field groups:", result.failedIds);
      },
    });
  }, [filteredData, selectedIds, bulkDeleteFieldGroups, clearSelection]);

  const getFieldCount = useCallback((fieldGroup: ApiFieldGroup): number => {
    if (fieldGroup.fieldCount !== undefined) return fieldGroup.fieldCount;
    return fieldGroup.fields?.length || 0;
  }, []);

  const allColumns = useMemo<NextlyColumn<ApiFieldGroup>[]>(
    () => [
      {
        name: "label",
        header: "FIELD GROUP",
        cell: ({ row }) => {
          const iconName = row.admin?.icon || "Puzzle";
          const IconComponent =
            (Icons as Record<string, React.ElementType>)[iconName] || Icons.Box;
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
                  {row.slug}
                </span>
              </div>
            </div>
          );
        },
      },
      {
        name: "admin",
        header: "CATEGORY",
        cell: ({ row }) => {
          const category = row.admin?.category;
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

  const handleSourceFilterChange = (value: string) => {
    setSourceFilter(value as FieldGroupSource | "all");
    resetPage();
  };

  const handleMigrationFilterChange = (value: string) => {
    setMigrationFilter(value as FieldGroupMigrationStatus | "all");
    resetPage();
  };

  const selection = useMemo<DataTableSelection<ApiFieldGroup>>(
    () => ({
      selectedIds,
      isSelectable: fieldGroup => !fieldGroup.locked,
      onToggle: fieldGroup => toggleSelection(fieldGroup.id),
      onToggleAll: (rows, allSelected) => {
        const ids = rows.map(r => r.id);
        if (allSelected) deselectAllOnPage(ids);
        else selectAllOnPage(ids);
      },
    }),
    [selectedIds, toggleSelection, deselectAllOnPage, selectAllOnPage]
  );

  const rowActions = useCallback(
    (fieldGroup: ApiFieldGroup): RowAction<ApiFieldGroup>[] => [
      {
        id: "edit",
        label: fieldGroup.locked ? "View" : "Edit",
        icon: fieldGroup.locked ? (
          <Eye className="h-4 w-4" />
        ) : (
          <Pencil className="h-4 w-4" />
        ),
        onSelect: () => handleEdit(fieldGroup),
      },
      {
        id: "delete",
        label: "Delete",
        icon: <Trash2 className="h-4 w-4" />,
        destructive: true,
        isDisabled: () => Boolean(fieldGroup.locked),
        onSelect: () => handleDelete(fieldGroup),
      },
    ],
    [handleEdit, handleDelete]
  );

  const showLoadingSkeleton =
    (isLoading || isFetching) && (!data || data.items.length === 0);
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
          itemLabel="field group"
        />
      )}

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search field groups..."
          isLoading={isFetching}
          className="w-full md:max-w-sm"
        />

        <div className="flex w-full items-center justify-between gap-2 sm:justify-end md:w-auto">
          {showLoadingSkeleton ? (
            <>
              <Skeleton className="h-9 w-20" />
              <Skeleton className="h-9 w-24" />
            </>
          ) : (
            <>
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
                      // Notification dot: a fixed circle, not a --radius step.
                      <span className="absolute -right-1 -top-1 flex h-3 w-3 rounded-full bg-primary" />
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
            </>
          )}
        </div>
      </div>

      {isError ? (
        <Alert variant="destructive">
          {error instanceof Error
            ? error.message
            : "Failed to load field groups. Please try again."}
        </Alert>
      ) : showLoadingSkeleton ? (
        <FieldGroupTableSkeleton />
      ) : isEmpty ? (
        <FieldGroupsEmptyState isSearching={isSearching || isFiltering} />
      ) : (
        <>
          <DataTableView<ApiFieldGroup>
            columns={columns}
            rows={filteredData}
            onRowClick={fieldGroup => handleEdit(fieldGroup)}
            primaryColumn="label"
            selection={selection}
            rowActions={rowActions}
            // Storage identifier, not copy: this addresses the registry the API serves.
            registryKey="components"
            ariaLabel="Field Groups table"
            emptyMessage="No field groups found. Try adjusting your search or filters."
            // The table owns the pager, so it is placed for whichever view is
            // showing. Gated on `data` rather than on a page
            // count because this list filters client-side after fetching, so
            // the server's total is the only reliable signal that a response
            // has arrived at all.
            pagination={
              data
                ? {
                    currentPage: page,
                    totalPages:
                      data.meta.totalPages > 0 ? data.meta.totalPages : 1,
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
        </>
      )}

      <BulkDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        entityType="Field Group"
        entityTypePlural="Field Groups"
        items={
          fieldGroupToDelete
            ? [
                {
                  id: fieldGroupToDelete.id,
                  name: fieldGroupToDelete.label,
                  secondary: fieldGroupToDelete.slug,
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
        entityType="Field Group"
        entityTypePlural="Field Groups"
        items={filteredData
          .filter(c => selectedIds.includes(c.id) && !c.locked)
          .map(c => ({ id: c.id, name: c.label, secondary: c.slug }))}
        onConfirm={handleConfirmBulkDelete}
        isLoading={isBulkDeleting}
      />
    </div>
  );
}
