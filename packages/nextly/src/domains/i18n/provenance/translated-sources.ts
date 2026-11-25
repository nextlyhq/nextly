/**
 * What a save that says a value was translated from a language is asked before it writes anything:
 * whether the value may be translated from it, as the caller may know of it. Asked by a collection's
 * and a Single's save alike.
 *
 * Asked for a save of one language other than the default one: in the default language, and in
 * every language at once, where a value came from is not claimed, as with a copy.
 *
 * @experimental Until per-field provenance is complete.
 *
 * @module domains/i18n/provenance/translated-sources
 */
import { NextlyError } from "../../../errors/nextly-error";
import { DOCUMENT_PROVENANCE_KEY } from "../../../lib/system-columns";
import { EVERY_LOCALE } from "../locale-selector";
import type {
  DocumentCaller,
  TranslatedDocument,
} from "../pipeline/document-access";

import type { ProvenanceClaims } from "./provenance-claims";

/** What a save's body claims, and the language it writes. */
interface ClaimedWrite {
  claims: ProvenanceClaims | undefined;
  /** The language as the save names it. */
  locale: string | undefined;
  defaultLocale: string | undefined;
}

/** A write in one language that says some of its fields were translated. */
interface TranslatedWrite {
  claims: ProvenanceClaims;
  locale: string;
  fields: string[];
}

/** The fields a write says were translated; null where it says so of none, or it is not kept. */
function translatedIn(write: ClaimedWrite): TranslatedWrite | null {
  const { claims, locale, defaultLocale } = write;
  if (!claims || !locale) return null;
  if (locale === EVERY_LOCALE || locale === defaultLocale) return null;
  const fields = Object.keys(claims).filter(
    field => claims[field]?.origin === "translated"
  );
  return fields.length === 0 ? null : { claims, locale, fields };
}

/**
 * Refuses a write of a document that is not there yet which says a value was translated: no
 * language of it holds a text to translate from.
 */
export function refuseTranslatedCreate(write: ClaimedWrite): void {
  const translated = translatedIn(write);
  if (translated === null) return;
  throw NextlyError.validation({
    errors: translated.fields.map(field => ({
      path: `${DOCUMENT_PROVENANCE_KEY}.${field}.sourceLocale`,
      code: "PROVENANCE_SOURCE_NOT_ELIGIBLE",
      message: "The source has no text of its own here.",
    })),
  });
}

/** Who asks for a save, as its options say. */
interface SaveCaller extends DocumentCaller {
  /** The route ran its own check: a person's save all the same, never trusted code's. */
  routeAuthorized?: boolean;
}

/** Refuses a save whose body says a field was translated from a language it may not be. */
export async function assertSourcesEligible(
  write: ClaimedWrite & { document: TranslatedDocument; caller: SaveCaller }
): Promise<void> {
  const translated = translatedIn(write);
  if (translated === null) return;
  const { user, authenticatedScope, request, context } = write.caller;
  // Loaded only for a save that says so.
  const { assertTranslatedSources } = await import("../pipeline/units");
  await assertTranslatedSources(
    write.document,
    {
      user,
      authenticatedScope,
      request,
      context,
      overrideAccess:
        write.caller.overrideAccess === true &&
        write.caller.routeAuthorized !== true,
    },
    translated.locale,
    translated.claims
  );
}
