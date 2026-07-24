"use client";

/**
 * DeliveryTable — an endpoint's delivery log with server-side pagination and
 * status/event-type filters. The parent owns the query state (page, size,
 * filters) so it can drive the `useDeliveries` request; this component is
 * presentational and reports every change back through callbacks. Clicking a
 * row opens that delivery's detail page.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import type React from "react";
import { useMemo } from "react";

import { Pagination } from "@admin/components/shared/pagination";
import { DataTableView } from "@admin/components/ui/table/data-table";
import type { NextlyColumn } from "@admin/components/ui/table/data-table";
import {
  WEBHOOK_DELIVERY_STATUSES,
  WEBHOOK_EVENT_TYPES,
  type WebhookDeliveryStatus,
  type WebhookDeliverySummary,
  type WebhookEventType,
} from "@admin/types/webhooks";

import {
  DeliveryStatusBadge,
  describeResource,
  formatDeliveryTimestamp,
  formatLatency,
  formatStatusCode,
} from "./deliveryStatus";

/** Sentinel for the "no filter" option (Radix Select forbids an empty value). */
const ALL = "all" as const;

export interface DeliveryTableProps {
  rows: WebhookDeliverySummary[];
  isLoading?: boolean;
  /** Total rows across all pages (from the server meta). */
  totalItems: number;
  totalPages: number;
  /** Current page index (0-based, for the Pagination control). */
  page: number;
  pageSize: number;
  /** Active filters; undefined means unfiltered. */
  status?: WebhookDeliveryStatus;
  eventType?: WebhookEventType;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onStatusChange: (status?: WebhookDeliveryStatus) => void;
  onEventTypeChange: (eventType?: WebhookEventType) => void;
  onRowClick: (delivery: WebhookDeliverySummary) => void;
}

export const DeliveryTable: React.FC<DeliveryTableProps> = ({
  rows,
  isLoading = false,
  totalItems,
  totalPages,
  page,
  pageSize,
  status,
  eventType,
  onPageChange,
  onPageSizeChange,
  onStatusChange,
  onEventTypeChange,
  onRowClick,
}) => {
  const columns = useMemo(
    (): NextlyColumn<WebhookDeliverySummary>[] => [
      {
        name: "status",
        header: "Status",
        cell: ({ row }) => <DeliveryStatusBadge status={row.status} />,
      },
      {
        name: "eventType",
        header: "Event",
        cell: ({ row }) => (
          <span className="font-medium text-foreground">{row.eventType}</span>
        ),
      },
      {
        name: "resource",
        header: "Resource",
        hideOnMobile: true,
        cell: ({ row }) => (
          <span
            className="block max-w-64 truncate text-sm text-muted-foreground"
            title={describeResource(row.resource)}
          >
            {describeResource(row.resource)}
          </span>
        ),
      },
      {
        name: "attemptCount",
        header: "Attempts",
        hideOnMobile: true,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {row.attemptCount}
          </span>
        ),
      },
      {
        name: "lastStatusCode",
        header: "Last response",
        hideOnMobile: true,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatStatusCode(row.lastStatusCode)}
            {row.lastLatencyMs !== null
              ? ` · ${formatLatency(row.lastLatencyMs)}`
              : ""}
          </span>
        ),
      },
      {
        name: "createdAt",
        header: "Created",
        hideOnMobile: true,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatDeliveryTimestamp(row.createdAt)}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select
          value={status ?? ALL}
          onValueChange={value =>
            onStatusChange(
              value === ALL ? undefined : (value as WebhookDeliveryStatus)
            )
          }
        >
          <SelectTrigger
            className="w-full sm:w-48"
            aria-label="Filter by status"
          >
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {WEBHOOK_DELIVERY_STATUSES.map(value => (
              <SelectItem key={value} value={value}>
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={eventType ?? ALL}
          onValueChange={value =>
            onEventTypeChange(
              value === ALL ? undefined : (value as WebhookEventType)
            )
          }
        >
          <SelectTrigger
            className="w-full sm:w-64"
            aria-label="Filter by event"
          >
            <SelectValue placeholder="All events" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All events</SelectItem>
            {WEBHOOK_EVENT_TYPES.map(value => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTableView<WebhookDeliverySummary>
        columns={columns}
        rows={rows}
        loading={isLoading}
        getRowId={row => row.id}
        onRowClick={onRowClick}
        primaryColumn="eventType"
        registryKey="webhook-deliveries"
        ariaLabel="Webhook deliveries table"
        emptyMessage="No deliveries match these filters yet."
      />

      <Pagination
        currentPage={page}
        totalPages={Math.max(1, totalPages)}
        pageSize={pageSize}
        pageSizeOptions={[20, 50, 100]}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        totalItems={totalItems}
        itemLabel="deliveries"
        isLoading={isLoading}
      />
    </div>
  );
};
