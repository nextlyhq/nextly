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

import { claimKey, type ServedAddress } from "./claim-key";
import {
  claimAddress,
  claimOrWait,
  committedClaims,
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
   * the addresses each holds: the pages an entry's address could fall on
   * before the start-up pass has claimed them.
   */
  readonly pagesWithSlugs: (
    slugs: readonly string[]
  ) => Promise<readonly { id: string; addresses: readonly ServedAddress[] }[]>;
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
    ? entryAddresses(data, address, locales, await deps.lifecycle(collection))
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
  await claimPagesAt(deps, write.transaction, wanted, "refuse");
  await reconcileHolder(
    deps.claims,
    write.transaction,
    holder,
    { addresses: wanted, spaces: [] },
    deps.describe
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
  // A page's slug is its served path, or the end of it under a prefix the
  // host serves pages at, so the candidates are the path's endings.
  const segments = addresses[0]?.segments ?? [];
  const slugs = segments.map((_, at) => segments.slice(at).join("/"));
  for (const page of await deps.pagesWithSlugs(slugs)) {
    const holder: Holder = { collection: deps.pages, id: page.id };
    for (const address of page.addresses) {
      if (!wanted.has(claimKey("address", address))) continue;
      if (mode === "wait") {
        await claimOrWait(deps.claims, tx, { address, holder });
      } else {
        await claimAddress(deps.claims, tx, {
          address,
          holder,
          describe: deps.describe,
        });
      }
    }
  }
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
  const lifecycle = await deps.lifecycle(collection);
  for (let page = 1; ; page += 1) {
    const rows = await deps.publishedEntries(collection, page, BATCH);
    for (const row of rows) {
      await settleEntry(deps, tx, collection, address, locales, row, {
        served,
        lifecycle,
      });
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
  state: { readonly served: boolean; readonly lifecycle: boolean }
): Promise<void> {
  const id = row.id;
  if (typeof id !== "string" && typeof id !== "number") return;
  const found =
    state.served && isPublished(row, state.lifecycle)
      ? entryAddresses(row, address, locales, state.lifecycle)
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
  await releaseUndeclared(deps);
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

/** How many claims one read of the undeclared sweep takes. */
const SWEEP_PAGE = 500;

/**
 * Give up every address and wait held by an entry of a collection no longer
 * given a template address in code (removed since the last start), so its
 * entries stop being served there and pages may take the paths. Never
 * throws: what it cannot release is warned about and left for the next
 * start.
 */
async function releaseUndeclared(deps: EntryClaimsPassDeps): Promise<void> {
  const known = new Set([deps.pages, ...deps.addresses.keys()]);
  const stale = new Map<string, Holder>();
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
        stale.set(`${holder.collection}\u0000${holder.id}`, holder);
      }
      if (rows.length === 0 || page * SWEEP_PAGE >= total) break;
    }
  } catch (error) {
    deps.warn("Could not read the address claims to sweep.", {
      error: String(error),
    });
    return;
  }
  for (const holder of stale.values()) {
    try {
      await deps.withTransaction(tx => releaseClaims(deps.claims, tx, holder));
    } catch (error) {
      deps.warn("Could not release an undeclared collection's address.", {
        collection: holder.collection,
        id: holder.id,
        error: String(error),
      });
    }
  }
}
