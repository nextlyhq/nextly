/**
 * The start-up pass: what each collection's claims are worked out from,
 * every collection's entries brought to where they are served now, and the
 * addresses of collections no longer given one released.
 *
 * Part of the entry address claims. `entry-claims-hook.ts` is the entry, and
 * its header explains when an entry holds, waits for or gives up an address.
 *
 * @module address-claims/entry-claims-at-start
 */

import {
  committedClaims,
  type Claims,
  type Holder,
  type Tx,
} from "./claim-store";
import type { ServingTemplate, EntryClaimsDeps } from "./entry-claims-deps";
import { servable, templateUnderLock } from "./entry-claims-serving";
import {
  settleUnserved,
  settleEntries,
  releaseCollection,
} from "./entry-claims-settle";

/** How many claims one read of the store's holders takes. */
const SWEEP_PAGE = 500;

/**
 * Everything about a collection itself, its entries aside, that decides
 * what its entries hold, each asked of {@link EntryClaimsDeps} as the claims
 * ask it: where it is served (its address declared in code, else its
 * template's), whether its template is published and splits a list into
 * pages, whether it may be served at all (a `slug` field, not localized),
 * whether its entries have a Draft/Published lifecycle, and the languages
 * an address is held in. The start-up pass decides each collection from it,
 * and the pass's mark is taken over it, so whatever changes what the pass
 * would do changes the mark: a new question the claims ask belongs here.
 */
export interface CollectionClaimInputs {
  readonly declared: readonly string[] | null;
  readonly template: ServingTemplate | null;
  readonly templatePaginates: boolean;
  readonly servable: boolean;
  readonly lifecycle: boolean;
  readonly locales: readonly string[];
}

/**
 * The {@link CollectionClaimInputs} of `collection`: on `known.tx` where
 * given, else as last committed, with any answer already read (`template`,
 * read under the collection's lock; `servable`, read before a transaction
 * opened) taken as is.
 */
export async function collectionClaimInputs(
  deps: EntryClaimsDeps,
  collection: string,
  known: {
    readonly tx?: Tx;
    readonly template?: ServingTemplate | null;
    readonly servable?: boolean;
  } = {}
): Promise<CollectionClaimInputs> {
  const { tx } = known;
  return {
    declared: deps.addresses.get(collection) ?? null,
    template:
      known.template === undefined
        ? await deps.templateOf(collection, tx)
        : known.template,
    templatePaginates: await deps.templatePaginates(collection, tx),
    servable: known.servable ?? (await servable(deps, collection, tx)),
    lifecycle: await deps.lifecycle(collection, tx),
    locales: deps.locales(),
  };
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
 *
 * @returns Whether every collection was settled, the stored addresses read
 *   included.
 */
export async function settleEntryClaimsAtStart(
  deps: EntryClaimsPassDeps
): Promise<boolean> {
  const read = await storedOrNone(deps);
  const stored = read ?? new Map();
  let settled = read !== null;
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
      settled = false;
      deps.warn("Could not settle the addresses of a collection's entries.", {
        collection,
        error: String(error),
      });
    }
  }
  return settled;
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
  // Decided from the same answers the pass's mark is taken over.
  const inputs = await collectionClaimInputs(deps, collection, {
    tx,
    template: await templateUnderLock(deps, tx, collection),
    servable: eligible,
  });
  if (!inputs.servable) {
    await releaseCollection(deps, tx, collection);
    return;
  }
  const address = inputs.declared ?? inputs.template?.address ?? null;
  if (address === null) return;
  await (inputs.template?.published === true
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
 *
 * @returns Whether every undeclared collection was released.
 */
export async function releaseUndeclared(
  deps: EntryClaimsPassDeps
): Promise<boolean> {
  const stored = await storedOrNone(deps);
  if (stored === null) return false;
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
    return false;
  }
  let released = true;
  for (const collection of new Set(stale.map(holder => holder.collection))) {
    try {
      await deps.withTransaction(tx =>
        releaseUnaddressed(deps, tx, collection)
      );
    } catch (error) {
      released = false;
      deps.warn("Could not release an undeclared collection's addresses.", {
        collection,
        error: String(error),
      });
    }
  }
  return released;
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
 * the claims `where` narrows to, that `keep` accepts: each once. Read through
 * the pool, so only outside a transaction (the start-up sweep); a write reads
 * them on its own with `holdersIn`.
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
