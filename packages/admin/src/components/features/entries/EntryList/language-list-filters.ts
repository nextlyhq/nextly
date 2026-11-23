/**
 * The entry list's language filter: "Missing in <language>" and "Out of date in <language>".
 *
 * Offered as the review filters are (`workflow-list-filters`): a `ListFilter` the toolbar draws,
 * whose choice is kept in the URL (`?pf=nextly.language:<value>`) and whose `where` is the
 * server's top-level `_translated` key, which `buildEntryWhereFilter` sends only for a reader who
 * may read every language's translation state. One filter rather than two, because the server
 * reads a single `_translated`: two filters chosen at once would send one and drop the other
 * while the URL claimed both.
 *
 * @module components/features/entries/EntryList/language-list-filters
 */
import type { TranslationFilterState } from "nextly/translation-filter-states";

import type { ListFilter } from "./plugin-filters";

/** The language filter's name: under core's own namespace, which no plugin slug can take. */
export const LANGUAGE_FILTER = "nextly.language";

/**
 * The states the filter offers, each with the value it is kept under in the URL and the words
 * it is offered with. The server's own state names are checked against its list at compile time.
 * A language code is letters, digits, `_` and `-` only, so the `.` separating it from the state
 * cannot be part of either.
 */
const OFFERED: readonly {
  state: TranslationFilterState;
  value: string;
  words: string;
}[] = [
  { state: "missing", value: "missing", words: "Missing in" },
  { state: "stale", value: "out-of-date", words: "Out of date in" },
];

/**
 * The language filter a collection's list offers: none below two languages, and no option for
 * the default language, which is the source and so is never missing or out of date.
 */
export function languageListFilters(
  locales: readonly { code: string; label: string }[],
  defaultLocale: string
): ListFilter[] {
  if (locales.length < 2) return [];
  const targets = locales.filter(locale => locale.code !== defaultLocale);
  if (targets.length === 0) return [];
  return [
    {
      name: LANGUAGE_FILTER,
      label: "Language",
      options: OFFERED.flatMap(({ state, value, words }) =>
        targets.map(locale => ({
          value: `${value}.${locale.code}`,
          label: `${words} ${locale.label}`,
          where: { _translated: { locale: locale.code, state } },
        }))
      ),
    },
  ];
}
