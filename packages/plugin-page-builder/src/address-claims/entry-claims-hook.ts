/**
 * The addresses of collections' entries, held in the same transaction as the
 * save that takes or gives them up.
 *
 * Registered on core's in-transaction phase for every collection given a
 * template address in code, for every other collection that has a template
 * (whose address is set at runtime, stored on the template, and may be set
 * after start), and for the templates collection:
 *
 * - An entry's save holds `<address>/<slug>` in each language while the entry
 *   and its collection's template are published, and is refused, naming the
 *   other document, where that address is held. Unpublishing, deleting or
 *   renaming it gives up the old address, handing it to whatever waited.
 * - A template's first publish claims every published entry's address, pages
 *   first: an entry whose address is held is left waiting for it, not
 *   refused, since nobody is saving the entry. Unpublishing or deleting the
 *   template gives up every entry's address. Changing a published template's
 *   stored address moves every entry: its old addresses are given up, handing
 *   them to whatever waited, and its new ones claimed, each waiting where it
 *   is held.
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

import { claimKey, spaceHolding, type ServedAddress } from "./claim-key";
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
  if (
    typeof collection !== "string" ||
    collection.startsWith("single:") ||
    deps.addresses.has(collection) ||
    collection === deps.templates ||
    deps.neverServed(collection)
  ) {
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
  if (write.transactionKey !== undefined) {
    sharePending(write.transaction, write.transactionKey);
  }
  if (write.operation === "delete") {
    // Under the collection's lock, so a template's walk that read this entry
    // before the delete committed cannot claim for it afterwards.
    await lockCollection(deps.claims, write.transaction, collection);
    await releaseClaims(deps.claims, write.transaction, holder);
    return;
  }
  const data = recordOf(write.data);
  if (data === null || data._isWorkingDraft === true) return;
  const locales = deps.locales();
  // Before the template is read, so a publish of it or a change of its
  // address in flight is waited for and then seen, and the template's walk
  // sees this entry once committed.
  await lockCollection(deps.claims, write.transaction, collection);
  const template = await deps.templateOf(collection);
  // A collection given no address in code, with no template, holds nothing:
  // a template's removal gave every entry's address up.
  if (template === null && !deps.addresses.has(collection)) return;
  const address = deps.addresses.get(collection) ?? template?.address ?? null;
  const wanted =
    eligible && template?.published === true && address !== null
      ? entryAddresses(data, address, locales, await deps.lifecycle(collection))
      : [];
  if (wanted === NO_ADDRESS) {
    throw NextlyError.validation({
      errors: [
        {
          path: ENTRY_SLUG_FIELD,
          code: "NO_ADDRESS",
          message: `This entry is published under /${(address ?? []).join("/")}, so it needs a slug that can be its address: one segment, not empty, without "/".`,
        },
      ],
      logContext: { reason: "entry-without-address", collection },
    });
  }
  await claimPagesAt(deps, write.transaction, wanted, "refuse");
  await reconcileHolder(
    deps.claims,
    write.transaction,
    holder,
    { addresses: wanted, spaces: [] },
    deps.describe(write.transaction)
  );
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
  const wanted = new Set(addresses.map(at => claimKey("address", at)));
  // The paginated lists whose later pages the address would be one of
  // (`/blog/page/2` is in the space of the page at `/blog`).
  const lists = addresses.flatMap(at => {
    const list = spaceHolding(at);
    return list === null ? [] : [list];
  });
  const wantedLists = new Set(lists.map(at => claimKey("space", at)));
  // A page's slug is its served path, or the end of it under a prefix the
  // host serves pages at, so the candidates are the path's endings, and
  // those of the list's page.
  const endings = (segments: readonly string[]) =>
    segments.map((_, at) => segments.slice(at).join("/"));
  const slugs = [
    ...endings(addresses[0]?.segments ?? []),
    ...endings(lists[0]?.segments ?? []),
  ];
  for (const page of await deps.pagesWithSlugs(slugs)) {
    const holder: Holder = { collection: deps.pages, id: page.id };
    for (const list of page.spaces) {
      if (!wantedLists.has(claimKey("space", list))) continue;
      await claimSpace(deps.claims, tx, {
        list,
        holder,
        describe: deps.describe(tx),
      });
    }
    for (const address of page.addresses) {
      if (!wanted.has(claimKey("address", address))) continue;
      if (mode === "wait") {
        await claimOrWait(deps.claims, tx, { address, holder });
      } else {
        await claimAddress(deps.claims, tx, {
          address,
          holder,
          describe: deps.describe(tx),
        });
      }
    }
  }
}

/**
 * Bring a collection's entries to where its template, as this write leaves
 * it, serves them: claimed when it is first published, given up when it is
 * unpublished or deleted, and moved when its stored address changes while it
 * is published. A stored address that changes is judged again first, in the
 * guard's words, so no write path stores one the guard would refuse. A save
 * that changes neither changes no entry.
 */
