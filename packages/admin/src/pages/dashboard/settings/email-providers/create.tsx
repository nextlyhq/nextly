"use client";

import { Button } from "@nextlyhq/ui";
import { useCallback } from "react";

import {
  EMAIL_PROVIDER_FORM_ID,
  EmailProviderForm,
  emailCatalogState,
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
  useCreateEmailProvider,
  useEmailProviderTypes,
} from "@admin/hooks/queries/useEmailProviders";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { navigateTo } from "@admin/lib/navigation";

export default function CreateEmailProviderPage() {
  const { mutate: createProvider, isPending } = useCreateEmailProvider();
  // The catalog of provider types this server registered. The form renders
  // from it, so a provider contributed by a plugin appears here without the
  // admin knowing its name.
  const {
    data: descriptors,
    isLoading: descriptorsLoading,
    error: descriptorsError,
  } = useEmailProviderTypes();

  // The submit button lives outside the form and reaches it by id, so it
  // stays clickable when the form is not there to receive it. Both states that
  // withdraw the form have to be answered here as well: while the catalog is
  // loading there is a skeleton, and with no catalog at all there is a fatal
  // alert. Pressing Create against either does nothing whatsoever, which reads
  // as a broken button rather than as a page that cannot be used yet.
  const catalog = emailCatalogState({
    loading: descriptorsLoading,
    failed: descriptorsError !== null && descriptorsError !== undefined,
    descriptors: descriptors ?? [],
  });
  const cannotCreate = catalog === "loading" || catalog === "unavailable";

  const handleSubmit = useCallback(
    (payload: EmailProviderPayload) => {
      createProvider(payload, {
        onSuccess: () => {
          toast.success("Provider created", {
            description: `${payload.name} has been created successfully.`,
          });
          navigateTo(ROUTES.SETTINGS_EMAIL_PROVIDERS);
        },
        onError: (error: Error) => {
          toast.error("Failed to create provider", {
            // apiErrorMessage, not getErrorMessage: a rule that lives
            // only in the provider's own parser -- SMTP's conditional
            // credentials, its transport-safety check, anything a plugin
            // enforces -- arrives as per-field reasons in `data.errors` under
            // a top-level "Validation failed." Reading only `Error.message`
            // shows the operator that sentence and nothing they can act on.
            description:
              apiErrorMessage(error) ||
              "An error occurred while creating the provider.",
          });
        },
      });
    },
    [createProvider]
  );

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer width="form">
        <SettingsLayout
          title="New Email Provider"
          description="Configure a new email delivery provider"
          crumb="New Email Provider"
          parentCrumb={{
            label: "Email Providers",
            href: ROUTES.SETTINGS_EMAIL_PROVIDERS,
          }}
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
                disabled={isPending || cannotCreate}
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
