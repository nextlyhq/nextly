"use client";

import { Alert, AlertDescription, Button, Skeleton } from "@nextlyhq/ui";
import { useCallback } from "react";

import {
  EMAIL_PROVIDER_FORM_ID,
  EmailProviderForm,
  type EmailProviderPayload,
} from "@admin/components/features/settings/EmailProviderForm";
import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { Loader2 } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import {
  useEmailProvider,
  useEmailProviderTypes,
  useUpdateEmailProvider,
} from "@admin/hooks/queries/useEmailProviders";
import { useRouter } from "@admin/hooks/useRouter";
import { getErrorMessage } from "@admin/lib/errors/error-types";
import { navigateTo } from "@admin/lib/navigation";
import { validateUUID } from "@admin/lib/validation";

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

  // The provider catalog. The stored record says which type this provider is;
  // the catalog says what that type's fields are, so both are needed before the
  // form can render anything editable.
  const {
    data: descriptors,
    isLoading: descriptorsLoading,
    error: descriptorsError,
  } = useEmailProviderTypes();

  // Update mutation
  const { mutate: updateProvider, isPending } = useUpdateEmailProvider();

  const handleSubmit = useCallback(
    (payload: EmailProviderPayload) => {
      if (!providerId) return;

      // The form has already dropped the credentials the user did not touch,
      // deciding from the descriptor's own `secret` flags and the stored value
      // rather than from a list of provider names kept here. The server merges
      // what remains over the stored configuration, so an omitted credential
      // keeps its value.
      updateProvider(
        {
          id: providerId,
          data: payload,
        },
        {
          onSuccess: () => {
            toast.success("Provider updated", {
              description: `${payload.name} has been updated successfully.`,
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
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-[500px] w-full rounded-lg" />
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
                onClick={() => {
                  void refetch();
                }}
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
        <SettingsLayout
          actions={
            <>
              {/* Test Connection — preserves the previous form behaviour
                  (placeholder, disabled). Wiring it up is out of scope for
                  this UI cleanup. */}
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
                    Updating...
                  </>
                ) : (
                  "Update Provider"
                )}
              </Button>
            </>
          }
        >
          <EmailProviderForm
            mode="edit"
            provider={provider}
            descriptors={descriptors ?? []}
            descriptorsLoading={descriptorsLoading}
            descriptorsError={descriptorsError}
            isPending={isPending}
            onSubmit={handleSubmit}
          />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}
