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
 *   and its collection's template are published, and is refused, naming the
 *   other document, where that address is held. Unpublishing, deleting or
 *   renaming it gives up the old address, handing it to whatever waited.
 * - A template's first publish claims every published entry's address, pages
 *   first: an entry whose address is held is left waiting for it, not
 *   refused, since nobody is saving the entry. Unpublishing or deleting the
 *   template gives up every entry's address, and pointing a published
 *   template at another collection does both. Changing a published
 *   template's stored address moves every entry: its old addresses are given
 *   up, handing them to whatever waited, and its new ones claimed, each
 *   waiting where it is held.
 *
 * A collection's address declared in code wins over one its template
 * stores, so a collection promoted into code moves to the declared address,
 * and until it starts with the declaration its entries stay at the stored
 * one.
 *
 * An entry's save, its template's publish and a change of its address take
 * the collection's lock before any reads the other, so none commits past
 * another unseen: an entry published while its template is being published,
 * or its address moved, is claimed by whichever commits second.
 *
 * @module address-claims/entry-claims-hook
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

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
  ENTRY_SLUG_FIELD,
  entryAddresses,
  NO_ADDRESS,
  isPublished,
  pageCandidates,
  templateChanges,
  type PageCandidates,
} from "./entry-claims";

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

/** What entries' claims need, resolved per save. */
export interface EntryClaimsDeps {
  readonly claims: Claims;
  /** Each address declared in code, as segments, by collection slug. */
  readonly addresses: ReadonlyMap<string, readonly string[]>;
  /** The templates collection's slug, as the host named it. */
  readonly templates: string;
  /** The languages an entry's address is held in. */
  readonly locales: () => readonly string[];
  /** `collection`'s template, as last committed, or null when it has none. */
  readonly templateOf: (collection: string) => Promise<ServingTemplate | null>;
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
   * shown in the admin, not localized): a collection that may not never
   * holds an address, so its saves take no lock.
   */
  readonly mayHaveTemplate: (collection: string) => Promise<boolean>;
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
   * every entry is live, whatever a field named `status` holds.
   */
  readonly lifecycle: (collection: string) => Promise<boolean>;
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
 * An entry's claims in a collection not given an address in code. One that
 * may have a template takes its lock before it reads whether it has one, so
 * a template created, published or given an address while the entry is
 * saved is either seen by this save or sees the entry in its own walk, and
 * the entry is judged at the address its template stores. One that may not
 * takes no lock, unless it has a template still, from before it lost its
 * `slug` field or became localized: its entries are then served nowhere, and
 * each save gives its address up. No template can be made for it meanwhile,
 * so that read needs no lock.
 */
async function holdRuntimeEntryClaims(
  write: HostWrite,
  deps: EntryClaimsDeps
): Promise<void> {
  const collection = write.collection;
  if (typeof collection !== "string" || neverTemplated(collection, deps)) {
    return;
  }
  const eligible = await deps.mayHaveTemplate(collection);
  if (!eligible && (await deps.templateOf(collection)) === null) return;
  await holdEntryClaims(collection, write, deps, eligible);
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
 * address); and otherwise its address while it and its template are
 * published, refused where another document holds it.
 */
async function holdEntryClaims(
  collection: string,
  write: HostWrite,
  deps: EntryClaimsDeps,
  /** False for a collection that may no longer have a template: served nowhere. */
  eligible = true
): Promise<void> {
  if (typeof write.id !== "string" && typeof write.id !== "number") return;
  const holder: Holder = { collection, id: String(write.id) };
  joinPending(write);
  if (write.operation === "delete") {
    await releaseEntry(deps, write.transaction, holder);
    return;
  }
  const data = savedData(write);
  if (data !== null) {
    await claimEntry(deps, write.transaction, holder, data, eligible);
  }
}

/**
 * Give up everything a deleted entry held, under the collection's lock, so
 * a template's walk that read the entry before the delete committed cannot
 * claim for it afterwards.
 */
async function releaseEntry(
  deps: EntryClaimsDeps,
  tx: Tx,
  holder: Holder
): Promise<void> {
  await lockCollection(deps.claims, tx, holder.collection);
  await releaseClaims(deps.claims, tx, holder);
}

/** Bring a saved entry's claims to what `data` should hold. */
async function claimEntry(
  deps: EntryClaimsDeps,
  tx: Tx,
  holder: Holder,
  data: Row,
  eligible: boolean
): Promise<void> {
  // Before the template is read, so a publish of it or a change of its
  // address in flight is waited for and then seen, and the template's walk
  // sees this entry once committed.
  await lockCollection(deps.claims, tx, holder.collection);
  const address = await servingAddress(deps, holder.collection, eligible);
  if (address === undefined) return;
  const wanted =
    address === null
      ? []
      : await wantedAddresses(deps, holder.collection, address, data);
  await claimPagesAt(deps, tx, wanted, "refuse");
  await reconcileHolder(
    deps.claims,
    tx,
    holder,
    { addresses: wanted, spaces: [] },
    deps.describe(tx)
  );
}

/**
 * Where `collection`'s entries are served now, read under its lock: its
 * address declared in code, else its template's stored one, while the
 * template is published; null where they are served nowhere. Undefined for
 * a collection given no address in code and with no template, which holds
 * nothing to reconcile: a template's removal gave every entry's address up.
 */
