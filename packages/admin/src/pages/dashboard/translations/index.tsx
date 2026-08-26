"use client";

/**
 * The translation worklist page.
 *
 * A page rather than a panel because the question is not about any one
 * document: it spans every collection, and there is no document open to hang it
 * off. The language and the state live in the URL for the reasons the editor's
 * locale does — a colleague can be sent "the Spanish backlog", it survives a
 * reload, and the back button works.
 *
 * @module pages/dashboard/translations
 */

import { TranslationWorklist } from "@admin/components/features/translations/TranslationWorklist";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { LOCALE_PARAM } from "@admin/constants/search-params";
import { useSearchParams } from "@admin/hooks/useSearchParams";
import { setSearchParam } from "@admin/lib/navigation";
import type { WorklistState } from "@admin/types/translations/worklist";

const STATE_PARAM = "state";

/**
 * One value from a query parameter that may legitimately arrive repeated.
 *
 * `?locale=es&locale=fr` is a question with two answers, and this page can only
 * ask one. The FIRST is taken rather than the last, so the same URL always
 * yields the same worklist — a hand-edited or double-appended link is then
 * merely odd rather than nondeterministic.
 */
function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The states this page will honour from a URL, so a stale link cannot ask for nonsense. */
const STATES: readonly WorklistState[] = [
  "missing",
  "translated",
  "draft",
  "published",
];

export default function TranslationsPage() {
  const params = useSearchParams();
  const localeParam = single(params[LOCALE_PARAM]);
  const stateParam = single(params[STATE_PARAM]);
  // A hand-edited or stale link falls back to the question this page exists
  // for, rather than erroring at someone who only followed a link.
  const state = STATES.find(s => s === stateParam) ?? "missing";

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <div className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight">Translations</h1>
          <p className="mt-1 text-sm font-normal text-muted-foreground">
            What needs translating, across every collection, in one language.
          </p>
        </div>
        <TranslationWorklist
          locale={localeParam ?? undefined}
          state={state}
          onLocaleChange={code => setSearchParam(LOCALE_PARAM, code)}
          onStateChange={next => setSearchParam(STATE_PARAM, next)}
        />
      </PageContainer>
    </QueryErrorBoundary>
  );
}
