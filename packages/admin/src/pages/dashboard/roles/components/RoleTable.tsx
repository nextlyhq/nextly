"use client";

import type { TableParams } from "@nextlyhq/ui";
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
} from "@nextlyhq/ui";
import { Columns, Edit, Shield, Trash2 } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";

import { BulkActionBar } from "@admin/components/features/entries/EntryList/BulkActionBar";
import { RoleDeleteDialog } from "@admin/components/features/role-management/RoleDeleteDialog";
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
import {
  useRoles,
  useDeleteRole,
  useBulkDeleteRoles,
} from "@admin/hooks/queries/useRoles";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import { useRowSelection } from "@admin/hooks/useRowSelection";
import { navigateTo } from "@admin/lib/navigation";
import type { Role } from "@admin/types/entities";

/** Columns pinned as always-visible in the column toggle. */
const ALWAYS_VISIBLE = new Set(["roleName"]);

/**
 * RoleTable
 *
 * Lists roles with search, server-side pagination, column visibility, whole-row
 * navigation to the edit page, per-row actions, and bulk delete. System roles
 * are locked: their selection checkbox is disabled and they are excluded from
 * bulk deletion. Data + mutations run through TanStack Query; rendering is
 * delegated to the unified DataTableView.
 */
export default function RoleTable() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState<{
    id: string;
    name: string;
    isSystemRole: boolean;
  } | null>(null);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  const {
    selectedIds,
    selectedCount,
    toggleSelection,
    selectAllOnPage,
    deselectAllOnPage,
    clearSelection,
  } = useRowSelection();

  const debouncedSearch = useDebouncedValue(search, 500);

  // Reset to the first page when the search term changes so a later page does not
  // request out-of-range results and show a false empty state.
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch]);

  // Selection is page-scoped: clear it whenever the page or search changes so a
  // bulk action never targets rows that are no longer shown/confirmed.
  useEffect(() => {
    clearSelection();
  }, [page, debouncedSearch, clearSelection]);

  const { mutate: bulkDeleteRoles, isPending: isBulkDeleting } =
    useBulkDeleteRoles();

  const params: TableParams = {
    pagination: { page, pageSize },
    sorting: [],
    filters: { search: debouncedSearch },
  };

  const { data, isLoading } = useRoles(params);
  const roles = useMemo(() => data?.items ?? [], [data?.items]);

  const { mutate: deleteRole, isPending: isDeleting } = useDeleteRole();

  const isSystemRole = useCallback((role: Role) => role.type === "System", []);

  const handleEdit = useCallback((role: Role) => {
    navigateTo(buildRoute(ROUTES.SECURITY_ROLES_EDIT, { id: role.id }));
  }, []);

  const handleDelete = useCallback((role: Role) => {
    setRoleToDelete({
      id: role.id,
      name: role.roleName,
      isSystemRole: role.type === "System",
    });
    setDeleteDialogOpen(true);
  }, []);

  const handleConfirmDelete = () => {
    if (!roleToDelete) return;
    deleteRole(roleToDelete.id, {
      onSuccess: () => {
        toast.success("Role deleted", {
          description: `${roleToDelete.name} has been deleted successfully.`,
        });
        setDeleteDialogOpen(false);
        setRoleToDelete(null);
      },
      onError: err => {
        toast.error("Delete failed", {
          description:
            err instanceof Error ? err.message : "Failed to delete the role.",
        });
      },
    });
  };

  const handleBulkDelete = () => {
    if (selectedCount === 0) {
      toast.error("No roles selected");
      return;
    }
    const selectedRoles = roles.filter(r => selectedIds.includes(r.id));
    const systemRolesSelected = selectedRoles.filter(r => r.type === "System");
    if (systemRolesSelected.length > 0) {
      toast.warning("System roles cannot be deleted", {
        description: `${systemRolesSelected.length} system role(s) will be excluded from deletion.`,
      });
    }
    const deletableRoles = selectedRoles.filter(r => r.type !== "System");
    if (deletableRoles.length === 0) {
      toast.error("No deletable roles selected", {
        description: "Only system roles are selected, which cannot be deleted.",
      });
      return;
    }
    setBulkDeleteDialogOpen(true);
  };

  const handleConfirmBulkDelete = () => {
    const deletableRoleIds = roles
      .filter(r => selectedIds.includes(r.id) && r.type !== "System")
      .map(r => r.id);
    if (deletableRoleIds.length === 0) {
      toast.error("No deletable roles selected");
      setBulkDeleteDialogOpen(false);
      return;
    }
    void bulkDeleteRoles(deletableRoleIds, undefined, {
      onSuccess: result => {
        if (result.failed === 0) {
          toast.success("Roles deleted", {
            description: `${result.succeeded} roles deleted successfully.`,
          });
        } else {
          toast.warning("Partially completed", {
            description: `${result.succeeded} deleted, ${result.failed} failed.`,
          });
          console.error("Failed to delete roles:", result.failedIds);
        }
        setBulkDeleteDialogOpen(false);
        clearSelection();
      },
      onError: result => {
        toast.error("Deletion failed", {
          description: `Failed to delete ${result.failed} roles.`,
        });
        console.error("Failed roles:", result.failedIds);
      },
    });
  };

  const systemRoleCount = useMemo(
    () =>
      roles.filter(r => selectedIds.includes(r.id) && r.type === "System")
        .length,
    [roles, selectedIds]
  );

  const allColumns = useMemo((): NextlyColumn<Role>[] => {
    return [
      {
        name: "roleName",
        header: "ROLE NAME",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <div className="table-row-icon-cover">
              <Shield className="h-4 w-4" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {row.roleName}
                </span>
                {row.type === "System" && (
                  <Badge variant="default" className="text-xs">
                    System
                  </Badge>
                )}
              </div>
              {row.subtitle && (
                <span className="truncate text-xs text-muted-foreground">
                  {row.subtitle}
                </span>
              )}
            </div>
          </div>
        ),
      },
      {
        name: "id",
        header: "ID",
        hideOnMobile: true,
        cell: ({ value }) => {
          const id = typeof value === "string" ? value : "";
          return (
            <span
              className="font-mono text-xs text-muted-foreground"
              title={id}
            >
              {id.length > 8 ? `${id.slice(0, 8)}...` : id}
            </span>
          );
        },
      },
      {
        name: "description",
        header: "Description",
        hideOnMobile: true,
        cell: ({ row }) => (
          <span className="line-clamp-2 text-sm text-muted-foreground">
            {row.description || "No description"}
          </span>
        ),
      },
      {
        name: "permissions",
        header: "Permissions",
        hideOnMobile: true,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.permissions.length} Permissions
          </span>
        ),
      },
      {
        name: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={row.status === "Active" ? "success" : "default"}>
            {row.status}
          </Badge>
        ),
      },
      {
        name: "created",
        header: "Created",
        hideOnMobile: true,
        cell: ({ value }) => (
          <span className="text-sm">
            {formatDateWithAdminTimezone(
              value as string,
              { year: "numeric", month: "short", day: "numeric" },
              "N/A"
            )}
          </span>
        ),
      },
    ];
  }, []);

  const columns = useMemo(
    () =>
      allColumns.map(col => ({ ...col, hidden: hiddenColumns.has(col.name) })),
    [allColumns, hiddenColumns]
  );

  const toggleableColumns = useMemo(
    () => allColumns.filter(col => !ALWAYS_VISIBLE.has(col.name)),
    [allColumns]
  );

  const toggleColumn = useCallback((columnKey: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(columnKey)) next.delete(columnKey);
      else next.add(columnKey);
      return next;
    });
  }, []);

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(0);
  }, []);

  const selection = useMemo<DataTableSelection<Role>>(
    () => ({
      selectedIds,
      isSelectable: role => !isSystemRole(role),
      onToggle: role => toggleSelection(role.id),
      onToggleAll: (rows, allSelected) => {
        const ids = rows.map(r => r.id);
        if (allSelected) deselectAllOnPage(ids);
        else selectAllOnPage(ids);
      },
    }),
    [
      selectedIds,
      isSystemRole,
      toggleSelection,
      deselectAllOnPage,
      selectAllOnPage,
    ]
  );

  const rowActions = useCallback(
    (role: Role): RowAction<Role>[] => [
      {
        id: "edit",
        label: "Edit",
        icon: <Edit className="h-4 w-4" />,
        onSelect: () => handleEdit(role),
      },
      {
        id: "delete",
        label: "Delete",
        icon: <Trash2 className="h-4 w-4" />,
        destructive: true,
        onSelect: () => handleDelete(role),
      },
    ],
    [handleEdit, handleDelete]
  );

  return (
    <div className="space-y-4">
      {selectedCount > 0 && (
        <>
          <BulkActionBar
            selectedCount={selectedCount}
            collection={undefined}
            onDelete={handleBulkDelete}
            onClear={clearSelection}
            itemLabel="role"
          />
          {systemRoleCount > 0 && (
            <Alert>
              {systemRoleCount} system role(s) selected. System roles cannot be
              deleted and will be excluded from bulk operations.
            </Alert>
          )}
        </>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search roles by name"
          isLoading={isLoading}
          className="max-w-sm flex-1 border-border bg-background text-foreground"
        />

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="md"
                className="border-border bg-background text-foreground hover:bg-accent/10"
              >
                <Columns className="h-4 w-4" />
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

      <DataTableView<Role>
        columns={columns}
        rows={roles}
        loading={isLoading}
        rowHref={role =>
          buildRoute(ROUTES.SECURITY_ROLES_EDIT, { id: role.id })
        }
        primaryColumn="roleName"
        selection={selection}
        rowActions={rowActions}
        registryKey="roles"
        ariaLabel="Roles table"
        emptyMessage={
          search
            ? "No roles found. Try adjusting your search."
            : "No roles available. Create your first role to get started."
        }
      />

      {data && data.meta.totalPages > 0 && (
        <Pagination
          currentPage={page}
          totalPages={data.meta.totalPages}
          pageSize={pageSize}
          pageSizeOptions={[10, 25, 50]}
          onPageChange={setPage}
          onPageSizeChange={handlePageSizeChange}
          isLoading={isLoading}
          totalItems={data.meta.total}
        />
      )}

      <RoleDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        role={roleToDelete}
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />

      <BulkDeleteDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={setBulkDeleteDialogOpen}
        entityType="Role"
        entityTypePlural="Roles"
        items={roles
          .filter(r => selectedIds.includes(r.id) && r.type !== "System")
          .map(r => ({
            id: r.id,
            name: r.roleName,
            secondary: r.description || "No description",
          }))}
        onConfirm={handleConfirmBulkDelete}
        isLoading={isBulkDeleting}
      />
    </div>
  );
}
