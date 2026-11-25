"use client";

/**
 * What a translation page reads: the collection or Single's fields, the
 * document as one language holds it, and every language's stored value of its
 * translatable fields.
 *
 * Two reads of one document, because they answer different questions. The
 * language being written is read with its held draft, which is what a save of
 * it builds on. The sources are read without one: a draft of the Spanish is not
 * the Spanish a translator works from.
 *
 * An entry and a Single are addressed differently and answer the same, so what
 * differs between them ends here.
 *
 * @module components/features/translations/page/useTranslationDocument
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { FieldConfig } from "nextly/config";

import type { LocaleTranslationMeta } from "@admin/components/features/entries/translation-meta";
import {
  historyEnabledFrom,
  historyRetentionFrom,
} from "@admin/components/features/versions/history-enabled";
import { useCollectionSchema } from "@admin/hooks/queries/useCollections";
import {
  singleDocumentKeys,
  useSingleSchema,
} from "@admin/hooks/queries/useSingles";
import { useCanRequest } from "@admin/hooks/useCanRequest";
import { useUpdateAnswer } from "@admin/hooks/useUpdateAnswer";
import { readsHeldDraft } from "@admin/lib/held-draft";
import type { TranslatedDocument } from "@admin/lib/navigation/translation-address";
import { entryApi, entryKeys } from "@admin/services/entryApi";
import { singleApi } from "@admin/services/singleApi";
import { getCollectionFields } from "@admin/types/collection";
import type { RemovedFromCodeMark } from "@admin/types/removed-from-code";

/** A document as a read answers it. */
export type DocumentRow = Record<string, unknown>;

/** What the page needs of the collection or Single. */
export interface TranslationSchema {
  label: string;
  fields: FieldConfig[];
  /** Whether its text is kept per language at all. */
  localized: boolean;
  hasStatus: boolean;
  /** Whether a save of a published language is held until it is published. */
  holdsDrafts: boolean;
  /**
   * Whether its held draft is read: one kept from before drafts stopped being
   * held may still be there.
   */
  readsDraft: boolean;
  useAsTitle: string | undefined;
  removed: RemovedFromCodeMark;
  /** Whether it keeps versions; undefined where the schema doesn't say. */
  historyEnabled: boolean | undefined;
  /** How many versions of a document it keeps, where the schema says. */
  retention: number | false | undefined;
  /** Whether a workflow may hold its publishing; undefined where not said. */
  workflowExpected: boolean | undefined;
}

export interface TranslationDocument {
  schema: TranslationSchema | undefined;
  /** The language being written, as it stands with its unpublished work. */
  target: DocumentRow | undefined;
  /** The document as it is served, with every language's values. */
  live: DocumentRow | undefined;
  /** Each language's standing, where the reader may read it. */
  translations: Record<string, LocaleTranslationMeta> | undefined;
  isLoading: boolean;
  error: Error | null;
  /**
   * Read both again, for the document as it now is: the language being
   * written, or undefined where it couldn't be read.
   */
  reload: () => Promise<DocumentRow | undefined>;
}

/** One list for a collection or Single with no fields, as its own is one. */
const NO_FIELDS: FieldConfig[] = [];

/**
 * A schema read's fields, the same list for as long as it is the same read. The
 * admin declares the read more loosely than the config it is of.
 */
export function fieldsOf(
  declared: readonly object[] | undefined
): FieldConfig[] {
  return declared === undefined || declared.length === 0
    ? NO_FIELDS
    : (declared as unknown as FieldConfig[]);
}

/** The schema hook's answer for either kind, and whether it is still coming. */
interface SchemaAnswer {
  schema: TranslationSchema | undefined;
  isLoading: boolean;
  error: Error | null;
}

/** What the schema says of history, read as the editor reads it. */
function historyOf(
  schema: object
): Pick<TranslationSchema, "historyEnabled" | "retention"> {
  return {
    historyEnabled: historyEnabledFrom(schema),
    retention: historyRetentionFrom(schema),
  };
}

type CollectionRead = NonNullable<
  ReturnType<typeof useCollectionSchema>["data"]
>;
type SingleRead = NonNullable<ReturnType<typeof useSingleSchema>["data"]>;

function ofCollection(data: CollectionRead, slug: string): TranslationSchema {
  return {
    label: data.label || data.name || slug,
    fields: fieldsOf(getCollectionFields(data)),
    // The schema read carries `localized`, which the admin's type for it does
    // not declare.
    localized: "localized" in data && data.localized === true,
    hasStatus: data.status === true,
    holdsDrafts: data.draftsEnabled === true,
    readsDraft: readsHeldDraft(data),
    useAsTitle: data.admin?.useAsTitle,
    removed: data,
    ...historyOf(data),
    workflowExpected: data.workflow != null,
  };
}

