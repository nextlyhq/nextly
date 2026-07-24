"use client";

import {
  Alert,
  AlertDescription,
  Button,
  Skeleton,
  TableSkeleton,
} from "@nextlyhq/ui";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { DeliveryTable } from "@admin/components/features/webhooks/DeliveryTable";
import { Loader2, Zap } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useDeliveries, useRunDrain, useWebhook } from "@admin/hooks/queries";
import { useCan } from "@admin/hooks/useCan";
import { useRouter } from "@admin/hooks/useRouter";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { navigateTo } from "@admin/lib/navigation";
import type {
  RunDrainResult,
  WebhookDeliveryStatus,
  WebhookDeliverySummary,
  WebhookEventType,
} from "@admin/types/webhooks";

/** A short human summary of a drain pass for the toast. */
function summarizeDrain(result: RunDrainResult): string {
  return `${result.attempted} attempted · ${result.delivered} delivered · ${result.retried} retrying · ${result.failed} failed.`;
}

const DeliveriesContent: React.FC<{ id: string }> = ({ id }) => {
  // Reads use read-or-update; the drain trigger needs the update umbrella.
  const canReadWebhooks = useCan("read-webhooks");
  const canManage = useCan("update-webhooks");
  const canRead = canReadWebhooks || canManage;

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState<WebhookDeliveryStatus | undefined>();
  const [eventType, setEventType] = useState<WebhookEventType | undefined>();

  const { data: endpoint, isLoading: isEndpointLoading } = useWebhook(id);
  const { data, isLoading, isError, error, isPlaceholderData } = useDeliveries(
    id,
    // The server is 1-based; the Pagination control is 0-based.
    { page: page + 1, limit: pageSize, status, eventType },
    { enabled: canRead }
  );
  const { mutate: doDrain, isPending: isDraining } = useRunDrain();

  // While a parameter change is refetching, `keepPreviousData` leaves the prior
  // page in `data` and `isPlaceholderData` is true. Treat that as busy so the
  // table and its pager show a loading state and disable paging — otherwise the
  // stale page reads as if it already matched the new filter, and its old page
  // count would let a click request a page that no longer exists.
  const isRefetching = isLoading || isPlaceholderData;

  // Keep the page in range when the result set shrinks under us (a filter
  // narrows it, or a drain/prune removes rows) so paging never sticks on an
  // empty page past the end. Only clamp against a freshly-returned total, never
  // the stale placeholder meta held during a refetch.
  useEffect(() => {
    if (!data || isPlaceholderData) return;
    const lastPage = Math.max(0, data.meta.totalPages - 1);
    if (page > lastPage) setPage(lastPage);
  }, [data, isPlaceholderData, page]);

  // Filters and page-size changes reset to the first page so the new query
  // never lands past the end of a shorter result set.
  const handleStatusChange = useCallback((next?: WebhookDeliveryStatus) => {
    setStatus(next);
    setPage(0);
  }, []);
  const handleEventTypeChange = useCallback((next?: WebhookEventType) => {
    setEventType(next);
    setPage(0);
  }, []);
  const handlePageSizeChange = useCallback((next: number) => {
    setPageSize(next);
    setPage(0);
  }, []);

  const handleRowClick = useCallback(
    (delivery: WebhookDeliverySummary) => {
      navigateTo(
        buildRoute(ROUTES.SETTINGS_WEBHOOKS_DELIVERY_DETAIL, {
          id,
          deliveryId: delivery.id,
        })
      );
    },
    [id]
  );

  const handleDrain = useCallback(() => {
    doDrain(undefined, {
      onSuccess: result => {
        toast.success("Queue processed", {
          description: summarizeDrain(result),
        });
      },
      onError: (err: Error) => {
        toast.error("Could not process the queue", {
          description: apiErrorMessage(err),
        });
      },
    });
  }, [doDrain]);

  if (!canRead) {
    return (
      <Alert variant="info" role="status">
        <AlertDescription>
          You do not have permission to view webhook deliveries.
        </AlertDescription>
      </Alert>
    );
  }

  if (isError) {
    return (
      <PageErrorFallback
        error={error ?? new Error("Failed to load deliveries")}
      />
    );
  }

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          {isEndpointLoading ? (
            <Skeleton className="h-5 w-48 rounded-none" />
          ) : endpoint ? (
            <p className="text-sm text-muted-foreground">
              Endpoint:{" "}
              {/* The edit route requires update-webhooks; a read-only viewer
                  only gets a link they could not open, so link only for a
                  manager and show plain text otherwise. */}
              {canManage ? (
                <Link
                  href={buildRoute(ROUTES.SETTINGS_WEBHOOKS_EDIT, { id })}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {endpoint.name}
                </Link>
              ) : (
                <span className="font-medium text-foreground">
                  {endpoint.name}
                </span>
              )}
            </p>
          ) : (
            // A retired endpoint keeps its delivery history, but `getWebhook`
            // 404s for it. Label it by id instead of holding a skeleton forever.
            <p className="text-sm text-muted-foreground">
              Endpoint <code className="font-mono text-xs">{id}</code> (no
              longer active)
            </p>
          )}
        </div>

        {canManage && (
          <Button
            type="button"
            variant="outline"
            onClick={handleDrain}
            disabled={isDraining}
          >
            {isDraining ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4" />
            )}
            Process queue now
          </Button>
        )}
      </div>

      {isLoading && !data ? (
        <TableSkeleton columns={6} rowCount={8} />
      ) : (
        <DeliveryTable
          rows={data?.items ?? []}
          isLoading={isRefetching}
          totalItems={data?.meta.total ?? 0}
          totalPages={data?.meta.totalPages ?? 1}
          page={page}
          pageSize={pageSize}
          status={status}
          eventType={eventType}
          onPageChange={setPage}
          onPageSizeChange={handlePageSizeChange}
          onStatusChange={handleStatusChange}
          onEventTypeChange={handleEventTypeChange}
          onRowClick={handleRowClick}
        />
      )}
    </>
  );
};

export default function WebhookDeliveriesPage() {
  const { route } = useRouter();
  const id =
    route?.params?.id && typeof route.params.id === "string"
      ? route.params.id
      : null;

  if (!id) {
    return (
      <PageContainer>
        <SettingsLayout>
          <Alert variant="destructive">
            <AlertDescription>
              Invalid endpoint ID. Please go back and try again.
            </AlertDescription>
          </Alert>
          <div className="mt-4">
            <Link href={ROUTES.SETTINGS_WEBHOOKS}>
              <Button variant="outline">Back to Webhooks</Button>
            </Link>
          </div>
        </SettingsLayout>
      </PageContainer>
    );
  }

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SettingsLayout>
          <DeliveriesContent id={id} />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}

// Exported for the drain-button test, which drives the content without the
// router-param wrapper.
export { DeliveriesContent };
