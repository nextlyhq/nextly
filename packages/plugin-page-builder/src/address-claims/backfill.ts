/**
 * The address claims of the pages a site already has, taken once the boot
 * has finished, so a site upgrading to the address store keeps every
 * published page at its address before a new page or list can take it.
 *
 * Run on every boot, in the background, and safe to run again: a page whose
 * claims already match what it should hold is read and left alone, so a pass
 * over a site that is up to date writes nothing, and a site whose languages
 * changed since the last boot claims its pages in the new ones. Pages are
 * claimed oldest first, by when they were made (ids are random, so their
 * order says nothing), so of two pages that clash the older keeps the
 * address and the newer waits for it, reported in the waiting report rather
 * than refused, since nobody is saving it now. A page whose address can no
 * longer be named (a changed page path it cannot fill) gives up what it
 * held.
 *
 * @module address-claims/backfill
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import {
  claimOrWait,
  reconcileHolder,
  type Claims,
  type Tx,
} from "./claim-store";
import { pageClaims } from "./page-claims";

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

/**
 * Claim every published page's address, in id order. Never throws.
 *
 * @returns Whether every page was settled: false when a read or a page's
 *   claim failed and was warned about, so what relies on every existing page
 *   holding its address waits for a pass that completes.
 */
export async function backfillPageClaims(deps: BackfillDeps): Promise<boolean> {
  let complete = true;
  for (let page = 1; ; page += 1) {
    let items: readonly unknown[];
    try {
      ({ items } = await deps.nextly.find({
        collection: deps.pages,
        where: { status: { equals: "published" } },
        // Oldest first; the walk is safe to repeat, so a page published while
        // it pages through is claimed by its own save, or by the next boot.
        sort: "createdAt",
        limit: BATCH,
        page,
        overrideAccess: true,
        depth: 0,
      }));
    } catch (error) {
      deps.warn("Could not read the pages whose addresses to claim.", {
        error: String(error),
      });
      return false;
    }
    for (const item of items) {
      const row = item as Record<string, unknown>;
      if (typeof row.id !== "string" && typeof row.id !== "number") continue;
      if (!(await claimPage(deps, String(row.id), row))) complete = false;
    }
    if (items.length < BATCH) return complete;
  }
}

/**
 * One page's claims: reconciled as a save would, or, where another document
 * already holds its address, left waiting for it.
 *
 * @returns Whether the page was settled, held or waiting.
 */
async function claimPage(
  deps: BackfillDeps,
  id: string,
  row: Readonly<Record<string, unknown>>
): Promise<boolean> {
  const holder = { collection: deps.pages, id };
  // Reconciled even when it holds nothing now, so claims for an address
  // it is no longer served at are given up.
  const wanted = pageClaims(row, deps.locales, deps.pathTemplate);
  try {
    await deps.withTransaction(tx =>
      reconcileHolder(
        deps.claims,
        tx,
        holder,
        wanted,
        async other => `${other.collection} ${other.id}`
      )
    );
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
  // Held by another document: wait for each address rather than refuse,
  // and claim no space, which a later save of the page settles (refused,
  // naming the page in its way, which tells its author).
  if (wanted.spaces.length > 0) {
    deps.warn(
      "A page's list could not hold its later pages: another page is published among them. Its next save is refused, naming that page.",
      { page: id }
    );
  }
  try {
    await deps.withTransaction(async tx => {
      for (const address of wanted.addresses) {
        await claimOrWait(deps.claims, tx, { address, holder });
      }
    });
    return true;
  } catch (error) {
    deps.warn("Could not record a page as waiting for its address.", {
      page: id,
      error: String(error),
    });
    return false;
  }
}
