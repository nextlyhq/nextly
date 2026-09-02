"use client";

import { Button, TableSkeleton } from "@nextlyhq/ui";
import type React from "react";
import { useCallback, useState } from "react";

import { ApiKeyTable } from "@admin/components/features/api-keys/ApiKeyTable";
import { RevokeApiKeyDialog } from "@admin/components/features/api-keys/RevokeApiKeyDialog";
import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { Plus } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { SearchBar } from "@admin/components/shared/search-bar";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useApiKeys } from "@admin/hooks/queries/useApiKeys";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { navigateTo } from "@admin/lib/navigation";
import { mayPerformApiKeyAction } from "@admin/lib/permissions/api-key-actions";
import type { ApiKeyMeta } from "@admin/services/apiKeyApi";

// ============================================================
// Inner content (inside QueryErrorBoundary)
// ============================================================

const ApiKeysContent: React.FC = () => {
  const { hasPermission } = useCurrentUserPermissions();
  // Fetch keys
  const { data, isLoading, isError, error } = useApiKeys();

  // Revoke dialog state
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKeyMeta | null>(null);

  const handleEdit = useCallback((key: ApiKeyMeta) => {
    navigateTo(buildRoute(ROUTES.SETTINGS_API_KEYS_EDIT, { id: key.id }));
  }, []);

  const handleRevoke = useCallback((key: ApiKeyMeta) => {
    setKeyToRevoke(key);
    setRevokeDialogOpen(true);
  }, []);

  const handleRevokeDialogChange = useCallback((open: boolean) => {
    setRevokeDialogOpen(open);
    if (!open) setKeyToRevoke(null);
  }, []);

  // ── Error handling ──────────────────────────────────────────
  if (isError) {
    return (
      <PageErrorFallback
        error={error || new Error("Failed to load API keys")}
      />
    );
  }

  // ── Loading handling ────────────────────────────────────────
  if (isLoading && !data) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex-1 max-w-md w-full">
            <SearchBar
              value=""
              onChange={() => {}}
              placeholder="Search API keys..."
              isLoading={true}
              className="w-full"
            />
          </div>
        </div>
        <TableSkeleton columns={7} rowCount={8} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Table */}
      <ApiKeyTable
        data={data?.data ?? []}
        isLoading={isLoading}
        onEdit={handleEdit}
        onRevoke={handleRevoke}
        canEdit={mayPerformApiKeyAction("update", hasPermission)}
        canRevoke={mayPerformApiKeyAction("delete", hasPermission)}
      />

      {/* Revoke dialog */}
      <RevokeApiKeyDialog
        open={revokeDialogOpen}
        onOpenChange={handleRevokeDialogChange}
        apiKey={keyToRevoke}
      />
    </div>
  );
};

// ============================================================
// Page
// ============================================================

const ApiKeysPage: React.FC = () => {
  const { hasPermission } = useCurrentUserPermissions();
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer width="wide">
        <SettingsLayout
          title="API Keys"
          description="Manage secure access keys for API integrations"
          crumb="API Keys"
          actions={
            // The list is open to a reader holding only `read-api-keys`, and
            // the create route answers to `create-api-keys` or the update
            // umbrella. Offering the button to everyone admitted here would
            // send a reader to a page that turns them away.
            mayPerformApiKeyAction("create", hasPermission) ? (
              <Button
                size="md"
                onClick={() => navigateTo(ROUTES.SETTINGS_API_KEYS_CREATE)}
              >
                <Plus className="h-4 w-4" />
                <span>Create API Key</span>
              </Button>
            ) : undefined
          }
        >
          <ApiKeysContent />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default ApiKeysPage;
