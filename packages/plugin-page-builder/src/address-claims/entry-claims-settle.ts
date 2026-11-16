/**
 * How a template's or an own design's write settles the entries it
 * serves: a publish claims their addresses, waiting where they are held,
 * an unpublish or removal gives them up, a moved address moves them, and a
 * list that starts or stops paging settles its later pages.
 *
 * Part of the entry address claims. `entry-claims-hook.ts` is the entry, and
 * its header explains when an entry holds, waits for or gives up an address.
 *
 * @module address-claims/entry-claims-settle
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import {
  holdersIn,
  lockCollection,
  reconcileHolder,
  refuseUnseenHolders,
  releaseClaims,
  type Holder,
  type Tx,
} from "./claim-store";
import {
  designedEntry,
  entryAddresses,
  NO_ADDRESS,
  isPublished,
  servedAt,
  templateChanges,
} from "./entry-claims";
import type { Row, EntryClaimsDeps, HostWrite } from "./entry-claims-deps";
import {
  type PublishedPages,
  publishedPagesRead,
  claimPagesAt,
} from "./entry-claims-published-pages";
import {
  servable,
  sameAddress,
  segmentsOf,
  recordOf,
  joinPending,
  savedData,
  templateUnderLock,
  type DrawingDesigns,
  drawingDesigns,
  listSpaces,
  collectionServing,
} from "./entry-claims-serving";
import { splitsList } from "./page-claims";

/** How many entries one read of a walk takes. */
const BATCH = 100;

/** A collection a template's write changes the serving of, and where to. */
interface ServingChange {
  readonly collection: string;
  /** Whether the template serves every entry of it from now on. */
  readonly served: boolean;
  /**
   * The collection's address from now on, or null for none: where its
   * entries are served while the template, or an entry's own design, is
   * published.
   */
  readonly address: readonly string[] | null;
}

/**
 * Settle the entries a template's write starts or stops serving, or moves:
 * its first publish claims every published entry of its collection, each
 * waiting where its address is held; an unpublish or a delete gives up the
 * address of every entry without a published own design; pointing a
 * published template at another collection does both; and changing a
 * template's stored address moves every entry it serves. A stored address
 * that changes is judged again first, in the guard's words, so no write
 * path stores one the guard would refuse. A write that leaves it serving
 * what it served, where it served it, changes no entry. An entry's own
 * design is settled for its one entry (see `settleDesignClaims`).
 */
export async function settleTemplateClaims(
  write: HostWrite,
  deps: EntryClaimsDeps
): Promise<void> {
  const data = savedData(write);
  if (data === null) return;
  const before =
    write.operation === "create"
      ? null
      : write.operation === "delete"
        ? data
        : recordOf(write.originalData);
  joinPending(write);
  const designed = designedEntry(data) ?? designedEntry(before);
  if (designed !== null) {
    await settleDesignClaims(deps, write, designed, data, before);
    return;
  }
  if (write.operation !== "delete") judgeStoredAddress(deps, data, before);
  const tx = write.transaction;
  for (const change of servingChanges(write.operation, data, before, deps)) {
    if (change.served && change.address !== null) {
      await settleEntries(deps, tx, change.collection, change.address);
      continue;
    }
    // A collection that may no longer have a template is served nowhere,
    // as the start-up pass decides, so no own design keeps an address in
    // it: every entry gives its address up, as with no address left.
    const address =
      change.address !== null && (await servable(deps, change.collection, tx))
        ? change.address
        : null;
    await settleUnserved(deps, tx, change.collection, address);
  }
}

/**
 * Settle the one entry an own design's write starts or stops drawing: a
 * publish claims its address, waiting where it is held, since nobody is
 * saving the entry; an unpublish or a delete gives it up. Each only where
 * `servedAt` answers differently with the design published and without it,
 * or where the design drawing the entry, before the write and after it,
 * differs in splitting a list into pages (its own design republished with a
 * list paged or no longer, or published, unpublished or removed over a
 * template that pages differently), whose later pages it then takes, waits
 * for or gives up. So a design published or removed under a published
 * template that pages alike changes no claim, and a design deleted with its
 * entry never claims for the entry being deleted. Read on the write's
 * transaction and under the collection's
 * lock, as an entry's save reads, so the two never commit past each other
 * unseen. A collection that may no longer have a template is served
 * nowhere (see `servable`): the write gives the entry's address up, and
 * never claims it back after start-up gave it up.
 */