async function servingAddress(
  deps: EntryClaimsDeps,
  collection: string,
  eligible: boolean
): Promise<readonly string[] | null | undefined> {
  const template = await deps.templateOf(collection);
  const declared = deps.addresses.get(collection);
  if (template === null && declared === undefined) return undefined;
  if (!eligible || template?.published !== true) return null;
  return declared ?? template.address;
}

/**
 * The addresses a saved entry should hold under `address`, and a refusal
 * when it is published with a slug that can be no address.
 */
async function wantedAddresses(
  deps: EntryClaimsDeps,
  collection: string,
  address: readonly string[],
  data: Row
): Promise<readonly ServedAddress[]> {
  const wanted = entryAddresses(
    data,
    address,
    deps.locales(),
    await deps.lifecycle(collection)
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
  /** Where its entries are served from now on, or null for nowhere. */
  readonly address: readonly string[] | null;
}

/**
 * Settle the entries a template's write starts or stops serving, or moves:
 * its first publish claims every published entry of its collection, each
 * waiting where its address is held; an unpublish or a delete gives every
 * entry's address up; pointing a published template at another collection
 * does both; and changing a published template's stored address moves every
 * entry. A stored address that changes is judged again first, in the
 * guard's words, so no write path stores one the guard would refuse. A
 * write that leaves it serving what it served, where it served it, changes
 * no entry.
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
  if (write.operation !== "delete") judgeStoredAddress(deps, data, before);
  joinPending(write);
  for (const change of servingChanges(write.operation, data, before, deps)) {
    await (change.address === null
      ? releaseCollection(deps, write.transaction, change.collection)
      : settleEntries(
          deps,
          write.transaction,
          change.collection,
          change.address
        ));
  }
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
 * starts or stops serving (see `templateChanges`), and its own when it goes
 * on serving it at another address. Where a collection is served is its
 * address declared in code, else the template's stored one.
 */
function servingChanges(
  operation: HostWrite["operation"],
  data: Row,
  before: Row | null,
  deps: EntryClaimsDeps
): ServingChange[] {
  const addressOf = (row: Row | null, collection: string) =>
    deps.addresses.get(collection) ?? segmentsOf(row?.address);
  const changes = templateChanges(operation, data, before);
  if (changes.length > 0) {
    return changes.map(({ collection, served }) => ({
      collection,
      address: served ? addressOf(data, collection) : null,
    }));
  }
  const collection = data.collection;
  if (
    operation === "delete" ||
    data.status !== "published" ||
    typeof collection !== "string"
  ) {
    return [];
  }
  const now = addressOf(data, collection);
  return sameAddress(addressOf(before, collection), now)
    ? []
    : [{ collection, address: now }];
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
  const locales = deps.locales();
  await lockCollection(deps.claims, tx, collection);
  const lifecycle = await deps.lifecycle(collection);
  for (let page = 1; ; page += 1) {
    const rows = await deps.publishedEntries(collection, page, BATCH);
    for (const row of rows) {
      await settleEntry(deps, tx, collection, address, locales, row, lifecycle);
    }
    if (rows.length < BATCH) return;
  }
}

/** One entry's claims, as a template's publish or the start-up pass sets them. */
async function settleEntry(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string,
  address: readonly string[],
  locales: readonly string[],
  row: Row,
  lifecycle: boolean
): Promise<void> {
  const id = row.id;
  if (typeof id !== "string" && typeof id !== "number") return;
  const found = isPublished(row, lifecycle)
    ? entryAddresses(row, address, locales, lifecycle)
    : [];
  // An entry with no address holds nothing; its next save is refused,
  // which tells its author.
  const wanted = found === NO_ADDRESS ? [] : found;
  await claimPagesAt(deps, tx, wanted, "wait");
  await reconcileHolder(
    deps.claims,
    tx,
    { collection, id: String(id) },
    { addresses: wanted, spaces: [] },
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
      await deps.withTransaction(tx => settleAtStart(deps, tx, collection));
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
 * waited for and then seen. An unpublished template's entries hold nothing
 * already: its unpublish gave their addresses up, and no save claims one
 * since. A collection served only at a stored address that may no longer
 * have a template (its `slug` field removed, or made localized) is served
 * nowhere: its entries give their addresses up.
 */
async function settleAtStart(
  deps: EntryClaimsPassDeps,
  tx: Tx,
  collection: string
): Promise<void> {
  await lockCollection(deps.claims, tx, collection);
  const declared = deps.addresses.get(collection);
  if (declared === undefined && !(await deps.mayHaveTemplate(collection))) {
    await releaseCollection(deps, tx, collection);
    return;
  }
  const template = await deps.templateOf(collection);
  const address = declared ?? template?.address ?? null;
  if (template?.published !== true || address === null) return;
  await settleEntries(deps, tx, collection, address);
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
  await lockCollection(deps.claims, tx, collection);
  const address = (await deps.templateOf(collection))?.address ?? null;
  if (address === null) await releaseCollection(deps, tx, collection);
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
 * under the collection's lock: what a template's unpublish, delete, removed
 * address or move to another collection does to the entries it served.
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