function ofSingle(data: SingleRead, slug: string): TranslationSchema {
  return {
    label: data.label || slug,
    fields: fieldsOf(data.fields),
    localized: data.localized === true,
    hasStatus: data.status === true,
    holdsDrafts: data.draftsEnabled === true,
    readsDraft: data.draftsEnabled === true,
    useAsTitle: undefined,
    removed: data,
    ...historyOf(data),
    // The schema read carries `workflow`, which the admin's type for it does
    // not declare.
    workflowExpected: "workflow" in data ? data.workflow != null : undefined,
  };
}

/**
 * The document's collection or Single. Both hooks are called, as hooks must
 * be, and the one the document is not of is asked for nothing.
 */
function useTranslationSchema({
  kind,
  slug,
}: TranslatedDocument): SchemaAnswer {
  const collection = useCollectionSchema(
    kind === "collection" ? slug : undefined
  );
  const single = useSingleSchema(kind === "single" ? slug : undefined);
  const { isLoading, error } = kind === "single" ? single : collection;
  const schema =
    kind === "single"
      ? single.data && ofSingle(single.data, slug)
      : collection.data && ofCollection(collection.data, slug);
  return { isLoading, error, schema };
}

/** What both of the page's reads of the document ask for. */
interface DocumentRead {
  locale: string;
  draft?: boolean;
  translationStatus?: boolean;
  everyLanguage?: boolean;
}

/**
 * One read. No fallback, so a field nobody wrote in the language reads empty
 * rather than as another language's text; and no related documents, so a link
 * the reader may not open is kept as the link it is.
 */
async function readDocument(
  document: TranslatedDocument,
  { draft = false, ...read }: DocumentRead
): Promise<DocumentRow> {
  const options = { ...read, fallbackLocale: "none", depth: 0 };
  if (document.kind === "single") {
    return singleApi.getDocument(
      document.slug,
      draft ? { ...options, draft } : options
    );
  }
  return entryApi.findByID(document.slug, document.id, { ...options, draft });
}

/** Under the document's own key, so a save of it anywhere reads both again. */
function readKey(
  document: TranslatedDocument,
  read: DocumentRead
): readonly unknown[] {
  const key =
    document.kind === "single"
      ? singleDocumentKeys.detail(document.slug)
      : entryKeys.detail(document.slug, document.id);
  return [...key, "translation", read];
}

function useDocumentRead(
  document: TranslatedDocument,
  read: DocumentRead,
  enabled: boolean
): UseQueryResult<DocumentRow, Error> {
  return useQuery<DocumentRow, Error>({
    queryKey: readKey(document, read),
    queryFn: () => readDocument(document, read),
    enabled,
    staleTime: 60_000,
  });
}

function translationsOf(
  document: DocumentRow | undefined
): Record<string, LocaleTranslationMeta> | undefined {
  const translations = document?._translations;
  return typeof translations === "object" && translations !== null
    ? (translations as Record<string, LocaleTranslationMeta>)
    : undefined;
}

/** The document's reads for translating it into `target`. */
export function useTranslationDocument(
  document: TranslatedDocument,
  target: string
): TranslationDocument {
  const schemaAnswer = useTranslationSchema(document);
  const { schema } = schemaAnswer;
  // The overview reads every language's state, so it is asked only of a reader
  // the server lets read them all, once it is known whether it does: asked
  // before, the document is read without it and then again with it.
  const asksStatus = useCanRequest(document.slug, "readTranslations");
  const permissionsKnown = useUpdateAnswer(document.slug) !== "unknown";
  const enabled = schema?.localized === true && permissionsKnown;
  const written = useDocumentRead(
    document,
    {
      locale: target,
      draft: schema?.readsDraft === true,
      translationStatus: asksStatus,
    },
    enabled
  );
  const live = useDocumentRead(
    document,
    { locale: target, everyLanguage: true },
    enabled
  );
  return {
    schema,
    target: written.data,
    live: live.data,
    translations: translationsOf(written.data),
    isLoading:
      schemaAnswer.isLoading ||
      (enabled && (written.isLoading || live.isLoading)) ||
      (schema?.localized === true && !permissionsKnown),
    // A failed re-read keeps the page on what it has.
    error:
      schemaAnswer.error ??
      (written.data === undefined ? written.error : null) ??
      (live.data === undefined ? live.error : null),
    reload: async () => {
      const [read] = await Promise.all([written.refetch(), live.refetch()]);
      // A failed read keeps the last one's data beside it.
      return read.isError ? undefined : read.data;
    },
  };
}
