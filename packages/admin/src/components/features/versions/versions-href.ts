/**
 * The address of a document's history page.
 *
 * Kept apart from the page it points at: both document editors link to a
 * comparison, and importing this from the page module would put the page, its
 * diff views and the read-only form they draw into every editor's own bundle.
 *
 * @module components/features/versions/versions-href
 */

import { ROUTES, buildRoute, withQuery } from "@admin/constants/routes";
import type { VersionScope } from "@admin/services/versionApi";

import type { ComparisonFrom } from "./version-search-params";

/**
 * The address of a document's history, with an optional pair already chosen.
 *
 * The locale travels with the pair. A localized document holds different text
 * per language, so the versions being compared and the name the page gives the
 * document are both questions the language answers — and a link that omits it
 * opens the French comparison under the English title.
 */
export function versionsHref(
  scope: VersionScope,
  pair?: { from: ComparisonFrom; to: number },
  locale?: string | null
): string {
  const path =
    scope.kind === "single"
      ? buildRoute(ROUTES.SINGLE_VERSIONS, { slug: scope.slug })
      : buildRoute(ROUTES.COLLECTION_ENTRY_VERSIONS, {
          slug: scope.slug,
          id: scope.entryId ?? "",
        });
  const query = {
    ...(pair ? { from: pair.from, to: pair.to } : {}),
    // Omitted rather than sent empty when there is none: a non-localized
    // document should carry no locale, and `?locale=` reads as one that failed
    // to resolve rather than one that was never asked for.
    ...(locale ? { locale } : {}),
  };
  return Object.keys(query).length > 0 ? withQuery(path, query) : path;
}
