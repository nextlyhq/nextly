"use client";

/**
 * ApiKeyTable
 *
 * Lists API keys with client-side search, pagination, and column visibility.
 * Clicking a row opens the edit dialog for active keys; per-row actions cover
 * edit and revoke. Revoked keys are read-only (no row click, no actions).
 */

import {
  Skeleton,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import type React from "react";
import { useCallback, useMemo, useState, useEffect } from "react";

import { SettingsTableToolbar } from "@admin/components/features/settings";
import { AlertTriangle, Columns, Edit, Trash2 } from "@admin/components/icons";
import { Pagination } from "@admin/components/shared/pagination";
import { SearchBar } from "@admin/components/shared/search-bar";
import { DataTableView } from "@admin/components/ui/table/data-table";
import type {
  NextlyColumn,
  RowAction,
} from "@admin/components/ui/table/data-table";
import type { ApiKeyMeta } from "@admin/services/apiKeyApi";

// ============================================================
// Types
// ============================================================

export interface ApiKeyTableProps {
  data: ApiKeyMeta[];
  isLoading?: boolean;
  onEdit: (key: ApiKeyMeta) => void;
  onRevoke: (key: ApiKeyMeta) => void;
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
}) => {
  const [search, setSearch] = useState("");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const toggleColumn = (key: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(0);
  }, []);

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
          <code className="rounded-none bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
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

  const columns = useMemo(
    () =>
      allColumns.map(col => ({ ...col, hidden: hiddenColumns.has(col.name) })),
    [allColumns, hiddenColumns]
  );

  const toggleableColumns = useMemo(
    () => allColumns.filter(col => !ALWAYS_VISIBLE.has(col.name)),
    [allColumns]
  );

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
    setPage(0);
  }, [search]);

  const rowActions = useCallback(
    (key: ApiKeyMeta): RowAction<ApiKeyMeta>[] => {
      if (!key.isActive) return [];
      return [
        {
          id: "edit",
          label: "Edit",
          icon: <Edit className="h-4 w-4" />,
          onSelect: () => onEdit(key),
        },
        {
          id: "revoke",
          label: "Revoke",
          icon: <Trash2 className="h-4 w-4" />,
          destructive: true,
          onSelect: () => onRevoke(key),
        },
      ];
    },
    [onEdit, onRevoke]
  );

  return (
    <div className="space-y-4">
      <SettingsTableToolbar
        search={
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search API keys by name, description, or role..."
            isLoading={isLoading}
            className="w-full bg-background text-foreground border-input"
          />
        }
        columns={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="md">
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
        }
      />

      {isLoading && data.length === 0 ? (
        <div className="rounded-none border border-border bg-card p-4">
          <Skeleton className="h-50 w-full rounded-none" />
        </div>
      ) : (
        <>
          <DataTableView<ApiKeyMeta>
            columns={columns}
            rows={paginatedData}
            loading={isLoading}
            onRowClick={key => {
              // Only active keys are editable; revoked keys are read-only.
              if (key.isActive) onEdit(key);
            }}
            primaryColumn="name"
            rowActions={rowActions}
            ariaLabel="API keys table"
            emptyMessage="No API keys yet. Create your first key to authenticate programmatic access."
          />

          <Pagination
            currentPage={page}
            totalPages={Math.max(1, totalPages)}
            pageSize={pageSize}
            pageSizeOptions={[10, 25, 50]}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
            totalItems={totalItems}
            isLoading={isLoading}
          />
        </>
      )}
    </div>
  );
};
