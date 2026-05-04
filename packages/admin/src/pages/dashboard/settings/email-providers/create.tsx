"use client";

import { Button } from "@revnixhq/ui";
import { useCallback } from "react";

import {
  EMAIL_PROVIDER_FORM_ID,
  EmailProviderForm,
  formValuesToPayload,
  type ProviderFormValues,
} from "@admin/components/features/settings/EmailProviderForm";
import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { Loader2 } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
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
        <SettingsLayout
          actions={
            <>
              {/* Test Connection is only meaningful once a provider has been
                  saved. We render it here for layout parity with the edit page
                  but keep it disabled in create mode (matches previous behavior). */}
              <Button type="button" variant="outline" disabled>
                Test Connection
              </Button>
              <Link href={ROUTES.SETTINGS_EMAIL_PROVIDERS}>
                <Button type="button" variant="outline" disabled={isPending}>
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                form={EMAIL_PROVIDER_FORM_ID}
                disabled={isPending}
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Provider"
                )}
              </Button>
            </>
          }
        >
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
