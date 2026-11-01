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
 * `read-email-templates` grant for email templates, in each language whose
 * value uses the item, so a translation the reader may not read gives away
 * neither its fields nor its language. Nothing here decides access itself.
 *
 * @module domains/media/usage/media-uses
 */

import type { IdentifiedUsageRow, UsageSubjectKind } from "./media-usage-store";

/** One field of a document that uses the item. */
export interface MediaUseField {
  /** The field's path, as the record holds it: `hero.image`. */
  path: string;
  /**
   * The languages whose values use the item that the reader may read, sorted.
   * Empty when a value every language shares uses it, so no language needs
   * naming.
   */
  locales: string[];
  /**
   * Whether the field names the item by its address (rich text, a JSON
   * value's `src`, an email template's image) rather than its id.
   */
  byAddress: boolean;
  /**
   * Whether the field still shows the file the item had before its file was
   * replaced: it names an address whose file a Replace kept.
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
  /**
   * The fields among the read's `paths` the reader may read in it, as the
   * ordinary read of the document as them leaves them: a field a read rule
   * withholds from them is absent, and is never told, by name or by its use
   * of the item.
   */
  paths: ReadonlySet<string>;
}

/** A document named by the record: its kind, slug and id. */
export interface MediaUseDocument {
  kind: UsageSubjectKind;
  slug: string;
  documentId: string;
}

/**
 * One document read in one language: `locale`, or its default language when
 * `null`. A localized document has a lifecycle and access per language, so
 * whether the reader may read it is asked per language, and so is which of
 * its fields that use the item (`paths`) they may read.
 */
export interface MediaUseRead extends MediaUseDocument {
  locale: string | null;
  /** The fields of the document that use the item, as the record names them. */
  paths: readonly string[];
}

/** What answering needs: the record, and the reader's view of documents. */
export interface MediaUsesSource {
  /** Every row of the record for the item, with its id. */
  rows(mediaId: string): Promise<IdentifiedUsageRow[]>;
  /**
   * The addresses whose files a Replace kept for the item: a use naming one
   * still shows the previous file. None for an item never replaced.
   */
  keptAddresses(mediaId: string): Promise<ReadonlySet<string>>;
  /**
   * The site's languages as they are now, or none where it has no
   * localization. A document is asked about only in these: a removed
   * language's value is told nowhere.
   */
  languages(): Promise<readonly string[]>;
  /**
   * The heading of each read the reader may make, by {@link mediaUseReadKey}.
   * One absent is a document they may not read in that language.
   */
  headings(
    reads: readonly MediaUseRead[]
  ): Promise<ReadonlyMap<string, MediaUseHeading>>;
}

/** The key a read of a document is filed under, in its heading. */
export function mediaUseReadKey(read: Omit<MediaUseRead, "paths">): string {
  return JSON.stringify([read.kind, read.slug, read.documentId, read.locale]);
}

/** How one field names the item in one language's value. */
interface LanguageUse {
  byAddress: boolean;
  showsPreviousFile: boolean;
}

/**
 * One field as it is gathered: how each language's value ("" a shared one)
 * names the item, kept apart so a language the reader may not read never
 * colours what they are told of one they may.
 */
interface GatheredField {
  locales: Map<string, LanguageUse>;
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
  kept: ReadonlySet<string>
): GatheredDocument[] {
  const documents = new Map<string, GatheredDocument>();
  for (const row of rows) {
    const document: MediaUseDocument = {
      kind: row.subjectKind,
      slug: row.subjectSlug,
      documentId: row.documentId,
    };
    const key = JSON.stringify([
      document.kind,
      document.slug,
      document.documentId,
    ]);
    const found = documents.get(key) ?? { ...document, fields: new Map() };
    const field = found.fields.get(row.fieldPath) ?? { locales: new Map() };
    const use = field.locales.get(row.locale) ?? {
      byAddress: false,
      showsPreviousFile: false,
    };
    if (row.address !== null) use.byAddress = true;
    if (row.address !== null && kept.has(row.address)) {
      use.showsPreviousFile = true;
    }
    field.locales.set(row.locale, use);
    found.fields.set(row.fieldPath, field);
    documents.set(key, found);
  }
  return [...documents.values()];
}

