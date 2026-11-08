/**
 * A page's address claims, written in the same transaction as the save that
 * takes or gives them up.
 *
 * Registered on core's in-transaction phase for the Pages collection, so
 * every write path holds them: the admin, REST, the Direct API, a batch, a
 * release and a scheduled publish. A refused claim throws a conflict naming
 * the other document, which rolls the whole save back, so a page is never
 * stored published at an address another document holds.
 *
 * @module address-claims/page-claims-hook
 */
import { readableTitleText } from "@nextlyhq/plugin-sdk";

import { addressesInSpaces, claimKey, type ServedAddress } from "./claim-key";
import {
  claimAddress,
  lockHolder,
  reconcileHolder,
  releaseClaims,
  type Claims,
  sharePending,
  type DescribeHolder,
  type Holder,
  type Tx,
} from "./claim-store";
import { pageClaims } from "./page-claims";

/** What the page claims need, resolved per save. */
export interface PageClaimsDeps {
  /** The Pages collection's slug, as the host named it. */
  readonly pages: string;
  readonly claims: Claims;
  /** The languages a page's address is held in. */
  readonly locales: () => readonly string[];
  /**
   * The page `id` as stored, read on the transaction `tx` stands for, or
   * null when there is none: for naming the page an address is held by.
   */
  readonly readPage: (
    tx: Tx,
    id: string
  ) => Promise<Readonly<Record<string, unknown>> | null>;
  /** Where the host serves its pages (`pagePreviewPath`), if it says. */
  readonly pathTemplate?: string;
  /** Whether the start-up pass has claimed every existing page. */
  readonly backfillDone: () => boolean;
  /**
   * Every published page, oldest first, a batch at a time, as committed:
   * the pages a new list's later pages could fall on.
   */
  readonly publishedPages: () => AsyncIterable<
    readonly Readonly<Record<string, unknown>>[]
  >;
}

/** The slice of the in-transaction write the hook reads. */
interface PageWrite {
  readonly operation: "create" | "update" | "delete";
  readonly id: unknown;
  readonly data: unknown;
  readonly user?: unknown;
  readonly transaction: Tx;
  /** The same for every call on one transaction. */
  readonly transactionKey?: object;
}

/** Where the hook is registered: core's in-transaction phase. */
interface InTransactionHooks {
  onInTransaction(
    collection: string,
    handler: (write: PageWrite) => Promise<void>
  ): void;
}

/** Register the Pages collection's claims on `hooks`. */
export function registerPageAddressClaims(
  hooks: InTransactionHooks,
  deps: PageClaimsDeps
): void {
  hooks.onInTransaction(deps.pages, write => holdPageClaims(write, deps));
}

/**
 * Hold what the page the write leaves should hold: release everything for a
 * deleted page, leave a save held as a working draft alone (the live page
 * keeps its address), and otherwise reconcile its claims with its address
 * and paginated list, in the write's own transaction.
 */
async function holdPageClaims(
  write: PageWrite,
  deps: PageClaimsDeps
): Promise<void> {
  if (typeof write.id !== "string" && typeof write.id !== "number") return;
  const holder: Holder = { collection: deps.pages, id: String(write.id) };
  // Every page saved in this transaction keeps its claims with the others',
  // so two pages saved together see each other's.
  if (write.transactionKey !== undefined) {
    sharePending(write.transaction, write.transactionKey);
  }
  const backfilling = !deps.backfillDone();
  // While the start-up pass runs it may be reconciling this very page from
  // the row as it was; taking the page's lock first makes the two take
  // turns, so the pass reads what this save leaves.
  if (backfilling) await lockHolder(deps.claims, write.transaction, holder);
  if (write.operation === "delete") {
    await releaseClaims(deps.claims, write.transaction, holder);
    return;
  }
  const wanted = savedClaims(write.data, deps);
  if (wanted === null) return;
  const describe = describeFor(deps, write.transaction);
  // Until the start-up pass has claimed every existing page, a list's later
  // pages could be taken over a page published among them that holds no
  // claim yet. So the pages already there are claimed first, in this save's
  // transaction, and the list's claim is then refused naming them.
  if (backfilling && wanted.spaces.length > 0) {
    await claimPagesIn(
      write.transaction,
      wanted.spaces,
      holder,
      deps,
      describe
    );
  }
  await reconcileHolder(
    deps.claims,
    write.transaction,
    holder,
    wanted,
    describe
  );
}

