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
import { Eye, Pencil, Plus, Puzzle, RefreshCw, Trash2 } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";

import { BulkActionBar } from "@admin/components/features/entries/EntryList/BulkActionBar";
import { ReconcileFieldGroupDialog } from "@admin/components/features/field-groups/ReconcileFieldGroupDialog";
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
type MigrationBadge = {
  variant: "success" | "warning" | "primary" | "default" | "destructive";
  label: string;
};

/** Every migration status this table can be handed, keyed so the compiler demands each one. */
const MIGRATION_BADGES: Record<FieldGroupMigrationStatus, MigrationBadge> = {
  synced: { variant: "success", label: "Synced" },
  pending: { variant: "warning", label: "Pending" },
  generated: { variant: "primary", label: "Generated" },
  applied: { variant: "success", label: "Applied" },
  failed: { variant: "destructive", label: "Failed" },
  diverged: { variant: "destructive", label: "Diverged" },
};

/**
 * Statuses a definition repair is the answer to.
 *
 * `diverged` refuses every schema edit until it is cleared; `failed` does not refuse anything but
 * stands over tables that may already match, so it is stale in the same way. Both are cleared by
 * the same operation, which is why one list covers them.
 */
const REPAIRABLE_STATUSES = new Set<string>(["diverged", "failed"]);

function getMigrationBadge(status?: FieldGroupMigrationStatus): MigrationBadge {
  // 🔴 An exhaustive Record rather than a switch with a `default`, and that is the control.
  //
  // A `default` arm silently absorbs any status added later: `diverged` rendered as `-` here — "no
  // migration state", the opposite of what it means, and the state an operator most needs to find —
  // while the sidebar indicator, which already keyed a Record off the same union, could not compile
  // until it was handled. The compiler is a boundary; remembering to add a case is not.
  //
  // `undefined` keeps its own answer, because "this row has no status" is a real case and is not
  // the same as an unhandled one.
  if (!status) return { variant: "default", label: "-" };

  // 🔴 A runtime fallback ON TOP of the exhaustive Record, not instead of it. The two catch
  // different things and only one of them is a compile-time question.
  //
  // `migration_status` is an unconstrained `varchar(20)` and the registry casts whatever string it
  // reads to this union, so the type is a claim about the column rather than a guarantee from it —
  // a row written by an older release, a hand-edited row, or a future status arriving during a
  // rolling deploy all land here as a value no entry covers. Indexing then yields `undefined` and
  // the cell dereferences `.variant`, taking down the whole management view: the operator loses the
  // page that would have shown them the offending row.
  //
  // This does NOT reopen the hole the Record closed. A new member of the union still fails to
  // compile until it has an entry, because the Record is declared exhaustive OVER THE UNION; what
  // this adds is an answer for values that were never in the union at all. The status is shown
  // verbatim, so an operator sees what the column actually holds rather than a shrug.
  return (
    MIGRATION_BADGES[status] ?? { variant: "warning", label: String(status) }
  );
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
  const { data, isLoading, isFetching, isError, error } = useFieldGroups({
    pagination: { page, pageSize },
    sorting: [],
    filters: {
      search: debouncedSearch,
      filters: { source: sourceFilter, migrationStatus: migrationFilter },
    },
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
        isDisabled: () => Boolean(fieldGroup.locked),
        onSelect: () => handleDelete(fieldGroup),
      },
    ],
    [handleEdit, handleDelete]
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
              <DropdownMenuCheckboxItem
                checked={migrationFilter === "diverged"}
                onCheckedChange={() => handleMigrationFilterChange("diverged")}
              >
                Diverged
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
          title: "No field groups yet",
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
          title: "No field groups found",
          description:
            "No field groups match your search. Try adjusting your search terms or filters.",
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
