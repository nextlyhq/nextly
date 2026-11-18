/**
 * How many DOCUMENTS use a thing, asked of the index rather than of the pages.
 *
 * The count a library tile shows beside a component, and the one an author
 * reads before deciding whether something is safe to change. Generic over the
 * usage indexes because it is one question: the class index and the component
 * index differ in what a row references, not in what "used on N pages" means.
 *
 * ## Why DISTINCT documents, and why that is not a detail
 *
 * A row is filed per field, per locale and per stored variant, so one page
 * using one component in two languages while holding a pending draft
 * contributes several rows. Counting rows would report that page as several,
 * and the number would climb every time somebody added a translation — a count
 * that grows without the usage growing is worse than no count, because it reads
 * as information.
 *
 * ## Why the database groups, rather than this module
 *
 * The index exists to make this affordable over a population too large to walk.
 * Reading every row back to deduplicate here would spend exactly what the index
 * was built to save, and it would spend it per tile.
 *
 * ## What `complete` is for
 *
 * The number can be short for two reasons, and both are short in the direction
 * that reads as fine. The grouped read is capped, so a component used on more
 * documents than the cap comes back at the cap. And a document that could not
 * be walked whole is recorded as one marker with its references DISCARDED, so
 * it is absent from every component's count rather than counted against the
 * wrong one — a component embedded only in such a document reads as used
 * nowhere.
 *
 * A caller that shows the number without saying so tells an author a widely
 * used component is barely used, which is the reading that makes a delete look
 * safe. So the bound travels WITH the number and the surface decides how to say
 * it.
 *
 * @module usage-count
 */
import { lastIdOf } from "./paged-walk";
import type {
  GroupedUsageReader,
  UsageIndex,
  UsageSubject,
} from "./usage-index";
import { indexIsWhole, type UsageIndexHealth } from "./usage-index-health";

/** What a count of the documents using something answered. */
export interface UsageCount {
  /**
   * How many DISTINCT documents reference it.
   *
   * A floor rather than a total when `complete` is false: the documents seen,
   * not the documents there are.
   */
  documents: number;
  /**
   * Whether `documents` is the whole answer.
   *
   * False means the number is a FLOOR, from either of two causes: the grouped
   * read reached its cap and stopped, or some document could not be read whole
   * and so is missing from the population entirely. A surface showing the count
   * without this says "used on 50 pages" about a component used on thousands,
   * and says "used on no pages" about one embedded in a document too large to
   * walk.
   */
  complete: boolean;
}

/**
 * The two columns that together identify a document in every usage index.
 *
 * `entityKey` holds the document's id and `entity` the collection it lives in,
 * and both are the same columns in each index because the six subject columns
 * are the shared half of the row. A document is the PAIR: ids are minted per
 * collection, so two tracked collections can each hold a document with the
 * same id — restored or imported records do — and grouping by the id alone
 * folds those into one bucket. The count then reads below the truth while
 * presenting itself as exact, which is the one answer a safe delete must never
 * be handed.
 */
const COLLECTION_COLUMN = "entity";
const DOCUMENT_COLUMN = "entityKey";

/**
 * The documents that reference something, grouped by the collection holding
 * them, and whether that is all of them.
 *
 * The richer answer the count is derived from: a surface that lists where
 * something is used, and one that splits the count by kind of document, read
 * the same buckets the count adds up, so the three can never disagree.
 */
export interface DocumentsUsing {
  /**
   * Each collection holding a referencing document, with that document's id.
   * A `null` id is a row whose document column held nothing: counted, since
   * it is a reference, but nameable by no one.
   */
  readonly collections: readonly {
    /** The collection's slug, or the Single's when {@link single} is set. */
    readonly collection: string;
    readonly documents: readonly (string | null)[];
    /**
     * Each document's rows as shares of its blocks, in `documents`' order,
     * where the read could count them: what {@link documentBlocks} counts a
     * document's blocks from. Absent from a listing the grouped read made,
     * which sees documents and not rows.
     */
    readonly shares?: readonly (readonly BlockShare[])[];
    /**
     * Set when `collection` names a Single rather than a collection: its one
     * document is listed with no id, and is read through the Single API.
     */
    readonly single?: true;
  }[];
  /** Whether `collections` is the whole answer; see {@link UsageCount}. */
  readonly complete: boolean;
  /**
   * Set when the listing comes from an index that counts blocks and from its
   * rows, so a listing with no documents still says "no blocks" rather than
   * nothing: the class index's row read. Absent from every other listing.
   */
  readonly countsBlocks?: true;
}

