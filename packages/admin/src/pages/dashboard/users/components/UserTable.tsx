import type { Column, TableParams } from "@revnixhq/ui";
import {
  Alert,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ResponsiveTable,
  Skeleton,
  TableSkeleton,
} from "@revnixhq/ui";
import { Columns } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { BulkActionBar } from "@admin/components/features/entries/EntryList/BulkActionBar";
import { UserDeleteDialog } from "@admin/components/features/user-dialog";
import { BulkDeleteDialog } from "@admin/components/shared/bulk-action-dialogs";
import { BulkSelectCheckbox } from "@admin/components/shared/bulk-select-checkbox";
import { Pagination } from "@admin/components/shared/pagination";
import { SearchBar } from "@admin/components/shared/search-bar";
import { toast } from "@admin/components/ui";
import { ActionColumn } from "@admin/components/ui/table/ActionColumn";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useUserFields } from "@admin/hooks/queries/useUserFields";
import {
  useUsers,
  useDeleteUser,
  useBulkDeleteUsers,
} from "@admin/hooks/queries/useUsers";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import { useRowSelection } from "@admin/hooks/useRowSelection";
import { navigateTo } from "@admin/lib/navigation";
import type { UserFieldDefinitionRecord } from "@admin/services/userFieldsApi";
import type { UserApiResponse } from "@admin/types/user";

// ============================================================================
// Custom Field Cell Renderer
// ============================================================================

/**
 * Renders a custom field value with type-appropriate formatting.
 * - text/email/textarea → plain text (truncated)
 * - number → formatted number
 * - checkbox → Yes/No badge
 * - select/radio → badge with option label
 * - date → formatted date
 */
