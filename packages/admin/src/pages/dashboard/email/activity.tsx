"use client";

import type { JSX } from "react";

import { ActivityScreen } from "@admin/components/features/email-hub/activity/ActivityScreen";
import { EmailHubLayout } from "@admin/components/features/email-hub/EmailHubLayout";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";

/**
 * Activity: what happened to every email the site sent or queued, newest
 * first, with no address, subject or body kept.
 */
export default function EmailActivityPage(): JSX.Element {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <EmailHubLayout tab="activity">
        <ActivityScreen />
      </EmailHubLayout>
    </QueryErrorBoundary>
  );
}
