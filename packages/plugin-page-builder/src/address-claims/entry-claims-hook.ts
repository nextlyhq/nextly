/**
 * The addresses of collections' entries, held in the same transaction as the
 * save that takes or gives them up.
 *
 * Registered on core's in-transaction phase for every collection given a
 * template address in code, for every other collection that may have a
 * template (whose address is set at runtime, stored on the template, and may
 * be set after start), and for the templates collection:
 *
 * - An entry's save holds `<address>/<slug>` in each language while the entry
 *   is published and drawn on the site (its collection's template or its own
 *   design is published, as `servedAt` decides), and is refused, naming the
 *   other document, where that address is held. Unpublishing, deleting or
 *   renaming it gives up the old address, handing it to whatever waited.
 * - A template's first publish claims every published entry's address, pages
 *   first: an entry whose address is held is left waiting for it, not
 *   refused, since nobody is saving the entry. Unpublishing or deleting the
 *   template gives up the address of every entry without a published own
 *   design, and pointing a published template at another collection does
 *   both. Changing a template's stored address moves every entry it serves:
 *   its old addresses are given up, handing them to whatever waited, and its
 *   new ones claimed, each waiting where it is held.
 * - An own design's publish claims its entry's address, waiting where it is
 *   held, and its unpublish or removal gives the address up, each only where
 *   the collection's template does not serve the entry anyway.
 * - Where the design drawing an entry (its published own design, else its
 *   collection's published template) splits a list into pages, the entry
 *   also holds that list's later pages (`<address>/<slug>/page/*`) as one
 *   space, as a page does: its save is refused where a document is published
 *   among them, and a template's or own design's write that starts the list
 *   paging leaves the entry waiting for them. Paging or unpaging a published
 *   template's list settles every entry it draws, and an own design's
 *   publish, republish, unpublish or removal settles its entry.
 * - A collection created at runtime is addressed only by its template, so
 *   once the template is deleted its entries hold nothing, own designs or
 *   not: there is no address left to serve them at.
 * - A collection that may no longer have a template (its `slug` field
 *   removed, or made localized) is served nowhere, whatever address its
 *   template still stores: the start-up pass gives its entries' addresses
 *   up, and neither an entry's save under an unpublished template, an own
 *   design's write nor its template's unpublish claims one back (see
 *   `servable`).
 *
 * A collection's address declared in code wins over one its template
 * stores, so a collection promoted into code moves to the declared address,
 * and until it starts with the declaration its entries stay at the stored
 * one.
 *
 * An entry's save, its template's publish, a change of its address and its
 * own design's publish or unpublish take the collection's lock before any
 * reads the others, so none commits past another unseen: an entry published
 * while its template or own design is being published, or its address
 * moved, is claimed by whichever commits second.
 *
 * @module address-claims/entry-claims-hook
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import { drawingDesign } from "../templates/entry-designs";
import { addressSegments } from "../templates/template-addresses";

import { claimKey, type ServedAddress } from "./claim-key";
import {
  claimAddress,
  claimOrWait,
  claimSpace,
  committedClaims,
  lockCollection,
  reconcileHolder,
  releaseClaims,
  sharePending,
  type Claims,
  type DescribeHolder,
  type Holder,
  type Tx,
} from "./claim-store";
import {
  designedEntry,
  ENTRY_SLUG_FIELD,
  entryAddresses,
  NO_ADDRESS,
  isPublished,
  pageCandidates,
  servedAt,
  templateChanges,
  type EntryServing,
  type PageCandidates,
} from "./entry-claims";
import { splitsList } from "./page-claims";

/** How many entries one read of a walk takes. */
const BATCH = 100;

/** How many claims one read of the store's holders takes. */
const SWEEP_PAGE = 500;

/** A committed row as the walks read it. */
type Row = Readonly<Record<string, unknown>>;

/** A collection's template as the claims read it, as last committed. */
export interface ServingTemplate {
  readonly published: boolean;
  /** The address it stores, as segments, or null for none. */
  readonly address: readonly string[] | null;
}

/** An entry's published own design as the claims read it. */
export interface OwnDesign {
  /** Whether it splits a list into pages (see `splitsList`). */
  readonly paginates: boolean;
}