async function settleDesignClaims(
  deps: EntryClaimsDeps,
  write: HostWrite,
  designed: { readonly collection: string; readonly id: string },
  data: Row,
  before: Row | null
): Promise<void> {
  const { was, now, repaged } = designPublishing(write.operation, data, before);
  if (was === now && !repaged) return;
  const { collection, id } = designed;
  const tx = write.transaction;
  // The template read on the write's own transaction, then the collection's
  // lock, in the order an entry's save takes them. A collection whose
  // entries lost their slug field still answers an address here: the
  // entry's row, read below, has no slug, and so holds none.
  const template = await templateUnderLock(deps, tx, collection);
  const serving = collectionServing(deps, collection, template);
  if (serving === undefined) return;
  if (!(await servable(deps, collection, tx))) {
    await releaseClaims(deps.claims, tx, { collection, id });
    return;
  }
  const from = await servedAt({ ...serving, ownDesignPublished: () => was });
  const to = await servedAt({ ...serving, ownDesignPublished: () => now });
  const designs = drawingDesigns(deps, tx, collection);
  const change = { from, to, was, now, before, data };
  if (!(await entryRedrawn(change, designs))) return;
  await settleDesigned(deps, tx, { collection, address: to, designs }, [id]);
}

/**
 * Whether an own design was published before its write (`was`) and is after
 * it (`now`), and, published throughout, whether the write starts or stops
 * it splitting a list into pages (`repaged`).
 */
function designPublishing(
  operation: HostWrite["operation"],
  data: Row,
  before: Row | null
): { readonly was: boolean; readonly now: boolean; readonly repaged: boolean } {
  const was =
    operation !== "create" && designedEntry(before)?.published === true;
  const now = operation !== "delete" && designedEntry(data)?.published === true;
  const repaged =
    was && now && splitsList(before?.content) !== splitsList(data.content);
  return { was, now, repaged };
}

/**
 * Whether an own design's write changes what its entry holds: where it is
 * served (`from` before the write, `to` after), or, served at one address
 * throughout, whether the design drawing it splits a list into pages (the
 * own design while it is published, else the collection's template).
 */
async function entryRedrawn(
  change: {
    readonly from: readonly string[] | null;
    readonly to: readonly string[] | null;
    readonly was: boolean;
    readonly now: boolean;
    readonly before: Row | null;
    readonly data: Row;
  },
  designs: DrawingDesigns
): Promise<boolean> {
  if (!sameAddress(change.from, change.to)) return true;
  if (change.to === null) return false;
  const paged = (published: boolean, row: Row | null) =>
    published ? splitsList(row?.content) : designs.templatePaginates();
  return (
    (await paged(change.was, change.before)) !==
    (await paged(change.now, change.data))
  );
}

/**
 * Bring each of `ids` (entries of `collection`) to what it should hold at
 * `address`, or give up all it holds where `address` is null, in `tx`: an
 * entry no longer published, or gone, holds nothing, and one whose address
 * is held waits for it. The entries are read on `tx`, `BATCH` to a read,
 * so a template with many own designs costs a read per batch, not per
 * entry, and a write holding the pool's last connection never waits for a
 * second. They are read held for share: an entry's save in flight holds its
 * row and waits for this write's lock, or its design's row, and the
 * database refuses one of the two as a deadlock. That save fails and rolls
 * back, nothing of it kept, and its caller may save again, then reading
 * what the other committed: the adapter does not run a deadlocked
 * transaction again itself. A new own design's entry row is already held
 * for share by the template write's earlier handler
 * (`judgeTemplateInTransaction`) before the collection's lock is taken
 * here, so on that path the row comes first, as an entry's save takes
 * them; a race with the entry's save can still end in the deadlock above,
 * with the same outcome.
 */
