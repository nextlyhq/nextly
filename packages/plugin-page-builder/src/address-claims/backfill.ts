/**
 * The address claims of the pages a site already has, taken once the boot
 * has finished, so a site upgrading to the address store keeps every
 * published page at its address before a new page or list can take it.
 *
 * Run on every boot, in the background, and safe to run again: a page whose
 * claims already match what it should hold keeps them, so a pass over a site
 * that is up to date changes no claim (it only takes each page's lock row in
 * turn), and a site whose languages changed since the last boot claims its
 * pages in the new ones. Pages are claimed oldest first, by when they were
 * made, so of two pages that clash the older keeps the address and the newer
 * waits for it, reported in the waiting report rather than refused, since
 * nobody is saving it now. A page whose address can no
 * longer be named (a changed page path it cannot fill) gives up what it
 * held.
 *
 * @module address-claims/backfill
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import {
  claimOrWait,
  claimSpaceOrWait,
  dropStaleClaims,
  lockHolder,
  reconcileHolder,
  type Claims,
  type Holder,
  type Tx,
} from "./claim-store";
import { pageClaims, type PageClaims } from "./page-claims";

/** How many pages one read of the walk takes. */
const BATCH = 100;

/** The Direct API read the walk makes. */
export interface PagesReader {
  find(args: Record<string, unknown>): Promise<{ items: readonly unknown[] }>;
}

/** What the backfill needs. */
export interface BackfillDeps {
  readonly pages: string;
  readonly claims: Claims;
  readonly locales: readonly string[];
  /** Where the host serves its pages (`pagePreviewPath`), if it says. */
  readonly pathTemplate?: string;
  readonly nextly: PagesReader;
  /**
   * The page `id` as committed, or null when it is gone, read on the
   * transaction `tx` stands for, with no row lock of its own: the pass reads
   * it under the page's claims lock, which a save of the page takes too. On
   * the pass's own transaction, so a pass holding the pool's last connection
   * never waits for a second one.
   */
  readonly readPage: (
    tx: Tx,
    id: string
  ) => Promise<Readonly<Record<string, unknown>> | null>;
  readonly withTransaction: <T>(work: (tx: Tx) => Promise<T>) => Promise<T>;
  readonly warn: (message: string, context: Record<string, unknown>) => void;
  /**
   * Whether this pass still belongs to the running site: false once a reload
   * has started another, whose languages and page path may differ. Asked
   * before each page, so a superseded pass stops writing.
   */
  readonly current?: () => boolean;
}

/** Which pages the walk reads. */
const PUBLISHED = { status: { equals: "published" } };

/**
 * Every published page, oldest first (ids are random, so their order says
 * nothing), a batch at a time, as committed, through the pool: the walk the
 * start-up pass claims from. A save made while that pass runs walks the
 * pages on its own transaction instead ({@link publishedPagesInTransaction}).
 * A read that fails throws.
 *
 * Each batch starts after the last page the one before it read, by when it
 * was made and then its id (the order the read sorts by), rather than at a
 * page number: a page unpublished or deleted meanwhile would shift every
 * later one back a place, and a numbered walk would skip one of them.
 */
async function* publishedPages(
  nextly: PagesReader,
  pages: string
): AsyncGenerator<readonly Readonly<Record<string, unknown>>[]> {
  let after: { readonly createdAt: unknown; readonly id: unknown } | null =
    null;
  for (;;) {
    const { items } = await nextly.find({
      collection: pages,
      where:
        after === null
          ? PUBLISHED
          : {
              and: [
                PUBLISHED,
                {
                  or: [
                    { createdAt: { greater_than: after.createdAt } },
                    {
                      and: [
                        { createdAt: { equals: after.createdAt } },
                        { id: { greater_than: after.id } },
                      ],
                    },
                  ],
                },
              ],
            },
      // A page published while this pages through is claimed by its own
      // save, or by the next boot's pass.
      sort: ["createdAt", "id"],
      limit: BATCH,
      overrideAccess: true,
      depth: 0,
    });
    const batch = items as readonly Readonly<Record<string, unknown>>[];
    yield batch;
    if (batch.length < BATCH) return;
    after = cursorAfter(batch.at(-1));
  }
}

