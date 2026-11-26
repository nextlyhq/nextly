/**
 * Suggested translations: submitted beside a document, and accepted or dismissed by a person.
 *
 * A suggestion changes nothing until it is accepted. Accepting it is the ordinary save of that one
 * text in its language, with where the text came from, and takes the suggestion out in the same
 * transaction: the text is written and the suggestion gone, or neither.
 *
 * Submitting has no route: server code alone calls it.
 *
 * @experimental
 *
 * @module domains/i18n/pipeline/suggestions
 */

import { isDeepStrictEqual } from "node:util";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { RequestActor } from "../../../auth/request-actor";
import { getService } from "../../../di";
import { NextlyError } from "../../../errors";
import { errorFromServiceEnvelope } from "../../../errors/from-service-envelope";
import { DOCUMENT_VERSION_KEY } from "../../../lib/system-columns";
import { isPlainObject } from "../../../shared/lib/plain-copy";
import { transactionTableProbe } from "../../dashboard/table-presence";
import {
  pruneSources,
  translationSourcesPresent,
} from "../provenance/source-text";

import type { SuggestionAcceptance } from "./acceptance";
import {
  assertFieldsEditable,
  assertSignedInPerson,
  readDocumentIn,
  type DocumentCaller,
  type TranslatedDocument,
} from "./document-access";
import { readableTexts } from "./document-units";
import { translationSuggestionsPresent } from "./suggestion-rows";
import {
  keepSuggestion,
  takeSuggestion,
  type OpenSuggestion,
  type SuggestedTranslation,
} from "./suggestion-store";
import {
  unitField,
  unitKey,
  unitProvenancePath,
  type UnitAddress,
} from "./unit-address";
import { withUnitValue } from "./unit-value";
import {
  documentNotFound,
  holdForChange,
  pathOf,
  readableSuggestions,
  readUnits,
  unknownSource,
  type UnitsReading,
} from "./units";

/** One suggestion, as a caller names it: in a language of a document. */
export interface NamedSuggestion {
  locale: string;
  id: string;
}

/** Refused until the tables suggestions need are there. */
async function assertKept({ adapter, logger }: UnitsReading): Promise<void> {
  if (await translationSuggestionsPresent(adapter, logger)) return;
  throw NextlyError.conflict({
    reason: "state",
    message: "Suggestions can't be kept yet. Run `nextly migrate` first.",
    logContext: { reason: "translation-suggestions-missing" },
  });
}

/** The suggestion named, among those the caller may read; not found otherwise. */
async function named(
  document: TranslatedDocument,
  reading: UnitsReading,
  { id }: NamedSuggestion
): Promise<OpenSuggestion> {
  const open = await readableSuggestions(reading);
  const suggestion = [...open.values()].find(each => each.id === id);
  if (suggestion === undefined) {
    throw documentNotFound(document, reading.languages.target);
  }
  return suggestion;
}

/** The refusal of a text the document has no place for any more. */
function textGone(address: UnitAddress): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: unitField(address),
        code: "SUGGESTED_TEXT_GONE",
        message:
          "The text this suggestion is for is no longer in the document. Dismiss the suggestion.",
      },
    ],
  });
}

/**
 * The body a save of one text sends: its own field, with that text replaced, and the version read.
 * `whole` is the document to take the field from, where that is not what the caller was shown.
 */
function bodyOf(
  { document }: UnitsReading,
  address: UnitAddress,
  text: unknown,
  whole: Readonly<Record<string, unknown>> = document.written
): Record<string, unknown> {
  const replaced = withUnitValue(whole, address, text);
  if (replaced === undefined) throw textGone(address);
  // Judged as any save is: refused where the document moved on since it was
  // read, so a container, which is sent whole, never puts an older row back.
  return {
    [replaced.field]: replaced.value,
    [DOCUMENT_VERSION_KEY]: document.written[DOCUMENT_VERSION_KEY],
  };
}

/**
 * The document with nothing in it left out, as a save of one text inside a field takes the rest of
 * the field from: the field is written whole, so a value there the caller may not read would be
 * lost with it. A field that is one text has no rest.
 */
async function wholeDocument(
  document: TranslatedDocument,
  caller: DocumentCaller,
  { document: read, languages }: UnitsReading,
  address: UnitAddress
): Promise<Readonly<Record<string, unknown>>> {
  if (address.length === 1) return read.written;
  const { request, context } = caller;
  const whole = await readDocumentIn(
    document,
    { overrideAccess: true, request, context },
    languages.target,
    { draft: true }
  );
  if (whole === null) throw documentNotFound(document, languages.target);
  return whole;
}

/** Removes, on `tx`, the source text of one text that nothing names any more. */
async function pruneTextSources(
  { adapter, logger, stored }: UnitsReading,
  tx: TransactionContext,
  address: UnitAddress
): Promise<void> {
  const kept = await translationSourcesPresent(
    adapter,
    logger,
    transactionTableProbe(adapter, tx)
  );
  if (!kept) return;
  await pruneSources({ db: tx, suggestionsKept: true }, stored, [
    unitProvenancePath(address),
  ]);
}

/** What an accepted suggestion answers: the document's version now, for the next save of it. */
export interface AcceptedSuggestion {
  version?: string;
}