async function settleDesigned(
  deps: EntryClaimsDeps,
  tx: Tx,
  target: {
    readonly collection: string;
    readonly address: readonly string[] | null;
    readonly designs: DrawingDesigns;
  },
  ids: Iterable<string>
): Promise<void> {
  const { collection, address, designs } = target;
  const all = [...ids];
  if (address === null) {
    await releaseEach(deps, tx, collection, all);
    return;
  }
  const served = await servedContext(deps, tx, collection, address, designs);
  for (let at = 0; at < all.length; at += BATCH) {
    await settleBatch(deps, tx, served, all.slice(at, at + BATCH));
  }
}

/**
 * What every entry of one walk is settled against: where its collection is
 * served, in which languages, whether its entries have a lifecycle, the
 * designs that may draw them, and the pages that may stand among their
 * lists' later pages, read once for the whole walk.
 */
interface ServedBatchContext {
  readonly collection: string;
  readonly address: readonly string[];
  readonly locales: ReturnType<EntryClaimsDeps["locales"]>;
  readonly lifecycle: Awaited<ReturnType<EntryClaimsDeps["lifecycle"]>>;
  readonly designs: DrawingDesigns;
  readonly pages: PublishedPages;
}

/** The context a walk of `collection`'s entries at `address` settles against. */
async function servedContext(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string,
  address: readonly string[],
  designs: DrawingDesigns
): Promise<ServedBatchContext> {
  return {
    collection,
    address,
    locales: deps.locales(),
    lifecycle: await deps.lifecycle(collection, tx),
    designs,
    pages: publishedPagesRead(deps, tx),
  };
}

/** Give up the address of each of `collection`'s entries `ids`. */
async function releaseEach(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string,
  ids: readonly string[]
): Promise<void> {
  for (const id of ids) {
    await releaseClaims(deps.claims, tx, { collection, id });
  }
}

/**
 * Settle one batch of entries read together: each published one claims or
 * waits at the address, and one not published, or gone, gives it up.
 */
async function settleBatch(
  deps: EntryClaimsDeps,
  tx: Tx,
  served: ServedBatchContext,
  batch: readonly string[]
): Promise<void> {
  const { collection, lifecycle } = served;
  const rows = rowsById(await deps.entriesWithIds(collection, batch, tx));
  for (const id of batch) {
    const row = rows.get(id);
    await (row === undefined || !isPublished(row, lifecycle)
      ? releaseClaims(deps.claims, tx, { collection, id })
      : settleEntry(deps, tx, served, row));
  }
}

/**
 * The rows read, by id as text. Matched to the id asked exactly: a database
 * may compare loosely, so a row is found only under the id it carries.
 */
function rowsById(read: readonly Row[]): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const row of read) {
    if (typeof row.id === "string" || typeof row.id === "number") {
      rows.set(String(row.id), row);
    }
  }
  return rows;
}

/**
 * Settle `collection`'s entries where its template does not serve them
 * (unpublished, deleted, or pointed elsewhere) and their address is
 * `address`: each entry with a published own design is served there,
 * claiming or waiting as `settleEntries` does, and every other gives its
 * address up, as `servedAt` decides for each. With no address left (a
 * collection created at runtime whose template is gone), every entry gives
 * its address up, own design or not. Under the collection's lock, so an own
 * design published meanwhile is waited for and then read. The designs are
 * read on the template's write's own transaction, held for share: an own
 * design's write in flight holds its row and waits for the template's, and
 * the database refuses one of the two as a deadlock. That save fails and
 * rolls back, nothing of it kept, and its caller may save again, then
 * reading what the other committed: the adapter does not run a deadlocked
 * transaction again itself.
 */
