"use client";

import { useCallback } from "react";

import {
  EmailProviderForm,
  formValuesToPayload,
  type ProviderFormValues,
} from "@admin/components/features/settings/EmailProviderForm";
import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { ROUTES } from "@admin/constants/routes";
import { useCreateEmailProvider } from "@admin/hooks/queries/useEmailProviders";
import { getErrorMessage } from "@admin/lib/errors/error-types";
import { navigateTo } from "@admin/lib/navigation";

export default function CreateEmailProviderPage() {
  const { mutate: createProvider, isPending } = useCreateEmailProvider();

  const handleSubmit = useCallback(
    (values: ProviderFormValues) => {
      const payload = formValuesToPayload(values);

      createProvider(payload, {
        onSuccess: () => {
          toast.success("Provider created", {
            description: `${values.name} has been created successfully.`,
          });
          navigateTo(ROUTES.SETTINGS_EMAIL_PROVIDERS);
        },
        onError: (error: Error) => {
          toast.error("Failed to create provider", {
            description: getErrorMessage(
              error,
              "An error occurred while creating the provider."
            ),
          });
        },
      });
    },
    [createProvider]
  );

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SettingsLayout>
          <EmailProviderForm
            mode="create"
            isPending={isPending}
            onSubmit={handleSubmit}
          />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}
