/**
 * A document's units as its callers are answered them, over REST and the Direct API alike.
 *
 * A suggestion is answered without who submitted it and without the document's own reference: the
 * one is nothing a translation page shows, and the other the caller named.
 *
 * @experimental
 *
 * @module domains/i18n/pipeline/unit-answer
 */

import type { DocumentCaller, TranslatedDocument } from "./document-access";
import type { TranslationUnit } from "./document-units";
import type { OpenSuggestion, SuggestedTranslation } from "./suggestion-store";
import { translationUnits } from "./units";

/**
 * An open suggestion, as it is answered.
 *
 * @experimental
 */
export interface SuggestionAnswer extends SuggestedTranslation {
  /** What accepting or dismissing it names. */
  id: string;
  /** When it was submitted, as an ISO string. */
  createdAt: string;
}

/**
 * One translatable text of a document, as it is answered.
 *
 * @experimental
 */
export interface UnitAnswer extends Omit<TranslationUnit, "suggestion"> {
  suggestion: SuggestionAnswer | null;
}

/**
 * A document's translatable texts in one language, as they are answered.
 *
 * @experimental
 */
export interface UnitsAnswer {
  locale: string;
  units: UnitAnswer[];
}

/** Each key named, so a column added to a suggestion is answered only once it is named here. */
function suggestionAnswer(suggestion: OpenSuggestion): SuggestionAnswer {
  const { id, value, origin, engine, model, sourceLocale, sourceFingerprint } =
    suggestion;
  return {
    id,
    value,
    origin,
    ...(engine === undefined ? {} : { engine }),
    ...(model === undefined ? {} : { model }),
    sourceLocale,
    sourceFingerprint,
    createdAt: suggestion.createdAt.toISOString(),
  };
}

/** The document's units in the language named, as the caller may know them. */
export async function unitsAnswer(
  document: TranslatedDocument,
  caller: DocumentCaller,
  named: { locale: string }
): Promise<UnitsAnswer> {
  const { locale, units } = await translationUnits(document, caller, named);
  return {
    locale,
    units: units.map(unit => ({
      ...unit,
      suggestion: unit.suggestion && suggestionAnswer(unit.suggestion),
    })),
  };
}
