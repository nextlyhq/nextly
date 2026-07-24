"use client";

import { Alert, AlertDescription, Button, Skeleton } from "@nextlyhq/ui";
import type React from "react";
import { useCallback } from "react";

import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import {
  AttemptOutcomeBadge,
  DeliveryStatusBadge,
  describeResource,
  formatDeliveryTimestamp,
  formatLatency,
  formatStatusCode,
} from "@admin/components/features/webhooks/deliveryStatus";
import { ArrowLeft, Loader2, RefreshCw } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useDelivery, useRedeliver } from "@admin/hooks/queries";
import { useCan } from "@admin/hooks/useCan";
import { useRouter } from "@admin/hooks/useRouter";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";

/** One read-only label/value row in a metadata card. */
const MetaRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[1fr_2fr] sm:gap-4">
    <span className="text-sm font-medium text-muted-foreground">{label}</span>
    <span className="text-sm text-foreground">{children}</span>
  </div>
);

const DeliveryDetailContent: React.FC<{
  webhookId: string;
  deliveryId: string;
}> = ({ webhookId, deliveryId }) => {
  const canManage = useCan("update-webhooks");
  const {
    data: delivery,
    isLoading,
    isError,
    error,
  } = useDelivery(webhookId, deliveryId);
  const { mutate: doRedeliver, isPending: isRedelivering } = useRedeliver();

  const handleRedeliver = useCallback(() => {
    doRedeliver(
      { webhookId, deliveryId },
      {
        onSuccess: () => {
          toast.success("Redelivery queued", {
            description: "The delivery will be attempted again shortly.",
          });
        },
        onError: (err: Error) => {
          toast.error("Could not queue the redelivery", {
            description: apiErrorMessage(err),
          });
        },
      }
    );
  }, [doRedeliver, webhookId, deliveryId]);

  if (isError) {
    return (
      <PageErrorFallback
        error={error ?? new Error("Failed to load delivery")}
      />
    );
  }

  if (isLoading || !delivery) {
    return <Skeleton className="h-130 w-full rounded-none" />;
  }

  // Newest attempt first, without mutating the query cache's array in place.
  const attempts = [...delivery.attempts].reverse();

  return (
    <div className="space-y-8">
      <Link
        href={buildRoute(ROUTES.SETTINGS_WEBHOOKS_DELIVERIES, {
          id: webhookId,
        })}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to deliveries
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <DeliveryStatusBadge status={delivery.status} />
            <span className="font-medium text-foreground">
              {delivery.eventType}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {describeResource(delivery.resource)}
          </p>
        </div>

        {canManage && (
          <Button
            type="button"
            variant="outline"
            onClick={handleRedeliver}
            disabled={isRedelivering}
          >
            {isRedelivering ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Redeliver
          </Button>
        )}
      </div>

      <section className="space-y-2">
        <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-muted-foreground">
          Delivery
        </p>
        <div className="rounded-md border border-input bg-card px-6">
          <div className="divide-y divide-foreground/10">
            <MetaRow label="Delivery ID">
              <code className="font-mono text-xs break-all">{delivery.id}</code>
            </MetaRow>
            <MetaRow label="Event ID">
              <code className="font-mono text-xs break-all">
                {delivery.eventId}
              </code>
            </MetaRow>
            <MetaRow label="Attempts">
              <span className="tabular-nums">{delivery.attemptCount}</span>
            </MetaRow>
            <MetaRow label="Last response">
              {delivery.lastStatusCode === null ? (
                "Not yet attempted"
              ) : (
                <span className="tabular-nums">
                  {formatStatusCode(delivery.lastStatusCode)} ·{" "}
                  {formatLatency(delivery.lastLatencyMs)}
                </span>
              )}
            </MetaRow>
            {delivery.lastError && (
              <MetaRow label="Last error">
                <span className="text-destructive-500 break-words">
                  {delivery.lastError}
                </span>
              </MetaRow>
            )}
            <MetaRow label="Next attempt">
              {delivery.nextAttemptAt
                ? formatDeliveryTimestamp(delivery.nextAttemptAt)
                : "None scheduled"}
            </MetaRow>
            <MetaRow label="Event created">
              {formatDeliveryTimestamp(delivery.eventCreatedAt)}
            </MetaRow>
            <MetaRow label="Created">
              {formatDeliveryTimestamp(delivery.createdAt)}
            </MetaRow>
            <MetaRow label="Updated">
              {formatDeliveryTimestamp(delivery.updatedAt)}
            </MetaRow>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-muted-foreground">
          Attempts
        </p>
        {attempts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No attempts have been recorded yet.
          </p>
        ) : (
          <ol className="space-y-3">
            {attempts.map((attempt, index) => (
              <li
                key={`${attempt.at}-${index}`}
                className="rounded-md border border-input bg-card p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <AttemptOutcomeBadge outcome={attempt.outcome} />
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {formatStatusCode(attempt.statusCode ?? null)} ·{" "}
                    {formatLatency(attempt.latencyMs)}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDeliveryTimestamp(attempt.at)}
                  </span>
                </div>
                {attempt.error && (
                  <p className="mt-2 text-sm text-destructive-500 break-words">
                    {attempt.error}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-2">
        <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-muted-foreground">
          Last response
        </p>
        {delivery.lastResponseSnippet ? (
          <pre className="max-h-64 overflow-auto rounded-md border border-input bg-muted p-4 font-mono text-xs whitespace-pre-wrap break-words text-foreground">
            {delivery.lastResponseSnippet}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">
            No response body was captured.
          </p>
        )}
      </section>

      <Alert variant="info" role="note">
        <AlertDescription>
          The outgoing request body and headers are not stored, so they are not
          shown here. Only the response status, latency, and a truncated
          response body are recorded for each attempt.
        </AlertDescription>
      </Alert>
    </div>
  );
};

export default function WebhookDeliveryDetailPage() {
  const { route } = useRouter();
  const id =
    route?.params?.id && typeof route.params.id === "string"
      ? route.params.id
      : null;
  const deliveryId =
    route?.params?.deliveryId && typeof route.params.deliveryId === "string"
      ? route.params.deliveryId
      : null;

  if (!id || !deliveryId) {
    return (
      <PageContainer>
        <SettingsLayout>
          <Alert variant="destructive">
            <AlertDescription>
              Invalid delivery reference. Please go back and try again.
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
          <DeliveryDetailContent webhookId={id} deliveryId={deliveryId} />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}

// Exported for the delivery-detail render test, which needs the inner content
// without the router-param wrapper.
export { DeliveryDetailContent };
