/**
 * Where an entry is served and what it wants: whether its collection can
 * be served at all, the template that serves it, the design drawing it and
 * the list spaces that design pages, the address it is served at, and the
 * values its save leaves stored.
 *
 * Part of the entry address claims. `entry-claims-hook.ts` is the entry, and
 * its header explains when an entry holds, waits for or gives up an address.
 *
 * @module address-claims/entry-claims-serving
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import { drawingDesign } from "../templates/entry-designs";
import { addressSegments } from "../templates/template-addresses";

import type { ServedAddress } from "./claim-key";
import {
  lockCollection,
  sharePending,
  type Holder,
  type Tx,
} from "./claim-store";
import {
  ENTRY_SLUG_FIELD,
  entryAddresses,
  NO_ADDRESS,
  servedAt,
  type EntryServing,
} from "./entry-claims";
import type {
  Row,
  ServingTemplate,
  OwnDesign,
  EntryClaimsDeps,
  HostWrite,
} from "./entry-claims-deps";

/**
 * Whether `collection`'s entries may be served at all: one given an address
 * in code always may (start-up refuses a declared collection that cannot
 * have a template), and any other only while it may still have a template.
 * The one answer the start-up pass, an own design's write, a template's
 * unpublish and an entry's save served by its own design ask, so a write
 * never claims back what start-up gave up. Given a write's transaction, the
 * registry is read on it.
 */
export async function servable(
  deps: EntryClaimsDeps,
  collection: string,
  tx?: Tx
): Promise<boolean> {
  return (
    deps.addresses.has(collection) ||
    (await deps.mayHaveTemplate(collection, tx))
  );
}

/** Whether a write's collection is one no template can serve. */
export function neverTemplated(
  collection: string,
  deps: EntryClaimsDeps
): boolean {
  return (
    collection.startsWith("single:") ||
    deps.addresses.has(collection) ||
    collection === deps.templates ||
    deps.neverServed(collection)
  );
}

/** Whether two addresses, as segments, are one, or both none. */
export function sameAddress(
  a: readonly string[] | null,
  b: readonly string[] | null
): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((part, at) => part === b[at]);
}

/** A stored address as its segments, or null for none. */
export function segmentsOf(stored: unknown): readonly string[] | null {
  return typeof stored === "string" && stored !== ""
    ? addressSegments(stored)
    : null;
}

/** A record, or null for anything else. */
export function recordOf(value: unknown): Row | null {
  return typeof value === "object" && value !== null ? (value as Row) : null;
}

/**
 * Keep what this write's transaction claims with what its other calls
 * claim, so documents saved together see each other's claims.
 */
export function joinPending(write: HostWrite): void {
  if (write.transactionKey !== undefined) {
    sharePending(write.transaction, write.transactionKey);
  }
}

/**
 * The document a save leaves, or null where nothing is to be held for it:
 * none, or a save held as a working draft, which leaves the live document's
 * claims as they are.
 */
export function savedData(write: HostWrite): Row | null {
  const data = recordOf(write.data);
  return data === null || data._isWorkingDraft === true ? null : data;
}

/**
 * The collection's template, read on `tx`, its row held for share, then the
 * collection's lock: row first and lock second, the order a template's own
 * write takes them in, so an entry's save and a template's publish or
 * address change take turns rather than wait on each other. A template
 * there was none of is read again under the lock, so one created meanwhile
 * is seen, or sees this entry in its own walk.
 */
export async function templateUnderLock(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string,
  first?: ServingTemplate | null
): Promise<ServingTemplate | null> {
  const read =
    first === undefined ? await deps.templateOf(collection, tx) : first;
  await lockCollection(deps.claims, tx, collection);
  return read ?? (await deps.templateOf(collection, tx));
}

/**
 * The designs that may draw a collection's entries, each read at most once
 * per write, on its transaction: an entry's own published design, and the
 * collection's template.
 */
export interface DrawingDesigns {
  readonly own: (id: string) => Promise<OwnDesign | null>;
  readonly templatePaginates: () => Promise<boolean>;
}

/** Read once and kept: `read`'s answer, asked for on first use. */
export function once<T>(read: () => Promise<T>): () => Promise<T> {
  let answer: Promise<T> | undefined;
  return () => (answer ??= read());
}

