/**
 * What a read in a language answers when the document is not published in it.
 *
 * To a public reader of a language, a document not published in that language
 * is not there: a read of it answers not found, and a list leaves it out.
 * Asked for, whole-document fallback answers instead in the first language of
 * the fallback chain the document is published in, read as a request for that
 * language, and says which.
 *
 * One rule for collection entries and Singles alike, so the two cannot answer
 * one question differently.
 *
 * @module domains/i18n/read-in-language
 */
import type { SQL } from "drizzle-orm";

import {
  buildTranslationStatusCondition,
  SOURCE_LOCALES_KEY,
} from "./companion-join";
import { EVERY_TRANSLATION } from "./locale-selector";
import type { CompanionSchema } from "./runtime/companion-io";

/**
 * On a public read in a language, the condition keeping only the documents
 * published in it; `undefined` where there is nothing to keep out. Only where
 * the entity publishes each language on its own (`companion.hasStatus`):
 * elsewhere a document's one status is the only publication there is.
 * "Published in a language" is the language filter's `published` state, so
 * the two cannot disagree about which documents it names.
 */
export function publishedInLanguageCondition(args: {
  companion: CompanionSchema | null | undefined;
  isPublicRead: boolean;
  /** The read's language chain; its first language is the one requested. */
  localeChain: readonly string[] | null | undefined;
  mainIdColumn: unknown;
  defaultLocale: string | undefined;
}): SQL | undefined {
  const requested = args.localeChain?.[0];
  if (
    !args.isPublicRead ||
    args.companion?.hasStatus !== true ||
    requested === undefined ||
    args.defaultLocale === undefined
  ) {
    return undefined;
  }
  return buildTranslationStatusCondition({
    companionTableName: args.companion.companionTableName,
    mainIdColumn: args.mainIdColumn,
    localizedColumns: args.companion.localizedFields.map(field => field.column),
    hasStatus: true,
    defaultLocale: args.defaultLocale,
    filter: { locale: requested, state: "published" },
  });
}

/** The parts of a read's answer whole-document fallback looks at. */
interface ReadAnswer {
  success: boolean;
  statusCode?: number;
  data?: unknown;
}

/**
 * A read with whole-document fallback: each language of `chain` in turn, read
 * as a request for that language alone (`read`), so its relations, components,
 * field fallback and rules all answer in it. The first that finds the document
 * answers, its document marked with the language (`_locale`); a refusal other
 * than not found ends the read as it is.
 */
export async function readInFirstPublishedLanguage<T extends ReadAnswer>(
  chain: readonly [string, ...string[]],
  read: (locale: string) => Promise<T>
): Promise<T> {
  let answer = await read(chain[0]);
  for (const [index, locale] of chain.entries()) {
    if (index > 0) answer = await read(locale);
    if (answer.success) {
      return {
        ...answer,
        data:
          answer.data && typeof answer.data === "object"
            ? { ...answer.data, _locale: locale }
            : answer.data,
      };
    }
    if (answer.statusCode !== 404) return answer;
  }
  return answer;
}

/** The key a read's every-language values are attached under (`translations: "all"`). */
export const ALL_LOCALES_KEY = "_allLocales";

/** Whether `value` is a plain object of named values. */
function isValues(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every language's values (`{ field: { en, es } }`) passed through `strip` one
 * language at a time, as one row of that language's values: the strip a row's
 * own fields go through, so each language's value is withheld as the row's is.
 * A field `strip` drops in a language is absent from that language.
 */
function stripEachLanguage(
  every: Record<string, unknown>,
  strip: (values: Record<string, unknown>) => Record<string, unknown>
): Record<string, Record<string, unknown>> {
  const codes = new Set<string>();
  for (const value of Object.values(every)) {
    if (isValues(value)) for (const code of Object.keys(value)) codes.add(code);
  }
  const stripped: Record<string, Record<string, unknown>> = Object.fromEntries(
    Object.keys(every).map(name => [name, {}])
  );
  for (const code of codes) {
    const inLanguage = Object.fromEntries(
      Object.entries(every).map(([name, value]) => [
        name,
        isValues(value) ? value[code] : undefined,
      ])
    );
    for (const [name, value] of Object.entries(strip(inLanguage))) {
      if (name in stripped) stripped[name][code] = value;
    }
  }
  return stripped;
}

/**
 * Leave a row's side keys saying only what the row says. `_allLocales` and
 * `_sources` speak of the row's own translatable fields in other languages,
 * so a field the row's read withheld (a field read rule, a hidden-field
 * strip, a selection) is left out of both, and every language's values go
 * through `strip`, the strip the row's own values went through. Called once
 * a read has shaped the row; a side key the read did not attach stays absent.
 */
export function narrowToRowFields(
  row: Record<string, unknown>,
  strip?: (values: Record<string, unknown>) => Record<string, unknown>
): void {
  const every = row[ALL_LOCALES_KEY];
  if (strip && isValues(every)) {
    row[ALL_LOCALES_KEY] = stripEachLanguage(every, strip);
  }
  for (const key of [ALL_LOCALES_KEY, SOURCE_LOCALES_KEY]) {
    const side = row[key];
    if (!isValues(side)) continue;
    row[key] = Object.fromEntries(
      Object.entries(side).filter(([name]) => name in row)
    );
  }
}

/**
 * A read asked in `locale=all`, as the read it stands for: the default
 * language, every field its own type, with every language's values beside it
 * (`translations: "all"`, under {@link ALL_LOCALES_KEY}). Any other read is
 * returned as it is.
 */
export function readOfEveryLanguage<
  T extends { locale?: string; translations?: "all" },
>(params: T): T {
  return params.locale === EVERY_TRANSLATION
    ? { ...params, locale: undefined, translations: "all" }
    : params;
}
