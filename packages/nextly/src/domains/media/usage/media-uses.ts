/**
 * Where one media item is used, as a person reading the library is told it:
 * each document that uses the item, named and titled as they may read it,
 * with the fields that use it and the languages that do when only some do,
 * and a count of the documents they may not read, never named.
 *
 * The documents come from the usage record alone (`listMediaUsage`), one
 * query on the item's index. Which of them the reader may read, and what each
 * is called, is asked of the ordinary read path as the reader
 * (`readableHeadings`) for collection entries and Singles, and of the
 * `read-email-templates` grant for email templates. Nothing here decides
 * access itself.
 *
 * @module domains/media/usage/media-uses
 */

import { addressUseRows, type AddressPaths } from "./address-uses";
import type { IdentifiedUsageRow, UsageSubjectKind } from "./media-usage-store";

/** One field of a document that uses the item. */
export interface MediaUseField {
  /** The field's path, as the record holds it: `hero.image`. */
  path: string;
  /**
   * The languages whose values use the item, sorted. Empty when a value every
   * language shares uses it, so no language needs naming.
   */
  locales: string[];
  /**
   * Whether the field names the item by its address (rich text, an email
   * template's image) rather than its id.
   */
  byAddress: boolean;
  /**
   * Whether the field still shows the file the item had before its file was
   * replaced: an address use whose content has not changed since.
   */
  showsPreviousFile: boolean;
}

/** One document that uses the item, as the reader may read it. */
export interface MediaUse {
  kind: UsageSubjectKind;
  /** The collection's or Single's slug; "" for an email template. */
  slug: string;
  /** The entry's or template's id; "" for a Single. */
  documentId: string;
  /** The document's title, the Single's label, or the template's name. */
  title: string;
  /**
   * What holds the document: the collection's plural label, the Single's
   * label, or "Email templates".
   */
  owner: string;
  fields: MediaUseField[];
}

/**
 * How many documents using the item the reader may not read, in one
 * collection or Single (or among the email templates, `scopeSlug` ""), as the
 * list envelope's `meta.hidden` counts them.
 */
export interface HiddenMediaUses {
  scopeKind: UsageSubjectKind;
  scopeSlug: string;
  count: number;
}

/** Every document using the item that the reader may read, and how many more. */
export interface MediaUses {
  items: MediaUse[];
  /** The documents using the item that the reader may not read, by scope. */
  hidden: HiddenMediaUses[];
}

/** What the reader is told of one document, when they may read it. */
export interface MediaUseHeading {
  title: string;
  owner: string;
}

/** A document named by the record: its kind, slug and id. */
export interface MediaUseDocument {
  kind: UsageSubjectKind;
  slug: string;
  documentId: string;
}

/** What answering needs: the record, and the reader's view of documents. */
export interface MediaUsesSource {
  /** Every row of the record for the item, with its id. */
  rows(mediaId: string): Promise<IdentifiedUsageRow[]>;
  /** Which fields of each kind of document name an item by its address. */
  addressPaths: AddressPaths;
  /**
   * The rows that still named the item's old address when its file was last
   * replaced, and have not been written since: none for an item never
   * replaced.
   */
  previousRows(mediaId: string): Promise<ReadonlySet<string>>;
  /**
   * The heading of each document the reader may read, by
   * {@link mediaUseDocumentKey}. One absent is one they may not read.
   */
  headings(
    documents: readonly MediaUseDocument[]
  ): Promise<ReadonlyMap<string, MediaUseHeading>>;
}

/** The key a document is filed under, in the record and in its heading. */
export function mediaUseDocumentKey(document: MediaUseDocument): string {
  return JSON.stringify([document.kind, document.slug, document.documentId]);
}

/** One field as it is gathered: its languages, and how it names the item. */
interface GatheredField {
  locales: Set<string>;
  byAddress: boolean;
  showsPreviousFile: boolean;
}

/** A document's fields as they are gathered, by path. */
interface GatheredDocument extends MediaUseDocument {
  fields: Map<string, GatheredField>;
}

/**
 * The record's rows gathered into documents, in the record's order, each with
 * its fields and the languages that use each.
 */
function gathered(
  rows: readonly IdentifiedUsageRow[],
  address: ReadonlySet<IdentifiedUsageRow>,
  previous: ReadonlySet<string>
): GatheredDocument[] {
  const documents = new Map<string, GatheredDocument>();
  for (const row of rows) {
    const document: MediaUseDocument = {
      kind: row.subjectKind,
      slug: row.subjectSlug,
      documentId: row.documentId,
    };
    const key = mediaUseDocumentKey(document);
    const found = documents.get(key) ?? { ...document, fields: new Map() };
    const field = found.fields.get(row.fieldPath) ?? {
      locales: new Set<string>(),
      byAddress: address.has(row),
      showsPreviousFile: false,
    };
    field.locales.add(row.locale);
    if (previous.has(row.id)) field.showsPreviousFile = true;
    found.fields.set(row.fieldPath, field);
    documents.set(key, found);
  }
  return [...documents.values()];
}

/**
 * A field's languages as the reader is told them: none when a shared value
 * ("") uses the item, since every language then does.
 */
function namedLocales(locales: ReadonlySet<string>): string[] {
  return locales.has("") ? [] : [...locales].sort();
}

/** Which uses to tell: every one, or only those naming the item by address. */
export interface MediaUsesQuery {
  byAddressOnly?: boolean;
}

/** Where `mediaId` is used, as the reader may be told it. */
export async function mediaUsesOf(
  mediaId: string,
  source: MediaUsesSource,
  query: MediaUsesQuery = {}
): Promise<MediaUses> {
  const rows = await source.rows(mediaId);
  const address = new Set(await addressUseRows(rows, source.addressPaths));
  const told = query.byAddressOnly
    ? rows.filter(row => address.has(row))
    : rows;
  const previous = told.some(row => address.has(row))
    ? await source.previousRows(mediaId)
    : new Set<string>();
  const documents = gathered(told, address, previous);
  if (documents.length === 0) return { items: [], hidden: [] };
  const headings = await source.headings(
    documents.map(({ kind, slug, documentId }) => ({ kind, slug, documentId }))
  );
  const items: MediaUse[] = [];
  const hidden = new Map<string, HiddenMediaUses>();
  for (const document of documents) {
    const heading = headings.get(mediaUseDocumentKey(document));
    if (!heading) {
      // Counted under its scope and named nowhere.
      const scope = JSON.stringify([document.kind, document.slug]);
      const counted = hidden.get(scope) ?? {
        scopeKind: document.kind,
        scopeSlug: document.slug,
        count: 0,
      };
      counted.count += 1;
      hidden.set(scope, counted);
      continue;
    }
    items.push({
      kind: document.kind,
      slug: document.slug,
      documentId: document.documentId,
      title: heading.title,
      owner: heading.owner,
      fields: [...document.fields].map(([path, field]) => ({
        path,
        locales: namedLocales(field.locales),
        byAddress: field.byAddress,
        showsPreviousFile: field.showsPreviousFile,
      })),
    });
  }
  return { items, hidden: [...hidden.values()] };
}
