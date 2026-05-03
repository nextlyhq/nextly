"use client";

import type { Column, TableParams } from "@revnixhq/ui";
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
  ResponsiveTable,
} from "@revnixhq/ui";
import { Columns, Shield } from "lucide-react";
import { useState, useMemo, useCallback } from "react";

import { BulkActionBar } from "@admin/components/features/entries/EntryList/BulkActionBar";
import { RoleDeleteDialog } from "@admin/components/features/role-management/RoleDeleteDialog";
import { BulkDeleteDialog } from "@admin/components/shared/bulk-action-dialogs";
import { BulkSelectCheckbox } from "@admin/components/shared/bulk-select-checkbox";
import { Pagination } from "@admin/components/shared/pagination";
import { SearchBar } from "@admin/components/shared/search-bar";
import { toast } from "@admin/components/ui";
import { ActionColumn } from "@admin/components/ui/table/ActionColumn";
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

/**
 * RoleTable Component
 *
 * Displays a responsive table/card view of roles with search, pagination, sorting, and CRUD actions.
 * Uses TanStack Query for data fetching and ResponsiveTable for mobile responsiveness.
 *
 * ## Features
 * - Mobile responsive: Card view (< 768px), table view (≥ 768px)
 * - Search roles by name (debounced 300ms)
 * - Server-side pagination (10/25/50 rows per page)
 * - Sorting by name
 * - CRUD actions: View, Edit, Delete
 * - Loading states: Skeleton on initial load, spinner during search
 * - Error states: Alert component for API failures
 * - Empty states: "No roles found" message
 *
 * ## TanStack Query Integration
 * - useRoles: Fetches paginated role list with auto-caching (5 min staleTime)
 * - useDeleteRole: Deletes role with automatic cache invalidation
 * - No manual state management for data (TanStack Query handles it)
 *
 * ## Design System Alignment
 * - Badge variants: System role = outline, Custom role = default, Active = success
 * - Typography: 16px minimum body text (WCAG 2.2 AA)
 * - Touch targets: 44px minimum (WCAG 2.2 AA)
 * - Dark mode: All components support dark mode
 *
 * @example
 * ```tsx
 * <RoleTable />
 * ```
 */
