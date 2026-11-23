"use client";

/**
 * Settings › Languages: the languages the site's content is written in, and
 * where an admin adds, edits, reorders and removes them and chooses the
 * default.
 */

import { Skeleton } from "@nextlyhq/ui";
import type React from "react";

import { LanguageSettings } from "@admin/components/features/settings/languages/LanguageSettings";
import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { PageContainer } from "@admin/components/layout/page-container";
import {
  PageErrorFallback,
  SectionErrorFallback,
} from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { useLanguageList } from "@admin/hooks/queries/useLanguageSettings";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";

const LANGUAGES_PAGE = {
  title: "Languages",
  description:
    "The languages your content is written in, in the order they are offered. The default language is the one content is edited in.",
  crumb: "Languages",
} as const;

export const LanguagesContent: React.FC = () => {
  const { data, error, refetch } = useLanguageList();

  if (error) {
    return (
      <SectionErrorFallback
        error={error}
        title="The languages could not be loaded"
        description={apiErrorMessage(error, "Try again in a moment.")}
        reset={() => {
          void refetch();
        }}
      />
    );
  }

  if (!data) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return <LanguageSettings list={data} />;
};

export default function LanguagesPage(): React.JSX.Element {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer type="list">
        <SettingsLayout {...LANGUAGES_PAGE}>
          <LanguagesContent />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}
