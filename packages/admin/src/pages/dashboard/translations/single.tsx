"use client";

/**
 * One Single, translated into one language.
 *
 * @module pages/dashboard/translations/single
 */

import type { JSX } from "react";

import { TranslationPage } from "@admin/components/features/translations/page/TranslationPage";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";

/** Params are given by the router from the address. */
interface TranslationSinglePageProps {
  params?: { slug?: string };
}

export default function TranslationSinglePage({
  params,
}: TranslationSinglePageProps): JSX.Element | null {
  const slug = params?.slug;
  // The route names it, so an address without one never matches it.
  if (!slug) return null;
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <TranslationPage document={{ kind: "single", slug }} />
    </QueryErrorBoundary>
  );
}
