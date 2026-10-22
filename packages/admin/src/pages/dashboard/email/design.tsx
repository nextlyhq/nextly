"use client";

import { LayoutsList } from "@admin/components/features/email-hub/design/LayoutsList";
import { EmailHubLayout } from "@admin/components/features/email-hub/EmailHubLayout";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";

/** Design: how every email looks, starting with the layouts they're sent in. */
export default function EmailDesignPage() {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <EmailHubLayout tab="design">
        <LayoutsList />
      </EmailHubLayout>
    </QueryErrorBoundary>
  );
}