/**
 * What the page a save leaves should hold, or null when the save changes
 * nothing it holds: one held as a working draft, whose live page keeps its
 * address.
 */
function savedClaims(
  data: unknown,
  deps: PageClaimsDeps
): ReturnType<typeof pageClaims> | null {
  if (typeof data !== "object" || data === null) return null;
  const row = data as Record<string, unknown>;
  if (row._isWorkingDraft === true) return null;
  return pageClaims(row, deps.locales(), deps.pathTemplate);
}

/**
 * Claim, for the page each belongs to, every published page's address that
 * falls among the later pages of `spaces`, other than `holder`'s own. Found
 * by the addresses the pages are served at, as they resolve, not by their
 * slugs: under a page path such as `/{slug}/{title}` a page's slug says
 * nothing about where it is served. Every published page is read, a batch
 * at a time, since any of them may be served there.
 */
async function claimPagesIn(
  tx: Tx,
  spaces: readonly ServedAddress[],
  holder: Holder,
  deps: PageClaimsDeps,
  describe: DescribeHolder
): Promise<void> {
  const keys = new Set(spaces.map(space => claimKey("space", space)));
  for await (const batch of deps.publishedPages()) {
    for (const row of batch) {
      const other = otherPage(row, holder, deps.pages);
      if (other === null) continue;
      for (const address of addressesIn(row, keys, deps)) {
        await claimAddress(deps.claims, tx, {
          address,
          holder: other,
          describe,
        });
      }
    }
  }
}

/** The page `row` is, as a holder, unless it is `self` or has no id. */
function otherPage(
  row: Readonly<Record<string, unknown>>,
  self: Holder,
  pages: string
): Holder | null {
  const id = row.id;
  if (typeof id !== "string" && typeof id !== "number") return null;
  return String(id) === self.id ? null : { collection: pages, id: String(id) };
}

/** The addresses the page `row` is served at inside the spaces keyed `keys`. */
function addressesIn(
  row: Readonly<Record<string, unknown>>,
  keys: ReadonlySet<string>,
  deps: PageClaimsDeps
): ServedAddress[] {
  return addressesInSpaces(
    pageClaims(row, deps.locales(), deps.pathTemplate).addresses,
    keys
  );
}

/**
 * How a refusal names the document holding an address: a page by its title
 * where a visitor may read it, which a published page is (`the page "About
 * us" (abc123)`), and by its id alone where not (`a page (abc123)`); any
 * other document by its id alone (`a document (abc123)`). Named as the
 * public would see it rather than as the person saving, so a name leaks
 * nothing to any caller.
 *
 * Read on the save's own transaction, never through the pool: the save holds
 * a connection while it is refused, and on a pool of one a second would never
 * come free. A page is the plugin's own content, so it is read there; another
 * collection's document cannot be, so it is named by id.
 */
export function describeFor(
  deps: Pick<PageClaimsDeps, "pages" | "readPage">,
  tx: Tx
): DescribeHolder {
  return async holder => {
    if (holder.collection !== deps.pages) return `a document (${holder.id})`;
    const row = await deps.readPage(tx, holder.id).catch(() => null);
    const title =
      row !== null && row.status === "published"
        ? readableTitleText(row.title)
        : undefined;
    return title === undefined
      ? `a page (${holder.id})`
      : `the page "${title}" (${holder.id})`;
  };
}
