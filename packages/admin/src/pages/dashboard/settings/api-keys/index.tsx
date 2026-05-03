"use client";

import { Button } from "@revnixhq/ui";
import type React from "react";
import { useCallback, useState } from "react";

import { ApiKeyTable } from "@admin/components/features/api-keys/ApiKeyTable";
import { EditApiKeyDialog } from "@admin/components/features/api-keys/EditApiKeyDialog";
import { RevokeApiKeyDialog } from "@admin/components/features/api-keys/RevokeApiKeyDialog";
import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { Plus } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { ROUTES } from "@admin/constants/routes";
import { useApiKeys } from "@admin/hooks/queries/useApiKeys";
import { navigateTo } from "@admin/lib/navigation";
import type { ApiKeyMeta } from "@admin/services/apiKeyApi";

// ============================================================
// Inner content (inside QueryErrorBoundary)
// ============================================================

const ApiKeysContent: React.FC = () => {
  // Fetch keys
  const { data, isLoading, isError, error } = useApiKeys();

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [keyToEdit, setKeyToEdit] = useState<ApiKeyMeta | null>(null);

  // Revoke dialog state
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKeyMeta | null>(null);

  const handleEdit = useCallback((key: ApiKeyMeta) => {
    setKeyToEdit(key);
    setEditDialogOpen(true);
  }, []);

  const handleRevoke = useCallback((key: ApiKeyMeta) => {
    setKeyToRevoke(key);
    setRevokeDialogOpen(true);
  }, []);

  const handleEditDialogChange = useCallback((open: boolean) => {
    setEditDialogOpen(open);
    if (!open) setKeyToEdit(null);
  }, []);

  const handleRevokeDialogChange = useCallback((open: boolean) => {
    setRevokeDialogOpen(open);
    if (!open) setKeyToRevoke(null);
  }, []);

  // ── Error handling ──────────────────────────────────────────
  if (isError) {
    return <PageErrorFallback error={error || new Error("Failed to load API keys")} />;
  }

  // ── Loading handling ────────────────────────────────────────
  if (isLoading && !data) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex-1 max-w-md w-full">
            <SearchBar value="" onChange={() => {}} placeholder="Search API keys..." isLoading={true} className="bg-white text-black border-primary/5" />
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
      />

      {/* Edit dialog */}
      <EditApiKeyDialog
        open={editDialogOpen}
        onOpenChange={handleEditDialogChange}
        apiKey={keyToEdit}
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
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SettingsLayout
          actions={
            <Button
              size="md"
              onClick={() => navigateTo(ROUTES.SETTINGS_API_KEYS_CREATE)}
            >
              <Plus className="h-4 w-4" />
              <span>Create API Key</span>
            </Button>
          }
        >
          <ApiKeysContent />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default ApiKeysPage;