async function settleTemplateClaims(
  write: HostWrite,
  deps: EntryClaimsDeps
): Promise<void> {
  const data = recordOf(write.data);
  if (data === null || data._isWorkingDraft === true) return;
  const collection = data.collection;
  if (typeof collection !== "string") return;
  const before =
    write.operation === "create"
      ? null
      : write.operation === "delete"
        ? data
        : recordOf(write.originalData);
  const storedBefore = segmentsOf(before?.address);
  const storedAfter =
    write.operation === "delete" ? null : segmentsOf(data.address);
  if (
    write.operation !== "delete" &&
    storedAfter !== null &&
    !sameAddress(storedBefore, storedAfter)
  ) {
    const problem = deps.storedAddressProblem(data.address, collection);
    if (problem !== null) {
      throw NextlyError.validation({
        errors: [
          { path: "address", code: "TEMPLATE_ADDRESS", message: problem },
        ],
        logContext: { reason: "template-address-refused", collection },
      });
    }
  }
  // A template may be pointed at another collection once its own is gone
  // (renamed or deleted): the old collection's entries then give their
  // addresses up, and the new one's are judged as on a first publish.
  const collectionBefore =
    typeof before?.collection === "string" ? before.collection : collection;
  const retargeted = collectionBefore !== collection;
  const servedBefore =
    before?.status === "published"
      ? (deps.addresses.get(collectionBefore) ?? storedBefore)
      : null;
  const servedAfter =
    write.operation !== "delete" && data.status === "published"
      ? (deps.addresses.get(collection) ?? storedAfter)
      : null;
  if (!retargeted && sameAddress(servedBefore, servedAfter)) return;
  if (write.transactionKey !== undefined) {
    sharePending(write.transaction, write.transactionKey);
  }
  if (retargeted) {
    await releaseCollection(deps, write.transaction, collectionBefore);
    if (servedAfter === null) return;
  }
  await settleEntries(deps, write.transaction, collection, servedAfter);
}

/**
 * Give up every address and wait held by an entry of `collection`, in `tx`,
 * under its lock, reading the holders from the store rather than the
 * collection, which may no longer exist.
 */
async function releaseCollection(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string
): Promise<void> {
  await lockCollection(deps.claims, tx, collection);
  for (const holder of await holdersIn(deps, collection)) {
    await releaseClaims(deps.claims, tx, holder);
  }
}

/** Every holder of `collection` holding or waiting for an address, as committed. */
async function holdersIn(
  deps: Pick<EntryClaimsDeps, "claims">,
  collection: string
): Promise<Holder[]> {
  const holders = new Map<string, Holder>();
  for (let page = 1; ; page += 1) {
    const { rows, total } = await committedClaims(
      deps.claims,
      {
        kind: { in: ["address", "waiting"] },
        holderCollection: { equals: collection },
      },
      { limit: SWEEP_PAGE, page }
    );
    for (const row of rows) {
      // Matched again exactly, as every read of the store is.
      if (row.holder?.collection === collection) {
        holders.set(row.holder.id, row.holder);
      }
    }
    if (rows.length === 0 || page * SWEEP_PAGE >= total)
      return [...holders.values()];
  }
}

/**
 * Bring every published entry of `collection` to what it should hold at
 * `address` (none while its template serves it nowhere), in `tx`, a page of
 * entries at a time. An entry whose address is held waits for it; one with
 * no address holds nothing. Takes the collection's lock first.
 */
