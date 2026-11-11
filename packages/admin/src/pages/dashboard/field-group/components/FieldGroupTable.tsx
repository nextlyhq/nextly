"use client";

import { Badge, Button, Skeleton } from "@nextlyhq/ui";
import { Eye, Pencil, Plus, Puzzle, RefreshCw, Trash2 } from "lucide-react";
import { useState, useEffect, useMemo, useCallback, type JSX } from "react";

import { BulkActionBar } from "@admin/components/features/entries/EntryList/BulkActionBar";
import { ReconcileFieldGroupDialog } from "@admin/components/features/field-groups/ReconcileFieldGroupDialog";
import * as Icons from "@admin/components/icons";
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
  fieldGroupKeys,
  useDeleteFieldGroup,
  useBulkDeleteFieldGroups,
} from "@admin/hooks/queries";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import { usePagination } from "@admin/hooks/usePagination";
import { useRowSelection } from "@admin/hooks/useRowSelection";
import { navigateTo } from "@admin/lib/navigation";
import { fieldGroupApi } from "@admin/services/fieldGroupApi";
import type {
  ApiFieldGroup,
  FieldGroupSource,
  FieldGroupMigrationStatus,
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

import { FieldGroupTableSkeleton } from "./FieldGroupTableSkeleton";

/** The source filter's options, in the order the menu offers them. */
const SOURCE_FILTERS: FieldGroupSource[] = ["code", "ui"];

/** The schema filter's options, in the order the menu offers them. */
const SCHEMA_FILTERS: FieldGroupMigrationStatus[] = [
  "synced",
  "applied",
  "pending",
  "generated",
  "failed",
  "diverged",
];

/** A field group's slug, which the plugins' metadata names it by. */
const slugOfFieldGroup = (fieldGroup: ApiFieldGroup): string => fieldGroup.slug;

/** How many fields a field group has, as the list's answer counts them. */
function fieldCountOf(fieldGroup: ApiFieldGroup): number {
  if (fieldGroup.fieldCount !== undefined) return fieldGroup.fieldCount;
  return fieldGroup.fields?.length || 0;
}

/**
 * How many fields place a field group: the count a delete of it would be
 * refused over. A count the list could not read says so with a dash, since
 * it is not the same as unused.
 */
function UsedByCell({ placedBy }: { placedBy?: number | null }): JSX.Element {
  if (placedBy === undefined || placedBy === null) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  if (placedBy === 0) {
    return <span className="text-sm text-muted-foreground">Not used</span>;
  }
  return (
    <span className="whitespace-nowrap text-sm tabular-nums">
      {placedBy} {placedBy === 1 ? "field" : "fields"}
    </span>
  );
}

/**
 * Statuses a definition repair is the answer to.
 *
 * `diverged` refuses every schema edit until it is cleared; `failed` does not refuse anything but
 * stands over tables that may already match, so it is stale in the same way. Both are cleared by
 * the same operation, which is why one list covers them.
 */
const REPAIRABLE_STATUSES = new Set<string>(["diverged", "failed"]);

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
export default function FieldGroupTable(): JSX.Element {
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
  // The field group whose repair plan is open, or null. Holding the row rather than a boolean lets
  // the dialog title name the group the operator picked.
  const [reconcileTarget, setReconcileTarget] = useState<ApiFieldGroup | null>(
    null
  );
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  // 🔴 Both filters go to the SERVER, and the table renders exactly what comes back.
  //
  // They used to be applied here, to `data.items` — one server-paginated page. A page is a window
  // over the whole set, so narrowing it can only ever search the window: choosing "Diverged" showed
  // an empty table whenever the diverged group sat on another page, hiding the one state an
  // operator opens this screen to find. The counters had the same problem from the other side,
  // since `meta.total` counts the unfiltered set.
  //
  // Asking the database once and rendering the answer also keeps the pager honest: `meta` now
  // describes the filtered set, so page count, "hasNext" and the row range all agree with the rows.
  // The site's own field groups: the server also leaves the plugins' out of
  // the page AND its count.
  const { data, isLoading, isFetching, isError, error } = useSiteEntityPage(
    fieldGroupKeys.lists(),
    {
      pagination: { page, pageSize },
      sorting: [],
      filters: {
        search: debouncedSearch,
        filters: { source: sourceFilter, migrationStatus: migrationFilter },
      },
    },
    fieldGroupApi.fetchComponents
  );

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
  // `migrationFilter` belongs here for the same reason `sourceFilter` does, and it did not before
  // only because the filter used to be applied after the fetch. Now that it changes which rows the
  // SERVER returns, a selection made under one filter would otherwise survive into another result
  // set and a bulk action would target rows the operator can no longer see.
  useEffect(() => {
    clearSelection();
  }, [page, debouncedSearch, sourceFilter, migrationFilter, clearSelection]);

  const { mutate: bulkDeleteFieldGroups, isPending: isBulkDeleting } =
    useBulkDeleteFieldGroups();

  // The rows ARE the answer to the filtered query, so there is nothing left to narrow here. A
  // second filter over the same question is the drift this codebase has a rule about: two
  // implementations agree the day they are written, and the one that runs last decides.
  const filteredData = useMemo(() => data?.items ?? [], [data?.items]);

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

  // The columns, with the source cell naming the plugin on a plugin's rows.
  const columnsFor = useCallback(
    (pluginName?: string): NextlyColumn<ApiFieldGroup>[] => [
      {
        name: "label",
        header: "FIELD GROUP",
        cell: ({ row }) => (
          <EntityNameCell
            icon={entityIcon(row.admin?.icon || "Puzzle", Icons.Box)}
            label={row.label}
            slug={row.slug}
            locked={row.locked}
          />
        ),
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
      sourceColumn(pluginName),
      schemaColumn(),
      {
        // The fields that place this group, wherever they are.
        name: "placedBy",
        header: "USED BY",
        cell: ({ row }) => <UsedByCell placedBy={row.placedBy} />,
      },
      fieldCountColumn("fields", fieldCountOf),
      createdColumn(),
    ],
    []
  );
  const allColumns = useMemo(() => columnsFor(), [columnsFor]);

  // Resolves persisted column visibility while ensuring pinned columns remain visible.
  const { columns, columnsControl } = useTableColumns({
    storageKey: "field-groups",
    columns: allColumns,
    alwaysVisible: ALWAYS_VISIBLE,
  });

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
      // Offered only where a repair is the answer to something. The preview itself is safe on any
      // field group, so this list decides DISCOVERABILITY, not permission — the server still
      // decides whether the operation may run, and says so in the dialog when it may not.
      ...(REPAIRABLE_STATUSES.has(fieldGroup.migrationStatus ?? "")
        ? [
            {
              id: "reconcile",
              label: "Repair definition",
              icon: <RefreshCw className="h-4 w-4" />,
              onSelect: () => setReconcileTarget(fieldGroup),
            } satisfies RowAction<ApiFieldGroup>,
          ]
        : []),
      {
        id: "delete",
        label: "Delete",
        icon: <Trash2 className="h-4 w-4" />,
        destructive: true,
        // One owned by code offers no delete, rather than a disabled one.
        isVisible: () => !fieldGroup.locked,
        onSelect: () => handleDelete(fieldGroup),
      },
    ],
    [handleEdit, handleDelete]
  );

  // A plugin's field group is read-only: it can be opened, never deleted.
  const pluginRowActions = useCallback(
    (fieldGroup: ApiFieldGroup): RowAction<ApiFieldGroup>[] => [
      {
        id: "edit",
        label: "View",
        icon: <Eye className="h-4 w-4" />,
        onSelect: () => handleEdit(fieldGroup),
      },
    ],
    [handleEdit]
  );

  const showLoadingSkeleton =
    (isLoading || isFetching) && (!data || data.items.length === 0);
  const isFiltering = sourceFilter !== "all" || migrationFilter !== "all";

  return (
    <>
      <ListView<ApiFieldGroup>
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search field groups...",
          isLoading: isFetching,
        }}
        hasActiveFilters={isFiltering}
        // Withheld while the first response is outstanding: a filter menu built
        // from data nobody has yet would open onto nothing. The skeletons below
        // hold their place so the row does not resize when they arrive.
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
              itemLabel="field group"
            />
          ) : undefined
        }
        loading={showLoadingSkeleton}
        skeleton={<FieldGroupTableSkeleton />}
        // The failure is a table state, so the list reports it the way every
        // other list does rather than through an Alert of its own beside a
        // table that is still drawn.
        error={
          isError
            ? error instanceof Error
              ? error.message
              : "Failed to load field groups. Please try again."
            : null
        }
        empty={{
          icon: <Puzzle className="h-5 w-5" aria-hidden="true" />,
          title: "No field groups of your own yet",
          description:
            "Get started by creating your first reusable field group to share across your collections.",
          action: (
            <Link href={ROUTES.BUILDER_FIELD_GROUPS_NEW}>
              <Button size="md">
                <Plus className="h-4 w-4" />
                Create Field Group
              </Button>
            </Link>
          ),
        }}
        emptyFiltered={{
          icon: <Puzzle className="h-5 w-5" aria-hidden="true" />,
          title: "No field groups of your own found",
          description:
            "None of your own field groups match your search. Try adjusting your search terms or filters.",
        }}
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
                totalPages: data.meta.totalPages > 0 ? data.meta.totalPages : 1,
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

      <PluginEntitySections<ApiFieldGroup>
        kind="fieldGroups"
        noun={{ one: "field group", many: "field groups" }}
        listKey={fieldGroupKeys.lists()}
        fetchPage={fieldGroupApi.fetchComponents}
        search={debouncedSearch}
        slugOf={slugOfFieldGroup}
        columnsFor={columnsFor}
        resolvedColumns={columns}
        rowActions={pluginRowActions}
        onRowClick={handleEdit}
      />

      {/* Mounted only while a target is held, so each opening fetches a fresh plan rather than
          reusing the one belonging to whichever group was picked last. */}
      {reconcileTarget ? (
        <ReconcileFieldGroupDialog
          open
          onOpenChange={next => {
            if (!next) setReconcileTarget(null);
          }}
          fieldGroupSlug={reconcileTarget.slug}
          fieldGroupLabel={reconcileTarget.label}
        />
      ) : null}

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
    </>
  );
}
