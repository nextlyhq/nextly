"use client";

/**
 * WebhookTable — lists webhook endpoints with client-side search and
 * pagination (the endpoints list is a single page from the server). Per-row
 * actions cover edit, enable/disable, test, and delete; the parent owns the
 * mutations and passes handlers in.
 */

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Edit, List, Power, Send, Trash2 } from "@admin/components/icons";
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
import type { WebhookEndpointSummary } from "@admin/types/webhooks";

import { EndpointStatusBadge, describeEvents } from "./status";

export interface WebhookTableProps {
  data: WebhookEndpointSummary[];
  isLoading?: boolean;
  /** Update permission gates Edit, Enable/Disable, and Test (and row-click nav). */
  canUpdate: boolean;
  /** Delete permission gates the Delete action. */
  canDelete: boolean;
  /** Read (or update) gates the "View deliveries" action. */
  canViewDeliveries: boolean;
  onEdit: (webhook: WebhookEndpointSummary) => void;
  onToggleEnabled: (webhook: WebhookEndpointSummary) => void;
  onTest: (webhook: WebhookEndpointSummary) => void;
  onDelete: (webhook: WebhookEndpointSummary) => void;
  onViewDeliveries: (webhook: WebhookEndpointSummary) => void;
}

/** Columns pinned as always-visible in the column toggle. */
const ALWAYS_VISIBLE = new Set(["name"]);

/** Static column definitions declared at module scope to avoid re-creation on render. */
const WEBHOOK_COLUMNS: NextlyColumn<WebhookEndpointSummary>[] = [
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
      <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
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
];

/** Builds the action items available on each row based on granted permissions. */
function buildWebhookRowActions(
  webhook: WebhookEndpointSummary,
  handlers: Omit<WebhookTableProps, "data" | "isLoading">
): RowAction<WebhookEndpointSummary>[] {
  const actions: RowAction<WebhookEndpointSummary>[] = [];
  if (handlers.canViewDeliveries) {
    actions.push({
      id: "deliveries",
      label: "View deliveries",
      icon: <List className="h-4 w-4" />,
      onSelect: () => handlers.onViewDeliveries(webhook),
    });
  }
  if (handlers.canUpdate) {
    actions.push(
      {
        id: "edit",
        label: "Edit",
        icon: <Edit className="h-4 w-4" />,
        onSelect: () => handlers.onEdit(webhook),
      },
      {
        id: "toggle",
        label: webhook.enabled ? "Disable" : "Enable",
        icon: <Power className="h-4 w-4" />,
        onSelect: () => handlers.onToggleEnabled(webhook),
      },
      {
        id: "test",
        label: "Send test event",
        icon: <Send className="h-4 w-4" />,
        onSelect: () => handlers.onTest(webhook),
      }
    );
  }
  if (handlers.canDelete) {
    actions.push({
      id: "delete",
      label: "Delete",
      icon: <Trash2 className="h-4 w-4" />,
      destructive: true,
      onSelect: () => handlers.onDelete(webhook),
    });
  }
  return actions;
}

export const WebhookTable: React.FC<WebhookTableProps> = ({
  data,
  isLoading = false,
  canUpdate,
  canDelete,
  canViewDeliveries,
  onEdit,
  onToggleEnabled,
  onTest,
  onDelete,
  onViewDeliveries,
}) => {
  const [search, setSearch] = useState("");
  const { page, pageSize, setPage, setPageSize, resetPage } = usePagination();

  // Reset to the first page whenever the search term changes.
  useEffect(() => {
    resetPage();
  }, [search, resetPage]);

  // Resolves persisted column visibility while ensuring pinned webhook names remain visible.
  const { columns, columnsControl } = useTableColumns({
    storageKey: "webhooks",
    columns: WEBHOOK_COLUMNS,
    alwaysVisible: ALWAYS_VISIBLE,
  });

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

  // Keep the page in range when the list shrinks (e.g. deleting the last row on
  // the last page) so the slice never lands past the end and shows empty.
  useEffect(() => {
    const lastPage = Math.max(0, totalPages - 1);
    if (page > lastPage) setPage(lastPage);
  }, [page, totalPages, setPage]);

  const rowActions = useCallback(
    (webhook: WebhookEndpointSummary): RowAction<WebhookEndpointSummary>[] =>
      buildWebhookRowActions(webhook, {
        canUpdate,
        canDelete,
        canViewDeliveries,
        onEdit,
        onToggleEnabled,
        onTest,
        onDelete,
        onViewDeliveries,
      }),
    [
      canUpdate,
      canDelete,
      canViewDeliveries,
      onEdit,
      onToggleEnabled,
      onTest,
      onDelete,
      onViewDeliveries,
    ]
  );

  return (
    <ListView<WebhookEndpointSummary>
      search={{
        value: search,
        onChange: setSearch,
        placeholder: "Search endpoints by name or URL...",
        isLoading,
      }}
      columnsControl={columnsControl}
      columns={columns}
      rows={paginated}
      loading={isLoading}
      getRowId={row => row.id}
      onRowClick={canUpdate ? onEdit : undefined}
      primaryColumn="name"
      rowActions={rowActions}
      registryKey="webhooks"
      ariaLabel="Webhook endpoints table"
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
      emptyMessage="No webhook endpoints yet. Create one to start receiving events."
      emptyFiltered={{
        title: "No endpoints match your search",
        description: "Try a different name or URL.",
      }}
    />
  );
};
