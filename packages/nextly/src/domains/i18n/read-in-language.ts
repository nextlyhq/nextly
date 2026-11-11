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

import { buildTranslationStatusCondition } from "./companion-join";
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