/** The save of `body` in the language, as the caller, with the acceptance told to it. */
async function save(
  document: TranslatedDocument,
  caller: DocumentCaller,
  locale: string,
  body: Record<string, unknown>,
  acceptance: SuggestionAcceptance
): Promise<AcceptedSuggestion> {
  const options = {
    user: caller.user,
    authenticatedScope: caller.authenticatedScope,
    request: caller.request,
    context: caller.context,
    overrideAccess: false,
    locale,
    acceptance,
  };
  const answer =
    document.kind === "collection"
      ? await getService("collectionsHandler").updateEntry(
          {
            collectionName: document.slug,
            entryId: document.id,
            ...options,
          },
          body
        )
      : await getService("singleEntryService").update(
          document.slug,
          body,
          options
        );
  if (answer.success) {
    const saved: unknown = answer.data;
    const version = isPlainObject(saved)
      ? saved[DOCUMENT_VERSION_KEY]
      : undefined;
    return typeof version === "string" ? { version } : {};
  }
  throw errorFromServiceEnvelope(
    {
      ...answer,
      message: answer.message ?? "The suggestion could not be accepted",
    },
    { reason: "suggestion-accept-failed" }
  );
}

/**
 * Accepts a suggestion: its text, or the one the person changed it to (`value`), becomes that
 * language's, as their own save of it would, and the suggestion is gone. A signed-in person alone
 * may: the judgement is theirs.
 */
export async function acceptSuggestion(
  document: TranslatedDocument,
  caller: DocumentCaller,
  input: NamedSuggestion & { value?: unknown }
): Promise<AcceptedSuggestion> {
  assertSignedInPerson(caller, "accept a suggestion");
  const reading = await readUnits(document, caller, input.locale);
  const suggestion = await named(document, reading, input);
  const { address } = suggestion;
  const { target } = reading.languages;
  const changed =
    Object.hasOwn(input, "value") &&
    !isDeepStrictEqual(input.value, suggestion.value);
  const body = bodyOf(
    reading,
    address,
    changed ? input.value : suggestion.value,
    await wholeDocument(document, caller, reading, address)
  );
  // Asked again of the row by the save itself, as any save asks it.
  await assertFieldsEditable(document, caller, target, body, [pathOf(address)]);
  return save(document, caller, target, body, {
    claims: {
      [unitProvenancePath(address)]: {
        origin: "suggestion",
        made: changed ? "person" : suggestion.origin,
        ...(changed || suggestion.engine === undefined
          ? {}
          : { engine: suggestion.engine }),
        sourceLocale: suggestion.sourceLocale,
        sourceFingerprint: suggestion.sourceFingerprint,
      },
    },
    onWritten: async tx => {
      await takeSuggestion(tx, suggestion);
      // The save's own prune came while the suggestion still named its source.
      await pruneTextSources(reading, tx, address);
    },
  });
}

/** Dismisses a suggestion, by whoever may change the text it is for. The text stays as it is. */
export async function dismissSuggestion(
  document: TranslatedDocument,
  caller: DocumentCaller,
  input: NamedSuggestion
): Promise<void> {
  const reading = await readUnits(document, caller, input.locale);
  const suggestion = await named(document, reading, input);
  const { address } = suggestion;
  const { written } = reading.document;
  const field = unitField(address);
  const text = withUnitValue(written, address, suggestion.value);
  // The document's own field for one whose text is gone, which can still be
  // dismissed.
  const assertStillEditable = await assertFieldsEditable(
    document,
    caller,
    reading.languages.target,
    { [field]: text === undefined ? written[field] : text.value },
    [text === undefined ? [{ field }] : pathOf(address)]
  );
  await reading.adapter.transaction(async tx => {
    await holdForChange(reading, tx, assertStillEditable);
    await takeSuggestion(tx, suggestion);
    // The source text it alone was made from goes with it.
    await pruneTextSources(reading, tx, address);
  });
}

/**
 * Submits a suggestion for one text, in the place of the one it had, and answers its id. The caller
 * must be able to change the text: a suggestion is an edit someone else may accept.
 */
export async function submitSuggestion(
  document: TranslatedDocument,
  caller: DocumentCaller,
  suggested: SuggestedTranslation & { locale: string; address: UnitAddress },
  by?: RequestActor
): Promise<string> {
  const { locale, address, ...suggestion } = suggested;
  const reading = await readUnits(document, caller, locale);
  await assertKept(reading);
  const key = unitKey(address);
  if (!readableTexts(reading.document).some(text => unitKey(text) === key)) {
    throw documentNotFound(document, reading.languages.target);
  }
  const unknown = unknownSource(reading, address, suggestion.sourceLocale);
  if (unknown !== null) {
    throw NextlyError.validation({
      errors: [
        {
          path: "sourceLocale",
          code: "SUGGESTION_SOURCE_UNKNOWN",
          message: unknown,
        },
      ],
    });
  }
  const body = bodyOf(reading, address, suggestion.value);
  const assertStillEditable = await assertFieldsEditable(
    document,
    caller,
    reading.languages.target,
    body,
    [pathOf(address)]
  );
  return keepSuggestion(
    reading.adapter,
    {
      document: reading.stored,
      targetLocale: reading.languages.target,
      address,
    },
    suggestion,
    by,
    new Date(),
    {
      before: tx => holdForChange(reading, tx, assertStillEditable),
      // The source text the one replaced alone was made from goes with it.
      onReplaced: tx => pruneTextSources(reading, tx, address),
    }
  );
}
