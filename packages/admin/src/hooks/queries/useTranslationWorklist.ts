/**
 * The translation worklist, for one language.
 *
 * Reads `GET /api/translations`. The language is REQUIRED by the endpoint — a
 * worklist for nobody's language is a list of work that is not theirs — so the
 * query stays disabled until one is chosen rather than guessing the default.
 *
 * @module hooks/queries/useTranslationWorklist
 */

import { useQuery } from "@tanstack/react-query";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type {
  TranslationWorklistResponse,
  WorklistState,
} from "@admin/types/translations/worklist";

export interface TranslationWorklistParams {
  /** The language being worked on. Undefined until the author picks one. */
  locale: string | undefined;
  state: WorklistState;
  limit?: number;
}

export function useTranslationWorklist({
  locale,
  state,
  limit = 50,
}: TranslationWorklistParams) {
  return useQuery<TranslationWorklistResponse, Error>({
    queryKey: ["translations", "worklist", locale, state, limit],
    queryFn: () =>
      protectedApi.get<TranslationWorklistResponse>(
        `/translations?locale=${encodeURIComponent(locale ?? "")}&state=${state}&limit=${limit}`
      ),
    // Nothing to ask until a language is chosen. Firing with an empty locale
    // would spend a request to be told it is required.
    enabled: locale !== undefined && locale !== "",
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    retry: 2,
    // Work appears because someone else edited a document, so a list that is
    // only correct on mount is worse than no list — it is a stale claim about
    // what is left to do.
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}