/** What entries' claims need, resolved per save. */
export interface EntryClaimsDeps {
  readonly claims: Claims;
  /** Each address declared in code, as segments, by collection slug. */
  readonly addresses: ReadonlyMap<string, readonly string[]>;
  /** The templates collection's slug, as the host named it. */
  readonly templates: string;
  /** The languages an entry's address is held in. */
  readonly locales: () => readonly string[];
  /**
   * `collection`'s template, or null when it has none: as last committed, or,
   * given a save's transaction, read on that transaction's own connection
   * (and held against writes until it ends), so a save asking takes no
   * second connection from the pool while it holds one.
   */
  readonly templateOf: (
    collection: string,
    tx?: Tx
  ) => Promise<ServingTemplate | null>;
  /**
   * The entry `id` of `collection`'s own design, or null when it has no
   * published one, read on `tx`, the write's own transaction, as the
   * template is, so a save asking takes no second connection from the pool
   * while it holds one.
   */
  readonly publishedOwnDesign: (
    collection: string,
    id: string,
    tx: Tx
  ) => Promise<OwnDesign | null>;
  /**
   * The published own designs of `collection`'s entries, by entry id, read
   * on `tx`, the write's own transaction.
   */
  readonly publishedDesigns: (
    collection: string,
    tx: Tx
  ) => Promise<ReadonlyMap<string, OwnDesign>>;
  /**
   * Whether `collection`'s published template splits a list into pages
   * (false where it has none published), read on `tx`, the write's own
   * transaction, so a template's write is read as it leaves the template.
   * Asked only for an entry its template draws.
   */
  readonly templatePaginates: (collection: string, tx: Tx) => Promise<boolean>;
  /**
   * The entries of `collection` among `ids`, published or not, as the
   * write's transaction `tx` sees them, in one read: the hook asks at most
   * `BATCH` ids at a time, and an id with no entry is left out. Read on the
   * transaction's own connection, so a write asking takes no second
   * connection from the pool while it holds one.
   */
  readonly entriesWithIds: (
    collection: string,
    ids: readonly string[],
    tx: Tx
  ) => Promise<readonly Row[]>;
  /**
   * Every collection whose template stores an address, with it as segments,
   * as last committed.
   */
  readonly storedAddresses: () => Promise<
    ReadonlyMap<string, readonly string[]>
  >;
  /**
   * Whether `collection` is one whose writes never move an entry's address:
   * the page builder's own collections, whose documents are not entries
   * served under a template address.
   */
  readonly neverServed: (collection: string) => boolean;
  /**
   * Whether `collection` may have a template at all (a `slug` text field,
   * shown in the admin, not localized): one that has a template still but
   * may no longer serves nothing, and the start-up pass gives its entries'
   * addresses up. Given a write's transaction, read on it.
   */
  readonly mayHaveTemplate: (collection: string, tx?: Tx) => Promise<boolean>;
  /**
   * Why a stored address cannot be `address` for `collection`, judged
   * without reading, or null: the guard's own words, asked again of the
   * template as its write leaves it, whichever path the write took.
   */
  readonly storedAddressProblem: (
    address: unknown,
    collection: string
  ) => string | null;
  /**
   * Whether `collection` has a Draft/Published lifecycle: without one,
   * every entry is live, whatever a field named `status` holds. Read on
   * `tx`, the write's own transaction, so a save asking takes no second
   * connection from the pool while it holds one.
   */
  readonly lifecycle: (collection: string, tx: Tx) => Promise<boolean>;
  /** The Pages collection's slug, as the host named it. */
  readonly pages: string;
  /** Whether the start-up pass has claimed every existing page. */
  readonly pagesBackfilled: () => boolean;
  /**
   * The published pages whose slug is one of `slugs`, as committed, with
   * the addresses and list spaces each holds: the pages an entry's address
   * could fall on before the start-up pass has claimed them.
   */
  readonly pagesWithSlugs: (slugs: readonly string[]) => Promise<
    readonly {
      id: string;
      addresses: readonly ServedAddress[];
      spaces: readonly ServedAddress[];
    }[]
  >;
  /**
   * One page (from 1) of `collection`'s published entries, as last
   * committed, oldest first, `size` to a page.
   */
  readonly publishedEntries: (
    collection: string,
    page: number,
    size: number
  ) => Promise<readonly Row[]>;
  /**
   * Names the document an address is held by, in a refusal, reading it on
   * the write's own transaction, so naming it takes no second connection
   * from the pool while the save holds one.
   */
  readonly describe: (tx: Tx) => DescribeHolder;
}

/** The slice of an in-transaction write the hooks read. */
interface HostWrite {
  /** The collection written to, or `single:<slug>` for a Single. */
  readonly collection?: string;
  readonly operation: "create" | "update" | "delete";
  readonly id: unknown;
  readonly data: unknown;
  readonly originalData?: unknown;
  readonly transaction: Tx;
  /** The same for every call on one transaction. */
  readonly transactionKey?: object;
}

/** Where the hooks are registered: core's in-transaction phase. */
interface InTransactionHooks {
  onInTransaction(
    collection: string,
    handler: (write: HostWrite) => Promise<void>
  ): void;
}

/** Register the entries' and the templates' claims on `hooks`. */
export function registerEntryAddressClaims(
  hooks: InTransactionHooks,
  deps: EntryClaimsDeps
): void {
  for (const collection of deps.addresses.keys()) {
    hooks.onInTransaction(collection, write =>
      holdEntryClaims(collection, write, deps)
    );
  }
  // Every other collection: one created at runtime is served at the address
  // its template stores, which may be set long after start.
  hooks.onInTransaction("*", write => holdRuntimeEntryClaims(write, deps));
  hooks.onInTransaction(deps.templates, write =>
    settleTemplateClaims(write, deps)
  );
}

/**
 * Whether `collection`'s entries may be served at all: one given an address
 * in code always may (start-up refuses a declared collection that cannot
 * have a template), and any other only while it may still have a template.
 * The one answer the start-up pass, an own design's write, a template's
 * unpublish and an entry's save served by its own design ask, so a write
 * never claims back what start-up gave up. Given a write's transaction, the
 * registry is read on it.
 */
async function servable(
  deps: EntryClaimsDeps,
  collection: string,
  tx?: Tx
): Promise<boolean> {
  return (
    deps.addresses.has(collection) ||
    (await deps.mayHaveTemplate(collection, tx))
  );
}

/** Whether a write's collection is one no template can serve. */
function neverTemplated(collection: string, deps: EntryClaimsDeps): boolean {
  return (
    collection.startsWith("single:") ||
    deps.addresses.has(collection) ||
    collection === deps.templates ||
    deps.neverServed(collection)
  );
}

/**
 * An entry's claims in a collection not given an address in code. Its
 * template is read on the save's own transaction; a collection with none,
 * whose entry has no slug to be served under one (users, media, a plugin's
 * records), takes no lock and reads nothing more. Any other is judged as a
 * declared collection's entry is, at the address its template stores.
 */