/** One reference to one document, as either read finds it. */
interface FoundReference {
  readonly referenceId: string;
  /** `null` for a row that names no collection: a document nobody can place. */
  readonly collection: string | null;
  readonly document: string | null;
  /** Whether the row is filed under a Single rather than a collection. */
  readonly single?: boolean;
  /** The row's own share of the document's blocks, where the row read it. */
  readonly share?: BlockShare;
}

/**
 * One row's share of its document's blocks: the stored copy it describes (its
 * language and form) and the field, and how many of that field's blocks
 * reference the thing there; `null` when the row holds no count (stored
 * before the count was kept).
 */
export interface BlockShare {
  /** The row's language, or empty for a field shared by every language. */
  readonly locale: string;
  /** The row's stored form: `published` or `draft`. */
  readonly variant: string;
  readonly field: string;
  readonly blocks: number | null;
}

/** Where a reference's documents are grouped: a Single apart from a collection of its name. */
function groupKey(reference: FoundReference & { collection: string }): string {
  return `${reference.single === true ? "single" : "collection"}\u0000${reference.collection}`;
}

/**
 * The listing for each id, from the references found: THE one statement of
 * what a usage listing is, whichever read found the references.
 *
 * Distinct documents per collection, in the order first found. An id is a
 * floor when any of its references could not be placed in a collection, when
 * the read that found them stopped at its cap, or when the index as a whole is
 * not whole.
 */
function listingFrom(
  referenceIds: readonly string[],
  found: Iterable<FoundReference>,
  readCut: boolean,
  health: UsageIndexHealth
): Map<string, DocumentsUsing> {
  const byId = new Map<string, FoundForId>();
  for (const id of referenceIds) {
    byId.set(id, { collections: new Map(), placeable: true });
  }
  for (const reference of found) {
    const entry = byId.get(reference.referenceId);
    if (entry !== undefined) addReference(entry, reference);
  }
  const whole = indexIsWhole(health);
  const listings = new Map<string, DocumentsUsing>();
  for (const [id, entry] of byId) {
    listings.set(id, {
      collections: [...entry.collections.values()].map(collectionListed),
      complete: !readCut && entry.placeable && whole,
    });
  }
  return listings;
}

/** One collection's references to an id, gathered by document. */
interface FoundInCollection {
  collection: string;
  single: boolean;
  documents: Set<string | null>;
  shares: Map<string | null, (BlockShare | undefined)[]>;
}

/** Everything found for one id, and whether each reference could be placed. */
interface FoundForId {
  collections: Map<string, FoundInCollection>;
  placeable: boolean;
}

/** File one reference under its collection and document. */
function addReference(entry: FoundForId, reference: FoundReference): void {
  const collection = reference.collection;
  if (collection === null) {
    entry.placeable = false;
    return;
  }
  const key = groupKey({ ...reference, collection });
  const group = entry.collections.get(key) ?? {
    collection,
    single: reference.single === true,
    documents: new Set<string | null>(),
    shares: new Map<string | null, (BlockShare | undefined)[]>(),
  };
  group.documents.add(reference.document);
  const shares = group.shares.get(reference.document) ?? [];
  shares.push(reference.share);
  group.shares.set(reference.document, shares);
  entry.collections.set(key, group);
}

/** One collection's documents as a listing names them, with their shares. */
function collectionListed(
  group: FoundInCollection
): DocumentsUsing["collections"][number] {
  const documents = [...group.documents];
  const shares = documents.map(document =>
    sharesRead(group.shares.get(document) ?? [])
  );
  return {
    collection: group.collection,
    documents,
    // Only where every document's rows were read: the grouped read finds
    // documents without their rows.
    ...(shares.every(read => read !== undefined) ? { shares } : {}),
    ...(group.single ? { single: true as const } : {}),
  };
}

