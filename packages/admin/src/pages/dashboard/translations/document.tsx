"use client";

/**
 * One entry of a collection, translated into one language.
 *
 * @module pages/dashboard/translations/document
 */

import type { JSX } from "react";

import { TranslationPage } from "@admin/components/features/translations/page/TranslationPage";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";

/** Params are given by the router from the address. */
interface TranslationEntryPageProps {
  params?: { slug?: string; id?: string };
}

export default function TranslationEntryPage({
  params,
}: TranslationEntryPageProps): JSX.Element | null {
  const slug = params?.slug;
  const id = params?.id;
  // The route names both, so an address without one never matches it.
  if (!slug || !id) return null;
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <TranslationPage document={{ kind: "collection", slug, id }} />
    </QueryErrorBoundary>
  );
}
