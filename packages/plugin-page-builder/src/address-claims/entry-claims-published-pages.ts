/**
 * The pages published at an entry's addresses or among its list's later
 * pages, read and claimed first, until the start-up pass has claimed every
 * page.
 *
 * Part of the entry address claims. `entry-claims-hook.ts` is the entry, and
 * its header explains when an entry holds, waits for or gives up an address.
 *
 * @module address-claims/entry-claims-published-pages
 */

import { claimKey, spaceKeyHolding, type ServedAddress } from "./claim-key";
import {
  claimAddress,
  claimOrWait,
  claimSpace,
  type Holder,
  type Tx,
} from "./claim-store";
import { pageCandidates, type PageCandidates } from "./entry-claims";
import type { PageHolding, EntryClaimsDeps } from "./entry-claims-deps";
import { once } from "./entry-claims-serving";

/** A published page's address that is a later page of some list. */
interface PageInSpace {
  /** The page's id. */
  readonly id: string;
  readonly address: ServedAddress;
}

/**
 * The published pages that may stand among an entry's list's later pages,
 * read on `tx` at most once per write, however many entries it settles:
 * each address of theirs that is a later page of some list, the only ones a
 * list's space can hold, by the key of that list's space, so each entry
 * looks up its own lists' spaces rather than going over every page.
 */
export type PublishedPages = () => Promise<
  ReadonlyMap<string, readonly PageInSpace[]>
>;

/** {@link PublishedPages}, read through `deps` on `tx` when first asked. */
export function publishedPagesRead(
  deps: EntryClaimsDeps,
  tx: Tx
): PublishedPages {
  return once(async () => {
    const bySpace = new Map<string, PageInSpace[]>();
    for await (const batch of deps.publishedPagesOn(tx)) {
      for (const page of batch) indexBySpace(bySpace, page);
    }
    return bySpace;
  });
}

/**
 * Add each of `page`'s addresses that is a later page of some list to
 * `bySpace`, under the key of that list's space.
 */
function indexBySpace(
  bySpace: Map<string, PageInSpace[]>,
  page: PageHolding
): void {
  for (const address of page.addresses) {
    const space = spaceKeyHolding(address);
    if (space === null) continue;
    const inSpace = bySpace.get(space) ?? [];
    inSpace.push({ id: page.id, address });
    bySpace.set(space, inSpace);
  }
}

/**
 * Until the start-up pass has claimed every existing page, a page already
 * published at one of an entry's addresses, or among its list's later
 * pages, may hold no claim yet, and an entry taking the address or the
 * space would push the page out of it, the page then waiting behind the
 * entry once the pass reaches it. So such pages claim those addresses
 * first, in this transaction, and the entry is then refused naming them, or
 * waits for them.
 */
export async function claimPagesAt(
  deps: EntryClaimsDeps,
  tx: Tx,
  wanted: {
    readonly addresses: readonly ServedAddress[];
    readonly spaces: readonly ServedAddress[];
  },
  read: { readonly mode: "refuse" | "wait"; readonly pages: PublishedPages }
): Promise<void> {
  if (deps.pagesBackfilled() || wanted.addresses.length === 0) return;
  const candidates = pageCandidates(wanted.addresses);
  for (const page of await deps.pagesWithSlugs(candidates.slugs, tx)) {
    await claimForPage(deps, tx, page, candidates, read.mode);
  }
  await claimPagesIn(deps, tx, wanted.spaces, read.pages);
}

/**
 * Claim, for the page each belongs to, every published page's address
 * among the later pages of `spaces`, as `spaceKeyHolding` places them,
 * waiting where another document holds it, as the start-up pass would have
 * claimed it: the entry's list then waits for the page, or its save is
 * refused naming it, as where the page had been claimed already.
 */
async function claimPagesIn(
  deps: EntryClaimsDeps,
  tx: Tx,
  spaces: readonly ServedAddress[],
  pages: PublishedPages
): Promise<void> {
  if (spaces.length === 0) return;
  const bySpace = await pages();
  for (const key of new Set(spaces.map(list => claimKey("space", list)))) {
    for (const { id, address } of bySpace.get(key) ?? []) {
      const holder: Holder = { collection: deps.pages, id };
      await claimOrWait(deps.claims, tx, { address, holder });
    }
  }
}

/**
 * Claim for `page` the list space and the addresses among `candidates` it
 * should hold: its list's space first, then its own address, refusing or
 * waiting where another document holds it.
 */
async function claimForPage(
  deps: EntryClaimsDeps,
  tx: Tx,
  page: PageHolding,
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
