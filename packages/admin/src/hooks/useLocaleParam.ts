"use client";

/**
 * Reading a content language out of the URL, honouring only languages the app
 * actually has.
 *
 * The editor addresses two languages by query param — the one being edited
 * (`?locale=`) and, in translation mode, the one being translated FROM
 * (`?translate=`) — and both owe the same rule: a hand-edited or stale code is
 * not sent to the API, which would answer for a language the app does not have.
 * An unknown code reads as absent rather than as an error the reader cannot act
 * on, because there is nothing for them to do about a URL they did not write.
 *
 * One implementation rather than two. The rule is three lines, which is exactly
 * the size at which a second copy gets written and then drifts — and the drift
 * would show up as one param accepting a language the other rejects, on the same
 * screen.
 *
 * @module hooks/useLocaleParam
 */

import { useLocalization } from "@admin/hooks/useLocalization";
import { useSearchParams } from "@admin/hooks/useSearchParams";
import { getSearchParam } from "@admin/lib/search-params";

/**
 * The requested code if the app configures it, otherwise undefined.
 *
 * Pure, so the rule can be tested without a router or a branding provider.
 */
export function resolveConfiguredLocale(
  requested: string | null,
  locales: readonly { code: string }[]
): string | undefined {
  if (!requested) return undefined;
  return locales.some(l => l.code === requested) ? requested : undefined;
}

/**
 * Read one query param as a configured content language.
 *
 * Reads straight off the parsed params rather than through `lib/routing`'s
 * helper: that module imports the page registry, so reaching into it from a
 * hook every page uses closes a cycle.
 */
export function useLocaleParam(param: string): string | undefined {
  const searchParams = useSearchParams();
  const { locales } = useLocalization();
  return resolveConfiguredLocale(getSearchParam(searchParams, param), locales);
}
