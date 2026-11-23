/**
 * Whether the entry list offers its language filter, and the filter itself.
 *
 * Offered only where the list shows each row's languages: a site with two languages or more, a
 * collection whose content is per language, and a reader the server lets read every language's
 * translation state in the default language (`useDefaultLanguageAsksTranslationStatus`), since a
 * read filtered by one language's state is judged in every language and the server refuses the
 * whole list to anyone else.
 *
 * @module components/features/entries/EntryList/useLanguageListFilters
 */
import { useMemo } from "react";

import { useDefaultLanguageAsksTranslationStatus } from "@admin/hooks/useCanRequest";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { useLocalization } from "@admin/hooks/useLocalization";

import { languageListFilters } from "./language-list-filters";
import type { ListFilter } from "./plugin-filters";

export interface LanguageListFilters {
  /** The language filter, or none where the list does not offer it. */
  filters: ListFilter[];
  /**
   * Whether the answer that decides it is still on its way. A link choosing the filter waits for
   * it, as it waits for a plugin's filters: read without the filter, the list would show rows the
   * link did not ask for, and then take them away.
   */
  pending: boolean;
  /**
   * Whether that answer failed and none is in hand. The filter is then neither offered nor
   * refused: a link choosing it is not read at all, as a link choosing a plugin's filter is not
   * when the filters cannot be loaded, since the list without it is not the one the link asks
   * for. A refusal in hand is an answer, and drops the filter.
   */
  unavailable: boolean;
}

export function useLanguageListFilters(
  collectionSlug: string,
  collectionLocalized: boolean
): LanguageListFilters {
  const { enabled, locales = [], defaultLocale = "" } = useLocalization();
  const readsStates = useDefaultLanguageAsksTranslationStatus(collectionSlug);
  const { content } = useCurrentUserPermissions();
  const offers = enabled && collectionLocalized && readsStates;
  const filters = useMemo(
    () => (offers ? languageListFilters(locales, defaultLocale) : []),
    [offers, locales, defaultLocale]
  );
  // Only an answer in hand can refuse the filter: until then the reader's access is unknown.
  const undecided =
    enabled && collectionLocalized && !readsStates && !content.hasAnswer;
  return {
    filters,
    pending: undecided && content.isLoading,
    unavailable: undecided && !content.isLoading,
  };
}