/** Where the walk resumes after `row`; a row it cannot resume after throws. */
function cursorAfter(row: Readonly<Record<string, unknown>> | undefined): {
  readonly createdAt: unknown;
  readonly id: unknown;
} {
  if (
    row === undefined ||
    row.createdAt === undefined ||
    row.createdAt === null ||
    (typeof row.id !== "string" && typeof row.id !== "number")
  ) {
    throw NextlyError.internal({
      logContext: { reason: "page-walk-cursor-missing" },
    });
  }
  return { createdAt: row.createdAt, id: row.id };
}

/**
 * The read {@link publishedPagesInTransaction} makes: the plugin's own
 * `ownCollections.listEntriesInTransaction` over the Pages collection, on
 * the transaction `tx` stands for.
 */
export type PagesInTransactionRead = (
  tx: Tx,
  options: {
    readonly where: Record<string, unknown>;
    readonly sort: { readonly field: "id"; readonly direction: "asc" };
    readonly pagination: { readonly limit: number };
    readonly depth: 0;
  },
  opts: { readonly lock: "none" }
) => Promise<{ readonly data: readonly unknown[] }>;

/**
 * Every published page, a batch at a time, read on the transaction `tx`
 * stands for: the pages a save made while the start-up pass runs finds in
 * its list's way. On the save's own transaction, so a save holding the
 * pool's last connection never waits for a second one.
 *
 * By id, the one field the read sorts on: the save claims every page it
 * finds in the way, and any refusal rolls it back whole, so the order says
 * only which page a refusal names. Each batch starts after the last id the
 * one before it read, rather than at a page number, so a page unpublished
 * meanwhile shifts none back a place; and the walk stops on a short batch,
 * not on the read's total, which is a count made beside it.
 *
 * Read with no row lock, as the start-up pass reads a page again: the save
 * holds its own page row and its claims locks (the page's own, and each
 * address's it has claimed so far), while another page's save holding its
 * row can be waiting for one of those locks, so a share lock here would wait
 * for a save that waits for this one until the database refuses one of
 * them. Under READ COMMITTED (PostgreSQL's default) the plain read answers
 * the pages as committed, as the walk through the pool did; under MySQL's
 * REPEATABLE READ it answers them as the save's snapshot holds them. Either
 * way a page published after that holds its own claim, taken by its own
 * save, which the list's claim is judged against under its lock.
 */
export async function* publishedPagesInTransaction(
  read: PagesInTransactionRead,
  tx: Tx
): AsyncGenerator<readonly Readonly<Record<string, unknown>>[]> {
  let after: string | number | null = null;
  for (;;) {
    const { data } = await read(
      tx,
      {
        where:
          after === null
            ? PUBLISHED
            : { and: [PUBLISHED, { id: { greater_than: after } }] },
        sort: { field: "id", direction: "asc" },
        pagination: { limit: BATCH },
        depth: 0,
      },
      { lock: "none" }
    );
    const batch = data as readonly Readonly<Record<string, unknown>>[];
    yield batch;
    if (batch.length < BATCH) return;
    after = idAfter(batch.at(-1));
  }
}

/** Where the id walk resumes after `row`; a row with no id throws. */
function idAfter(
  row: Readonly<Record<string, unknown>> | undefined
): string | number {
  const id = row?.id;
  if (typeof id !== "string" && typeof id !== "number") {
    throw NextlyError.internal({
      logContext: { reason: "page-walk-cursor-missing" },
    });
  }
  return id;
}

/**
 * Claim every published page's address, oldest first. Never throws.
 *
 * @returns Whether every page was read and claimed (or left waiting): only
 *   then may saves stop making up for pages the pass has not reached.
 */
