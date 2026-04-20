"use client";

/**
 * ApiKeyTable
 *
 * Displays the list of API keys in a responsive table. Handles loading/error/empty
 * states and exposes callbacks to open the Edit and Revoke dialogs.
 *
 * Columns:
 *   Name | Type | Key | Expires | Last Used | Status | Actions
 */

import type { Column } from "@revnixhq/ui";
import {
  Skeleton,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  ResponsiveTable,
  TableSkeleton,
} from "@revnixhq/ui";
import React, { useCallback, useMemo, useState } from "react";

import {
  AlertTriangle,
  Columns,
  Edit,
  Loader2,
  MoreHorizontal,
  Trash2,
  Filter,
} from "@admin/components/icons";
import { SearchBar } from "@admin/components/shared/search-bar";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { navigateTo } from "@admin/lib/navigation";
import type { ApiKeyMeta } from "@admin/services/apiKeyApi";

// ============================================================
// Types
// ============================================================

export interface ApiKeyTableProps {
  data: ApiKeyMeta[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onEdit: (key: ApiKeyMeta) => void;
  onRevoke: (key: ApiKeyMeta) => void;
}

// ============================================================
// Helpers
// ============================================================

type KeyStatus = "active" | "expired" | "revoked";

type StatusFilter = "all" | KeyStatus;

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

/** Returns the type badge label and className (color override). */
function getTypeBadgeProps(key: ApiKeyMeta): {
  label: string;
  variant: "primary" | "warning" | "default";
  className?: string;
  hasWarning?: boolean;
} {
  switch (key.tokenType) {
    case "read-only":
      return { label: "Read-only", variant: "default" };
    case "full-access":
      return { label: "Full access", variant: "warning" };
    case "role-based": {
      if (key.role === null) {
        return {
          label: "Role-based: (role deleted)",
          variant: "default",
          className:
            "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-100",
          hasWarning: true,
        };
      }
      return {
        label: `Role-based: ${key.role.name}`,
        variant: "default",
        className:
          "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-100",
      };
    }
  }
}

// ============================================================
// Component
// ============================================================

export const ApiKeyTable: React.FC<ApiKeyTableProps> = ({
  data,
  isLoading,
  isError,
  error,
  onEdit,
  onRevoke,
}) => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  const toggleColumn = (key: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleEdit = useCallback((key: ApiKeyMeta) => onEdit(key), [onEdit]);
  const handleRevoke = useCallback(
    (key: ApiKeyMeta) => onRevoke(key),
    [onRevoke]
  );

  // Toggleable columns (exclude actions)
  const ALWAYS_VISIBLE = new Set(["actions"]);

  const columnDefs: Column<ApiKeyMeta>[] = [
    {
      key: "name",
      label: "Name",
      render: (_value, key) => (
        <div>
          <span className="font-medium">{key.name}</span>
          {key.description && (
            <p className="text-xs text-muted-foreground mt-0.5 max-w-[200px] truncate">
              {key.description}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "tokenType",
      label: "Type",
      render: (_value, key) => {
        const { label, variant, className, hasWarning } =
          getTypeBadgeProps(key);
        return (
          <div className="flex items-center gap-1.5">
            {hasWarning && (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            )}
            <Badge variant={variant} className={className}>
              {label}
            </Badge>
          </div>
        );
      },
    },
    {
      key: "keyPrefix",
      label: "Key",
      render: (_value, key) => (
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
          {key.keyPrefix}
          {"•".repeat(32)}
        </code>
      ),
    },
    {
      key: "expiresAt",
      label: "Expires",
      hideOnMobile: true,
      render: (_value, key) => (
        <span className="text-sm text-muted-foreground">
          {formatRelativeTime(key.expiresAt, "Never")}
        </span>
      ),
    },
    {
      key: "lastUsedAt",
      label: "Last Used",
      hideOnMobile: true,
      render: (_value, key) => (
        <span className="text-sm text-muted-foreground">
          {formatRelativeTime(key.lastUsedAt, "Never")}
        </span>
      ),
    },
    {
      key: "isActive",
      label: "Status",
      render: (_value, key) => {
        const status = getStatus(key);
        if (status === "active") {
          return <Badge variant="success">Active</Badge>;
        }
        if (status === "expired") {
          return <Badge variant="default">Expired</Badge>;
        }
        return <Badge variant="destructive">Revoked</Badge>;
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
      key: "actions" as keyof ApiKeyMeta,
      label: "Actions",
      render: (_value, key) => {
        const isRevoked = !key.isActive;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 w-8 p-0 border border-border"
                disabled={isRevoked}
                title={
                  isRevoked
                    ? "Actions unavailable for revoked key"
                    : "Key actions"
                }
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => handleEdit(key)}
              >
                <Edit className="h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer text-destructive focus:text-destructive"
                onClick={() => handleRevoke(key)}
              >
                <Trash2 className="h-4 w-4" />
                Revoke
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const columns = useMemo(
    () => columnDefs.filter(col => !hiddenColumns.has(String(col.key))),
    [columnDefs, hiddenColumns]
  );

  const toggleableColumns = columnDefs.filter(
    col => !ALWAYS_VISIBLE.has(String(col.key))
  );

  const filteredData = useMemo(() => {
    const term = search.trim().toLowerCase();

    return data.filter(key => {
      // Status filter
      const status = getStatus(key);

      if (statusFilter !== "all" && status !== statusFilter) {
        return false;
      }

      // Search filter
      if (!term) return true;

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
  }, [data, search, statusFilter]);

  // ── Error state ────────────────────────────────────────────
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          {error instanceof Error
            ? error.message
            : "Failed to load API keys. Please try again."}
        </AlertDescription>
      </Alert>
    );
  }

  // ── Loading state ──────────────────────────────────────────
  if (isLoading && data.length === 0) {
    return <TableSkeleton columns={7} rowCount={5} hideWrapper hideFooter />;
  }

  return (
    <div className="space-y-4">
      {/* Search + Filters toolbar (outside table card, like Forms/Entries) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto">
          <div className="flex-1 max-w-md w-full">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search API keys by name, description, or role..."
              isLoading={isLoading}
            />
          </div>
        </div>

        {/* Right: Filters & Column visibility */}
        <div className="flex items-center gap-2">
          {/* Filter Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 relative hover-unified"
              >
                <Filter className="mr-2 h-4 w-4" />
                Filter
                {statusFilter !== "all" && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3 rounded-full bg-primary" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={statusFilter === "all"}
                onCheckedChange={() => setStatusFilter("all")}
              >
                All Status
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={statusFilter === "active"}
                onCheckedChange={() => setStatusFilter("active")}
              >
                Active
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={statusFilter === "expired"}
                onCheckedChange={() => setStatusFilter("expired")}
              >
                Expired
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={statusFilter === "revoked"}
                onCheckedChange={() => setStatusFilter("revoked")}
              >
                Revoked
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Columns Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 hover-unified">
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

      {/* Table card */}
      {isLoading && data.length === 0 ? (
        <div className="table-wrapper rounded-md border border-border bg-card overflow-hidden">
          <div className="p-4 space-y-3">
            <Skeleton className="h-[200px] w-full rounded-md" />
          </div>
        </div>
      ) : (
        <div className="table-wrapper rounded-md border border-border bg-card overflow-hidden">
          <div className="space-y-1">
            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground pb-2 px-6 pt-4">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Refreshing…
              </div>
            )}
            <ResponsiveTable
              data={filteredData}
              columns={columns}
              emptyMessage="No API keys yet. Create your first key to authenticate programmatic access."
              ariaLabel="API keys table"
              tableWrapperClassName="border-0 rounded-none shadow-none"
            />
          </div>
        </div>
      )}
    </div>
  );
};