/** A document's shares, or `undefined` when any of its rows was read without one. */
function sharesRead(
  shares: readonly (BlockShare | undefined)[]
): BlockShare[] | undefined {
  const read: BlockShare[] = [];
  for (const share of shares) {
    if (share === undefined) return undefined;
    read.push(share);
  }
  return read;
}

/** The language of a field every language shares: the index's empty locale. */
const SHARED_LOCALE = "";

/** One stored copy of a document: its form, and its language or none. */
export interface StoredCopy {
  readonly variant: string;
  readonly locale: string;
}

/**
 * One document's rows, field by field in each copy: one value per field, the
 * larger where two rows describe the same field of the same copy (a save's
 * new row before its old one is removed, or two saves at once), since they
 * are the same blocks again and never more of them. `null` holds over a count.
 */
function fieldsByCopy(
  shares: readonly BlockShare[]
): Map<string, Map<string, Map<string, number | null>>> {
  const byVariant = new Map<string, Map<string, Map<string, number | null>>>();
  for (const share of shares) {
    const locales = byVariant.get(share.variant) ?? new Map();
    const fields =
      locales.get(share.locale) ?? new Map<string, number | null>();
    const before = fields.get(share.field);
    fields.set(
      share.field,
      before === undefined
        ? share.blocks
        : before === null || share.blocks === null
          ? null
          : Math.max(before, share.blocks)
    );
    locales.set(share.locale, fields);
    byVariant.set(share.variant, locales);
  }
  return byVariant;
}

/** The sum of some fields' counts, `null` when any is unknown. */
function sumOf(counts: Iterable<number | null>): number | null {
  let sum = 0;
  for (const count of counts) {
    if (count === null) return null;
    sum += count;
  }
  return sum;
}

/** One document's rows, read field by field in each copy. */
type CopyFields = ReturnType<typeof fieldsByCopy>;

/**
 * Every stored copy one document's rows describe: in each form, one copy per
 * language its rows name, or the one copy every language shares where they
 * name none.
 */
export function copiesOf(shares: readonly BlockShare[]): StoredCopy[] {
  return copiesIn(fieldsByCopy(shares));
}

function copiesIn(byVariant: CopyFields): StoredCopy[] {
  const copies: StoredCopy[] = [];
  for (const [variant, locales] of byVariant) {
    const languages = [...locales.keys()].filter(l => l !== SHARED_LOCALE);
    for (const locale of languages.length > 0 ? languages : [SHARED_LOCALE]) {
      copies.push({ variant, locale });
    }
  }
  return copies;
}

/**
 * How many of one document's blocks reference something in one stored copy:
 * the copy's fields added up, since each is part of the same page, with the
 * fields every language shares counted in each language's copy. `null` when
 * any of those fields' counts is unknown; 0 for a copy the rows do not name.
 */
export function copyBlocks(
  shares: readonly BlockShare[],
  copy: StoredCopy
): number | null {
  return copyBlocksIn(fieldsByCopy(shares), copy);
}

function copyBlocksIn(byVariant: CopyFields, copy: StoredCopy): number | null {
  const locales = byVariant.get(copy.variant);
  if (locales === undefined) return 0;
  const shared = locales.get(SHARED_LOCALE)?.values() ?? [];
  const own =
    copy.locale === SHARED_LOCALE
      ? []
      : (locales.get(copy.locale)?.values() ?? []);
  return sumOf([...shared, ...own]);
}

/**
 * How many of one document's blocks reference something: THE one statement
 * of it. Each stored copy's blocks ({@link copyBlocks}); the copies (a draft
 * beside the published page, another language) are the same page again, so
 * the largest copy is the page's. `null` when any copy's count is unknown,
 * and 0 for a document with no rows.
 */
export function documentBlocks(shares: readonly BlockShare[]): number | null {
  const byVariant = fieldsByCopy(shares);
  let largest = 0;
  for (const copy of copiesIn(byVariant)) {
    const blocks = copyBlocksIn(byVariant, copy);
    if (blocks === null) return null;
    largest = Math.max(largest, blocks);
  }
  return largest;
}