/**
 * The designs that may draw `collection`'s entries, read on `tx`: each
 * entry's own design read by itself, or, given `designs` (every published
 * one, read together for a walk), looked up there.
 */
export function drawingDesigns(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string,
  designs?: ReadonlyMap<string, OwnDesign>
): DrawingDesigns {
  const own = new Map<string, () => Promise<OwnDesign | null>>();
  return {
    own: id => {
      if (designs !== undefined)
        return Promise.resolve(designs.get(id) ?? null);
      let read = own.get(id);
      if (read === undefined) {
        read = once(() => deps.publishedOwnDesign(collection, id, tx));
        own.set(id, read);
      }
      return read();
    },
    templatePaginates: once(() => deps.templatePaginates(collection, tx)),
  };
}

/**
 * The later pages an entry served at `addresses` holds: the same addresses,
 * as spaces, where the design drawing it (its own published design, else
 * its collection's template, as `drawingDesign` decides) splits a list into
 * pages, and none where it splits none or the entry is served nowhere.
 */
export async function listSpaces(
  designs: DrawingDesigns,
  id: string,
  addresses: readonly ServedAddress[]
): Promise<readonly ServedAddress[]> {
  if (addresses.length === 0) return [];
  const drawn = await drawingDesign(await designs.own(id), async () => ({
    paginates: await designs.templatePaginates(),
  }));
  return drawn?.paginates === true ? addresses : [];
}

/**
 * What decides where `collection`'s entries are served, the entry's own
 * design aside, from its template as read under its lock: its address
 * declared in code, else its template's stored one, and whether that
 * template is published. A collection given no address in code whose saved
 * entry `data` has no slug field (one that lost it) has no address. Undefined
 * for a collection given no address in code and with no template, which
 * holds nothing to reconcile: a template's removal gave every entry's
 * address up.
 */
export function collectionServing(
  deps: EntryClaimsDeps,
  collection: string,
  template: ServingTemplate | null,
  data?: Row
): Omit<EntryServing, "ownDesignPublished"> | undefined {
  const declared = deps.addresses.get(collection);
  if (template === null && declared === undefined) return undefined;
  const stored =
    data === undefined || ENTRY_SLUG_FIELD in data
      ? (template?.address ?? null)
      : null;
  return {
    address: declared ?? stored,
    templatePublished: template?.published === true,
  };
}

/**
 * Where the entry `holder` is served now, as `servedAt` decides from its
 * collection's `template`, read under the collection's lock, and its own
 * design (`ownDesign`), read on `tx`, the save's own transaction; null where
 * it is served nowhere, and undefined where its collection holds nothing to
 * reconcile (see `collectionServing`). Whether the entry itself is
 * published is judged of `data` by `entryAddresses`, at the address this
 * answers. An own design serves the entry only while the collection may
 * still have a template (see `servable`), asked only once a published design
 * is found, so a save with none reads no registry.
 */
export async function servingAddress(
  deps: EntryClaimsDeps,
  tx: Tx,
  holder: Holder,
  template: ServingTemplate | null,
  data: Row,
  ownDesign: () => Promise<OwnDesign | null>
): Promise<readonly string[] | null | undefined> {
  const serving = collectionServing(deps, holder.collection, template, data);
  if (serving === undefined) return undefined;
  return await servedAt({
    ...serving,
    ownDesignPublished: async () =>
      (await ownDesign()) !== null &&
      (await servable(deps, holder.collection, tx)),
  });
}

/**
 * The addresses a saved entry should hold under `address`, and a refusal
 * when it is published with a slug that can be no address.
 */
export async function wantedAddresses(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string,
  address: readonly string[],
  data: Row
): Promise<readonly ServedAddress[]> {
  const wanted = entryAddresses(
    data,
    address,
    deps.locales(),
    await deps.lifecycle(collection, tx)
  );
  if (wanted === NO_ADDRESS) throw noAddressRefusal(collection, address);
  return wanted;
}

/** The refusal of a published entry whose slug can be no address. */
function noAddressRefusal(
  collection: string,
  address: readonly string[]
): NextlyError {
  return NextlyError.validation({
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
