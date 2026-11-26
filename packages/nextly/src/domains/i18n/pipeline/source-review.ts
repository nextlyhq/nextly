/**
 * Showing what changed in the source of one translated field since its translation was made, and
 * keeping that translation as it is: "this is still right against the source as it is now".
 *
 * @experimental
 *
 * @module domains/i18n/pipeline/source-review
 */
import { isDeepStrictEqual } from "node:util";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { getService } from "../../../di";
import { NextlyError } from "../../../errors";
import { getActiveHookRegistry } from "../../../hooks/hook-registry";
import { storedHookExecutor } from "../../../hooks/stored-hook-executor";
import { getFieldFunctions } from "../../../shared/lib/field-level-registry";
import type { Logger } from "../../../shared/types";
import { transactionTableProbe } from "../../dashboard/table-presence";
import { getSingleHookCollection } from "../../singles/services/single-query-service";
import { isBlank } from "../blank-value";
import type { SanitizedLocalizationConfig } from "../config/types";
import { appLocalization } from "../configured-locales";
import {
  publishesPerLanguage,
  storesPerLanguage,
} from "../per-language-storage";
import { reviewTexts } from "../provenance/container-review";
import { translationProvenancePresent } from "../provenance/record-provenance";
import {
  sourceReaderOf,
  translationSourcesPresent,
  type SourceDocument,
} from "../provenance/source-text";
import {
  fieldRecords,
  fieldSource,
  liveFingerprint,
  reviewField,
  shownRecords,
  type FieldRecord,
  type SourceUnavailable,
  type TranslatedField,
} from "../provenance/translation-review";
import { valueFingerprint } from "../provenance/value-fingerprint";
import { configuredLocale } from "../resolve-locale";
import {
  buildCompanionSchema,
  type CompanionSchema,
} from "../runtime/companion-io";
import { isCompanionReady } from "../runtime/companion-readiness";
import { withComponentShapesOf } from "../runtime/component-shapes";

import {
  assertFieldsEditable,
  assertSignedInPerson,
  documentIdOf,
  readDocumentIn,
  showsHeldDraft,
  type DocumentCaller,
  type TranslatedDocument,
} from "./document-access";
import { translationSuggestionsPresent } from "./suggestion-rows";

/** One translated field, as a caller names it. */
export interface FieldInLanguage {
  /** The translation's language. */
  locale: string;
  /** The field's name. */
  field: string;
}

/**
 * The fingerprints "Keep current" is sent back with: of the translation, and of the source as it is
 * now. Each is absent where there is none to name.
 */
interface ReviewFingerprints {
  valueFingerprint?: string;
  sourceFingerprint?: string;
}

/**
 * What changed in a translated field's source since its translation was made: the source then
 * (`before`) and now (`after`), each in the field's stored form. `available` tells a source that was
 * empty, whose `before` is empty, from one whose text is not there to show.
 */
export type SourceChange = ReviewFingerprints &
  (
    | {
        available: true;
        sourceLocale: string;
        before: unknown;
        after: unknown;
      }
    | {
        available: false;
        reason: SourceUnavailable;
        /** Absent for a value written originally in its own language. */
        sourceLocale?: string;
        after?: unknown;
      }
  );

/** What a "Keep current" names beside the field: what the person was shown. */
export interface KeepCurrentInput extends FieldInLanguage {
  valueFingerprint: string;
  sourceFingerprint: string;
}

/** The document's translations, as its records and its translation table hold them. */
interface TranslationStore {
  adapter: DrizzleAdapter;
  logger: Logger;
  document: SourceDocument;
  mainTable: string;
  companion: CompanionSchema;
  field: TranslatedField;
  /** Whether a hook may change the field as it is read. */
  readThroughHook: boolean;
}

/** A refusal of a request naming a language or a field that is not one to ask about. */
function refuse(path: string, code: string, message: string): never {
  throw NextlyError.validation({ errors: [{ path, code, message }] });
}

/** The refusal of a document or field the caller is told nothing of. */
function notFound(
  document: TranslatedDocument,
  named: FieldInLanguage
): NextlyError {
  return NextlyError.notFound({
    logContext: {
      reason: "translated-field-not-found",
      kind: document.kind,
      slug: document.slug,
      locale: named.locale,
      field: named.field,
    },
  });
}

