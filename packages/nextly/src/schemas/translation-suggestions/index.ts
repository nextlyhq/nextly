/**
 * `nextly_translation_suggestions`: the translation suggested for each text.
 *
 * @module schemas/translation-suggestions
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export { TRANSLATION_SUGGESTIONS_TABLE } from "./table-name";
export type { StoredSuggestionValue, SuggestionOrigin } from "./types";

export function translationSuggestionsTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyTranslationSuggestions } = loadedDialect(dialect).tables;
  return { nextlyTranslationSuggestions };
}