export default function RoleTable() {
  // Pagination state
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  // Search state
  const [search, setSearch] = useState("");

  // Filter state
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Column visibility
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  // Debounced search for API calls
  const debouncedSearch = useDebouncedValue(search, 500);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState<{
    id: string;
    name: string;
    isSystemRole: boolean;
  } | null>(null);

  // Bulk delete dialog state
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  // Row selection state management
  const {
    selectedIds,
    selectedCount,
    toggleSelection,
    clearSelection,
    isSelected,
  } = useRowSelection();

  // Bulk mutation hooks
  const { mutate: bulkDeleteRoles, isPending: isBulkDeleting } =
    useBulkDeleteRoles();

  // TanStack Query: Fetch roles
  const params: TableParams = {
    pagination: { page, pageSize },
    sorting: [], // Sorting can be added later if needed
    filters: { search: debouncedSearch }, // Use debounced search
  };

  const { data, isLoading, _isError, _error } = useRoles(params);

  // Filter data client-side (until API supports these filters)
  const filteredData = useMemo(() => {
    if (!data?.data) return [];

    return data.data.filter(role => {
      // Filter by type
      if (typeFilter !== "all" && role.type !== typeFilter) {
        return false;
      }
      // Filter by status
      if (statusFilter !== "all" && role.status !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [data?.data, typeFilter, statusFilter]);

  // TanStack Query: Delete role mutation
  const { mutate: deleteRole, isPending: isDeleting } = useDeleteRole();

  // Action handlers
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

  // Bulk delete handlers
  const handleBulkDelete = () => {
    if (selectedCount === 0) {
      toast.error("No roles selected");
      return;
    }

    // Filter out system roles from selection
    const selectedRoles =
      data?.data.filter(r => selectedIds.includes(r.id)) || [];
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
    // Filter out system roles before deletion
    const selectedRoles =
      data?.data.filter(r => selectedIds.includes(r.id)) || [];
    const deletableRoleIds = selectedRoles
      .filter(r => r.type !== "System")
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

  // Helper: Check if role is a system role
  const isSystemRole = useCallback((role: Role) => role.type === "System", []);

  // Helper: Get count of system roles in current selection
  const systemRoleCount = useMemo(() => {
    const selectedRoles =
      filteredData.filter(r => selectedIds.includes(r.id)) || [];
    return selectedRoles.filter(r => r.type === "System").length;
  }, [filteredData, selectedIds]);

  // ResponsiveTable columns
  const columnDefs: Column<Role>[] = useMemo(
    () => [
      // Checkbox column for bulk selection (disabled for system roles)
      {
        key: "select" as keyof Role,
        label: "",
        hideOnMobile: true,
        render: (_value, role) => (
          <BulkSelectCheckbox
            checked={isSelected(role.id)}
            onCheckedChange={() => toggleSelection(role.id)}
            disabled={isSystemRole(role)}
            rowId={role.id}
            rowLabel={role.roleName}
          />
        ),
      },
      {
        key: "roleName",
        label: "ROLE NAME",
        render: (_roleName, role) => (
          <div className="flex items-center gap-3">
            <div className="table-row-icon-cover">
              <Shield className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1 flex flex-col">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleEdit(role)}
                  className="font-medium text-sm text-foreground truncate text-left cursor-pointer"
                >
                  {role.roleName}
                </button>
                {role.type === "System" && (
                  <Badge variant="default" className="text-xs">
                    System
                  </Badge>
                )}
              </div>
              {role.subtitle && (
                <div className="text-xs text-muted-foreground truncate">
                  {role.subtitle}
                </div>
              )}
            </div>
          </div>
        ),
      },
      {
        key: "id",
        label: "ID",
        hideOnMobile: true,
        render: id => (
          <span
            className="font-mono text-xs text-muted-foreground"
            title={id as string}
          >
            {(id as string).length > 8
              ? `${(id as string).slice(0, 8)}...`
              : (id as string)}
          </span>
        ),
      },
      {
        key: "description",
        label: "Description",
        hideOnMobile: true, // Hide on mobile to save space
        render: description => (
          <span className="text-sm text-muted-foreground line-clamp-2">
            {description || "No description"}
          </span>
        ),
      },
      {
        key: "permissions",
        label: "Permissions",
        hideOnMobile: true,
        render: permissions => (
          <span className="text-sm text-muted-foreground">
            {Array.isArray(permissions) ? permissions.length : 0} Permissions
          </span>
        ),
      },
      {
        key: "status",
        label: "Status",
        render: status => (
          <Badge variant={status === "Active" ? "success" : "default"}>
            {status}
          </Badge>
        ),
      },
      {
        key: "created",
        label: "Created",
        hideOnMobile: true, // Hide on mobile to save space
        render: created => (
          <span className="text-sm">
            {formatDateWithAdminTimezone(
              created as string,
              {
                year: "numeric",
                month: "short",
                day: "numeric",
              },
              "N/A"
            )}
          </span>
        ),
      },
      {
        key: "actions" as keyof Role,
        label: "Actions",
        render: (_, role) => (
          <div className="flex justify-end">
            <ActionColumn
              item={role}
              callbacks={{
                onEdit: handleEdit,
                onDelete: handleDelete,
              }}
            />
          </div>
        ),
      },
    ],
    [handleEdit, handleDelete, isSelected, toggleSelection, isSystemRole]
  );

  const columns = useMemo(
    () => columnDefs.filter(col => !hiddenColumns.has(String(col.key))),
    [columnDefs, hiddenColumns]
  );

  const ALWAYS_VISIBLE = new Set(["roleName", "actions"]);

  const toggleableColumns = columnDefs.filter(
    col => !ALWAYS_VISIBLE.has(String(col.key))
  );

  const toggleColumn = useCallback((columnKey: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(columnKey)) {
        next.delete(columnKey);
      } else {
        next.add(columnKey);
      }
      return next;
    });
  }, []);

  // Handle filter changes (reset to first page)
  // Handle page size change (reset to first page)
  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(0);
  }, []);

  const _handleTypeFilterChange = useCallback((value: string) => {
    setTypeFilter(value);
    setPage(0);
  }, []);

  const _handleStatusFilterChange = useCallback((value: string) => {
    setStatusFilter(value);
    setPage(0);
  }, []);

  return (
    <div className="space-y-4">
      {/* Bulk selection toolbar */}
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

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search roles by name"
            isLoading={isLoading}
            className="flex-1 max-w-sm bg-white text-black border-primary/5"
          />
        </div>

        {/* Right: Filters & Column visibility */}
        <div className="flex items-center gap-2">
          {/* Columns Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="md">
                <Columns className="mr-2 h-4 w-4" />
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
                  {typeof col.label === "string" ? col.label : String(col.key)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Responsive table */}
      <div className="table-wrapper rounded-none  border border-primary/5 bg-card overflow-hidden">
        <ResponsiveTable
          data={filteredData}
          columns={columns}
          emptyMessage={
            search || typeFilter !== "all" || statusFilter !== "all"
              ? "No roles found. Try adjusting your search or filters."
              : "No roles available. Create your first role to get started."
          }
          ariaLabel="Roles table"
          tableWrapperClassName="border-0 rounded-none shadow-none"
        />
        {data && data.meta.totalPages > 0 && (
          <div className="table-footer border-t border-primary/5 p-4 bg-[hsl(var(--table-header-bg))]">
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
          </div>
        )}
      </div>

      {/* Single delete confirmation dialog */}
      <RoleDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        role={roleToDelete}
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />

      {/* Bulk delete confirmation dialog */}
      {/* Bulk delete confirmation dialog */}
      <BulkDeleteDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={setBulkDeleteDialogOpen}
        entityType="Role"
        entityTypePlural="Roles"
        items={
          filteredData
            .filter(r => selectedIds.includes(r.id) && r.type !== "System")
            .map(r => ({
              id: r.id,
              name: r.roleName,
              secondary: r.description || "No description", // Use description as secondary info
            })) || []
        }
        onConfirm={handleConfirmBulkDelete}
        isLoading={isBulkDeleting}
      />
    </div>
  );
}
