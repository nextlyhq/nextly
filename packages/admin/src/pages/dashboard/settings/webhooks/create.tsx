"use client";

import type React from "react";
import { useCallback, useState } from "react";

import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { WebhookForm } from "@admin/components/features/webhooks/WebhookForm";
import { WebhookSecretModal } from "@admin/components/features/webhooks/WebhookSecretModal";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { ROUTES } from "@admin/constants/routes";
import { useCreateWebhook } from "@admin/hooks/queries/useWebhooks";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { navigateTo } from "@admin/lib/navigation";
import { toCreateInput } from "@admin/lib/webhook-validation";

const CreateWebhookContent: React.FC = () => {
  const { mutate: doCreate, isPending } = useCreateWebhook();
  const [secret, setSecret] = useState<string | null>(null);

  const handleSubmit = useCallback(
    (values: Parameters<typeof toCreateInput>[0]) => {
      doCreate(toCreateInput(values), {
        onSuccess: result => {
          // The signing secret is shown once here and never retrievable again.
          setSecret(result.secret);
        },
        onError: (err: Error) => {
          toast.error("Could not create endpoint", {
            description: apiErrorMessage(err),
          });
        },
      });
    },
    [doCreate]
  );

  const handleDismissSecret = useCallback(() => {
    setSecret(null);
    navigateTo(ROUTES.SETTINGS_WEBHOOKS);
  }, []);

  return (
    <>
      <WebhookForm
        onSubmit={handleSubmit}
        isPending={isPending}
        submitLabel="Create endpoint"
        pendingLabel="Creating…"
      />

      <WebhookSecretModal
        open={secret !== null}
        secrets={secret !== null ? [secret] : null}
        oneTime
        onClose={handleDismissSecret}
      />
    </>
  );
};

const CreateWebhookPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SettingsLayout>
          <CreateWebhookContent />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default CreateWebhookPage;
