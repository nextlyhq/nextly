"use client";

import { Alert, AlertDescription, Button, Skeleton } from "@nextlyhq/ui";
import type React from "react";
import { useCallback, useState } from "react";

import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { DeleteWebhookDialog } from "@admin/components/features/webhooks/DeleteWebhookDialog";
import { WebhookForm } from "@admin/components/features/webhooks/WebhookForm";
import { WebhookSecretModal } from "@admin/components/features/webhooks/WebhookSecretModal";
import { Eye, List, Loader2 } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import {
  useDeleteWebhook,
  useRevealSecret,
  useUpdateWebhook,
  useWebhook,
} from "@admin/hooks/queries/useWebhooks";
import { useCan } from "@admin/hooks/useCan";
import { useRouter } from "@admin/hooks/useRouter";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { navigateTo } from "@admin/lib/navigation";
import {
  toFormValues,
  toUpdateInput,
  type WebhookFormValues,
} from "@admin/lib/webhook-validation";

const EditWebhookContent: React.FC<{ id: string }> = ({ id }) => {
  const { data: webhook, isLoading, isError, error } = useWebhook(id);
  const { mutate: doUpdate, isPending } = useUpdateWebhook();
  const { mutate: doReveal, isPending: isRevealing } = useRevealSecret();
  const { mutate: doDelete, isPending: isDeleting } = useDeleteWebhook();

  const [secrets, setSecrets] = useState<string[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const handleReveal = useCallback(() => {
    doReveal(id, {
      onSuccess: setSecrets,
      onError: (err: Error) => {
        toast.error("Could not reveal the secret", {
          description: apiErrorMessage(err),
        });
      },
    });
  }, [doReveal, id]);

  const handleConfirmDelete = useCallback(() => {
    if (!webhook) return;
    const name = webhook.name;
    doDelete(id, {
      onSuccess: () => {
        toast.success("Endpoint deleted", {
          description: `"${name}" will no longer receive events.`,
        });
        navigateTo(ROUTES.SETTINGS_WEBHOOKS);
      },
      onError: (err: Error) => {
        toast.error("Delete failed", { description: apiErrorMessage(err) });
      },
    });
  }, [doDelete, id, webhook]);

  if (isError) {
    return (
      <PageErrorFallback
        error={error ?? new Error("Failed to load endpoint")}
      />
    );
  }

  if (isLoading || !webhook) {
    return <Skeleton className="h-130 w-full rounded-none" />;
  }

  return (
    <>
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

      <div className="mt-8 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            type="button"
            variant="outline"
            onClick={handleReveal}
            disabled={isRevealing}
          >
            {isRevealing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
            Reveal signing secret
          </Button>

          <Link href={buildRoute(ROUTES.SETTINGS_WEBHOOKS_DELIVERIES, { id })}>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
            >
              <List className="h-4 w-4" />
              View deliveries
            </Button>
          </Link>
        </div>

        {canDelete && (
          <Button
            type="button"
            variant="destructive"
            onClick={() => setConfirmDelete(true)}
          >
            Delete endpoint
          </Button>
        )}
      </div>

      <WebhookSecretModal
        open={secrets !== null}
        secrets={secrets}
        oneTime={false}
        onClose={() => setSecrets(null)}
      />

      <DeleteWebhookDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        webhook={webhook}
        onConfirm={handleConfirmDelete}
        isPending={isDeleting}
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
          <EditWebhookContent id={id} />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}