/** The language named, as configured: a translation's, and so not the default one. */
export function translationLanguage(
  localization: SanitizedLocalizationConfig | undefined,
  named: string
): string {
  const locale =
    localization === undefined
      ? undefined
      : configuredLocale(localization, named);
  if (locale === undefined) {
    refuse(
      "locale",
      "UNKNOWN_LANGUAGE",
      "That is not one of the site's languages."
    );
  }
  if (locale === localization?.defaultLocale) {
    refuse(
      "locale",
      "LANGUAGE_IS_THE_DEFAULT",
      "The default language's values are not translated from another language."
    );
  }
  return locale;
}

/** The document's collection or Single, as it is registered. */
export function registeredEntity(document: TranslatedDocument) {
  return document.kind === "collection"
    ? getService("collectionRegistryService").getCollectionBySlug(document.slug)
    : getService("singleRegistryService").getSingleBySlug(document.slug);
}

/**
 * Whether a hook may change `field` as it is read: one of the entity's, in code or kept with it, a
 * global one, or the field's own. Asked of what is registered, since what a hook makes of today's
 * value says nothing of what it would make of another.
 */
function readThroughHook(
  document: TranslatedDocument,
  record: NonNullable<Awaited<ReturnType<typeof registeredEntity>>>,
  field: string
): boolean {
  const named =
    document.kind === "collection"
      ? document.slug
      : getSingleHookCollection(document.slug);
  if (getActiveHookRegistry().hasHooks("afterRead", named)) return true;
  if (
    "hooks" in record &&
    storedHookExecutor.hasHooks("afterRead", record.hooks)
  ) {
    return true;
  }
  const own = getFieldFunctions(document.kind, document.slug)?.[field];
  return (own?.hooks?.afterRead?.length ?? 0) > 0;
}

/** The entity's translation table, or null where it has none or it is not there yet. */
export async function translationTableOf(
  adapter: DrizzleAdapter,
  record: NonNullable<Awaited<ReturnType<typeof registeredEntity>>>
): Promise<CompanionSchema | null> {
  if (!storesPerLanguage(record)) return null;
  const companion = buildCompanionSchema({
    slug: record.slug,
    tableName: record.tableName,
    fields: (record.fields ?? []) as unknown as Parameters<
      typeof buildCompanionSchema
    >[0]["fields"],
    dialect: adapter.dialect,
    status: publishesPerLanguage(record),
  });
  if (!companion) return null;
  return (await isCompanionReady(adapter, companion.companionTableName))
    ? companion
    : null;
}

/**
 * Where the document's translations of the field are kept. Asked only once the caller may read it:
 * a field that is not translated is refused by name, and one that is not there answers not found.
 */
async function translationStore(
  document: TranslatedDocument,
  named: FieldInLanguage
): Promise<TranslationStore> {
  const localization = appLocalization();
  const locale = translationLanguage(localization, named.locale);
  const record = await registeredEntity(document);
  const entryId = await documentIdOf(document);
  if (!localization || !record?.tableName || entryId === null) {
    throw notFound(document, named);
  }
  const adapter = getService("adapter");
  const companion = await withComponentShapesOf(
    await translationTableOf(adapter, record)
  );
  if (!companion?.localizedFields.some(ref => ref.name === named.field)) {
    refuse("field", "FIELD_NOT_TRANSLATED", "That field is not translated.");
  }
  const source: SourceDocument = {
    scopeKind: document.kind,
    scopeSlug: document.slug,
    entryId,
  };
  return {
    adapter,
    logger: getService("logger"),
    document: source,
    mainTable: record.tableName,
    companion,
    field: {
      document: source,
      locale,
      defaultLocale: localization.defaultLocale,
      fieldPath: named.field,
    },
    readThroughHook: readThroughHook(document, record, named.field),
  };
}

/** The document as the caller reads it, refused where they may not read the field in it. */
async function readableField(
  document: TranslatedDocument,
  caller: DocumentCaller,
  named: FieldInLanguage,
  locale: string,
  draft: boolean
): Promise<Record<string, unknown>> {
  const read = await readDocumentIn(document, caller, locale, { draft });
  if (read === null || !Object.hasOwn(read, named.field)) {
    throw notFound(document, named);
  }
  return read;
}

/** The translation as the caller is shown it, and whether that is the held draft's value. */
async function shownTranslation(
  document: TranslatedDocument,
  caller: DocumentCaller,
  named: FieldInLanguage,
  locale: string
): Promise<{ value: unknown; heldDraft: boolean }> {
  const read = await readableField(document, caller, named, locale, true);
  return {
    value: read[named.field],
    heldDraft: await showsHeldDraft(document, caller, locale, read),
  };
}