async function holdRuntimeEntryClaims(
  write: HostWrite,
  deps: EntryClaimsDeps
): Promise<void> {
  const collection = write.collection;
  if (typeof collection !== "string" || neverTemplated(collection, deps)) {
    return;
  }
  const template = await deps.templateOf(collection, write.transaction);
  const data = recordOf(write.data);
  if (template === null && (data === null || !(ENTRY_SLUG_FIELD in data))) {
    return;
  }
  await holdEntryClaims(collection, write, deps, template);
}

/** Whether two addresses, as segments, are one, or both none. */
function sameAddress(
  a: readonly string[] | null,
  b: readonly string[] | null
): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((part, at) => part === b[at]);
}

/** A stored address as its segments, or null for none. */
function segmentsOf(stored: unknown): readonly string[] | null {
  return typeof stored === "string" && stored !== ""
    ? addressSegments(stored)
    : null;
}

/** A record, or null for anything else. */
function recordOf(value: unknown): Row | null {
  return typeof value === "object" && value !== null ? (value as Row) : null;
}

/**
 * Keep what this write's transaction claims with what its other calls
 * claim, so documents saved together see each other's claims.
 */
function joinPending(write: HostWrite): void {
  if (write.transactionKey !== undefined) {
    sharePending(write.transaction, write.transactionKey);
  }
}

/**
 * The document a save leaves, or null where nothing is to be held for it:
 * none, or a save held as a working draft, which leaves the live document's
 * claims as they are.
 */
function savedData(write: HostWrite): Row | null {
  const data = recordOf(write.data);
  return data === null || data._isWorkingDraft === true ? null : data;
}

/**
 * Hold what the entry the write leaves should hold: nothing once deleted; a
 * save held as a working draft left alone (the live entry keeps its
 * address); and otherwise its address while it is published and drawn on
 * the site (its template or its own design is published), refused where
 * another document holds it. `first` is the template as already read on
 * the write's transaction, if it was.
 */
async function holdEntryClaims(
  collection: string,
  write: HostWrite,
  deps: EntryClaimsDeps,
  first?: ServingTemplate | null
): Promise<void> {
  if (typeof write.id !== "string" && typeof write.id !== "number") return;
  const holder: Holder = { collection, id: String(write.id) };
  joinPending(write);
  if (write.operation === "delete") {
    await releaseEntry(deps, write.transaction, holder, first);
    return;
  }
  const data = savedData(write);
  if (data !== null) {
    await claimEntry(deps, write.transaction, holder, data, first);
  }
}

/**
 * The collection's template, read on `tx`, its row held for share, then the
 * collection's lock: row first and lock second, the order a template's own
 * write takes them in, so an entry's save and a template's publish or
 * address change take turns rather than wait on each other. A template
 * there was none of is read again under the lock, so one created meanwhile
 * is seen, or sees this entry in its own walk.
 */
async function templateUnderLock(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string,
  first?: ServingTemplate | null
): Promise<ServingTemplate | null> {
  const read =
    first === undefined ? await deps.templateOf(collection, tx) : first;
  await lockCollection(deps.claims, tx, collection);
  return read ?? (await deps.templateOf(collection, tx));
}

/**
 * Give up everything a deleted entry held, under the collection's lock, so
 * a template's walk that read the entry before the delete committed cannot
 * claim for it afterwards. A collection given no address in code and with
 * no template holds nothing to give up.
 */
async function releaseEntry(
  deps: EntryClaimsDeps,
  tx: Tx,
  holder: Holder,
  first?: ServingTemplate | null
): Promise<void> {
  const template = await templateUnderLock(deps, tx, holder.collection, first);
  if (template === null && !deps.addresses.has(holder.collection)) return;
  await releaseClaims(deps.claims, tx, holder);
}

/**
 * Bring a saved entry's claims to what `data` should hold: its addresses,
 * and their later pages where the design drawing it splits a list into
 * pages. Either is refused where another document holds it, as a page's
 * save is, naming that document.
 */
async function claimEntry(
  deps: EntryClaimsDeps,
  tx: Tx,
  holder: Holder,
  data: Row,
  first?: ServingTemplate | null
): Promise<void> {
  const template = await templateUnderLock(deps, tx, holder.collection, first);
  const designs = drawingDesigns(deps, tx, holder.collection);
  const address = await servingAddress(deps, tx, holder, template, data, () =>
    designs.own(holder.id)
  );
  if (address === undefined) return;
  const wanted =
    address === null
      ? []
      : await wantedAddresses(deps, tx, holder.collection, address, data);
  const spaces = await listSpaces(designs, holder.id, wanted);
  await claimPagesAt(deps, tx, wanted, "refuse");
  await reconcileHolder(
    deps.claims,
    tx,
    holder,
    { addresses: wanted, spaces },
    deps.describe(tx)
  );
}

/**
 * The designs that may draw a collection's entries, each read at most once
 * per write, on its transaction: an entry's own published design, and the
 * collection's template.
 */
interface DrawingDesigns {
  readonly own: (id: string) => Promise<OwnDesign | null>;
  readonly templatePaginates: () => Promise<boolean>;
}

/** Read once and kept: `read`'s answer, asked for on first use. */
function once<T>(read: () => Promise<T>): () => Promise<T> {
  let answer: Promise<T> | undefined;
  return () => (answer ??= read());
}

/**
 * The designs that may draw `collection`'s entries, read on `tx`: each
 * entry's own design read by itself, or, given `designs` (every published
 * one, read together for a walk), looked up there.
 */
