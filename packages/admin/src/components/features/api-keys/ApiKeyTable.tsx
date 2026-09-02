"use client";

/**
 * ApiKeyTable
 *
 * Lists API keys with client-side search, pagination, and column visibility.
 * Clicking a row opens the edit dialog for active keys; per-row actions cover
 * edit and revoke. Revoked keys are read-only (no row click, no actions).
 */

import { Skeleton, Badge } from "@nextlyhq/ui";
import type React from "react";
import { useCallback, useMemo, useState, useEffect } from "react";

import { AlertTriangle, Edit, Trash2 } from "@admin/components/icons";
import type {
  NextlyColumn,
  RowAction,
} from "@admin/components/ui/table/data-table";
import {
  ListView,
  useTableColumns,
} from "@admin/components/ui/table/list-view";
import { PAGINATION } from "@admin/constants/pagination";
import { usePagination } from "@admin/hooks/usePagination";
import type { ApiKeyMeta } from "@admin/services/apiKeyApi";

// ============================================================
// Types
// ============================================================

export interface ApiKeyTableProps {
  data: ApiKeyMeta[];
  isLoading?: boolean;
  onEdit: (key: ApiKeyMeta) => void;
  onRevoke: (key: ApiKeyMeta) => void;
  /**
   * Whether this reader may edit a key, and revoke one.
   *
   * Required rather than defaulted: the list is now open to a reader holding
   * only `read-api-keys`, and a default of `true` would leave every call site
   * that forgets these offering actions the endpoint refuses.
   */
  canEdit: boolean;
  canRevoke: boolean;
}

// ============================================================
// Helpers
// ============================================================

type KeyStatus = "active" | "expired" | "revoked";

function getStatus(key: ApiKeyMeta): KeyStatus {
  if (!key.isActive) return "revoked";
  if (key.expiresAt && new Date(key.expiresAt) < new Date()) return "expired";
  return "active";
}

/** Returns a human-readable relative time string. */
function formatRelativeTime(
  isoDate: string | null,
  fallback = "Never"
): string {
  if (!isoDate) return fallback;

  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = then - now;
  const absDiffMs = Math.abs(diffMs);

  const minutes = Math.floor(absDiffMs / 60_000);
  const hours = Math.floor(absDiffMs / 3_600_000);
  const days = Math.floor(absDiffMs / 86_400_000);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  let label: string;
  if (absDiffMs < 60_000) {
    label = "just now";
  } else if (minutes < 60) {
    label = `${minutes} minute${minutes === 1 ? "" : "s"}`;
  } else if (hours < 24) {
    label = `${hours} hour${hours === 1 ? "" : "s"}`;
  } else if (days < 30) {
    label = `${days} day${days === 1 ? "" : "s"}`;
  } else if (months < 12) {
    label = `${months} month${months === 1 ? "" : "s"}`;
  } else {
    label = `${years} year${years === 1 ? "" : "s"}`;
  }

  if (absDiffMs < 60_000) return label; // "just now"
  return diffMs < 0 ? `${label} ago` : `in ${label}`;
}

/** Returns the type badge label plus whether a deleted-role warning applies. */
function getTypeBadge(key: ApiKeyMeta): { label: string; hasWarning: boolean } {
  switch (key.tokenType) {
    case "read-only":
      return { label: "Read-only", hasWarning: false };
    case "full-access":
      return { label: "Full access", hasWarning: false };
    case "role-based":
      return key.role === null
        ? { label: "Role-based: (role deleted)", hasWarning: true }
        : { label: `Role-based: ${key.role.name}`, hasWarning: false };
  }
}

/** Columns pinned as always-visible in the column toggle. */
const ALWAYS_VISIBLE = new Set(["name"]);

// ============================================================
// Component
// ============================================================

