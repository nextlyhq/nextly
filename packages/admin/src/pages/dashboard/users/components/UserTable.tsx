"use client";

import type { TableParams } from "@nextlyhq/ui";
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
  Skeleton,
} from "@nextlyhq/ui";
import { Columns, Edit, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BulkActionBar } from "@admin/components/features/entries/EntryList/BulkActionBar";
import { UserDeleteDialog } from "@admin/components/features/user-dialog";
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
// Custom field cell renderer
// ============================================================================

/**
 * Renders a user custom-field value with type-appropriate formatting:
 * checkbox -> Yes/No badge, select/radio -> option-label badge, number ->
 * formatted number, date -> formatted date, everything else -> truncated text.
 */
function renderCustomFieldCell(
  value: unknown,
  fieldDef: UserFieldDefinitionRecord
): React.ReactNode {
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
        { year: "numeric", month: "short", day: "numeric" },
        ""
      );
      return <span className="text-sm">{formatted || dateStr}</span>;
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

/** Columns pinned as always-visible in the column toggle. */
const ALWAYS_VISIBLE = new Set(["name"]);

/**
 * UserTable
 *
 * Lists users with search, server-side pagination, dynamic custom-field columns,
 * column visibility, whole-row navigation to the edit page, per-row actions, and
 * bulk delete. Data + mutations run through TanStack Query so the list stays in
 * sync after edits and deletes; rendering is delegated to the unified
 * DataTableView.
 */