/** The source's live value as the caller reads it. */
async function readableSource(
  document: TranslatedDocument,
  caller: DocumentCaller,
  named: FieldInLanguage,
  sourceLocale: string
): Promise<unknown> {
  const read = await readableField(
    document,
    caller,
    named,
    sourceLocale,
    false
  );
  return read[named.field];
}

/**
 * Whether a held draft's `value` is that of a cleared translation, which has no record: the live
 * one's is not of what is shown. A blank a hook may have made says nothing of what is stored.
 */
function clearedIn(store: TranslationStore, value: unknown): boolean {
  return isBlank(value) && !store.readThroughHook;
}

/** Whether a recorded language is still one of the site's: a read in one that is not is of another. */
function isConfigured(locale: string): boolean {
  const localization = appLocalization();
  return (
    localization !== undefined &&
    configuredLocale(localization, locale) !== undefined
  );
}

/**
 * A reading of something that may be saved as it is read: read once more where the first was, and
 * answered as it is where that one was too, which its `settled` tells.
 */
export async function readSettled<T extends { settled: boolean }>(
  attempt: () => Promise<T>
): Promise<T> {
  const first = await attempt();
  return first.settled ? first : attempt();
}

/**
 * The record of the translation the caller is shown, and that value's fingerprint. A translation
 * saved at each reading of it is answered with no fingerprint, so none is kept as it is in a version
 * the caller was not shown.
 */
async function translationNow(
  store: TranslationStore,
  recorded: boolean,
  read: () => Promise<{ value: unknown; heldDraft: boolean }>
): Promise<{ record?: FieldRecord; fingerprint?: string }> {
  const { adapter, field } = store;
  const keptNow = async () => ({
    records: recorded ? await fieldRecords(adapter, field) : {},
    stored: (await storedReader(store)(field.locale)).get(field.fieldPath)
      ?.fingerprint,
  });
  const { value, heldDraft, kept, settled } = await readSettled(async () => {
    const before = await keptNow();
    const shown = await read();
    const kept = await keptNow();
    return { ...shown, kept, settled: isDeepStrictEqual(before, kept) };
  });
  if (heldDraft && clearedIn(store, value)) return {};
  const record = shownRecords(kept.records, heldDraft).at(0);
  return {
    record,
    fingerprint: settled
      ? (record?.valueFingerprint ?? kept.stored)
      : undefined,
  };
}

/**
 * The source's live value as the caller reads it, and that value's fingerprint. A source saved
 * while it is read is read once more; saved again, it is answered with no fingerprint, so nothing
 * is reviewed against a version the caller was not shown.
 */
async function sourceNow(
  store: TranslationStore,
  recorded: boolean,
  sourceLocale: string,
  read: () => Promise<unknown>
): Promise<{ after: unknown; fingerprint?: string }> {
  const { adapter, field } = store;
  const fingerprintNow = async () =>
    (recorded
      ? await liveFingerprint(adapter, field, sourceLocale)
      : undefined) ??
    (await storedReader(store)(sourceLocale)).get(field.fieldPath)?.fingerprint;
  const { after, fingerprint, settled } = await readSettled(async () => {
    const before = await fingerprintNow();
    const after = await read();
    const fingerprint = await fingerprintNow();
    return { after, fingerprint, settled: before === fingerprint };
  });
  return settled ? { after, fingerprint } : { after };
}

/**
 * What changed in the source of one translated field since its translation was made.
 *
 * The caller must be able to read the field in both languages now: the kept text is content, and a
 * person who has lost the right to it is told nothing of what it was. No hook saw that text, so none
 * is shown where one may change the field as it is read: what it would have made of the older text
 * is not known. Nor where the source does not read to this caller as it is stored, for any reason.
 *
 * Everything told is of the value the caller is shown: the held draft's, or the live one where they
 * are shown that.
 */
