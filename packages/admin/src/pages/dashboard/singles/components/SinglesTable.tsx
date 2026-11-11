"use client";

import { Button, Skeleton } from "@nextlyhq/ui";
import { Eye, FileEdit, Pencil, Plus, Trash2 } from "lucide-react";
import React, { useState, useEffect, useMemo, useCallback } from "react";

import { BulkActionBar } from "@admin/components/features/entries/EntryList/BulkActionBar";
import {
  isRemovedFromCode,
  type RemovedEntity,
} from "@admin/components/features/entries/removed-from-code-notice";
import {
  RemovedFromCodeDescription,
  RemovedFromCodeMark,
} from "@admin/components/features/entries/RemovedFromCodeNotice";
import { FileText } from "@admin/components/icons";
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
  singleKeys,
  useDeleteSingle,
  useBulkDeleteSingles,
} from "@admin/hooks/queries";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import { usePagination } from "@admin/hooks/usePagination";
import { useRowSelection } from "@admin/hooks/useRowSelection";
import { navigateTo } from "@admin/lib/navigation";
import { singleApi } from "@admin/services/singleApi";
import type {
  ApiSingle,
  SingleSource,
  SingleMigrationStatus,
} from "@admin/types/entities";

import {
  EntityListFilterItems,
  EntityNameCell,
  createdColumn,
  entityIcon,
  fieldCountColumn,
  schemaColumn,
  sourceColumn,
} from "../../collection/components/entity-list/entity-list-columns";
import { PluginEntitySections } from "../../collection/components/entity-list/PluginEntitySections";
import { useSiteEntityPage } from "../../collection/components/entity-list/use-entity-lists-by-owner";

import { SinglesTableSkeleton } from "./SinglesTableSkeleton";

/** A Single as the removed-from-code notice names it. */
function removedSingle(single: ApiSingle): RemovedEntity {
  return {
    kind: "single",
    label: single.label || single.slug,
    slug: single.slug,
  };
}

/** The source filter's options, in the order the menu offers them. */
const SOURCE_FILTERS: SingleSource[] = ["code", "ui", "built-in"];

/** The schema filter's options, in the order the menu offers them. */
const SCHEMA_FILTERS: SingleMigrationStatus[] = [
  "synced",
  "applied",
  "pending",
  "generated",
];

/** A Single's slug, which the plugins' metadata names it by. */
const slugOfSingle = (single: ApiSingle): string => single.slug;

/** How many fields a Single has, as the list's answer counts them. */
function fieldCountOf(single: ApiSingle): number {
  if (single.fieldCount !== undefined) return single.fieldCount;
  return single.fields?.length || 0;
}

interface SinglesTableProps {
  mode?: "builder" | "content";
}

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
export default function SinglesTable({
  mode = "builder",
}: SinglesTableProps): React.JSX.Element {
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

  // The site's own Singles: the server leaves the plugins' out of the page
  // AND its count, so the pager counts only rows this table can show.
  const { data, isLoading, isFetching, isError, error } = useSiteEntityPage(
    singleKeys.lists(),
    {
      pagination: { page, pageSize },
      sorting: [],
      filters: { search: debouncedSearch },
    },
    singleApi.fetchSingles
  );

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

  // The columns, with the source cell naming the plugin on a plugin's rows.
  const columnsFor = useCallback(
    (pluginName?: string): NextlyColumn<ApiSingle>[] => [
      {
        name: "label",
        header: "SINGLE",
        cell: ({ row }) => (
          <EntityNameCell
            icon={entityIcon(row.admin?.icon, FileText)}
            label={row.label}
            slug={row.slug}
            locked={row.locked}
          >
            {/* Listed, and marked, once the configuration no longer
                declares it; the notice with its next step is read out. */}
            {isRemovedFromCode(row) && (
              <>
                <RemovedFromCodeMark
                  entity={removedSingle(row)}
                  state={row.removedFromCodeState}
                  className="ml-0"
                />
                <RemovedFromCodeDescription
                  entity={removedSingle(row)}
                  state={row.removedFromCodeState}
                />
              </>
            )}
          </EntityNameCell>
        ),
      },
      sourceColumn(pluginName),
      schemaColumn(),
      fieldCountColumn("fields", fieldCountOf),
      createdColumn(),
    ],
    []
  );
  const allColumns = useMemo(() => columnsFor(), [columnsFor]);

  // Resolves persisted column visibility while ensuring pinned single label/created remain visible.
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
        // One owned by code offers no delete, rather than a disabled one.
        isVisible: () => !single.locked,
        onSelect: () => handleDelete(single),
      },
    ],
    [handleEdit, handleViewDocument, handleDelete]
  );

  // A plugin's Single is read-only here: it can be opened and its document
  // edited, never deleted.
  const pluginRowActions = useCallback(
    (single: ApiSingle): RowAction<ApiSingle>[] => [
      {
        id: "edit",
        label: "View",
        icon: <Eye className="h-4 w-4" />,
        onSelect: () => handleEdit(single),
      },
      {
        id: "view-document",
        label: "View Document",
        icon: <FileEdit className="h-4 w-4" />,
        onSelect: () => handleViewDocument(single),
      },
    ],
    [handleEdit, handleViewDocument]
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
            <EntityListFilterItems
              sources={SOURCE_FILTERS}
              source={sourceFilter}
              onSource={handleSourceFilterChange}
              states={SCHEMA_FILTERS}
              state={migrationFilter}
              onState={handleMigrationFilterChange}
            />
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
          title: "No Singles of your own yet",
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
          title: "No Singles of your own found",
          description:
            "None of your own Singles match your search. Try adjusting your search terms or filters.",
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

      <PluginEntitySections<ApiSingle>
        kind="singles"
        noun={{ one: "Single", many: "Singles" }}
        listKey={singleKeys.lists()}
        fetchPage={singleApi.fetchSingles}
        search={debouncedSearch}
        slugOf={slugOfSingle}
        columnsFor={columnsFor}
        rowActions={pluginRowActions}
        onRowClick={handleEdit}
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
