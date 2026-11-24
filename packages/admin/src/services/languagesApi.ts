/**
 * The admin's client for `/api/languages`: the site's languages, what making
 * one the default would touch, and one change at a time.
 *
 * Thin over `fetcher`, like every other service here. The list answers in the
 * list envelope with `meta.lockedByConfig`, and a change answers with the list
 * after it as the mutation's `item`; both are read here into one shape, so the
 * screen holds one list whichever answered last.
 *
 * @module services/languagesApi
 */

import { fetcher } from "../lib/api/fetcher";
import type {
  ListResponse,
  MutationResponse,
  PaginationMeta,
} from "../lib/api/response-types";
import type {
  DefaultChangeSummary,
  LanguageChange,
  LanguageList,
  LanguageView,
} from "../types/languages";

/** The languages, the removed ones included, and whether the configuration locks them. */
export async function listLanguages(): Promise<LanguageList> {
  const result = await fetcher<
    ListResponse<LanguageView> & {
      meta: PaginationMeta & { lockedByConfig?: boolean };
    }
  >("/languages", { cache: "no-store" }, true);
  return {
    lockedByConfig: result.meta.lockedByConfig === true,
    languages: result.items,
  };
}

/**
 * What making `code` the default would touch. Asked of the current default, it
 * changes nothing and answers how much content each language holds.
 */
export function previewDefaultChange(
  code: string
): Promise<DefaultChangeSummary> {
  return fetcher<DefaultChangeSummary>(
    `/languages?defaultPreview=${encodeURIComponent(code)}`,
    { cache: "no-store" },
    true
  );
}

/** Makes one change, answering the list as it then reads. */
export async function changeLanguages(
  change: LanguageChange
): Promise<LanguageList> {
  const result = await fetcher<MutationResponse<LanguageList>>(
    "/languages",
    { method: "POST", body: JSON.stringify(change) },
    true
  );
  return result.item;
}
