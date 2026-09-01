"use client";

import { Alert, AlertDescription, Button, Skeleton } from "@nextlyhq/ui";
import type React from "react";
import { useCallback } from "react";

import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { DeleteWebhookDialog } from "@admin/components/features/webhooks/DeleteWebhookDialog";
import { RotateSecretDialog } from "@admin/components/features/webhooks/RotateSecretDialog";
import { WebhookCredentialPanel } from "@admin/components/features/webhooks/WebhookCredentialPanel";
import { WebhookForm } from "@admin/components/features/webhooks/WebhookForm";
import { WebhookSecretModal } from "@admin/components/features/webhooks/WebhookSecretModal";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useUpdateWebhook, useWebhook } from "@admin/hooks/queries/useWebhooks";
import { useCan } from "@admin/hooks/useCan";
import { useRouter } from "@admin/hooks/useRouter";
import { useWebhookDeletion } from "@admin/hooks/useWebhookDeletion";
import { useWebhookSecretActions } from "@admin/hooks/useWebhookSecretActions";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { navigateTo } from "@admin/lib/navigation";
import {
  toFormValues,
  toUpdateInput,
  type WebhookFormValues,
} from "@admin/lib/webhook-validation";

/**
 * This page renders the settings chrome in several branches — loading,
 * error and the resolved document — and its identity is the same in all of
 * them. Stated once here so the branches cannot drift apart.
 */
const WEBHOOK_PAGE = {
  title: "Edit Webhook",
  description: "Update the endpoint, events, and headers",
  crumb: "Edit Webhook",
  parentCrumb: { label: "Webhooks", href: ROUTES.SETTINGS_WEBHOOKS },
} as const;
const EditWebhookContent: React.FC<{ id: string }> = ({ id }) => {
  const { data: webhook, isLoading, isError, error } = useWebhook(id);
  const { mutate: doUpdate, isPending } = useUpdateWebhook();
  const secretActions = useWebhookSecretActions(id);
  const deletion = useWebhookDeletion(id, webhook?.name ?? "");

  // Reaching this page requires update-webhooks (registry-gated). Delete is a
  // separate grant, but `update-webhooks` is the management umbrella that
  // satisfies it too, so either one shows the control. (Both hooks are called
  // unconditionally — the OR is on their results, not the calls.)
  const canDeleteWebhooks = useCan("delete-webhooks");
  const canManageWebhooks = useCan("update-webhooks");
  const canDelete = canDeleteWebhooks || canManageWebhooks;

  const handleSubmit = useCallback(
    (values: WebhookFormValues) => {
      if (!webhook) return;
      const input = toUpdateInput(values, { original: webhook });
      // An empty patch would fail the server's "at least one field" rule; a
      // no-op save is a no-op, not an error.
      if (Object.keys(input).length === 0) {
        toast.info("No changes to save.");
        return;
      }
      doUpdate(
        { id, input },
        {
          onSuccess: () => {
            toast.success("Endpoint updated", {
              description: `"${values.name}" has been saved.`,
            });
            navigateTo(ROUTES.SETTINGS_WEBHOOKS);
          },
          onError: (err: Error) => {
            toast.error("Update failed", { description: apiErrorMessage(err) });
          },
        }
      );
    },
    [doUpdate, id, webhook]
  );

  if (isError) {
    return (
      <PageErrorFallback
        error={error ?? new Error("Failed to load endpoint")}
      />
    );
  }

  if (isLoading || !webhook) {
    return <Skeleton className="h-130 w-full rounded-lg" />;
  }

  return (
    <>
      {/*
       * Above the form deliberately. The secret is what a person copies when
       * WIRING UP the endpoint, which is the first thing they need and was
       * previously reachable only by scrolling past every configuration field.
       */}
      <WebhookCredentialPanel
        secrets={webhook.secrets}
        canManage={canManageWebhooks}
        onReveal={secretActions.reveal}
        isRevealing={secretActions.isRevealing}
        onRotate={() => secretActions.setConfirmingRotate(true)}
        isRotating={secretActions.isRotating}
        onExpireOld={secretActions.expireOld}
        isExpiring={secretActions.isExpiring}
        deliveriesHref={buildRoute(ROUTES.SETTINGS_WEBHOOKS_DELIVERIES, { id })}
      />

      <WebhookForm
        defaultValues={toFormValues(webhook)}
        existingHeaderNames={
          webhook.headers ? Object.keys(webhook.headers) : []
        }
        onSubmit={handleSubmit}
        isPending={isPending}
        submitLabel="Save changes"
        pendingLabel="Saving…"
      />

      {/*
       * Deletion stays BELOW, and after the form. It is the one act here that
       * cannot be undone, and a destructive control at the top of a page is
       * reached by accident far more often than on purpose.
       */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div />
        {canDelete && (
          <Button
            type="button"
            variant="destructive"
            onClick={() => deletion.setConfirming(true)}
          >
            Delete endpoint
          </Button>
        )}
      </div>

      <WebhookSecretModal
        open={secretActions.revealed !== null}
        secrets={secretActions.revealed}
        oneTime={false}
        onClose={secretActions.dismissRevealed}
      />

      <WebhookSecretModal
        open={secretActions.rotated !== null}
        secrets={
          secretActions.rotated !== null ? [secretActions.rotated] : null
        }
        oneTime
        canRevealLater
        onClose={secretActions.dismissRotated}
      />

      <RotateSecretDialog
        open={secretActions.confirmingRotate}
        onOpenChange={secretActions.setConfirmingRotate}
        webhookName={webhook.name}
        onConfirm={secretActions.rotate}
        isPending={secretActions.isRotating}
      />

      <DeleteWebhookDialog
        open={deletion.confirming}
        onOpenChange={deletion.setConfirming}
        webhook={webhook}
        onConfirm={deletion.confirm}
        isPending={deletion.isDeleting}
      />
    </>
  );
};

export default function EditWebhookPage() {
  const { route } = useRouter();
  const id =
    route?.params?.id && typeof route.params.id === "string"
      ? route.params.id
      : null;

  if (!id) {
    return (
      <PageContainer width="form">
        <SettingsLayout {...WEBHOOK_PAGE}>
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
      <PageContainer width="form">
        <SettingsLayout {...WEBHOOK_PAGE}>
          <EditWebhookContent id={id} />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}