function drawingDesigns(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string,
  designs?: ReadonlyMap<string, OwnDesign>
): DrawingDesigns {
  const own = new Map<string, () => Promise<OwnDesign | null>>();
  return {
    own: id => {
      if (designs !== undefined)
        return Promise.resolve(designs.get(id) ?? null);
      let read = own.get(id);
      if (read === undefined) {
        read = once(() => deps.publishedOwnDesign(collection, id, tx));
        own.set(id, read);
      }
      return read();
    },
    templatePaginates: once(() => deps.templatePaginates(collection, tx)),
  };
}

/**
 * The later pages an entry served at `addresses` holds: the same addresses,
 * as spaces, where the design drawing it (its own published design, else
 * its collection's template, as `drawingDesign` decides) splits a list into
 * pages, and none where it splits none or the entry is served nowhere.
 */
async function listSpaces(
  designs: DrawingDesigns,
  id: string,
  addresses: readonly ServedAddress[]
): Promise<readonly ServedAddress[]> {
  if (addresses.length === 0) return [];
  const drawn = await drawingDesign(await designs.own(id), async () => ({
    paginates: await designs.templatePaginates(),
  }));
  return drawn?.paginates === true ? addresses : [];
}

/**
 * What decides where `collection`'s entries are served, the entry's own
 * design aside, from its template as read under its lock: its address
 * declared in code, else its template's stored one, and whether that
 * template is published. A collection given no address in code whose saved
 * entry `data` has no slug field (one that lost it) has no address. Undefined
 * for a collection given no address in code and with no template, which
 * holds nothing to reconcile: a template's removal gave every entry's
 * address up.
 */
function collectionServing(
  deps: EntryClaimsDeps,
  collection: string,
  template: ServingTemplate | null,
  data?: Row
): Omit<EntryServing, "ownDesignPublished"> | undefined {
  const declared = deps.addresses.get(collection);
  if (template === null && declared === undefined) return undefined;
  const stored =
    data === undefined || ENTRY_SLUG_FIELD in data
      ? (template?.address ?? null)
      : null;
  return {
    address: declared ?? stored,
    templatePublished: template?.published === true,
  };
}

/**
 * Where the entry `holder` is served now, as `servedAt` decides from its
 * collection's `template`, read under the collection's lock, and its own
 * design (`ownDesign`), read on `tx`, the save's own transaction; null where
 * it is served nowhere, and undefined where its collection holds nothing to
 * reconcile (see `collectionServing`). Whether the entry itself is
 * published is judged of `data` by `entryAddresses`, at the address this
 * answers. An own design serves the entry only while the collection may
 * still have a template (see `servable`), asked only once a published design
 * is found, so a save with none reads no registry.
 */
async function servingAddress(
  deps: EntryClaimsDeps,
  tx: Tx,
  holder: Holder,
  template: ServingTemplate | null,
  data: Row,
  ownDesign: () => Promise<OwnDesign | null>
): Promise<readonly string[] | null | undefined> {
  const serving = collectionServing(deps, holder.collection, template, data);
  if (serving === undefined) return undefined;
  return await servedAt({
    ...serving,
    ownDesignPublished: async () =>
      (await ownDesign()) !== null &&
      (await servable(deps, holder.collection, tx)),
  });
}

/**
 * The addresses a saved entry should hold under `address`, and a refusal
 * when it is published with a slug that can be no address.
 */
async function wantedAddresses(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string,
  address: readonly string[],
  data: Row
): Promise<readonly ServedAddress[]> {
  const wanted = entryAddresses(
    data,
    address,
    deps.locales(),
    await deps.lifecycle(collection, tx)
  );
  if (wanted === NO_ADDRESS) throw noAddressRefusal(collection, address);
  return wanted;
}

/** The refusal of a published entry whose slug can be no address. */
function noAddressRefusal(
  collection: string,
  address: readonly string[]
): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: ENTRY_SLUG_FIELD,
        code: "NO_ADDRESS",
        message: `This entry is published under /${address.join("/")}, so it needs a slug that can be its address: one segment, not empty, without "/".`,
      },
    ],
    logContext: { reason: "entry-without-address", collection },
  });
}

/**
 * Until the start-up pass has claimed every existing page, a page already
 * published at one of `addresses` may hold no claim yet, and an entry
 * taking the address would push the page out of it. So such pages claim
 * their addresses first, in this transaction, and the entry is then refused
 * naming them, or waits for them.
 */
async function claimPagesAt(
  deps: EntryClaimsDeps,
  tx: Tx,
  addresses: readonly ServedAddress[],
  mode: "refuse" | "wait"
): Promise<void> {
  if (deps.pagesBackfilled() || addresses.length === 0) return;
  const candidates = pageCandidates(addresses);
  for (const page of await deps.pagesWithSlugs(candidates.slugs)) {
    await claimForPage(deps, tx, page, candidates, mode);
  }
}

/** A page as the pre-claim reads it: its id and what it should hold. */
type CandidatePage = Awaited<
  ReturnType<EntryClaimsDeps["pagesWithSlugs"]>
>[number];

/**
 * Claim for `page` the list space and the addresses among `candidates` it
 * should hold: its list's space first, then its own address, refusing or
 * waiting where another document holds it.
 */
