/**
 * The in-transaction hooks the claims register, and an entry's own save:
 * it holds its addresses while it is published and served, is refused
 * where one is held, and gives them up when it stops being served.
 *
 * Part of the entry address claims. `entry-claims-hook.ts` is the entry, and
 * its header explains when an entry holds, waits for or gives up an address.
 *
 * @module address-claims/entry-claims-register
 */

import {
  reconcileHolder,
  releaseClaims,
  type Holder,
  type Tx,
} from "./claim-store";
import { ENTRY_SLUG_FIELD } from "./entry-claims";
import type {
  Row,
  ServingTemplate,
  EntryClaimsDeps,
  HostWrite,
  InTransactionHooks,
} from "./entry-claims-deps";
import {
  publishedPagesRead,
  claimPagesAt,
} from "./entry-claims-published-pages";
import {
  neverTemplated,
  recordOf,
  joinPending,
  savedData,
  templateUnderLock,
  drawingDesigns,
  listSpaces,
  servingAddress,
  wantedAddresses,
} from "./entry-claims-serving";
import { settleTemplateClaims } from "./entry-claims-settle";

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
 * An entry's claims in a collection not given an address in code. Its
 * template is read on the save's own transaction; a collection with none,
 * whose entry has no slug to be served under one (users, media, a plugin's
 * records), takes no lock and reads nothing more. Any other is judged as a
 * declared collection's entry is, at the address its template stores.
 */
async function holdRuntimeEntryClaims(
  write: HostWrite,
  deps: EntryClaimsDeps
): Promise<void> {
  const collection = write.collection;
  if (typeof collection !== "string" || neverTemplated(collection, deps)) {
    return;
  }
  const template = await deps.templateOf(collection, write.transaction);
  const data = recordOf(write.data);
  if (template === null && (data === null || !(ENTRY_SLUG_FIELD in data))) {
    return;
  }
  await holdEntryClaims(collection, write, deps, template);
}

/**
 * Hold what the entry the write leaves should hold: nothing once deleted; a
 * save held as a working draft left alone (the live entry keeps its
 * address); and otherwise its address while it is published and drawn on
 * the site (its template or its own design is published), refused where
 * another document holds it. `first` is the template as already read on
 * the write's transaction, if it was.
 */
async function holdEntryClaims(
  collection: string,
  write: HostWrite,
  deps: EntryClaimsDeps,
  first?: ServingTemplate | null
): Promise<void> {
  if (typeof write.id !== "string" && typeof write.id !== "number") return;
  const holder: Holder = { collection, id: String(write.id) };
  joinPending(write);
  if (write.operation === "delete") {
    await releaseEntry(deps, write.transaction, holder, first);
    return;
  }
  const data = savedData(write);
  if (data !== null) {
    await claimEntry(deps, write.transaction, holder, data, first);
  }
}

/**
 * Give up everything a deleted entry held, under the collection's lock, so
 * a template's walk that read the entry before the delete committed cannot
 * claim for it afterwards. A collection given no address in code and with
 * no template holds nothing to give up.
 */
async function releaseEntry(
  deps: EntryClaimsDeps,
  tx: Tx,
  holder: Holder,
  first?: ServingTemplate | null
): Promise<void> {
  const template = await templateUnderLock(deps, tx, holder.collection, first);
  if (template === null && !deps.addresses.has(holder.collection)) return;
  await releaseClaims(deps.claims, tx, holder);
}

/**
 * Bring a saved entry's claims to what `data` should hold: its addresses,
 * and their later pages where the design drawing it splits a list into
 * pages. Either is refused where another document holds it, as a page's
 * save is, naming that document.
 */
async function claimEntry(
  deps: EntryClaimsDeps,
  tx: Tx,
  holder: Holder,
  data: Row,
  first?: ServingTemplate | null
): Promise<void> {
  const template = await templateUnderLock(deps, tx, holder.collection, first);
  const designs = drawingDesigns(deps, tx, holder.collection);
  const address = await servingAddress(deps, tx, holder, template, data, () =>
    designs.own(holder.id)
  );
  if (address === undefined) return;
  const wanted =
    address === null
      ? []
      : await wantedAddresses(deps, tx, holder.collection, address, data);
  const spaces = await listSpaces(designs, holder.id, wanted);
  await claimPagesAt(
    deps,
    tx,
    { addresses: wanted, spaces },
    { mode: "refuse", pages: publishedPagesRead(deps, tx) }
  );
  await reconcileHolder(
    deps.claims,
    tx,
    holder,
    { addresses: wanted, spaces },
    deps.describe(tx)
  );
}
