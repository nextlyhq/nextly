"use client";

/**
 * Settings › Workflows › one workflow: its definition, read-only, and the
 * settings admins own about it. The workflow is named by the route's slug.
 */

import type React from "react";

import { WorkflowSettingsDetail } from "@admin/components/features/settings/workflows/WorkflowSettingsDetail";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { useRouter } from "@admin/hooks/useRouter";

export default function WorkflowDetailPage(): React.JSX.Element {
  const { route } = useRouter();
  const slug = typeof route?.params?.slug === "string" ? route.params.slug : "";
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer type="form">
        {/* Keyed by the workflow, so a choice not yet saved on one never shows on another. */}
        <WorkflowSettingsDetail key={slug} slug={slug} />
      </PageContainer>
    </QueryErrorBoundary>
  );
}