async function claimForPage(
  deps: EntryClaimsDeps,
  tx: Tx,
  page: CandidatePage,
  candidates: PageCandidates,
  mode: "refuse" | "wait"
): Promise<void> {
  const holder: Holder = { collection: deps.pages, id: page.id };
  const describe = deps.describe(tx);
  const lists = page.spaces.filter(list =>
    candidates.lists.has(claimKey("space", list))
  );
  for (const list of lists) {
    await claimSpace(deps.claims, tx, { list, holder, describe });
  }
  const addresses = page.addresses.filter(address =>
    candidates.addresses.has(claimKey("address", address))
  );
  for (const address of addresses) {
    await (mode === "wait"
      ? claimOrWait(deps.claims, tx, { address, holder })
      : claimAddress(deps.claims, tx, { address, holder, describe }));
  }
}

/** A collection a template's write changes the serving of, and where to. */
interface ServingChange {
  readonly collection: string;
  /** Whether the template serves every entry of it from now on. */
  readonly served: boolean;
  /**
   * The collection's address from now on, or null for none: where its
   * entries are served while the template, or an entry's own design, is
   * published.
   */
  readonly address: readonly string[] | null;
}

/**
 * Settle the entries a template's write starts or stops serving, or moves:
 * its first publish claims every published entry of its collection, each
 * waiting where its address is held; an unpublish or a delete gives up the
 * address of every entry without a published own design; pointing a
 * published template at another collection does both; and changing a
 * template's stored address moves every entry it serves. A stored address
 * that changes is judged again first, in the guard's words, so no write
 * path stores one the guard would refuse. A write that leaves it serving
 * what it served, where it served it, changes no entry. An entry's own
 * design is settled for its one entry (see `settleDesignClaims`).
 */
async function settleTemplateClaims(
  write: HostWrite,
  deps: EntryClaimsDeps
): Promise<void> {
  const data = savedData(write);
  if (data === null) return;
  const before =
    write.operation === "create"
      ? null
      : write.operation === "delete"
        ? data
        : recordOf(write.originalData);
  joinPending(write);
  const designed = designedEntry(data) ?? designedEntry(before);
  if (designed !== null) {
    await settleDesignClaims(deps, write, designed, data, before);
    return;
  }
  if (write.operation !== "delete") judgeStoredAddress(deps, data, before);
  const tx = write.transaction;
  for (const change of servingChanges(write.operation, data, before, deps)) {
    if (change.served && change.address !== null) {
      await settleEntries(deps, tx, change.collection, change.address);
      continue;
    }
    // A collection that may no longer have a template is served nowhere,
    // as the start-up pass decides, so no own design keeps an address in
    // it: every entry gives its address up, as with no address left.
    const address =
      change.address !== null && (await servable(deps, change.collection, tx))
        ? change.address
        : null;
    await settleUnserved(deps, tx, change.collection, address);
  }
}

/**
 * Settle the one entry an own design's write starts or stops drawing: a
 * publish claims its address, waiting where it is held, since nobody is
 * saving the entry; an unpublish or a delete gives it up. Each only where
 * `servedAt` answers differently with the design published and without it,
 * or where the design drawing the entry, before the write and after it,
 * differs in splitting a list into pages (its own design republished with a
 * list paged or no longer, or published, unpublished or removed over a
 * template that pages differently), whose later pages it then takes, waits
 * for or gives up. So a design published or removed under a published
 * template that pages alike changes no claim, and a design deleted with its
 * entry never claims for the entry being deleted. Read on the write's
 * transaction and under the collection's
 * lock, as an entry's save reads, so the two never commit past each other
 * unseen. A collection that may no longer have a template is served
 * nowhere (see `servable`): the write gives the entry's address up, and
 * never claims it back after start-up gave it up.
 */
async function settleDesignClaims(
  deps: EntryClaimsDeps,
  write: HostWrite,
  designed: { readonly collection: string; readonly id: string },
  data: Row,
  before: Row | null
): Promise<void> {
  const { was, now, repaged } = designPublishing(write.operation, data, before);
  if (was === now && !repaged) return;
  const { collection, id } = designed;
  const tx = write.transaction;
  // The template read on the write's own transaction, then the collection's
  // lock, in the order an entry's save takes them. A collection whose
  // entries lost their slug field still answers an address here: the
  // entry's row, read below, has no slug, and so holds none.
  const template = await templateUnderLock(deps, tx, collection);
  const serving = collectionServing(deps, collection, template);
  if (serving === undefined) return;
  if (!(await servable(deps, collection, tx))) {
    await releaseClaims(deps.claims, tx, { collection, id });
    return;
  }
  const from = await servedAt({ ...serving, ownDesignPublished: () => was });
  const to = await servedAt({ ...serving, ownDesignPublished: () => now });
  const designs = drawingDesigns(deps, tx, collection);
  const change = { from, to, was, now, before, data };
  if (!(await entryRedrawn(change, designs))) return;
  await settleDesigned(deps, tx, { collection, address: to, designs }, [id]);
}

/**
 * Whether an own design was published before its write (`was`) and is after
 * it (`now`), and, published throughout, whether the write starts or stops
 * it splitting a list into pages (`repaged`).
 */
function designPublishing(
  operation: HostWrite["operation"],
  data: Row,
  before: Row | null
): { readonly was: boolean; readonly now: boolean; readonly repaged: boolean } {
  const was =
    operation !== "create" && designedEntry(before)?.published === true;
  const now = operation !== "delete" && designedEntry(data)?.published === true;
  const repaged =
    was && now && splitsList(before?.content) !== splitsList(data.content);
  return { was, now, repaged };
}

/**
 * Whether an own design's write changes what its entry holds: where it is
 * served (`from` before the write, `to` after), or, served at one address
 * throughout, whether the design drawing it splits a list into pages (the
 * own design while it is published, else the collection's template).
 */
