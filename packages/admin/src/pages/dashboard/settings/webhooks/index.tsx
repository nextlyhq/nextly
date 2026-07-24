"use client";

import { Alert, AlertDescription, Button, TableSkeleton } from "@nextlyhq/ui";
import type React from "react";
import { useCallback, useState } from "react";

import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { DeleteWebhookDialog } from "@admin/components/features/webhooks/DeleteWebhookDialog";
import { WebhookTable } from "@admin/components/features/webhooks/WebhookTable";
import { Plus } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import {
  useDeleteWebhook,
  useTestEndpoint,
  useUpdateWebhook,
  useWebhooks,
} from "@admin/hooks/queries/useWebhooks";
import { useCan } from "@admin/hooks/useCan";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { navigateTo } from "@admin/lib/navigation";
import type { WebhookEndpointSummary } from "@admin/types/webhooks";

const WebhooksContent: React.FC = () => {
  // `update-webhooks` is the backend management umbrella (it satisfies read and
  // delete too), so it grants those alongside the specific grants.
  const canReadWebhooks = useCan("read-webhooks");
  const canManage = useCan("update-webhooks");
  const canDeleteWebhooks = useCan("delete-webhooks");
  const canRead = canReadWebhooks || canManage;
  const canUpdate = canManage;
  const canDelete = canDeleteWebhooks || canManage;

  // Skip the list fetch when the user can't read it (a create-only role would
  // otherwise get a 403); the create action stays available above.
  const { data, isLoading, isError, error } = useWebhooks({ enabled: canRead });
  const { mutate: doUpdate } = useUpdateWebhook();
  const { mutate: doTest } = useTestEndpoint();
  const { mutate: doDelete, isPending: isDeleting } = useDeleteWebhook();

  const [toDelete, setToDelete] = useState<WebhookEndpointSummary | null>(null);

  const handleEdit = useCallback((webhook: WebhookEndpointSummary) => {
    navigateTo(buildRoute(ROUTES.SETTINGS_WEBHOOKS_EDIT, { id: webhook.id }));
  }, []);

  const handleToggleEnabled = useCallback(
    (webhook: WebhookEndpointSummary) => {
      doUpdate(
        { id: webhook.id, input: { enabled: !webhook.enabled } },
        {
          onSuccess: () => {
            toast.success(
              webhook.enabled ? "Endpoint disabled" : "Endpoint enabled",
              { description: `"${webhook.name}" was updated.` }
            );
          },
          onError: (err: Error) => {
            toast.error("Update failed", { description: apiErrorMessage(err) });
          },
        }
      );
    },
    [doUpdate]
  );

  const handleTest = useCallback(
    (webhook: WebhookEndpointSummary) => {
      doTest(webhook.id, {
        onSuccess: result => {
          if (result.delivered) {
            toast.success("Test event delivered", {
              description: `Responded ${result.statusCode} in ${result.latencyMs}ms.`,
            });
          } else {
            toast.error("Test event not delivered", {
              description:
                result.error ?? "The endpoint did not accept the event.",
            });
          }
        },
        onError: (err: Error) => {
          toast.error("Could not send test event", {
            description: apiErrorMessage(err),
          });
        },
      });
    },
    [doTest]
  );

  const handleConfirmDelete = useCallback(() => {
    if (!toDelete) return;
    const name = toDelete.name;
    doDelete(toDelete.id, {
      onSuccess: () => {
        toast.success("Endpoint deleted", {
          description: `"${name}" will no longer receive events.`,
        });
        setToDelete(null);
      },
      onError: (err: Error) => {
        toast.error("Delete failed", { description: apiErrorMessage(err) });
      },
    });
  }, [doDelete, toDelete]);

  if (!canRead) {
    return (
      <Alert variant="info" role="status">
        <AlertDescription>
          You can create webhook endpoints but not view existing ones. Use
          &ldquo;Create endpoint&rdquo; above to add one.
        </AlertDescription>
      </Alert>
    );
  }

  if (isError) {
    return (
      <PageErrorFallback
        error={error ?? new Error("Failed to load webhooks")}
      />
    );
  }

  if (isLoading && !data) {
    return <TableSkeleton columns={6} rowCount={8} />;
  }

  return (
    <>
      <WebhookTable
        data={data ?? []}
        isLoading={isLoading}
        canUpdate={canUpdate}
        canDelete={canDelete}
        onEdit={handleEdit}
        onToggleEnabled={handleToggleEnabled}
        onTest={handleTest}
        onDelete={setToDelete}
      />

      <DeleteWebhookDialog
        open={toDelete !== null}
        onOpenChange={open => {
          if (!open) setToDelete(null);
        }}
        webhook={toDelete}
        onConfirm={handleConfirmDelete}
        isPending={isDeleting}
      />
    </>
  );
};

const WebhooksPage: React.FC = () => {
  // Both hooks run unconditionally; the OR is on their results (the backend
  // treats update-webhooks as the umbrella that also permits create).
  const canCreateWebhooks = useCan("create-webhooks");
  const canManageWebhooks = useCan("update-webhooks");
  const canCreate = canCreateWebhooks || canManageWebhooks;
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SettingsLayout
          actions={
            canCreate ? (
              <Button
                size="md"
                onClick={() => navigateTo(ROUTES.SETTINGS_WEBHOOKS_CREATE)}
              >
                <Plus className="h-4 w-4" />
                <span>Create endpoint</span>
              </Button>
            ) : undefined
          }
        >
          <WebhooksContent />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default WebhooksPage;
