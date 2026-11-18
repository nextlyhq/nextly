"use client";

/**
 * Settings › Workflows: every workflow the code defines, one card each, each
 * opening its own page. Stages and steps are the code's, so none is made or
 * removed here.
 */

import { Alert, AlertDescription, Button, Skeleton } from "@nextlyhq/ui";
import type React from "react";

import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { WorkflowList } from "@admin/components/features/settings/workflows/WorkflowList";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { useWorkflows } from "@admin/hooks/queries/useWorkflows";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";

const WORKFLOWS_PAGE = {
  title: "Workflows",
  description:
    "Stages and steps are defined in code, so every environment runs the same workflow. Here you decide who takes each step.",
  crumb: "Workflows",
} as const;

/** Where a developer reads how workflows are defined and what the API offers. */
const WORKFLOWS_DOCS =
  "https://nextlyhq.com/docs/api-reference/rest-api#workflows-experimental";

export const WorkflowsContent: React.FC = () => {
  const { data, error, refetch } = useWorkflows();

  if (error) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription className="space-y-3">
          <p>{apiErrorMessage(error, "The workflows could not be loaded.")}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void refetch();
            }}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-card-foreground">
        <h2 className="text-base font-semibold">
          No workflows are defined in code
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A workflow is defined with <code>defineWorkflow</code> and attached to
          a collection or Single with its <code>workflow</code> option. Once one
          is attached, it is listed here.
        </p>
        <a
          href={WORKFLOWS_DOCS}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-sm font-medium text-foreground underline underline-offset-4"
        >
          Read about workflows
        </a>
      </div>
    );
  }

  return <WorkflowList workflows={data.items} />;
};

export default function WorkflowsPage(): React.JSX.Element {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer type="list">
        <SettingsLayout {...WORKFLOWS_PAGE}>
          <WorkflowsContent />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}