async function entryRedrawn(
  change: {
    readonly from: readonly string[] | null;
    readonly to: readonly string[] | null;
    readonly was: boolean;
    readonly now: boolean;
    readonly before: Row | null;
    readonly data: Row;
  },
  designs: DrawingDesigns
): Promise<boolean> {
  if (!sameAddress(change.from, change.to)) return true;
  if (change.to === null) return false;
  const paged = (published: boolean, row: Row | null) =>
    published ? splitsList(row?.content) : designs.templatePaginates();
  return (
    (await paged(change.was, change.before)) !==
    (await paged(change.now, change.data))
  );
}

/**
 * Bring each of `ids` (entries of `collection`) to what it should hold at
 * `address`, or give up all it holds where `address` is null, in `tx`: an
 * entry no longer published, or gone, holds nothing, and one whose address
 * is held waits for it. The entries are read on `tx`, `BATCH` to a read,
 * so a template with many own designs costs a read per batch, not per
 * entry, and a write holding the pool's last connection never waits for a
 * second. They are read held for share: an entry's save in flight holds its
 * row and waits for this write's lock, or its design's row, and the
 * database refuses one of the two as a deadlock, which the adapter runs
 * again, so the second reads what the first committed. A new own design's
 * entry row is already held for share by the template write's earlier
 * handler (`judgeTemplateInTransaction`) before the collection's lock is
 * taken here, so on that path the row comes first, as an entry's save
 * takes them; a race with the entry's save can still end in the deadlock
 * above, and is run again the same way.
 */
async function settleDesigned(
  deps: EntryClaimsDeps,
  tx: Tx,
  target: {
    readonly collection: string;
    readonly address: readonly string[] | null;
    readonly designs: DrawingDesigns;
  },
  ids: Iterable<string>
): Promise<void> {
  const { collection, address, designs } = target;
  const all = [...ids];
  if (address === null) {
    await releaseEach(deps, tx, collection, all);
    return;
  }
  const served = await servedContext(deps, tx, collection, address, designs);
  for (let at = 0; at < all.length; at += BATCH) {
    await settleBatch(deps, tx, served, all.slice(at, at + BATCH));
  }
}

/**
 * What every entry of one walk is settled against: where its collection is
 * served, in which languages, whether its entries have a lifecycle, and the
 * designs that may draw them.
 */
interface ServedBatchContext {
  readonly collection: string;
  readonly address: readonly string[];
  readonly locales: ReturnType<EntryClaimsDeps["locales"]>;
  readonly lifecycle: Awaited<ReturnType<EntryClaimsDeps["lifecycle"]>>;
  readonly designs: DrawingDesigns;
}

/** The context a walk of `collection`'s entries at `address` settles against. */
async function servedContext(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string,
  address: readonly string[],
  designs: DrawingDesigns
): Promise<ServedBatchContext> {
  return {
    collection,
    address,
    locales: deps.locales(),
    lifecycle: await deps.lifecycle(collection, tx),
    designs,
  };
}

/** Give up the address of each of `collection`'s entries `ids`. */
async function releaseEach(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string,
  ids: readonly string[]
): Promise<void> {
  for (const id of ids) {
    await releaseClaims(deps.claims, tx, { collection, id });
  }
}

/**
 * Settle one batch of entries read together: each published one claims or
 * waits at the address, and one not published, or gone, gives it up.
 */
async function settleBatch(
  deps: EntryClaimsDeps,
  tx: Tx,
  served: ServedBatchContext,
  batch: readonly string[]
): Promise<void> {
  const { collection, lifecycle } = served;
  const rows = rowsById(await deps.entriesWithIds(collection, batch, tx));
  for (const id of batch) {
    const row = rows.get(id);
    await (row === undefined || !isPublished(row, lifecycle)
      ? releaseClaims(deps.claims, tx, { collection, id })
      : settleEntry(deps, tx, served, row));
  }
}

/**
 * The rows read, by id as text. Matched to the id asked exactly: a database
 * may compare loosely, so a row is found only under the id it carries.
 */
function rowsById(read: readonly Row[]): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const row of read) {
    if (typeof row.id === "string" || typeof row.id === "number") {
      rows.set(String(row.id), row);
    }
  }
  return rows;
}

/**
 * Settle `collection`'s entries where its template does not serve them
 * (unpublished, deleted, or pointed elsewhere) and their address is
 * `address`: each entry with a published own design is served there,
 * claiming or waiting as `settleEntries` does, and every other gives its
 * address up, as `servedAt` decides for each. With no address left (a
 * collection created at runtime whose template is gone), every entry gives
 * its address up, own design or not. Under the collection's lock, so an own
 * design published meanwhile is waited for and then read. The designs are
 * read on the template's write's own transaction, held for share: an own
 * design's write in flight holds its row and waits for the template's, and
 * the database refuses one of the two as a deadlock, which the adapter runs
 * again, so the second reads what the first committed.
 */
async function settleUnserved(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string,
  address: readonly string[] | null
): Promise<void> {
  if (address === null) {
    await releaseCollection(deps, tx, collection);
    return;
  }
  await lockCollection(deps.claims, tx, collection);
  const designs = await deps.publishedDesigns(collection, tx);
  const servedHere = (id: string) =>
    servedAt({
      address,
      templatePublished: false,
      ownDesignPublished: () => designs.has(id),
    });
  const holders = await committedHolders(
    deps.claims,
    { holderCollection: { equals: collection } },
    holder => holder.collection === collection
  );
  for (const holder of holders) {
    if ((await servedHere(holder.id)) === null) {
      await releaseClaims(deps.claims, tx, holder);
    }
  }
  const served: string[] = [];
  for (const id of designs.keys()) {
    if ((await servedHere(id)) !== null) served.push(id);
  }
  await settleDesigned(
    deps,
    tx,
    {
      collection,
      address,
      designs: drawingDesigns(deps, tx, collection, designs),
    },
    served
  );
}

