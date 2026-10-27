"use client";

import type { JSX } from "react";

import { BrandDesign } from "@admin/components/features/email-hub/design/BrandDesign";
import { LayoutsList } from "@admin/components/features/email-hub/design/LayoutsList";
import { EmailHubLayout } from "@admin/components/features/email-hub/EmailHubLayout";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";

/**
 * Design: how every email looks. The brand settings beside a live preview,
 * where they reach, and the layouts emails are sent in.
 */
export default function EmailDesignPage(): JSX.Element {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <EmailHubLayout tab="design">
        <div className="space-y-6">
          <BrandDesign />
          <LayoutsList />
        </div>
      </EmailHubLayout>
    </QueryErrorBoundary>
  );
}