/**
 * Which documents reference `referenceId`, by collection, and whether that is
 * all of them.
 *
 * Asked of the database as grouped reads, so a reference used on thousands of
 * documents costs two reads per collection rather than its rows. The answer is
 * {@link listingFrom}'s, which the batch read shares.
 */
async function listDocumentsUsing<TRow extends UsageSubject>(args: {
  index: UsageIndex<TRow>;
  read: GroupedUsageReader;
  referenceId: string;
  /** What is known about the index as a whole; see {@link countDocumentsUsing}. */
  health: UsageIndexHealth;
}): Promise<DocumentsUsing> {
  const { referenceId } = args;
  // An empty id references nothing and is not an id. Answered as COMPLETE
  // because it genuinely is — nothing can reference what is not a reference —
  // and answered without a read, because asking would spend a query to learn
  // what the argument already said.
  if (referenceId === "") return { collections: [], complete: true };

  const referencing = args.index.whereReferencing(referenceId);

  // Which collections hold a reference at all, then the documents in EACH.
  // The grouped read takes one column, so the pair is asked as two questions:
  // grouping by the id across every collection at once is the fold described
  // above, and grouping by collection alone counts collections, not documents.
  const collections = await args.read({
    where: referencing,
    groupBy: COLLECTION_COLUMN,
  });
  const found: FoundReference[] = [];
  let readCut = collections.truncated;
  for (const collection of collections.buckets) {
    if (collection === null) {
      found.push({ referenceId, collection: null, document: null });
      continue;
    }
    const inCollection = await args.read({
      where: { ...referencing, [COLLECTION_COLUMN]: { equals: collection } },
      groupBy: DOCUMENT_COLUMN,
    });
    for (const document of inCollection.buckets) {
      found.push({ referenceId, collection, document });
    }
    readCut ||= inCollection.truncated;
  }
  const listing = listingFrom([referenceId], found, readCut, args.health);
  return listing.get(referenceId) ?? { collections: [], complete: true };
}

/**
 * Reads a usage index's stored rows a page at a time, as the system: the rows
 * a predicate matches, without grouping.
 */
export interface UsageRowReader {
  (args: {
    where: Record<string, { equals: string } | { in: string[] }>;
    /** Which page of rows, from 1. */
    page: number;
    /**
     * The id of the last row the previous page held; absent on the first
     * page. Pages run by id, so a row removed meanwhile moves no later one
     * out of reach.
     */
    after?: string;
  }): Promise<{ items: readonly unknown[]; hasNext: boolean }>;
}

/**
 * The most pages of rows one batch read takes. Bounded, so a page of styles
 * used on very many documents costs a fixed number of reads and says its
 * counts are floors, rather than reading the whole index.
 */
export const USAGE_ROW_PAGES_MAX = 10;

/**
 * Which documents reference each of `referenceIds`, by collection, in a
 * bounded number of reads however many ids are asked for.
 *
 * One predicate names every id, and the rows it matches are read a page at a
 * time, up to {@link USAGE_ROW_PAGES_MAX} pages; a row per field, language and
 * stored form is folded into one document by {@link listingFrom}, the same
 * statement the single listing uses. Reaching the cap makes every id's answer
 * a floor, since the rows not read could belong to any of them.
 */