/**
 * Refuse a stored address the template's write changes to one the guard
 * would refuse, in its words.
 */
function judgeStoredAddress(
  deps: EntryClaimsDeps,
  data: Row,
  before: Row | null
): void {
  const after = segmentsOf(data.address);
  const collection = data.collection;
  if (
    after === null ||
    typeof collection !== "string" ||
    sameAddress(segmentsOf(before?.address), after)
  ) {
    return;
  }
  const problem = deps.storedAddressProblem(data.address, collection);
  if (problem === null) return;
  throw NextlyError.validation({
    errors: [{ path: "address", code: "TEMPLATE_ADDRESS", message: problem }],
    logContext: { reason: "template-address-refused", collection },
  });
}

/**
 * The collections a template's write changes the serving of: those it
 * starts or stops serving (see `templateChanges`), and its own when its
 * address changes while it stays as it was, published or not, since entries
 * with a published own design are served at the address of an unpublished
 * template too. Where a collection is served is its address declared in
 * code, else the template's stored one: a deleted template, or one pointed
 * at another collection, leaves the collection only the address declared in
 * code, if any.
 */
function servingChanges(
  operation: HostWrite["operation"],
  data: Row,
  before: Row | null,
  deps: EntryClaimsDeps
): ServingChange[] {
  const addressOf = (row: Row | null, collection: string) =>
    deps.addresses.get(collection) ?? segmentsOf(row?.address);
  // The collection's address once the write commits: the template's while
  // it still names the collection, else only the one declared in code.
  const addressAfter = (collection: string) =>
    operation !== "delete" && data.collection === collection
      ? addressOf(data, collection)
      : (deps.addresses.get(collection) ?? null);
  const changes = templateChanges(operation, data, before);
  if (changes.length > 0) {
    return changes.map(({ collection, served }) => ({
      collection,
      served,
      address: addressAfter(collection),
    }));
  }
  const collection = data.collection;
  if (typeof collection !== "string") return [];
  const now = addressAfter(collection);
  // A published template that starts or stops splitting a list into pages
  // changes the later pages every entry it draws holds.
  const moved = !sameAddress(addressOf(before, collection), now);
  return moved || (now !== null && templateRepaged(operation, data, before))
    ? [
        {
          collection,
          served: operation !== "delete" && data.status === "published",
          address: now,
        },
      ]
    : [];
}

/**
 * Whether an update leaves a template published, serving the collection it
 * served, while it starts or stops splitting a list into pages.
 */
function templateRepaged(
  operation: HostWrite["operation"],
  data: Row,
  before: Row | null
): boolean {
  return (
    operation === "update" &&
    before !== null &&
    before.status === "published" &&
    data.status === "published" &&
    before.collection === data.collection &&
    splitsList(before.content) !== splitsList(data.content)
  );
}

/**
 * Bring every published entry of `collection` to what it should hold at
 * `address`, in `tx`, a page of entries at a time. An entry whose address
 * is held waits for it; one with no address holds nothing. Takes the
 * collection's lock first.
 */
async function settleEntries(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string,
  address: readonly string[]
): Promise<void> {
  await lockCollection(deps.claims, tx, collection);
  // Every published own design read together, so a walk reads none per
  // entry: an entry with one is drawn by it, the others by the template.
  const designs = drawingDesigns(
    deps,
    tx,
    collection,
    await deps.publishedDesigns(collection, tx)
  );
  const served = await servedContext(deps, tx, collection, address, designs);
  for (let page = 1; ; page += 1) {
    const rows = await deps.publishedEntries(collection, page, BATCH);
    for (const row of rows) await settleEntry(deps, tx, served, row);
    if (rows.length < BATCH) return;
  }
}

/**
 * One entry's claims, as a template's or an own design's write, or the
 * start-up pass, sets them: its addresses, and their later pages where the
 * design drawing it splits a list into pages, each waited for where another
 * document holds it, since nobody is saving the entry.
 */
async function settleEntry(
  deps: EntryClaimsDeps,
  tx: Tx,
  served: ServedBatchContext,
  row: Row
): Promise<void> {
  const id = row.id;
  if (typeof id !== "string" && typeof id !== "number") return;
  const { collection, address, locales, lifecycle } = served;
  const found = isPublished(row, lifecycle)
    ? entryAddresses(row, address, locales, lifecycle)
    : [];
  // An entry with no address holds nothing; its next save is refused,
  // which tells its author.
  const wanted = found === NO_ADDRESS ? [] : found;
  const spaces = await listSpaces(served.designs, String(id), wanted);
  await claimPagesAt(deps, tx, wanted, "wait");
  await reconcileHolder(
    deps.claims,
    tx,
    { collection, id: String(id) },
    { addresses: wanted, spaces },
    deps.describe(tx),
    { wait: true }
  );
}

/** What the start-up pass needs beside the claims' own deps. */
export interface EntryClaimsPassDeps extends EntryClaimsDeps {
  readonly withTransaction: <T>(work: (tx: Tx) => Promise<T>) => Promise<T>;
  readonly warn: (message: string, context: Record<string, unknown>) => void;
}

/**
 * The template addresses set in the admin, or an empty map, warned about,
 * when they cannot be read.
 */