export const ApiKeyTable: React.FC<ApiKeyTableProps> = ({
  data,
  isLoading = false,
  onEdit,
  onRevoke,
  canEdit,
  canRevoke,
}) => {
  const [search, setSearch] = useState("");
  const { page, pageSize, setPage, setPageSize, resetPage } = usePagination();

  const allColumns = useMemo((): NextlyColumn<ApiKeyMeta>[] => {
    return [
      {
        name: "name",
        header: "Name",
        cell: ({ row }) => (
          <div>
            <span className="font-medium text-foreground">{row.name}</span>
            {row.description && (
              <p className="mt-0.5 max-w-50 truncate text-xs text-muted-foreground">
                {row.description}
              </p>
            )}
          </div>
        ),
      },
      {
        name: "tokenType",
        header: "Type",
        cell: ({ row }) => {
          const { label, hasWarning } = getTypeBadge(row);
          return (
            <div className="flex items-center gap-1.5">
              {hasWarning && (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <Badge variant="default">{label}</Badge>
            </div>
          );
        },
      },
      {
        name: "keyPrefix",
        header: "Key",
        cell: ({ row }) => (
          <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
            {row.keyPrefix}
            {"•".repeat(32)}
          </code>
        ),
      },
      {
        name: "expiresAt",
        header: "Expires",
        hideOnMobile: true,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatRelativeTime(row.expiresAt, "Never")}
          </span>
        ),
      },
      {
        name: "lastUsedAt",
        header: "Last Used",
        hideOnMobile: true,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatRelativeTime(row.lastUsedAt, "Never")}
          </span>
        ),
      },
      {
        name: "isActive",
        header: "Status",
        cell: ({ row }) => {
          const status = getStatus(row);
          if (status === "active")
            return <Badge variant="success">Active</Badge>;
          if (status === "expired")
            return <Badge variant="default">Expired</Badge>;
          return <Badge variant="destructive">Revoked</Badge>;
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
    ];
  }, []);

  // Resolves persisted column visibility while ensuring pinned API key names remain visible.
  const { columns, columnsControl } = useTableColumns({
    storageKey: "api-keys",
    columns: allColumns,
    alwaysVisible: ALWAYS_VISIBLE,
  });

  const filteredData = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data;
    return data.filter(key => {
      const roleName = key.role?.name ?? "";
      const haystack = [
        key.name,
        key.description ?? "",
        key.keyPrefix,
        key.tokenType,
        roleName,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [data, search]);

  const paginatedData = useMemo(() => {
    const start = page * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, page, pageSize]);

  const totalItems = filteredData.length;
  const totalPages = Math.ceil(totalItems / pageSize);

  // Reset to the first page whenever the search term changes.
  useEffect(() => {
    resetPage();
  }, [search, resetPage]);

  const rowActions = useCallback(
    (key: ApiKeyMeta): RowAction<ApiKeyMeta>[] => {
      if (!key.isActive) return [];
      // Offered only where the endpoint behind them would agree. Editing
      // answers to `update-api-keys`; revoking accepts `delete-api-keys` or
      // that same umbrella.
      const actions: RowAction<ApiKeyMeta>[] = [];
      if (canEdit) {
        actions.push({
          id: "edit",
          label: "Edit",
          icon: <Edit className="h-4 w-4" />,
          onSelect: () => onEdit(key),
        });
      }
      if (canRevoke) {
        actions.push({
          id: "revoke",
          label: "Revoke",
          icon: <Trash2 className="h-4 w-4" />,
          destructive: true,
          onSelect: () => onRevoke(key),
        });
      }
      return actions;
    },
    [onEdit, onRevoke, canEdit, canRevoke]
  );

  return (
    <ListView<ApiKeyMeta>
      search={{
        value: search,
        onChange: setSearch,
        placeholder: "Search API keys by name, description, or role...",
        isLoading,
      }}
      columnsControl={columnsControl}
      skeleton={
        <div className="rounded-lg border border-border bg-card p-4">
          <Skeleton className="h-50 w-full rounded-lg" />
        </div>
      }
      columns={columns}
      rows={paginatedData}
      loading={isLoading}
      onRowClick={
        // The row is a second door to the same edit route, so it answers to
        // the same grant as the Edit item. Without this a read-only viewer
        // opens the editor by clicking the row — or by activating it from the
        // keyboard — and is refused there. Revoked keys are read-only for
        // everyone.
        canEdit
          ? key => {
              if (key.isActive) onEdit(key);
            }
          : undefined
      }
      primaryColumn="name"
      rowActions={rowActions}
      registryKey="api-keys"
      ariaLabel="API keys table"
      emptyMessage="No API keys yet. Create your first key to authenticate programmatic access."
      // Inside the table rather than beside it: only the table knows
      // which of its two views is showing, so only it can place the pager.
      pagination={{
        currentPage: page,
        totalPages: Math.max(1, totalPages),
        pageSize,
        pageSizeOptions: PAGINATION.TABLE_PAGE_SIZE_OPTIONS,
        onPageChange: setPage,
        onPageSizeChange: setPageSize,
        totalItems,
        isLoading,
      }}
    />
  );
};