export async function settleUnserved(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string,
  address: readonly string[] | null
): Promise<void> {
  if (address === null) {
    await releaseCollection(deps, tx, collection);
    return;
  }
  await lockCollection(deps.claims, tx, collection);
  const designs = await deps.publishedDesigns(collection, tx);
  const servedHere = (id: string) =>
    servedAt({
      address,
      templatePublished: false,
      ownDesignPublished: () => designs.has(id),
    });
  // Read on the template's write's own transaction, under the lock taken
  // above: a write holding the pool's last connection never waits for a
  // second one.
  const { where, keep } = entriesClaims(collection);
  const holders = await holdersIn(deps.claims, tx, where, keep);
  for (const holder of holders) {
    if ((await servedHere(holder.id)) === null) {
      await releaseClaims(deps.claims, tx, holder);
    }
  }
  const served: string[] = [];
  for (const id of designs.keys()) {
    if ((await servedHere(id)) !== null) served.push(id);
  }
  await settleDesigned(
    deps,
    tx,
    {
      collection,
      address,
      designs: drawingDesigns(deps, tx, collection, designs),
    },
    served
  );
  // Last, once every lock taken above is held: an entry whose claim the read
  // of holders missed is refused rather than left holding an address its
  // collection no longer serves. Those with a published own design were
  // settled above, their later pages with them, so they are dealt with too.
  await refuseUnseenHolders(deps.claims, tx, where, keep, [
    ...holders,
    ...[...designs.keys()].map(id => ({ collection, id })),
  ]);
}

/**
 * The claims held or waited for by `collection`'s entries: `where` narrows a
 * read to them, and `keep` decides, so the read of holders and the check
 * made after it select the same claims.
 */
function entriesClaims(collection: string): {
  where: Record<string, unknown>;
  keep: (holder: Holder) => boolean;
} {
  return {
    where: { holderCollection: { equals: collection } },
    keep: holder => holder.collection === collection,
  };
}

/**
 * Refuse a stored address the template's write changes to one the guard
 * would refuse, in its words.
 */
function judgeStoredAddress(
  deps: EntryClaimsDeps,
  data: Row,
  before: Row | null
): void {
  const after = segmentsOf(data.address);
  const collection = data.collection;
  if (
    after === null ||
    typeof collection !== "string" ||
    sameAddress(segmentsOf(before?.address), after)
  ) {
    return;
  }
  const problem = deps.storedAddressProblem(data.address, collection);
  if (problem === null) return;
  throw NextlyError.validation({
    errors: [{ path: "address", code: "TEMPLATE_ADDRESS", message: problem }],
    logContext: { reason: "template-address-refused", collection },
  });
}

/**
 * The collections a template's write changes the serving of: those it
 * starts or stops serving (see `templateChanges`), and its own when its
 * address changes while it stays as it was, published or not, since entries
 * with a published own design are served at the address of an unpublished
 * template too. Where a collection is served is its address declared in
 * code, else the template's stored one: a deleted template, or one pointed
 * at another collection, leaves the collection only the address declared in
 * code, if any.
 */
function servingChanges(
  operation: HostWrite["operation"],
  data: Row,
  before: Row | null,
  deps: EntryClaimsDeps
): ServingChange[] {
  const addressOf = (row: Row | null, collection: string) =>
    deps.addresses.get(collection) ?? segmentsOf(row?.address);
  // The collection's address once the write commits: the template's while
  // it still names the collection, else only the one declared in code.
  const addressAfter = (collection: string) =>
    operation !== "delete" && data.collection === collection
      ? addressOf(data, collection)
      : (deps.addresses.get(collection) ?? null);
  const changes = templateChanges(operation, data, before);
  if (changes.length > 0) {
    return changes.map(({ collection, served }) => ({
      collection,
      served,
      address: addressAfter(collection),
    }));
  }
  const collection = data.collection;
  if (typeof collection !== "string") return [];
  const now = addressAfter(collection);
  // A published template that starts or stops splitting a list into pages
  // changes the later pages every entry it draws holds.
  const moved = !sameAddress(addressOf(before, collection), now);
  return moved || (now !== null && templateRepaged(operation, data, before))
    ? [
        {
          collection,
          served: operation !== "delete" && data.status === "published",
          address: now,
        },
      ]
    : [];
}