export default function UserTable() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [roleFilter] = useState<string>("all");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  // Single + bulk delete dialog state.
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<{
    id: string;
    name: string;
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

  const { data: fieldsData } = useUserFields();
  const debouncedSearch = useDebouncedValue(search, 500);

  // Reset to the first page when the search term changes so a later page does not
  // request out-of-range results and show a false empty state.
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch]);

  const params: TableParams = {
    pagination: { page, pageSize },
    sorting: [],
    filters: { search: debouncedSearch },
  };

  const { data, isLoading, isError, error, isFetching } = useUsers(params);

  // Client-side role filter until the API supports it.
  const filteredData = useMemo(() => {
    if (!data?.items) return [];
    return data.items.filter(user => {
      if (roleFilter !== "all") {
        return user.roles.some(role => role.id === roleFilter);
      }
      return true;
    });
  }, [data?.items, roleFilter]);

  const { mutate: deleteUser, isPending: isDeleting } = useDeleteUser();
  const { mutate: bulkDeleteUsers } = useBulkDeleteUsers();

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

  const handleBulkDelete = () => setBulkDeleteDialogOpen(true);

  const handleConfirmBulkDelete = () => {
    void bulkDeleteUsers(selectedIds, undefined, {
      onSuccess: result => {
        if (result.failed === 0) {
          toast.success("Users deleted", {
            description: `${result.succeeded} users deleted successfully.`,
          });
        } else {
          toast.warning("Partially completed", {
            description: `${result.succeeded} users deleted, ${result.failed} failed. Check console for details.`,
          });
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
        console.error("Failed to delete users:", result.failedIds);
      },
    });
  };

  // Dynamic custom-field columns from the admin list config.
  const customColumns = useMemo((): NextlyColumn<UserApiResponse>[] => {
    if (!fieldsData?.fields || !fieldsData.adminConfig?.listFields) return [];
    const activeFieldMap = new Map<string, UserFieldDefinitionRecord>(
      fieldsData.fields.filter(f => f.isActive).map(f => [f.name, f])
    );
    const cols: NextlyColumn<UserApiResponse>[] = [];
    for (const fieldName of fieldsData.adminConfig.listFields) {
      const fieldDef = activeFieldMap.get(fieldName);
      if (!fieldDef) continue;
      cols.push({
        name: fieldName,
        header: fieldDef.label,
        hideOnMobile: true,
        cell: ({ row }) => renderCustomFieldCell(row[fieldName], fieldDef),
      });
    }
    return cols;
  }, [fieldsData]);

  const allColumns = useMemo((): NextlyColumn<UserApiResponse>[] => {
    return [
      {
        name: "name",
        header: "NAME",
        cell: ({ row }) => {
          const initial = row.name.split(" ")[0].charAt(0).toUpperCase();
          return (
            <div className="flex items-center gap-3">
              <Avatar className="w-9 rounded-none">
                <AvatarImage src={row.image} alt={row.name} />
                <AvatarFallback className="rounded-none bg-muted text-foreground">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">
                  {row.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {row.email}
                </span>
              </div>
            </div>
          );
        },
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
        name: "roles",
        header: "ROLE",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2 text-left">
            {row.roles.length > 0 ? (
              row.roles.map(role => (
                <Badge
                  key={role.id}
                  variant="default"
                  className="capitalize shadow-none"
                >
                  {role.name}
                </Badge>
              ))
            ) : (
              <Badge
                variant="default"
                className="font-normal text-muted-foreground"
              >
                No role
              </Badge>
            )}
          </div>
        ),
      },
      ...customColumns,
      {
        name: "createdAt",
        header: "CREATED",
        hideOnMobile: true,
        cell: ({ value }) => (
          <span className="text-sm">
            {formatDate(value as string | undefined)}
          </span>
        ),
      },
    ];
  }, [customColumns, formatDate]);

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

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(0);
  };

  // Controlled selection wired to the page-level selection hook.
  const selection = useMemo<DataTableSelection<UserApiResponse>>(
    () => ({
      selectedIds,
      onToggle: user => toggleSelection(user.id),
      onToggleAll: (rows, allSelected) => {
        const ids = rows.map(r => r.id);
        if (allSelected) deselectAllOnPage(ids);
        else selectAllOnPage(ids);
      },
    }),
    [selectedIds, toggleSelection, deselectAllOnPage, selectAllOnPage]
  );

  const rowActions = useCallback(
    (user: UserApiResponse): RowAction<UserApiResponse>[] => [
      {
        id: "edit",
        label: "Edit",
        icon: <Edit className="h-4 w-4" />,
        onSelect: () => handleEdit(user),
      },
      {
        id: "delete",
        label: "Delete",
        icon: <Trash2 className="h-4 w-4" />,
        destructive: true,
        onSelect: () => handleDelete(user),
      },
    ],
    [handleEdit, handleDelete]
  );

  const showLoadingSkeleton = isLoading || (isFetching && !data);

  return (
    <div className="space-y-4">
      {selectedCount > 0 && (
        <BulkActionBar
          selectedCount={selectedCount}
          collection={undefined}
          onDelete={handleBulkDelete}
          onClear={clearSelection}
          itemLabel="user"
        />
      )}

      {/* Search + column visibility */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search users by name or email"
          isLoading={isFetching}
          className="max-w-sm flex-1 border-border bg-background text-foreground"
        />

        <div className="flex items-center gap-2">
          {showLoadingSkeleton ? (
            <Skeleton className="h-9 w-25" />
          ) : (
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
          )}
        </div>
      </div>

      {isError ? (
        <Alert variant="destructive">
          {error instanceof Error
            ? error.message
            : "Failed to load users. Please try again."}
        </Alert>
      ) : (
        <DataTableView<UserApiResponse>
          columns={columns}
          rows={filteredData}
          loading={showLoadingSkeleton}
          rowHref={user => buildRoute(ROUTES.USERS_EDIT, { id: user.id })}
          primaryColumn="name"
          selection={selection}
          rowActions={rowActions}
          registryKey="users"
          ariaLabel="Users table"
          emptyMessage={
            search || roleFilter !== "all"
              ? "No users found. Try adjusting your search or filters."
              : "No users available."
          }
        />
      )}

      {data && data.meta.totalPages > 0 && (
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
      )}

      <UserDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        user={userToDelete}
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />

      <BulkDeleteDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={setBulkDeleteDialogOpen}
        users={filteredData
          .filter(user => selectedIds.includes(user.id))
          .map(user => ({ id: user.id, name: user.name, email: user.email }))}
        onConfirm={handleConfirmBulkDelete}
      />
    </div>
  );
}
