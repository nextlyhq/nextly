"use client";

import { Alert, AlertDescription, Button, Skeleton } from "@nextlyhq/ui";
import { useCallback } from "react";

import {
  EMAIL_PROVIDER_FORM_ID,
  EmailProviderForm,
  emailCatalogState,
  isUnregisteredProviderType,
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
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
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
              // apiErrorMessage, not getErrorMessage: a rule that lives only
              // in the provider's own parser -- SMTP's conditional
              // credentials, its transport-safety check, anything a plugin
              // enforces -- arrives as per-field reasons in `data.errors`
              // under a top-level "Validation failed." Reading only
              // `Error.message` shows the operator that sentence and nothing
              // they can act on.
              description:
                apiErrorMessage(error) ||
                "An error occurred while updating the provider.",
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
        <SettingsLayout {...EMAIL_PROVIDER_PAGE}>
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
        <SettingsLayout {...EMAIL_PROVIDER_PAGE}>
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
        <SettingsLayout {...EMAIL_PROVIDER_PAGE}>
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

  // The same question the form answers before it disables every field: is the
  // stored type still registered? Asked once, from the shared predicate, so
  // the button and the notice beside it can never disagree — an enabled Update
  // under a "settings cannot be edited" banner submits an empty configuration
  // and comes back with an unsupported-provider error.
  //
  // Gated on the catalog having settled, because an empty list mid-fetch makes
  // every type look unregistered.
  //
  // A failed catalog with NOTHING cached is its own reason: the form renders a
  // fatal alert instead of itself, so there is no form for this button to
  // submit and an enabled Update would do nothing at all.
  //
  // A catalog that merely failed to REFRESH is not that reason. Its cached
  // descriptors are what the form goes on to render and to disable itself
  // from, so the same question has to be asked of them here — treating the
  // stale state as "no answer yet" is what leaves Update enabled beneath the
  // form's own notice that the settings cannot be edited.
  const catalog = emailCatalogState({
    loading: descriptorsLoading,
    failed: descriptorsError !== null && descriptorsError !== undefined,
    descriptors: descriptors ?? [],
  });

  // Loading counts as well as unavailable. The form renders only its skeleton
  // until the catalog settles, so the id this button submits to is not on the
  // page yet and pressing it does nothing at all — which reads as a broken
  // control rather than as a page that is not ready.
  const cannotEdit =
    catalog === "loading" ||
    catalog === "unavailable" ||
    isUnregisteredProviderType(provider?.type, descriptors ?? []);

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SettingsLayout
          {...EMAIL_PROVIDER_PAGE}
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
                disabled={isPending || cannotEdit}
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

/**
 * This page renders the settings chrome in several branches — loading,
 * error and the resolved document — and its identity is the same in all of
 * them. Stated once here so the branches cannot drift apart.
 */
const EMAIL_PROVIDER_PAGE = {
  title: "Edit Email Provider",
  description: "Update the email provider configuration",
  crumb: "Edit Email Provider",
  parentCrumb: {
    label: "Email Providers",
    href: ROUTES.SETTINGS_EMAIL_PROVIDERS,
  },
} as const;
