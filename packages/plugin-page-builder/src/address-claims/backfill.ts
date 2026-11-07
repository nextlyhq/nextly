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
  readonly withTransaction: <T>(work: (tx: Tx) => Promise<T>) => Promise<T>;
  readonly warn: (message: string, context: Record<string, unknown>) => void;
}

/** Which pages the walk reads. */
const PUBLISHED = { status: { equals: "published" } };

/**
 * Every published page, oldest first (ids are random, so their order says
 * nothing), a batch at a time, as committed. The one walk over a site's
 * pages: the start-up pass claims from it, and a save made while that pass
 * runs finds the pages in its list's way from it. A read that fails throws.
 *
 * Each batch starts after the last page the one before it read, by when it
 * was made and then its id (the order the read sorts by), rather than at a
 * page number: a page unpublished or deleted meanwhile would shift every
 * later one back a place, and a numbered walk would skip one of them.
 */
export async function* publishedPages(
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
 * The page `id` as committed now, or null when it is gone. Read under the
 * page's own lock, so a save of it that has not committed yet waits for this
 * pass, and one that has is what this reads.
 */
async function currentPage(
  deps: BackfillDeps,
  id: string
): Promise<Readonly<Record<string, unknown>> | null> {
  const { items } = await deps.nextly.find({
    collection: deps.pages,
    where: { id: { equals: id } },
    limit: 1,
    overrideAccess: true,
    depth: 0,
  });
  const [row] = items;
  return typeof row === "object" && row !== null
    ? (row as Readonly<Record<string, unknown>>)
    : null;
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
      await reconcileHolder(
        deps.claims,
        tx,
        holder,
        wanted,
        async other => `${other.collection} ${other.id}`
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
 * own lock (taken here, first): null when it is gone.
 */
async function wantedNow(
  deps: BackfillDeps,
  tx: Tx,
  holder: Holder
): Promise<PageClaims | null> {
  await lockHolder(deps.claims, tx, holder);
  const row = await currentPage(deps, holder.id);
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
      for (const address of wanted.addresses) {
        await claimOrWait(deps.claims, tx, { address, holder });
      }
      for (const list of wanted.spaces) {
        await claimSpaceOrWait(deps.claims, tx, { list, holder });
      }
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
