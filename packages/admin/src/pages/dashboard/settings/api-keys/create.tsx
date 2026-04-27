"use client";

import type React from "react";
import { useCallback, useState } from "react";

import { ApiKeyRevealModal } from "@admin/components/features/api-keys/ApiKeyRevealModal";
import { CreateApiKeyForm } from "@admin/components/features/api-keys/CreateApiKeyForm";
import type { CreateApiKeyFormValues } from "@admin/components/features/api-keys/CreateApiKeyForm";
import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { ROUTES } from "@admin/constants/routes";
import { useCreateApiKey } from "@admin/hooks/queries/useApiKeys";
import { navigateTo } from "@admin/lib/navigation";

// ============================================================
// Inner content (inside QueryErrorBoundary)
// ============================================================

const CreateApiKeyContent: React.FC = () => {
  const [rawKey, setRawKey] = useState<string | null>(null);

  const { mutate: doCreate, isPending } = useCreateApiKey();

  const handleSubmit = useCallback(
    (values: CreateApiKeyFormValues) => {
      doCreate(values, {
        onSuccess: result => {
          setRawKey(result.key);
        },
        onError: (err: Error) => {
          toast.error("Failed to create API key", {
            description: err.message || "An unexpected error occurred.",
          });
        },
      });
    },
    [doCreate]
  );

  const handleDismiss = useCallback(() => {
    setRawKey(null);
    navigateTo(ROUTES.SETTINGS_API_KEYS);
  }, []);

  return (
    <>
      <CreateApiKeyForm onSubmit={handleSubmit} isPending={isPending} />

      {/* One-time key reveal modal */}
      <ApiKeyRevealModal
        open={rawKey !== null}
        rawKey={rawKey}
        onDismiss={handleDismiss}
      />
    </>
  );
};

// ============================================================
// Page
// ============================================================

const CreateApiKeyPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SettingsLayout>
          <CreateApiKeyContent />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default CreateApiKeyPage;
