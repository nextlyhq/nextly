"use client";

/**
 * WebhookTable — lists webhook endpoints with client-side search and
 * pagination (the endpoints list is a single page from the server). Per-row
 * actions cover edit, enable/disable, test, and delete; the parent owns the
 * mutations and passes handlers in.
 */

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Edit, Power, Send, Trash2 } from "@admin/components/icons";
import { Pagination } from "@admin/components/shared/pagination";
import { SearchBar } from "@admin/components/shared/search-bar";
import { DataTableView } from "@admin/components/ui/table/data-table";
import type {
  NextlyColumn,
  RowAction,
} from "@admin/components/ui/table/data-table";
import type { WebhookEndpointSummary } from "@admin/types/webhooks";

import { EndpointStatusBadge, describeEvents } from "./status";

export interface WebhookTableProps {
  data: WebhookEndpointSummary[];
  isLoading?: boolean;
  /** Update permission gates Edit, Enable/Disable, and Test (and row-click nav). */
  canUpdate: boolean;
  /** Delete permission gates the Delete action. */
  canDelete: boolean;
  onEdit: (webhook: WebhookEndpointSummary) => void;
  onToggleEnabled: (webhook: WebhookEndpointSummary) => void;
  onTest: (webhook: WebhookEndpointSummary) => void;
  onDelete: (webhook: WebhookEndpointSummary) => void;
}

export const WebhookTable: React.FC<WebhookTableProps> = ({
  data,
  isLoading = false,
  canUpdate,
  canDelete,
  onEdit,
  onToggleEnabled,
  onTest,
  onDelete,
}) => {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const handlePageSizeChange = useCallback((next: number) => {
    setPageSize(next);
    setPage(0);
  }, []);

  // Reset to the first page whenever the search term changes.
  useEffect(() => {
    setPage(0);
  }, [search]);

  const columns = useMemo(
    (): NextlyColumn<WebhookEndpointSummary>[] => [
      {
        name: "name",
        header: "Name",
        cell: ({ row }) => (
          <span className="font-medium text-foreground">{row.name}</span>
        ),
      },
      {
        name: "url",
        header: "Payload URL",
        cell: ({ row }) => (
          <span
            className="block max-w-80 truncate text-sm text-muted-foreground"
            title={row.url}
          >
            {row.url}
          </span>
        ),
      },
      {
        name: "enabled",
        header: "Status",
        cell: ({ row }) => <EndpointStatusBadge enabled={row.enabled} />,
      },
      {
        name: "eventTypes",
        header: "Events",
        hideOnMobile: true,
        cell: ({ row }) => (
          <span
            className="text-sm text-muted-foreground"
            title={row.eventTypes.join(", ")}
          >
            {describeEvents(row.eventTypes)}
          </span>
        ),
      },
      {
        name: "secretPrefix",
        header: "Secret",
        hideOnMobile: true,
        cell: ({ row }) => (
          <code className="rounded-none bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
            {row.secretPrefix}
            {"•".repeat(6)}
          </code>
        ),
      },
      {
        name: "createdAt",
        header: "Created",
        hideOnMobile: true,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {new Date(row.createdAt).toLocaleDateString()}
          </span>
        ),
      },
    ],
    []
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data;
    return data.filter(webhook =>
      `${webhook.name} ${webhook.url}`.toLowerCase().includes(term)
    );
  }, [data, search]);

  const paginated = useMemo(() => {
    const start = page * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / pageSize);

  const rowActions = useCallback(
    (webhook: WebhookEndpointSummary): RowAction<WebhookEndpointSummary>[] => {
      const actions: RowAction<WebhookEndpointSummary>[] = [];
      if (canUpdate) {
        actions.push(
          {
            id: "edit",
            label: "Edit",
            icon: <Edit className="h-4 w-4" />,
            onSelect: () => onEdit(webhook),
          },
          {
            id: "toggle",
            label: webhook.enabled ? "Disable" : "Enable",
            icon: <Power className="h-4 w-4" />,
            onSelect: () => onToggleEnabled(webhook),
          },
          {
            id: "test",
            label: "Send test event",
            icon: <Send className="h-4 w-4" />,
            onSelect: () => onTest(webhook),
          }
        );
      }
      if (canDelete) {
        actions.push({
          id: "delete",
          label: "Delete",
          icon: <Trash2 className="h-4 w-4" />,
          destructive: true,
          onSelect: () => onDelete(webhook),
        });
      }
      return actions;
    },
    [canUpdate, canDelete, onEdit, onToggleEnabled, onTest, onDelete]
  );

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search endpoints by name or URL..."
          isLoading={isLoading}
          className="w-full bg-background text-foreground border-input"
        />
      </div>

      <DataTableView<WebhookEndpointSummary>
        columns={columns}
        rows={paginated}
        loading={isLoading}
        getRowId={row => row.id}
        onRowClick={canUpdate ? onEdit : undefined}
        primaryColumn="name"
        rowActions={rowActions}
        registryKey="webhooks"
        ariaLabel="Webhook endpoints table"
        emptyMessage="No webhook endpoints yet. Create one to start receiving events."
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
    </div>
  );
};