/**
 * Whether an update leaves a template published, serving the collection it
 * served, while it starts or stops splitting a list into pages.
 */
function templateRepaged(
  operation: HostWrite["operation"],
  data: Row,
  before: Row | null
): boolean {
  return (
    operation === "update" &&
    before !== null &&
    before.status === "published" &&
    data.status === "published" &&
    before.collection === data.collection &&
    splitsList(before.content) !== splitsList(data.content)
  );
}

/**
 * Bring every published entry of `collection` to what it should hold at
 * `address`, in `tx`, a page of entries at a time. An entry whose address
 * is held waits for it; one with no address holds nothing. Takes the
 * collection's lock first. The entries are read on `tx`, held for share: an
 * entry's save in flight holds its row and waits for the template's row or
 * this write's lock, and the database refuses one of the two as a deadlock:
 * that save fails and rolls back, nothing of it kept, and its caller may save
 * again, then reading what the other committed: the adapter does not run a
 * deadlocked transaction again itself.
 */
export async function settleEntries(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string,
  address: readonly string[]
): Promise<void> {
  await lockCollection(deps.claims, tx, collection);
  // Every published own design read together, so a walk reads none per
  // entry: an entry with one is drawn by it, the others by the template.
  const designs = drawingDesigns(
    deps,
    tx,
    collection,
    await deps.publishedDesigns(collection, tx)
  );
  const served = await servedContext(deps, tx, collection, address, designs);
  for (let page = 1; ; page += 1) {
    const rows = await deps.publishedEntries(
      collection,
      page,
      BATCH,
      tx,
      served.lifecycle
    );
    for (const row of rows) await settleEntry(deps, tx, served, row);
    if (rows.length < BATCH) return;
  }
}

/**
 * One entry's claims, as a template's or an own design's write, or the
 * start-up pass, sets them: its addresses, and their later pages where the
 * design drawing it splits a list into pages, each waited for where another
 * document holds it, since nobody is saving the entry.
 */
async function settleEntry(
  deps: EntryClaimsDeps,
  tx: Tx,
  served: ServedBatchContext,
  row: Row
): Promise<void> {
  const id = row.id;
  if (typeof id !== "string" && typeof id !== "number") return;
  const { collection, address, locales, lifecycle } = served;
  const found = isPublished(row, lifecycle)
    ? entryAddresses(row, address, locales, lifecycle)
    : [];
  // An entry with no address holds nothing; its next save is refused,
  // which tells its author.
  const wanted = found === NO_ADDRESS ? [] : found;
  const spaces = await listSpaces(served.designs, String(id), wanted);
  await claimPagesAt(
    deps,
    tx,
    { addresses: wanted, spaces },
    { mode: "wait", pages: served.pages }
  );
  await reconcileHolder(
    deps.claims,
    tx,
    { collection, id: String(id) },
    { addresses: wanted, spaces },
    deps.describe(tx),
    { wait: true }
  );
}

/**
 * Give up every address `collection`'s entries hold or wait for, in `tx`,
 * under the collection's lock: what a collection left with no address (its
 * template's address removed, or the template deleted or moved to another
 * collection, with none declared in code) does to its entries, own designs
 * or not, and what the start-up sweep does to a collection no longer given
 * one.
 * Found by the claims themselves, never by reading the collection, so a
 * collection renamed or deleted since is released all the same.
 */
export async function releaseCollection(
  deps: EntryClaimsDeps,
  tx: Tx,
  collection: string
): Promise<void> {
  await lockCollection(deps.claims, tx, collection);
  // On `tx`, as every read inside a write is: a template's write holding the
  // pool's last connection never waits for a second one.
  const { where, keep } = entriesClaims(collection);
  const holders = await holdersIn(deps.claims, tx, where, keep);
  for (const holder of holders) {
    await releaseClaims(deps.claims, tx, holder);
  }
  // Last, once every lock the releases took is held: an entry whose claim
  // the read of holders missed is refused rather than left holding an
  // address in a collection with none.
  await refuseUnseenHolders(deps.claims, tx, where, keep, holders);
}