/** The languages a document's rows name, sorted, and whether a shared value does. */
function languagesOf(document: GatheredDocument): {
  named: string[];
  shared: boolean;
} {
  const all = new Set<string>();
  for (const field of document.fields.values()) {
    for (const locale of field.locales.keys()) all.add(locale);
  }
  return {
    named: [...all].filter(locale => locale !== "").sort(),
    shared: all.has(""),
  };
}

/**
 * The reads that decide what the reader is told of a document: one in each
 * of the site's languages whose value uses the item, and, when a shared
 * value does, one in the default language and one in every language, since
 * the reader sees a shared value in any translation they may read. An email
 * template has no languages.
 */
function readsOf(
  document: GatheredDocument,
  languages: readonly string[]
): MediaUseRead[] {
  const { kind, slug, documentId } = document;
  const paths = [...document.fields.keys()];
  if (kind === "email-template") {
    return [{ kind, slug, documentId, locale: null, paths }];
  }
  const { named, shared } = languagesOf(document);
  const site = new Set(languages);
  const locales = new Set<string | null>([
    ...(shared ? [null, ...languages] : []),
    ...named.filter(locale => site.has(locale)),
  ]);
  return [...locales].map(locale => ({
    kind,
    slug,
    documentId,
    locale,
    paths,
  }));
}

/**
 * What the reader is told of one document, or `null` when nothing: each
 * field's languages cut to those the reader may read the document, and that
 * field, in; a shared value, which every language reads, told when they may
 * read the field in any. A field a read rule withholds from them is told in
 * no language. How a field names the item is taken from the told languages'
 * values alone. The title is the default language's, else the first
 * readable one's.
 */
function toldOf(
  document: GatheredDocument,
  headings: ReadonlyMap<string, MediaUseHeading>,
  languages: readonly string[]
): MediaUse | null {
  const reads = readsOf(document, languages);
  const headingIn = (locale: string | null) =>
    headings.get(mediaUseReadKey({ ...document, locale }));
  const readable = reads
    .map(read => headingIn(read.locale))
    .filter((heading): heading is MediaUseHeading => heading !== undefined);
  if (readable.length === 0) return null;
  // A shared value is told wherever the reader may read the field at all.
  const told = (locale: string, path: string) =>
    locale === ""
      ? readable.some(heading => heading.paths.has(path))
      : headingIn(locale)?.paths.has(path) === true;
  const fields: MediaUseField[] = [];
  for (const [path, field] of document.fields) {
    const uses = [...field.locales].filter(([locale]) => told(locale, path));
    // A field used only in languages the reader may not read is not told.
    if (uses.length === 0) continue;
    const shared = field.locales.has("");
    fields.push({
      path,
      locales: shared ? [] : uses.map(([locale]) => locale).sort(),
      byAddress: uses.some(([, use]) => use.byAddress),
      showsPreviousFile: uses.some(([, use]) => use.showsPreviousFile),
    });
  }
  if (fields.length === 0) return null;
  const heading = headingIn(null) ?? readable[0];
  return {
    kind: document.kind,
    slug: document.slug,
    documentId: document.documentId,
    title: heading.title,
    owner: heading.owner,
    fields,
  };
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
  const told = query.byAddressOnly
    ? rows.filter(row => row.address !== null)
    : rows;
  const kept = told.some(row => row.address !== null)
    ? await source.keptAddresses(mediaId)
    : new Set<string>();
  const documents = gathered(told, kept);
  if (documents.length === 0) return { items: [], hidden: [] };
  const languages = documents.some(doc => doc.kind !== "email-template")
    ? await source.languages()
    : [];
  const headings = await source.headings(
    documents.flatMap(document => readsOf(document, languages))
  );
  const items: MediaUse[] = [];
  const hidden = new Map<string, HiddenMediaUses>();
  for (const document of documents) {
    const use = toldOf(document, headings, languages);
    if (use) {
      items.push(use);
      continue;
    }
    // Counted under its scope and named nowhere.
    const scope = JSON.stringify([document.kind, document.slug]);
    const counted = hidden.get(scope) ?? {
      scopeKind: document.kind,
      scopeSlug: document.slug,
      count: 0,
    };
    counted.count += 1;
    hidden.set(scope, counted);
  }
  return { items, hidden: [...hidden.values()] };
}
