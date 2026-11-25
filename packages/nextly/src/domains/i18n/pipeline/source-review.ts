/**
 * Showing what changed in the source of one translated field since its translation was made, and
 * keeping that translation as it is: "this is still right against the source as it is now".
 *
 * @experimental
 *
 * @module domains/i18n/pipeline/source-review
 */
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

import {
  assertFieldsEditable,
  assertSignedInPerson,
  documentIdOf,
  readDocumentIn,
  showsHeldDraft,
  type DocumentCaller,
  type TranslatedDocument,
} from "./document-access";

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
function translationLanguage(
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
function registeredEntity(document: TranslatedDocument) {
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

/** The translation table that stores `field`, or null where the entity does not translate it. */
async function translationsOf(
  adapter: DrizzleAdapter,
  record: NonNullable<Awaited<ReturnType<typeof registeredEntity>>>,
  field: string
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
  const stored = companion?.localizedFields.some(ref => ref.name === field);
  if (!companion || stored !== true) return null;
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
  const companion = await translationsOf(adapter, record, named.field);
  if (companion === null) {
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
  const { heldDraft } = await shownTranslation(document, caller, named, locale);
  const store = await translationStore(document, named);
  const { adapter, field } = store;
  const recorded = await translationProvenancePresent(adapter, store.logger);
  const record = recorded
    ? shownRecords(await fieldRecords(adapter, field), heldDraft).at(0)
    : undefined;
  const source = await fieldSource(
    adapter,
    field,
    record,
    await translationSourcesPresent(adapter, store.logger)
  );
  const reads = storedReader(store);
  const value =
    record?.valueFingerprint ??
    (await reads(locale)).get(named.field)?.fingerprint;
  const shown: ReviewFingerprints =
    value === undefined ? {} : { valueFingerprint: value };
  if (source.sourceLocale === undefined) {
    return { ...shown, available: false, reason: "original" };
  }
  const after = await readableSource(
    document,
    caller,
    named,
    source.sourceLocale
  );
  const now =
    (recorded
      ? await liveFingerprint(adapter, field, source.sourceLocale)
      : undefined) ??
    (await reads(source.sourceLocale)).get(named.field)?.fingerprint;
  if (now !== undefined) shown.sourceFingerprint = now;
  if (!source.available) return { ...shown, ...source, after };
  return !store.readThroughHook && readsAsStored(after, now)
    ? { ...shown, ...source, after }
    : {
        ...shown,
        available: false,
        reason: "not-kept",
        sourceLocale: source.sourceLocale,
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
  const record = shownRecords(await fieldRecords(adapter, field), heldDraft).at(
    0
  );
  if (record?.origin !== "original") {
    await readableSource(
      document,
      caller,
      input,
      record?.sourceLocale ?? field.defaultLocale
    );
  }
  await adapter.transaction(async tx => {
    // Held as a save holds it, so the records cannot move between their read and their write.
    await tx.lockRow(store.mainTable, store.document.entryId);
    await assertStillEditable(tx);
    await reviewField(
      tx,
      {
        ...field,
        heldDraft,
        valueFingerprint: input.valueFingerprint,
        sourceFingerprint: input.sourceFingerprint,
      },
      {
        db: tx,
        read: storedReader(store, tx.getDrizzle()),
        kept: await translationSourcesPresent(
          adapter,
          store.logger,
          transactionTableProbe(adapter, tx)
        ),
      },
      new Date()
    );
  });
}