function renderCustomFieldCell(
  value: unknown,
  fieldDef: UserFieldDefinitionRecord
): React.ReactNode {
  // Null/undefined → dash
  if (value === null || value === undefined || value === "") {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  switch (fieldDef.type) {
    case "checkbox": {
      const isChecked =
        value === true || value === "true" || value === 1 || value === "1";
      return (
        <Badge variant={isChecked ? "success" : "default"}>
          {isChecked ? "Yes" : "No"}
        </Badge>
      );
    }

    case "select":
    case "radio": {
      // Try to find the matching option label
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const strValue = String(value);
      const option = fieldDef.options?.find(o => o.value === strValue);
      return <Badge variant="default">{option?.label ?? strValue}</Badge>;
    }

    case "number": {
      const num = Number(value);
      return (
        <span className="text-sm tabular-nums">
          {/* eslint-disable-next-line @typescript-eslint/no-base-to-string */}
          {Number.isNaN(num) ? String(value) : num.toLocaleString()}
        </span>
      );
    }

    case "date": {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const dateStr = String(value);
      const formatted = formatDateWithAdminTimezone(
        dateStr,
        {
          year: "numeric",
          month: "short",
          day: "numeric",
        },
        ""
      );
      if (!formatted) {
        return <span className="text-sm">{dateStr}</span>;
      }
      return <span className="text-sm">{formatted}</span>;
    }

    case "text":
    case "email":
    case "textarea":
    default: {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const text = String(value);
      const truncated = text.length > 50 ? `${text.slice(0, 50)}...` : text;
      return <span className="text-sm">{truncated}</span>;
    }
  }
}

/**
 * UserTable Component
 *
 * Displays a responsive table/card view of users with search, pagination, sorting, CRUD actions,
 * and bulk operations (assign role, delete, enable/disable, export).
 * Uses TanStack Query for data fetching and ResponsiveTable for mobile responsiveness.
 *
 * ## Features
 * - Mobile responsive: Card view (< 768px), table view (≥ 768px)
 * - Search users by name or email (debounced 300ms)
 * - Server-side pagination (10/25/50 rows per page)
 * - Sorting by name or created date
 * - CRUD actions: View, Edit, Delete
 * - **Bulk operations**: Select multiple users, assign role, delete, enable/disable, export CSV
 * - Loading states: Skeleton on initial load, spinner during search
 * - Error states: Alert component for API failures
 * - Empty states: "No users found" message
 *
 * ## TanStack Query Integration
 * - useUsers: Fetches paginated user list with auto-caching
 * - useDeleteUser: Deletes user with automatic cache invalidation
 * - No manual state management for data (TanStack Query handles it)
 *
 * ## Bulk Operations
 * - BulkSelectCheckbox: Checkbox in first column for row selection
 * - BulkSelectCheckbox: Checkbox in first column for row selection
 * - BulkActionBar: Top bulk action bar with selection count, delete, and clear
 * - useRowSelection: Custom hook for selection state management
 *
 * @example
 * ```tsx
 * <UserTable />
 * ```
 */
const ALWAYS_VISIBLE = new Set(["email", "actions", "name", "id"]);

export default function UserTable() {
  // Pagination state
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  // Search state
  const [search, setSearch] = useState("");

  // Filter state
  const [roleFilter, setRoleFilter] = useState<string>("all");

  // Delete dialog state (single user)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Bulk delete dialog state
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  // Bulk selection state (NEW)
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

  // TanStack Query: Fetch user field definitions (for dynamic columns)
  const { data: fieldsData } = useUserFields();

  // Debounced search term to prevent rapid API calls
  const debouncedSearch = useDebouncedValue(search, 500);

  // TanStack Query: Fetch users
  const params: TableParams = {
    pagination: { page, pageSize },
    sorting: [], // Sorting can be added later if needed
    filters: { search: debouncedSearch },
  };

  const { data, isLoading, isError, error, isFetching } = useUsers(params);

  // Filter data client-side (until API supports these filters)
  const filteredData = useMemo(() => {
    if (!data?.data) return [];

    return data.data.filter(user => {
      // Filter by role
      if (roleFilter !== "all") {
        const hasRole = user.roles.some(role => role.id === roleFilter);
        if (!hasRole) return false;
      }
      return true;
    });
  }, [data?.data, roleFilter]);

  // TanStack Query: Delete user mutation
  const { mutate: deleteUser, isPending: isDeleting } = useDeleteUser();

  // TanStack Query: Bulk mutations
  const { mutate: bulkDeleteUsers } = useBulkDeleteUsers();

  // Action handlers
  const handleEdit = useCallback((user: UserApiResponse) => {
    navigateTo(buildRoute(ROUTES.USERS_EDIT, { id: user.id }));
  }, []);

  const handleDelete = useCallback((user: UserApiResponse) => {
    setUserToDelete({ id: user.id, name: user.name });
    setDeleteDialogOpen(true);
  }, []);

  const handleConfirmDelete = () => {
    if (!userToDelete) return;

    deleteUser(userToDelete.id, {
      onSuccess: () => {
        toast.success("User deleted", {
          description: `${userToDelete.name} has been deleted successfully.`,
        });
        setDeleteDialogOpen(false);
        setUserToDelete(null);
      },
      onError: err => {
        toast.error("Delete failed", {
          description:
            err instanceof Error ? err.message : "Failed to delete the user.",
        });
      },
    });
  };

  // Format date helper
  const formatDate = useCallback((dateValue?: string) => {
    return formatDateWithAdminTimezone(
      dateValue,
      {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      },
      "N/A"
    );
  }, []);

  // Bulk operation handlers (NEW)
  const usersOnPage = filteredData || [];
  const pageUserIds = usersOnPage.map(u => u.id);
  const selectedOnPage = getSelectedCountOnPage(pageUserIds);
  const _totalUsers = data?.meta.total || 0;

  // Determine "select all on page" checkbox state
  const selectAllCheckboxState: boolean | "indeterminate" =
    selectedOnPage === 0
      ? false
      : selectedOnPage === pageUserIds.length
        ? true
        : "indeterminate";

  // Debounced search term to prevent rapid API calls

  // Column visibility state
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  // Handler: Toggle "select all on page"
  const handleToggleSelectAllOnPage = useCallback(() => {
    if (selectedOnPage === pageUserIds.length) {
      // All selected → Deselect all on page
      deselectAllOnPage(pageUserIds);
    } else {
      // Some or none selected → Select all on page
      selectAllOnPage(pageUserIds);
    }
  }, [selectedOnPage, pageUserIds, deselectAllOnPage, selectAllOnPage]);

  // Handler: Bulk delete users (shows confirmation dialog)
  const handleBulkDelete = () => {
    setBulkDeleteDialogOpen(true);
  };

  // Handler: Confirm bulk delete (after dialog confirmation)
  const handleConfirmBulkDelete = () => {
    const selectedUserIds = Array.from(selectedIds);

    void bulkDeleteUsers(selectedUserIds, undefined, {
      onSuccess: result => {
        if (result.failed === 0) {
          toast.success("Users deleted", {
            description: `${result.succeeded} users deleted successfully.`,
          });
        } else {
          toast.warning("Partially completed", {
            description: `${result.succeeded} users deleted, ${result.failed} failed. Check console for details.`,
          });
          // Log failed IDs for debugging
          console.error("Failed to delete users:", result.failedIds);
        }
        setBulkDeleteDialogOpen(false);
        clearSelection();
      },
      onError: result => {
        toast.error("Deletion failed", {
          description:
            result.failed === 1
              ? "Failed to delete 1 user."
              : `Failed to delete ${result.failed} users. Check console for details.`,
        });
        // Log failed IDs for debugging
        console.error("Failed to delete users:", result.failedIds);
      },
    });
  };

  // Build custom field columns from listFields config
  const customColumns = useMemo((): Column<UserApiResponse>[] => {
    if (!fieldsData?.fields || !fieldsData.adminConfig?.listFields) {
      return [];
    }

    const { listFields: configListFields } = fieldsData.adminConfig;
    const activeFieldMap = new Map<string, UserFieldDefinitionRecord>(
      fieldsData.fields.filter(f => f.isActive).map(f => [f.name, f])
    );

    const cols: Column<UserApiResponse>[] = [];
    for (const fieldName of configListFields) {
      const fieldDef = activeFieldMap.get(fieldName);
      if (!fieldDef) continue;

      cols.push({
        key: fieldName,
        label: fieldDef.label,
        hideOnMobile: true,
        render: (_value: unknown, user: UserApiResponse) =>
          renderCustomFieldCell(user[fieldName], fieldDef),
      });
    }
    return cols;
  }, [fieldsData]);

  // ResponsiveTable columns — custom columns inserted between Role and Created
  const columns: Column<UserApiResponse>[] = useMemo(
    () => [
      // Checkbox column for bulk selection
      {
        key: "email",
        label: (
          <BulkSelectCheckbox
            checked={selectAllCheckboxState}
            onCheckedChange={handleToggleSelectAllOnPage}
            rowId="select-all"
            rowLabel="Select all users on page"
          />
        ),
        render: (_value, user) => (
          <BulkSelectCheckbox
            checked={isSelected(user.id)}
            onCheckedChange={() => toggleSelection(user.id)}
            rowId={user.id}
            rowLabel={user.name}
          />
        ),
      },
      {
        key: "name",
        label: "NAME",
        render: (value, user) => {
          const firstName = user.name.split(" ")[0];
          const initial = firstName.charAt(0).toUpperCase();
          return (
            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9 rounded-full">
                <AvatarImage src={user.image} alt={user.name} />
                <AvatarFallback className="rounded-full bg-black/20 text-black">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 flex flex-col">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      handleEdit(user);
                    }}
                    className="font-medium text-sm text-foreground truncate text-left cursor-pointer"
                  >
                    {user.name}
                  </button>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {user.email}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        key: "id",
        label: "ID",
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
        key: "roles",
        label: "ROLE",
        render: roles => (
          <div className="flex gap-2 flex-wrap text-left">
            {Array.isArray(roles) && roles.length > 0 ? (
              roles.map(role => {
                const lowerName = role.name.toLowerCase();
                let badgeVariant:
                  | "default"
                  | "destructive"
                  | "warning"
                  | "primary"
                  | "success"
                  | "outline" = "default";

                if (lowerName.includes("admin")) {
                  badgeVariant = "destructive";
                } else if (lowerName.includes("manager")) {
                  badgeVariant = "warning";
                } else if (lowerName.includes("editor")) {
                  badgeVariant = "primary";
                } else if (
                  lowerName.includes("user") ||
                  lowerName.includes("viewer")
                ) {
                  badgeVariant = "success";
                }

                return (
                  <Badge
                    key={role.id}
                    variant={badgeVariant}
                    className="capitalize shadow-none"
                  >
                    {role.name}
                  </Badge>
                );
              })
            ) : (
              <Badge
                variant="default"
                className="text-muted-foreground font-normal"
              >
                No role
              </Badge>
            )}
          </div>
        ),
      },
      // Dynamic custom field columns (inserted between Role and Created)
      ...customColumns,
      {
        key: "createdAt",
        label: "CREATED",
        hideOnMobile: true, // Hide on mobile to save space
        render: createdAt => (
          <span className="text-sm">
            {formatDate(createdAt as string | undefined)}
          </span>
        ),
      },
      {
        key: "actions" as keyof UserApiResponse,
        label: "ACTIONS",
        render: (_, user) => (
          <div className="flex justify-center">
            <ActionColumn
              item={user}
              callbacks={{
                onEdit: handleEdit,
                onDelete: handleDelete,
              }}
            />
          </div>
        ),
      },
    ],
    [
      selectAllCheckboxState,
      handleToggleSelectAllOnPage,
      isSelected,
      toggleSelection,
      customColumns,
      formatDate,
      handleEdit,
      handleDelete,
    ]
  );

  // Combine columns and handle visibility
  const allColumns = useMemo(
    () => [
      ...columns.slice(0, 4), // email/select, name, id, roles
      ...customColumns,
      ...columns.slice(columns.length - 2), // createdAt, actions
    ],
    [columns, customColumns]
  );

  const visibleColumns = useMemo(
    () => allColumns.filter(col => !hiddenColumns.has(String(col.key))),
    [allColumns, hiddenColumns]
  );

  const toggleableColumns = useMemo(
    () => allColumns.filter(col => !ALWAYS_VISIBLE.has(String(col.key))),
    [allColumns]
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
  const _handleRoleFilterChange = (value: string) => {
    setRoleFilter(value);
    setPage(0);
  };

  // Handle page size change (reset to first page)
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(0);
  };

  // Handlers for error and loading states within the unified layout
  const showLoadingSkeleton = isLoading || (isFetching && !data);

  // Render table with data
  return (
    <div className="space-y-4">
      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <BulkActionBar
          selectedCount={selectedCount}
          collection={undefined}
          onDelete={handleBulkDelete}
          onClear={clearSelection}
          itemLabel="user"
        />
      )}

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search users by name or email"
            isLoading={isFetching}
            className="flex-1 max-w-sm"
          />
        </div>

        {/* Right: Filters & Column visibility */}
        <div className="flex items-center gap-2">
          {showLoadingSkeleton ? (
            <>
              <Skeleton className="h-9 w-[80px]" />
              <Skeleton className="h-9 w-[100px]" />
            </>
          ) : (
            /* Columns Dropdown */
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
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
                    {typeof col.label === "string"
                      ? col.label
                      : String(col.key)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Responsive table and Pagination Card */}
      <div className="table-wrapper rounded-md border border-border bg-card overflow-hidden">
        {isError ? (
          <div className="p-8">
            <Alert variant="destructive">
              {error instanceof Error
                ? error.message
                : "Failed to load users. Please try again."}
            </Alert>
          </div>
        ) : showLoadingSkeleton ? (
          <TableSkeleton columns={6} rowCount={pageSize} />
        ) : (
          <ResponsiveTable
            data={filteredData}
            columns={visibleColumns}
            emptyMessage={
              search || roleFilter !== "all"
                ? "No users found. Try adjusting your search or filters."
                : "No users available."
            }
            ariaLabel="Users table"
            tableWrapperClassName="border-0 rounded-none shadow-none"
          />
        )}

        {/* Pagination */}
        {data && data.meta.totalPages > 0 && (
          <div className="table-footer border-t border-border p-4">
            <Pagination
              currentPage={page}
              totalPages={data.meta.totalPages}
              totalItems={data.meta.total}
              pageSize={pageSize}
              pageSizeOptions={[10, 25, 50]}
              onPageChange={setPage}
              onPageSizeChange={handlePageSizeChange}
              isLoading={isLoading}
            />
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <UserDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        user={userToDelete}
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />

      {/* Bulk delete confirmation dialog */}
      <BulkDeleteDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={setBulkDeleteDialogOpen}
        users={
          filteredData
            .filter(user => selectedIds.includes(user.id))
            .map(user => ({
              id: user.id,
              name: user.name,
              email: user.email,
            })) || []
        }
        onConfirm={handleConfirmBulkDelete}
      />
    </div>
  );
}
