/**
 * The addresses of collections' entries, held in the same transaction as the
 * save that takes or gives them up.
 *
 * Registered on core's in-transaction phase for every collection given a
 * template address in code, and for the templates collection:
 *
 * - An entry's save holds `<address>/<slug>` in each language while the entry
 *   and its collection's template are published, and is refused, naming the
 *   other document, where that address is held. Unpublishing, deleting or
 *   renaming it gives up the old address, handing it to whatever waited.
 * - A template's first publish claims every published entry's address, pages
 *   first: an entry whose address is held is left waiting for it, not
 *   refused, since nobody is saving the entry. Unpublishing or deleting the
 *   template gives up every entry's address.
 *
 * An entry's save and its template's publish take the collection's lock
 * before either reads the other, so neither commits past the other unseen: an
 * entry published while its template is being published is claimed by
 * whichever of the two commits second.
 *
 * @module address-claims/entry-claims-hook
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import {
  holdLocks,
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

/** A committed row as the walks read it. */
type Row = Readonly<Record<string, unknown>>;

/** What entries' claims need, resolved per save. */
export interface EntryClaimsDeps {
  readonly claims: Claims;
  /** Each collection's address segments, by collection slug. */
  readonly addresses: ReadonlyMap<string, readonly string[]>;
  /** The templates collection's slug, as the host named it. */
  readonly templates: string;
  /** The languages an entry's address is held in. */
  readonly locales: () => readonly string[];
  /** Whether `collection`'s template is published, as last committed. */
  readonly templatePublished: (collection: string) => Promise<boolean>;
  /**
   * One page (from 1) of `collection`'s published entries, as last
   * committed, oldest first, `size` to a page.
   */
  readonly publishedEntries: (
    collection: string,
    page: number,
    size: number
  ) => Promise<readonly Row[]>;
  /** Names the document an address is held by, in a refusal. */
  readonly describe: DescribeHolder;
}

/** The slice of an in-transaction write the hooks read. */
interface HostWrite {
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
  hooks.onInTransaction(deps.templates, write =>
    settleTemplateClaims(write, deps)
  );
}

/** A record, or null for anything else. */
function recordOf(value: unknown): Row | null {
  return typeof value === "object" && value !== null ? (value as Row) : null;
}

/**
 * The lock an entry's save and its template's publish take first: the
 * collection's address, in the first language claims are held in.
 */
function collectionLock(
  address: readonly string[],
  locales: readonly string[]
): { locale: string; segments: readonly string[] }[] {
  const locale = locales[0];
  return locale === undefined ? [] : [{ locale, segments: address }];
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
  deps: EntryClaimsDeps
): Promise<void> {
  if (typeof write.id !== "string" && typeof write.id !== "number") return;
  const address = deps.addresses.get(collection);
  if (address === undefined) return;
  const holder: Holder = { collection, id: String(write.id) };
  if (write.transactionKey !== undefined) {
    sharePending(write.transaction, write.transactionKey);
  }
  if (write.operation === "delete") {
    await releaseClaims(deps.claims, write.transaction, holder);
    return;
  }
  const data = recordOf(write.data);
  if (data === null || data._isWorkingDraft === true) return;
  const locales = deps.locales();
  // Before the template is read, so a publish of it in flight is waited for
  // and then seen, and the template's walk sees this entry once committed.
  await holdLocks(
    deps.claims,
    write.transaction,
    collectionLock(address, locales)
  );
  const wanted = (await deps.templatePublished(collection))
    ? entryAddresses(data, address, locales)
    : [];
  if (wanted === NO_ADDRESS) {
    throw NextlyError.validation({
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
  await reconcileHolder(
    deps.claims,
    write.transaction,
    holder,
    { addresses: wanted, spaces: [] },
    deps.describe
  );
}

/**
 * When a template is first published, claim every published entry of its
 * collection, each waiting where its address is held; when it is unpublished
 * or deleted, give every entry's address up. A save that leaves it published
 * or unpublished as it was changes no entry.
 */
async function settleTemplateClaims(
  write: HostWrite,
  deps: EntryClaimsDeps
): Promise<void> {
  const data = recordOf(write.data);
  if (data === null || data._isWorkingDraft === true) return;
  const collection = data.collection;
  if (typeof collection !== "string") return;
  const address = deps.addresses.get(collection);
  if (address === undefined) return;
  const before =
    write.operation === "create" ? null : recordOf(write.originalData);
  const wasPublished =
    write.operation === "delete"
      ? data.status === "published"
      : before?.status === "published";
  const nowPublished =
    write.operation !== "delete" && data.status === "published";
  if (wasPublished === nowPublished) return;
  if (write.transactionKey !== undefined) {
    sharePending(write.transaction, write.transactionKey);
  }
  await settleEntries(deps, write.transaction, collection, nowPublished);
}

/**
 * Bring every published entry of `collection` to what it should hold while
 * its template is published (`served`) or not, in `tx`, a page of entries at
 * a time. An entry whose address is held waits for it; one with no address
 * holds nothing. Takes the collection's lock first.
 */
async function settleEntries(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string,
  served: boolean
): Promise<void> {
  const address = deps.addresses.get(collection);
  if (address === undefined) return;
  const locales = deps.locales();
  await holdLocks(deps.claims, tx, collectionLock(address, locales));
  for (let page = 1; ; page += 1) {
    const rows = await deps.publishedEntries(collection, page, BATCH);
    for (const row of rows) {
      await settleEntry(deps, tx, collection, address, locales, row, served);
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
  served: boolean
): Promise<void> {
  const id = row.id;
  if (typeof id !== "string" && typeof id !== "number") return;
  const wanted =
    served && isPublished(row) ? entryAddresses(row, address, locales) : [];
  await reconcileHolder(
    deps.claims,
    tx,
    { collection, id: String(id) },
    // An entry with no address holds nothing; its next save is refused,
    // which tells its author.
    { addresses: wanted === NO_ADDRESS ? [] : wanted, spaces: [] },
    deps.describe,
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
  for (const collection of deps.addresses.keys()) {
    try {
      await deps.withTransaction(async tx => {
        const address = deps.addresses.get(collection) ?? [];
        await holdLocks(
          deps.claims,
          tx,
          collectionLock(address, deps.locales())
        );
        // Read under the lock, so a publish or unpublish of the template in
        // flight is waited for and then seen.
        // An unpublished template's entries hold nothing already: its
        // unpublish gave their addresses up, and no save claims one since.
        if (!(await deps.templatePublished(collection))) return;
        await settleEntries(deps, tx, collection, true);
      });
    } catch (error) {
      deps.warn("Could not settle the addresses of a collection's entries.", {
        collection,
        error: String(error),
      });
    }
  }
}
