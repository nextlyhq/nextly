"use client";

import { Alert, AlertDescription, Button, Skeleton } from "@revnixhq/ui";
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
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import {
  useEmailProvider,
  useUpdateEmailProvider,
} from "@admin/hooks/queries/useEmailProviders";
import { useRouter } from "@admin/hooks/useRouter";
import { getErrorMessage } from "@admin/lib/errors/error-types";
import { navigateTo } from "@admin/lib/navigation";
import { validateUUID } from "@admin/lib/validation";

const MASKED_SECRET = "••••••••";

export default function EditEmailProviderPage() {
  const { route } = useRouter();

  // Extract and validate provider ID from route params
  const rawId =
    route?.params?.id && typeof route.params.id === "string"
      ? route.params.id
      : null;
  const providerId = validateUUID(rawId);

  // Fetch provider data
  const {
    data: provider,
    isLoading,
    error: fetchError,
    refetch,
  } = useEmailProvider(providerId || undefined);

  // Update mutation
  const { mutate: updateProvider, isPending } = useUpdateEmailProvider();

  const handleSubmit = useCallback(
    (values: ProviderFormValues) => {
      if (!providerId) return;

      const payload = formValuesToPayload(values);

      // For edit, only send configuration fields that have values
      // (empty sensitive fields mean "keep existing")
      const configuration = { ...payload.configuration };

      if (values.type === "smtp") {
        if (
          !values.smtpPassword ||
          values.smtpPassword === MASKED_SECRET ||
          /^\*+$/.test(values.smtpPassword)
        ) {
          const auth = configuration.auth as Record<string, unknown>;
          delete auth.pass;
        }
      } else {
        if (
          !values.apiKey ||
          values.apiKey === MASKED_SECRET ||
          /^\*+$/.test(values.apiKey)
        ) {
          delete configuration.apiKey;
        }
      }

      // Only include configuration in the update if it has actual values.
      // An empty object would overwrite the stored (encrypted) credentials.
      const dataToUpdate: {
        name: string;
        type: ProviderFormValues["type"];
        fromEmail: string;
        fromName: string | null;
        isDefault: boolean;
        configuration?: Record<string, unknown>;
      } = {
        name: payload.name,
        type: payload.type,
        fromEmail: payload.fromEmail,
        fromName: payload.fromName,
        isDefault: payload.isDefault,
      };
      if (Object.keys(configuration).length > 0) {
        dataToUpdate.configuration = configuration;
      }

      updateProvider(
        {
          id: providerId,
          data: dataToUpdate,
        },
        {
          onSuccess: () => {
            toast.success("Provider updated", {
              description: `${values.name} has been updated successfully.`,
            });
            navigateTo(ROUTES.SETTINGS_EMAIL_PROVIDERS);
          },
          onError: (error: Error) => {
            toast.error("Failed to update provider", {
              description: getErrorMessage(
                error,
                "An error occurred while updating the provider."
              ),
            });
          },
        }
      );
    },
    [providerId, updateProvider]
  );

  // Invalid ID
  if (!providerId) {
    return (
      <PageContainer>
        <SettingsLayout>
          <Alert variant="destructive">
            <AlertDescription>
              Invalid provider ID. Please go back and try again.
            </AlertDescription>
          </Alert>
          <div className="mt-4">
            <Link href={ROUTES.SETTINGS_EMAIL_PROVIDERS}>
              <Button variant="outline">Back to Providers</Button>
            </Link>
          </div>
        </SettingsLayout>
      </PageContainer>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <PageContainer>
        <SettingsLayout>
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <Skeleton className="w-9 rounded-none" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-72" />
              </div>
            </div>
            <Skeleton className="h-[500px] w-full rounded-none" />
          </div>
        </SettingsLayout>
      </PageContainer>
    );
  }

  // Error state
  if (fetchError) {
    return (
      <PageContainer>
        <SettingsLayout>
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between">
              <span>
                {getErrorMessage(
                  fetchError,
                  "Failed to load provider details."
                )}
              </span>
              <Button
                size="md"
                variant="outline"
                onClick={() => { void refetch(); }}
                className="ml-2"
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
          <div className="mt-4">
            <Link href={ROUTES.SETTINGS_EMAIL_PROVIDERS}>
              <Button variant="outline">Back to Providers</Button>
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
          <EmailProviderForm
            mode="edit"
            provider={provider}
            isPending={isPending}
            onSubmit={handleSubmit}
          />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}