export async function sourceChange(
  document: TranslatedDocument,
  caller: DocumentCaller,
  named: FieldInLanguage
): Promise<SourceChange> {
  const locale = translationLanguage(appLocalization(), named.locale);
  // Asked first: the store answers more of the field than one who may not read it is told.
  await readableField(document, caller, named, locale, true);
  const store = await translationStore(document, named);
  const { adapter, field } = store;
  const recorded = await translationProvenancePresent(adapter, store.logger);
  const { record, fingerprint } = await translationNow(store, recorded, () =>
    shownTranslation(document, caller, named, locale)
  );
  const source = await fieldSource(
    adapter,
    field,
    record,
    await translationSourcesPresent(adapter, store.logger)
  );
  const shown: ReviewFingerprints =
    fingerprint === undefined ? {} : { valueFingerprint: fingerprint };
  const { sourceLocale } = source;
  if (sourceLocale === undefined) {
    return { ...shown, available: false, reason: "original" };
  }
  if (!isConfigured(sourceLocale)) {
    return {
      ...shown,
      available: false,
      reason: "source-language-removed",
      sourceLocale,
    };
  }
  const { after, fingerprint: now } = await sourceNow(
    store,
    recorded,
    sourceLocale,
    () => readableSource(document, caller, named, sourceLocale)
  );
  if (now !== undefined) shown.sourceFingerprint = now;
  if (!source.available) return { ...shown, ...source, after };
  return !store.readThroughHook && readsAsStored(after, now)
    ? { ...shown, ...source, after }
    : {
        ...shown,
        available: false,
        reason: "not-kept",
        sourceLocale,
        after,
      };
}

/** Whether a value read is the stored one its record's fingerprint is of; a blank one reads as null. */
function readsAsStored(
  read: unknown,
  fingerprint: string | undefined
): boolean {
  if (fingerprint === undefined) return false;
  if (valueFingerprint(read) === fingerprint) return true;
  return (
    isBlank(read) &&
    [null, ""].some(blank => valueFingerprint(blank) === fingerprint)
  );
}

/** Reads the document's stored values by language, on `db` or the pool. */
function storedReader(store: TranslationStore, db?: unknown) {
  return sourceReaderOf({
    db: db ?? store.adapter.getDrizzle(),
    companion: store.companion,
    // Asked as the store was found.
    readiness: "ready",
    entryId: store.document.entryId,
  });
}

/**
 * Marks one field's translation as right against its source as that is now (`reviewField`).
 *
 * A signed-in person alone may say so, who may change the field in the translation's language and
 * read its source: the judgement is theirs, as a save of the translation would be.
 */
export async function keepCurrent(
  document: TranslatedDocument,
  caller: DocumentCaller,
  input: KeepCurrentInput
): Promise<void> {
  assertSignedInPerson(caller, "mark a translation as reviewed");
  const locale = translationLanguage(appLocalization(), input.locale);
  const { value, heldDraft } = await shownTranslation(
    document,
    caller,
    input,
    locale
  );
  const assertStillEditable = await assertFieldsEditable(
    document,
    caller,
    locale,
    { [input.field]: value },
    [[{ field: input.field }]]
  );
  const store = await translationStore(document, input);
  const { adapter, field } = store;
  if (!(await translationProvenancePresent(adapter, store.logger))) {
    throw NextlyError.conflict({
      reason: "state",
      message:
        "Translations can't be marked as reviewed yet. Run `nextly migrate` first.",
      logContext: { reason: "translation-provenance-missing" },
    });
  }
  if (heldDraft && clearedIn(store, value)) {
    refuse(
      "field",
      "TRANSLATION_IS_EMPTY",
      "This field has no translation to review."
    );
  }
  const record = shownRecords(await fieldRecords(adapter, field), heldDraft).at(
    0
  );
  const sourceLocale =
    record?.origin === "original"
      ? undefined
      : (record?.sourceLocale ?? field.defaultLocale);
  if (sourceLocale !== undefined) {
    if (!isConfigured(sourceLocale)) {
      refuse(
        "field",
        "TRANSLATION_SOURCE_LANGUAGE_REMOVED",
        "The language this translation was made from is no longer one of the site's languages."
      );
    }
    await readableSource(document, caller, input, sourceLocale);
  }
  await adapter.transaction(async tx => {
    // Held as a save holds it, so the records cannot move between their read and their write.
    await tx.lockRow(store.mainTable, store.document.entryId);
    await assertStillEditable(tx);
    const sources = {
      db: tx,
      read: storedReader(store, tx.getDrizzle()),
      kept: await translationSourcesPresent(
        adapter,
        store.logger,
        transactionTableProbe(adapter, tx)
      ),
      suggestionsKept: await translationSuggestionsPresent(
        adapter,
        store.logger,
        transactionTableProbe(adapter, tx)
      ),
    };
    const now = new Date();
    await reviewField(
      tx,
      {
        ...field,
        heldDraft,
        sourceLocale,
        valueFingerprint: input.valueFingerprint,
        sourceFingerprint: input.sourceFingerprint,
      },
      sources,
      now
    );
    await reviewTexts(tx, { ...field, heldDraft, sourceLocale }, sources, now);
  });
}
