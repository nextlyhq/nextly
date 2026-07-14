"use client";

import { Alert, AlertDescription, Button, Skeleton } from "@nextlyhq/ui";
import type React from "react";
import { useCallback } from "react";

import { EditApiKeyForm } from "@admin/components/features/api-keys/EditApiKeyForm";
import type { EditApiKeyFormValues } from "@admin/components/features/api-keys/EditApiKeyForm";
import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useApiKeys, useUpdateApiKey } from "@admin/hooks/queries/useApiKeys";
import { useRouter } from "@admin/hooks/useRouter";
import { navigateTo } from "@admin/lib/navigation";
import { validateUUID } from "@admin/lib/validation";

// ============================================================
// Inner content (inside QueryErrorBoundary)
// ============================================================

const EditApiKeyContent: React.FC<{ id: string }> = ({ id }) => {
  // The API exposes only a list endpoint, so find the key in the cached list.
  const { data, isLoading, isError, error } = useApiKeys();
  const { mutate: doUpdate, isPending } = useUpdateApiKey();

  const apiKey = data?.data.find(k => k.id === id) ?? null;

  const handleSubmit = useCallback(
    (values: EditApiKeyFormValues) => {
      doUpdate(
        {
          id,
          data: {
            name: values.name,
            description: values.description || null,
          },
        },
        {
          onSuccess: () => {
            toast.success("API key updated", {
              description: `"${values.name}" has been saved.`,
            });
            navigateTo(ROUTES.SETTINGS_API_KEYS);
          },
          onError: (err: Error) => {
            toast.error("Update failed", {
              description: err.message || "Failed to update the API key.",
            });
          },
        }
      );
    },
    [doUpdate, id]
  );

  if (isError) {
    return (
      <PageErrorFallback error={error || new Error("Failed to load API key")} />
    );
  }

  if (isLoading && !data) {
    return <Skeleton className="h-[420px] w-full rounded-none" />;
  }

  if (!apiKey) {
    return (
      <>
        <Alert variant="destructive">
          <AlertDescription>
            API key not found. It may have been revoked.
          </AlertDescription>
        </Alert>
        <div className="mt-4">
          <Link href={ROUTES.SETTINGS_API_KEYS}>
            <Button variant="outline">Back to API Keys</Button>
          </Link>
        </div>
      </>
    );
  }

  return (
    <EditApiKeyForm
      apiKey={apiKey}
      isPending={isPending}
      onSubmit={handleSubmit}
    />
  );
};

// ============================================================
// Page
// ============================================================

export default function EditApiKeyPage() {
  const { route } = useRouter();
  const rawId =
    route?.params?.id && typeof route.params.id === "string"
      ? route.params.id
      : null;
  const id = validateUUID(rawId);

  if (!id) {
    return (
      <PageContainer>
        <SettingsLayout>
          <Alert variant="destructive">
            <AlertDescription>
              Invalid API key ID. Please go back and try again.
            </AlertDescription>
          </Alert>
          <div className="mt-4">
            <Link href={ROUTES.SETTINGS_API_KEYS}>
              <Button variant="outline">Back to API Keys</Button>
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
          <EditApiKeyContent id={id} />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}