export async function listDocumentsUsingEach<TRow extends UsageSubject>(args: {
  index: UsageIndex<TRow>;
  rows: UsageRowReader;
  referenceIds: readonly string[];
  /** What is known about the index as a whole; see {@link countDocumentsUsing}. */
  health: UsageIndexHealth;
}): Promise<Map<string, DocumentsUsing>> {
  // The empty id is no reference, as for the single listing: complete, and
  // never asked about.
  const ids = [...new Set(args.referenceIds)];
  const asked = ids.filter(id => id !== "");
  const found: FoundReference[] = [];
  let readCut = false;
  let after: string | undefined;
  for (let page = 1; asked.length > 0; page += 1) {
    const read = await args.rows({
      where: args.index.whereReferencingAny(asked),
      page,
      ...(after === undefined ? {} : { after }),
    });
    after = lastIdOf(read.items) ?? after;
    for (const item of read.items) {
      const reference = foundIn(args.index, item);
      if (reference !== undefined) found.push(reference);
    }
    if (!read.hasNext) break;
    if (page >= USAGE_ROW_PAGES_MAX) {
      readCut = true;
      break;
    }
  }
  const listings = listingFrom(asked, found, readCut, args.health);
  if (ids.includes("")) listings.set("", { collections: [], complete: true });
  if (args.index.blocksOf === undefined) return listings;
  // Read from the rows of an index that counts blocks: every listing says so,
  // its empty ones included.
  return new Map(
    [...listings].map(([id, listing]) => [
      id,
      { ...listing, countsBlocks: true as const },
    ])
  );
}

/** One stored row as a found reference, or `undefined` when it is not one. */
function foundIn<TRow extends UsageSubject>(
  index: UsageIndex<TRow>,
  item: unknown
): FoundReference | undefined {
  if (item === null || typeof item !== "object") return undefined;
  const row = item as Record<string, unknown>;
  const own = index.readOwn(row);
  if (own === null) return undefined;
  return {
    referenceId: index.referenceOf(own),
    collection:
      typeof row[COLLECTION_COLUMN] === "string"
        ? row[COLLECTION_COLUMN]
        : null,
    document:
      typeof row[DOCUMENT_COLUMN] === "string" ? row[DOCUMENT_COLUMN] : null,
    single: row.scope === "single",
    ...shareOf(index, own, row),
  };
}

/**
 * A row's share of its document's blocks, for an index that counts them: the
 * class index's rows carry `blocks`. Nothing for any other index.
 */
function shareOf<TRow extends UsageSubject>(
  index: UsageIndex<TRow>,
  own: Omit<TRow, keyof UsageSubject>,
  row: Record<string, unknown>
): Pick<FoundReference, "share"> {
  const blocks = index.blocksOf?.(own);
  if (blocks === undefined) return {};
  return {
    share: {
      locale: String(row.locale),
      variant: String(row.variant),
      field: String(row.field),
      blocks,
    },
  };
}

/**
 * How many blocks a listing's documents hold, and whether that is all of them:
 * a floor when the listing is, or when any document's count is unknown.
 * `undefined` for a listing that counts no blocks.
 */
export function blockCountOf(
  found: DocumentsUsing
): { blocks: number; complete: boolean } | undefined {
  if (found.countsBlocks !== true) return undefined;
  let blocks = 0;
  let known = found.complete;
  for (const entry of found.collections) {
    if (entry.shares === undefined) return undefined;
    for (const shares of entry.shares) {
      const count = documentBlocks(shares);
      if (count === null) known = false;
      else blocks += count;
    }
  }
  return { blocks, complete: known };
}

/**
 * How many documents reference `referenceId`, and whether that is all of them.
 *
 * Derived from {@link listDocumentsUsing}: the number is how many documents
 * that listing holds, so a count and a list of the same thing always agree.
 */
export async function countDocumentsUsing<TRow extends UsageSubject>(args: {
  index: UsageIndex<TRow>;
  read: GroupedUsageReader;
  referenceId: string;
  /**
   * What is known about the index as a whole, resolved ONCE by the caller.
   *
   * Required rather than defaulted, and that is the API decision worth
   * defending. A default would have to be either "whole", which is the
   * confident wrong answer this module exists to stop, or "a floor", which
   * quietly caveats every count on a healthy site. Neither is a fact, so the
   * caller supplies one — and being made to says out loud that this half of
   * the answer is a property of the SCREEN rather than of the component.
   */
  health: UsageIndexHealth;
}): Promise<UsageCount> {
  const found = await listDocumentsUsing(args);
  return { documents: documentCountOf(found), complete: found.complete };
}

/** How many documents a listing holds: the one count of a listing. */
export function documentCountOf(found: DocumentsUsing): number {
  return found.collections.reduce(
    (sum, entry) => sum + entry.documents.length,
    0
  );
}