async function settleEntries(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string,
  address: readonly string[] | null
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
  address: readonly string[] | null,
  locales: readonly string[],
  row: Row,
  lifecycle: boolean
): Promise<void> {
  const id = row.id;
  if (typeof id !== "string" && typeof id !== "number") return;
  const found =
    address !== null && isPublished(row, lifecycle)
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
 * Bring every collection's entries to the addresses declared now, once the
 * page claims are in: an address changed in code since the last start moves
 * them (old addresses given up, new ones claimed, each waiting where it is
 * held), and a site upgrading claims its entries for the first time. A pass
 * over entries that already hold what they should writes nothing. Never
 * throws: a collection it cannot settle is warned about and left for the
 * next start.
 */
export async function settleEntryClaimsAtStart(
  deps: EntryClaimsPassDeps
): Promise<void> {
  let stored: ReadonlyMap<string, readonly string[]>;
  try {
    stored = await deps.storedAddresses();
  } catch (error) {
    deps.warn("Could not read the template addresses set in the admin.", {
      error: String(error),
    });
    stored = new Map();
  }
  const collections = new Set([...deps.addresses.keys(), ...stored.keys()]);
  for (const collection of collections) {
    try {
      await deps.withTransaction(async tx => {
        await lockCollection(deps.claims, tx, collection);
        // Read under the lock, so a publish, an unpublish or an address
        // change of the template in flight is waited for and then seen.
        // An unpublished template's entries hold nothing already: its
        // unpublish gave their addresses up, and no save claims one since.
        const template = await deps.templateOf(collection);
        const declared = deps.addresses.get(collection);
        // A collection served only at a stored address that may no longer
        // have a template (its `slug` field removed, or made localized) is
        // served nowhere: its entries give their addresses up.
        if (
          declared === undefined &&
          !(await deps.mayHaveTemplate(collection))
        ) {
          await releaseCollection(deps, tx, collection);
          return;
        }
        const address = declared ?? template?.address ?? null;
        if (template?.published !== true || address === null) return;
        await settleEntries(deps, tx, collection, address);
      });
    } catch (error) {
      deps.warn("Could not settle the addresses of a collection's entries.", {
        collection,
        error: String(error),
      });
    }
  }
}

/**
 * Give up every address and wait held by an entry of a collection given a
 * template address neither in code nor on its template (removed since the
 * last start), so its entries stop being served there and pages may take the
 * paths. Never throws: what it cannot release is warned about and left for
 * the next start, as is everything when the stored addresses cannot be read,
 * since a collection served at one would otherwise lose its entries' claims.
 */
export async function releaseUndeclared(
  deps: EntryClaimsPassDeps
): Promise<void> {
  let stored: ReadonlyMap<string, readonly string[]>;
  try {
    stored = await deps.storedAddresses();
  } catch (error) {
    deps.warn("Could not read the template addresses set in the admin.", {
      error: String(error),
    });
    return;
  }
  const known = new Set([
    deps.pages,
    ...deps.addresses.keys(),
    ...stored.keys(),
  ]);
  const stale = new Set<string>();
  try {
    for (let page = 1; ; page += 1) {
      const { rows, total } = await committedClaims(
        deps.claims,
        { kind: { in: ["address", "waiting"] } },
        { limit: SWEEP_PAGE, page }
      );
      for (const row of rows) {
        const holder = row.holder;
        if (holder === null || known.has(holder.collection)) continue;
        stale.add(holder.collection);
      }
      if (rows.length === 0 || page * SWEEP_PAGE >= total) break;
    }
  } catch (error) {
    deps.warn("Could not read the address claims to sweep.", {
      error: String(error),
    });
    return;
  }
  for (const collection of stale) {
    try {
      await deps.withTransaction(async tx => {
        // Under the collection's lock, and asked again: an address may have
        // been set on its template since the read above.
        await lockCollection(deps.claims, tx, collection);
        const address = (await deps.templateOf(collection))?.address ?? null;
        if (address !== null) return;
        for (const holder of await holdersIn(deps, collection)) {
          await releaseClaims(deps.claims, tx, holder);
        }
      });
    } catch (error) {
      deps.warn("Could not release an undeclared collection's addresses.", {
        collection,
        error: String(error),
      });
    }
  }
}