async function storedOrNone(
  deps: EntryClaimsPassDeps
): Promise<ReadonlyMap<string, readonly string[]> | null> {
  try {
    return await deps.storedAddresses();
  } catch (error) {
    deps.warn("Could not read the template addresses set in the admin.", {
      error: String(error),
    });
    return null;
  }
}

/**
 * Bring every collection's entries to where they are served now, once the
 * page claims are in: an address changed in code or in the admin since the
 * last start moves them (old addresses given up, new ones claimed, each
 * waiting where it is held), and a site upgrading claims its entries for the
 * first time. A pass over entries that already hold what they should writes
 * nothing. Never throws: a collection it cannot settle is warned about and
 * left for the next start.
 */
export async function settleEntryClaimsAtStart(
  deps: EntryClaimsPassDeps
): Promise<void> {
  const stored = (await storedOrNone(deps)) ?? new Map();
  const collections = new Set([...deps.addresses.keys(), ...stored.keys()]);
  for (const collection of collections) {
    try {
      // Asked of the registry before the transaction opens, so the read
      // never waits on the connection the transaction holds.
      const eligible = await servable(deps, collection);
      await deps.withTransaction(tx =>
        settleAtStart(deps, tx, collection, eligible)
      );
    } catch (error) {
      deps.warn("Could not settle the addresses of a collection's entries.", {
        collection,
        error: String(error),
      });
    }
  }
}

/**
 * One collection's entries at start, under its lock, reading its template
 * there, so a publish, an unpublish or an address change in flight is
 * waited for and then seen. Without a published template, only the entries
 * with a published own design are served, and settled; the others' claims
 * were given up by the unpublish. A collection served only at a stored
 * address that may no longer have a template (its `slug` field removed, or
 * made localized) is served nowhere: its entries give their addresses up.
 */
async function settleAtStart(
  deps: EntryClaimsPassDeps,
  tx: Tx,
  collection: string,
  eligible: boolean
): Promise<void> {
  const template = await templateUnderLock(deps, tx, collection);
  if (!eligible) {
    await releaseCollection(deps, tx, collection);
    return;
  }
  const address = deps.addresses.get(collection) ?? template?.address ?? null;
  if (address === null) return;
  await (template?.published === true
    ? settleEntries(deps, tx, collection, address)
    : settleUnserved(deps, tx, collection, address));
}

/**
 * Give up every address and wait held by an entry of a collection given a
 * template address neither in code nor on its template (removed since the
 * last start), so its entries stop being served there and pages may take the
 * paths. Each candidate is asked again under its collection's lock, since an
 * address may be set in the admin meanwhile. Never throws: what it cannot
 * release is warned about and left for the next start, as is everything when
 * the stored addresses cannot be read, since a collection served at one would
 * otherwise lose its entries' claims.
 */
export async function releaseUndeclared(
  deps: EntryClaimsPassDeps
): Promise<void> {
  const stored = await storedOrNone(deps);
  if (stored === null) return;
  const known = new Set([
    deps.pages,
    ...deps.addresses.keys(),
    ...stored.keys(),
  ]);
  let stale: readonly Holder[];
  try {
    stale = await committedHolders(
      deps.claims,
      {},
      holder => !known.has(holder.collection)
    );
  } catch (error) {
    deps.warn("Could not read the address claims to sweep.", {
      error: String(error),
    });
    return;
  }
  for (const collection of new Set(stale.map(holder => holder.collection))) {
    try {
      await deps.withTransaction(tx =>
        releaseUnaddressed(deps, tx, collection)
      );
    } catch (error) {
      deps.warn("Could not release an undeclared collection's addresses.", {
        collection,
        error: String(error),
      });
    }
  }
}

/**
 * Release `collection`'s entries' claims unless, under its lock, its
 * template now stores an address.
 */
async function releaseUnaddressed(
  deps: EntryClaimsPassDeps,
  tx: Tx,
  collection: string
): Promise<void> {
  const template = await templateUnderLock(deps, tx, collection);
  if ((template?.address ?? null) === null) {
    await releaseCollection(deps, tx, collection);
  }
}

/**
 * Every document holding an address or waiting for one, as committed, among
 * the claims `where` narrows to, that `keep` accepts: each once.
 */
async function committedHolders(
  claims: Claims,
  where: Record<string, unknown>,
  keep: (holder: Holder) => boolean
): Promise<Holder[]> {
  const holders = new Map<string, Holder>();
  for (let page = 1; ; page += 1) {
    const { rows, total } = await committedClaims(
      claims,
      { kind: { in: ["address", "waiting"] }, ...where },
      { limit: SWEEP_PAGE, page }
    );
    for (const { holder } of rows) {
      if (holder !== null && keep(holder)) {
        holders.set(`${holder.collection}\u0000${holder.id}`, holder);
      }
    }
    if (rows.length === 0 || page * SWEEP_PAGE >= total)
      return [...holders.values()];
  }
}

/**
 * Give up every address `collection`'s entries hold or wait for, in `tx`,
 * under the collection's lock: what a collection left with no address (its
 * template's address removed, or the template deleted or moved to another
 * collection, with none declared in code) does to its entries, own designs
 * or not, and what the start-up sweep does to a collection no longer given
 * one.
 * Found by the claims themselves, never by reading the collection, so a
 * collection renamed or deleted since is released all the same.
 */
async function releaseCollection(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string
): Promise<void> {
  await lockCollection(deps.claims, tx, collection);
  const holders = await committedHolders(
    deps.claims,
    { holderCollection: { equals: collection } },
    holder => holder.collection === collection
  );
  for (const holder of holders) {
    await releaseClaims(deps.claims, tx, holder);
  }
}
