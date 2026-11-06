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

import { DataTableView } from "@admin/components/ui/table/data-table";
import type { NextlyColumn } from "@admin/components/ui/table/data-table";
import {
  webhookEventChoices,
  type WebhookEventChoice,
} from "@admin/lib/webhook-event-choices";
import {
  WEBHOOK_DELIVERY_STATUSES,
  type WebhookDeliveryStatus,
  type WebhookDeliverySummary,
  type WebhookEventType,
  type WebhookEventTypeEntry,
} from "@admin/types/webhooks";

import {
  DeliveryStatusBadge,
  describeResource,
  formatDeliveryTimestamp,
  formatLatency,
  formatStatusCode,
} from "./deliveryStatus";

/**
 * What the event filter calls a choice: a plugin's label beside its id, so it
 * reads as the webhook form names it, and a type the server no longer lists
 * marked unavailable.
 */
function eventChoiceText(choice: WebhookEventChoice): string {
  if (choice.unavailable) return `${choice.type} (unavailable)`;
  return choice.label === choice.type
    ? choice.type
    : `${choice.label} (${choice.type})`;
}

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
  /**
   * The event types the server lists, which the event filter offers;
   * `undefined` while they load or when they could not be loaded.
   */
  eventTypes: readonly WebhookEventTypeEntry[] | undefined;
  /** The list could not be loaded, which the filter says rather than look empty. */
  eventTypesFailed?: boolean;
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
  eventTypes,
  eventTypesFailed = false,
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

        <DeliveryEventFilter
          eventType={eventType}
          eventTypes={eventTypes}
          eventTypesFailed={eventTypesFailed}
          onEventTypeChange={onEventTypeChange}
        />
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
        // Passed to the table rather than rendered beside it, so it is placed
        // by the component that knows which of the two views is
        // showing. This list is the one most often read on a narrow screen
        // while chasing a failed delivery, which is the layout a detached pager
        // gets wrong.
        pagination={{
          currentPage: page,
          totalPages: Math.max(1, totalPages),
          pageSize,
          pageSizeOptions: [20, 50, 100],
          onPageChange,
          onPageSizeChange,
          totalItems,
          itemLabel: "deliveries",
          isLoading,
        }}
      />
    </div>
  );
};

/**
 * The delivery log's event filter: the types the server lists, by label, and
 * the filter in force kept named when the server no longer lists it. Says so
 * when the list could not be loaded, rather than offer an empty one.
 */
function DeliveryEventFilter({
  eventType,
  eventTypes,
  eventTypesFailed,
  onEventTypeChange,
}: {
  eventType: WebhookEventType | undefined;
  eventTypes: readonly WebhookEventTypeEntry[] | undefined;
  eventTypesFailed: boolean;
  onEventTypeChange: (eventType?: WebhookEventType) => void;
}): React.ReactElement {
  return (
    <>
      <Select
        value={eventType ?? ALL}
        onValueChange={value =>
          onEventTypeChange(value === ALL ? undefined : value)
        }
      >
        <SelectTrigger className="w-full sm:w-64" aria-label="Filter by event">
          <SelectValue placeholder="All events" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All events</SelectItem>
          {/* The filter in force stays offered, named, though the server
          no longer lists it, as a disabled plugin's type is not. */}
          {webhookEventChoices(
            eventTypes ?? [],
            eventType === undefined ? [] : [eventType]
          ).map(choice => (
            <SelectItem key={choice.type} value={choice.type}>
              {eventChoiceText(choice)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {eventTypesFailed && (
        <p className="text-sm text-destructive-500">
          Could not load the event types to filter by. Reload the page to try
          again.
        </p>
      )}
    </>
  );
}