export async function backfillPageClaims(deps: BackfillDeps): Promise<boolean> {
  let complete = true;
  try {
    for await (const batch of publishedPages(deps.nextly, deps.pages)) {
      for (const row of batch) {
        // Superseded: the newer pass settles every page, and this one is
        // not complete.
        if (deps.current?.() === false) return false;
        if (typeof row.id !== "string" && typeof row.id !== "number") continue;
        if (!(await claimPage(deps, String(row.id)))) complete = false;
      }
    }
  } catch (error) {
    deps.warn("Could not read the pages whose addresses to claim.", {
      error: String(error),
    });
    return false;
  }
  return complete;
}

/**
 * One page's claims: reconciled as a save would, or, where another document
 * already holds its address, left waiting for it. Its row is read again
 * inside each transaction, under its lock, rather than taken from the walk:
 * a page saved since the walk read it (moved from `/about` to `/about-us`)
 * is reconciled to what it is now, never back to what it was.
 *
 * @returns Whether its claims are settled.
 */
async function claimPage(deps: BackfillDeps, id: string): Promise<boolean> {
  const holder = { collection: deps.pages, id };
  try {
    await deps.withTransaction(async tx => {
      const wanted = await wantedNow(deps, tx, holder);
      // Gone since the walk read it: its delete released what it held.
      if (wanted === null) return;
      // Reconciled even when it holds nothing now, so claims for an address
      // it is no longer served at are given up.
      await reconcileHolder(deps.claims, tx, holder, wanted, other =>
        Promise.resolve(`${other.collection} ${other.id}`)
      );
    });
    return true;
  } catch (error) {
    if (!NextlyError.isCode(error, "CONFLICT")) {
      deps.warn("Could not claim a page's address.", {
        page: id,
        error: String(error),
      });
      return false;
    }
  }
  return waitForAddresses(deps, holder);
}

/**
 * What the page should hold, from its row as committed now, read under its
 * own lock (taken here, first): null when it is gone, or when this pass has
 * been superseded.
 */
async function wantedNow(
  deps: BackfillDeps,
  tx: Tx,
  holder: Holder
): Promise<PageClaims | null> {
  await lockHolder(deps.claims, tx, holder);
  // Asked again under the lock: a pass superseded while it waited for the
  // lock leaves the page to the newer one, which reads it after this.
  if (deps.current?.() === false) return null;
  // Under the page's own lock, so a save of it that has not committed yet
  // waits for this pass, and one that has is what this reads.
  const row = await deps.readPage(tx, holder.id);
  return row === null ? null : pageClaims(row, deps.locales, deps.pathTemplate);
}

/**
 * Where another document holds the page's address, or one is published
 * among its list's later pages: wait for each address and for the later
 * pages rather than refuse, since nobody is saving the page now. It is
 * served at each, and its list paged, once what is in the way is released.
 * The page is read again under its lock, as in the first attempt, since a
 * save may have moved or unpublished it between the two: a wait recorded
 * for an address it has left would later hand it that address.
 */
async function waitForAddresses(
  deps: BackfillDeps,
  holder: Holder
): Promise<boolean> {
  try {
    await deps.withTransaction(async tx => {
      const wanted = await wantedNow(deps, tx, holder);
      if (wanted === null) return;
      // What it should hold first, then what it should not, as reconciling
      // does: releasing a stale address first could hand another list a
      // space over the page's new address before the page claims it.
      for (const address of wanted.addresses) {
        await claimOrWait(deps.claims, tx, { address, holder });
      }
      for (const list of wanted.spaces) {
        await claimSpaceOrWait(deps.claims, tx, { list, holder });
      }
      await dropStaleClaims(deps.claims, tx, holder, wanted);
    });
    return true;
  } catch (error) {
    deps.warn("Could not record a page as waiting for its address.", {
      page: holder.id,
      error: String(error),
    });
    return false;
  }
}
