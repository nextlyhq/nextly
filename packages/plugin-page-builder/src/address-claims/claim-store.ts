/**
 * Claiming, waiting for and releasing served addresses, inside the
 * transaction of the save that takes or gives one up.
 *
 * Every write here runs in the caller's transaction, so a claim stands or
 * falls with the save it belongs to. The store's reads are of COMMITTED rows:
 * a plugin's reads do not run on the transaction's connection on PostgreSQL
 * and MySQL, so a row this transaction wrote is invisible to them, and one it
 * deleted still shows. So each transaction's own writes and deletions are
 * kept beside it, and every read here is answered as the transaction sees
 * the store: committed rows less those it deleted, and the rows it wrote.
 *
 * Two holders of one address are refused by the claim key's unique index:
 * the second insert fails, and the refusal names the first. A paginated
 * list's space and an address inside it have different keys, so the index
 * cannot see them collide; both take the space's lock row first, so the
 * second waits for the first to commit and then reads its claim.
 *
 * @module address-claims/claim-store
 */
import { createHash } from "node:crypto";

import {
  NextlyError,
  type PluginCollectionTransaction,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";

import { asOverwrite } from "../document-version";

import {
  claimKey,
  holderLockKey,
  pathOf,
  servedAddress,
  spaceHolding,
  waitingKey,
  type ClaimKind,
  type ServedAddress,
} from "./claim-key";

/** A document that holds, or waits for, an address. */
export interface Holder {
  readonly collection: string;
  readonly id: string;
}

/** A claim as stored. Its keys are stored keys (see {@link storedKey}). */
export interface ClaimRow {
  readonly id: string;
  readonly key: string;
  readonly kind: ClaimKind;
  readonly address: ServedAddress | null;
  readonly holder: Holder | null;
  /** For an address claim, the key of the space that would hold it. */
  readonly space: string | null;
  /** For a waiting row, the key of the claim it waits on. */
  readonly blockedBy: string | null;
}

/** The claims collection, as the store reaches it. */
export interface Claims {
  readonly services: Pick<
    PluginRouteContext["services"],
    "collections" | "ownCollections"
  >;
  /** The collection's slug as stored, which a host may have renamed. */
  readonly slug: string;
  /** The database the site runs on, which decides how a lock is held. */
  readonly dialect: PluginRouteContext["dialect"];
}

export type Tx = PluginCollectionTransaction;

/** Names a holder in a refusal, as the person asking may see it. */
export type DescribeHolder = (holder: Holder) => Promise<string>;

/** Which of a holder's claims a release gives up: all of them by default. */
export interface ReleaseScope {
  /** Only those in this language. */
  readonly locale?: string;
  /** Only those on this address. */
  readonly address?: ServedAddress;
  /**
   * Only claims of this kind: `"space"` for a list that stops paginating but
   * keeps its own address.
   */
  readonly kind?: "address" | "space";
}

/** How many claims one read asks for; a read pages through the rest. */
const READ_PAGE = 500;

/**
 * A key as the unique column stores it: its SHA-256, in hex. Two keys are one
 * stored key exactly when they are the same text, on every dialect: the hex
 * digits compare alike under any collation (MySQL's default one would read
 * `/About` and `/about` as one value), and the length is fixed, so a long
 * address fits wherever a short one does.
 */
export function storedKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** What one transaction has written and deleted, by the store's own hand. */
interface Pending {
  /** Ids of committed rows it deleted. */
  readonly gone: Set<string>;
  /** Rows it wrote, by stored key. */
  readonly written: Map<string, ClaimRow>;
}

const pendingByTransaction = new WeakMap<object, Pending>();

function pendingOf(tx: Tx): Pending {
  const key: object = sharedKeys.get(tx) ?? tx;
  let pending = pendingByTransaction.get(key);
  if (pending === undefined) {
    pending = { gone: new Set(), written: new Map() };
    pendingByTransaction.set(key, pending);
  }
  return pending;
}

/** The transaction each token stands for, where several tokens share one. */
const sharedKeys = new WeakMap<Tx, object>();

/**
 * Keep what is written through `tx` with what other tokens of the same
 * transaction wrote, under `key`: the in-transaction phase hands each
 * handler call a token of its own and one key for the whole transaction, so
 * pages saved in one batch see each other's claims.
 */
export function sharePending(tx: Tx, key: object): void {
  sharedKeys.set(tx, key);
}

/**
 * Up to `limit` committed claims matching `where`, from `page`, with how many
 * match in all.
 */
export async function committedClaims(
  claims: Claims,
  where: Record<string, unknown>,
  { limit, page = 1 }: { limit: number; page?: number }
): Promise<{ rows: ClaimRow[]; total: number }> {
  const { data, pagination } = await claims.services.ownCollections.listEntries(
    claims.slug,
    {
      where,
      pagination: { limit, page },
      sort: { field: "claimKey", direction: "asc" },
      depth: 0,
    }
  );
  return { rows: data.map(rowOf), total: pagination.total };
}

/**
 * Every claim `matches` accepts, as `tx` sees the store. `where` narrows the
 * read; `matches` decides, so a comparison the database makes loosely (MySQL
 * compares text without regard to case) is made again exactly.
 */
async function claimsIn(
  claims: Claims,
  tx: Tx,
  where: Record<string, unknown>,
  matches: (row: ClaimRow) => boolean
): Promise<ClaimRow[]> {
  const { gone, written } = pendingOf(tx);
  const found: ClaimRow[] = [];
  for (let page = 1; ; page++) {
    const { rows, total } = await committedClaims(claims, where, {
      limit: READ_PAGE,
      page,
    });
    found.push(...rows.filter(row => !gone.has(row.id) && matches(row)));
    if (rows.length === 0 || page * READ_PAGE >= total) break;
  }
  for (const row of written.values()) {
    if (matches(row) && !found.some(seen => seen.id === row.id)) {
      found.push(row);
    }
  }
  return found;
}

/** The claims keyed by any of `keys` (canonical keys), as `tx` sees them. */
function keyed(
  claims: Claims,
  tx: Tx,
  keys: readonly string[]
): Promise<ClaimRow[]> {
  const stored = keys.map(storedKey);
  return claimsIn(claims, tx, { claimKey: { in: stored } }, row =>
    stored.includes(row.key)
  );
}

/**
 * Every kind a row may have. A row of any other is read as a lock, the one
 * kind nothing is served from or released for.
 */
const CLAIM_KINDS: readonly ClaimKind[] = [
  "address",
  "space",
  "waiting",
  "lock",
];

/** A stored row read back, every column checked rather than trusted. */
function rowOf(entry: unknown): ClaimRow {
  const row = entry as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const locale = text(row.locale);
  const path = text(row.path);
  const holderCollection = text(row.holderCollection);
  const holderId = text(row.holderId);
  return {
    id: String(row.id),
    key: String(row.claimKey),
    kind: CLAIM_KINDS.find(kind => kind === row.kind) ?? "lock",
    address:
      locale === null || path === null ? null : servedAddress(locale, path),
    holder:
      holderCollection === null || holderId === null
        ? null
        : { collection: holderCollection, id: holderId },
    space: text(row.space),
    blockedBy: text(row.blockedBy),
  };
}

function sameHolder(a: Holder | null, b: Holder): boolean {
  return a !== null && a.collection === b.collection && a.id === b.id;
}

function sameAddress(a: ServedAddress | null, b: ServedAddress): boolean {
  return a !== null && a.locale === b.locale && pathOf(a) === pathOf(b);
}

/** The columns of a claim of `kind` held by `holder` on `address`. */
function columns(
  kind: ClaimKind,
  key: string,
  address: ServedAddress,
  holder: Holder | null
): Record<string, unknown> {
  return {
    claimKey: storedKey(key),
    kind,
    locale: address.locale,
    path: pathOf(address),
    holderCollection: holder?.collection ?? null,
    holderId: holder?.id ?? null,
  };
}

/** An address claim, with the space it falls in, if any. */
function addressColumns(
  address: ServedAddress,
  holder: Holder
): Record<string, unknown> {
  const space = spaceHolding(address);
  return {
    ...columns("address", claimKey("address", address), address, holder),
    space: space === null ? null : storedKey(claimKey("space", space)),
  };
}

/**
 * Write a claim, answering the row written, or null when its key is already
 * held. The insert runs under a savepoint (or, on MySQL, fails alone), so a
 * refused one leaves the transaction usable.
 */
async function insert(
  claims: Claims,
  tx: Tx,
  data: Record<string, unknown>
): Promise<ClaimRow | null> {
  let created: unknown;
  try {
    created = await claims.services.collections.createEntryInTransaction(
      tx,
      claims.slug,
      data
    );
  } catch (error) {
    if (NextlyError.isCode(error, "DUPLICATE")) return null;
    throw error;
  }
  const row = rowOf({ ...data, ...(created as object) });
  pendingOf(tx).written.set(row.key, row);
  return row;
}

/**
 * Delete a claim, and remember this transaction did.
 *
 * A row another save committed after this transaction's snapshot was taken
 * (MySQL's default isolation reads every statement from that snapshot) can
 * be found by the store's reads and still be missing to the delete. The save
 * is then refused as a conflict to retry: nothing it did stands, the row it
 * met is left as it was, and the retry sees it.
 */
async function remove(claims: Claims, tx: Tx, row: ClaimRow): Promise<void> {
  try {
    await claims.services.collections.deleteEntryInTransaction(
      tx,
      claims.slug,
      row.id
    );
  } catch (error) {
    if (!NextlyError.isCode(error, "NOT_FOUND")) throw error;
    throw NextlyError.conflict({
      message:
        "Another save changed who holds or waits for this address just now. Try again.",
      logContext: { reason: "address-claim-changed", claimId: row.id },
      cause: error instanceof Error ? error : undefined,
    });
  }
  const { gone, written } = pendingOf(tx);
  gone.add(row.id);
  if (written.get(row.key)?.id === row.id) written.delete(row.key);
}

/**
 * Hold `list`'s lock row until this transaction ends, so whatever else
 * claims in that space waits, then reads what this transaction claimed. One
 * that exists is held by updating it, which reads it for update; one created
 * here is held the same way, another transaction creating it waiting on the
 * key's index for this one to end. An address's lock row is created by the
 * save that first claims it, so the waits and releases that contend for it
 * later only update it. (On MySQL two saves creating one lock row at once can
 * deadlock; the database then refuses one of them as a conflict to retry, and
 * nothing is claimed by it.)
 *
 * SQLite runs one writer at a time, so a transaction there already has every
 * claim to itself, and takes no lock.
 */
async function lock(
  claims: Claims,
  tx: Tx,
  list: ServedAddress
): Promise<void> {
  const key = claimKey("lock", list);
  await holdLockRow(claims, tx, key, columns("lock", key, list, null), {
    path: pathOf(list),
  });
}

/**
 * Hold `holder`'s own lock row until this transaction ends, so whatever else
 * reconciles that holder's claims waits for this transaction, then reads
 * what it left. The start-up pass takes it before it reads the page it
 * reconciles, and a save of that page takes it while the pass runs, so the
 * pass never reconciles a page from a row a save has since changed. Taken
 * before any address's lock, in both.
 */
export async function lockHolder(
  claims: Claims,
  tx: Tx,
  holder: Holder
): Promise<void> {
  const key = holderLockKey(holder);
  await holdLockRow(
    claims,
    tx,
    key,
    { claimKey: storedKey(key), kind: "lock" },
    { kind: "lock" }
  );
}

/**
 * Hold the lock row keyed `key`, created with `created` where none is stored
 * yet, and otherwise held by writing `touched` over it (see {@link lock}).
 */
async function holdLockRow(
  claims: Claims,
  tx: Tx,
  key: string,
  created: Record<string, unknown>,
  touched: Record<string, unknown>
): Promise<void> {
  if (claims.dialect === "sqlite") return;
  let [row] = await keyed(claims, tx, [key]);
  if (row === undefined) {
    if ((await insert(claims, tx, created)) !== null) return;
    [row] = await keyed(claims, tx, [key]);
    if (row === undefined) {
      throw NextlyError.internal({
        logContext: { reason: "address-lock-vanished", key },
      });
    }
  }
  // Held by writing it, whatever it stores: the write is the lock, not a
  // change made from a read, so it says to overwrite.
  await claims.services.collections.updateEntryInTransaction(
    tx,
    claims.slug,
    row.id,
    asOverwrite(touched)
  );
}

/**
 * Lock each of `addresses`, in key order, so two saves never wait on each
 * other crosswise.
 */
async function lockInOrder(
  claims: Claims,
  tx: Tx,
  addresses: readonly ServedAddress[]
): Promise<void> {
  const byKey = new Map(addresses.map(at => [claimKey("lock", at), at]));
  // Plain code-unit order, the same in every process, whatever its locale.
  for (const key of [...byKey.keys()].sort()) {
    const at = byKey.get(key);
    if (at !== undefined) await lock(claims, tx, at);
  }
}

/**
 * The addresses whose locks serialise claiming, waiting for and releasing
 * `address`: its own, and the space that holds it, if any.
 */
function locksFor(address: ServedAddress): ServedAddress[] {
  const space = spaceHolding(address);
  return space === null ? [address] : [address, space];
}

/**
 * The claims an address claim would contend with: the address itself, and
 * the space that holds it, if any, read under their locks.
 */
async function heldAt(
  claims: Claims,
  tx: Tx,
  address: ServedAddress
): Promise<ClaimRow[]> {
  const space = spaceHolding(address);
  await lockInOrder(claims, tx, locksFor(address));
  return keyed(claims, tx, [
    claimKey("address", address),
    ...(space === null ? [] : [claimKey("space", space)]),
  ]);
}

/**
 * The refusal of a claim on `address` that `held` stands in the way of,
 * naming its holder. A holder no longer stored (released meanwhile) is not
 * named: the save is refused all the same, and trying again settles it.
 */
async function refusal(
  address: ServedAddress,
  held: ClaimRow | undefined,
  describe: DescribeHolder
): Promise<NextlyError> {
  const path = pathOf(address);
  const holder = held?.holder ?? null;
  if (holder === null) {
    return NextlyError.conflict({
      message: `${path} was taken by another document just now. Try again.`,
      logContext: { reason: "address-claimed", path },
    });
  }
  const named = await describe(holder);
  const list = held?.kind === "space" ? held.address : null;
  const message =
    list === null
      ? `${path} is already the address of ${named}.`
      : `${path} is one of the later pages of the list at ${pathOf(list)}, on ${named}.`;
  return NextlyError.conflict({
    message,
    logContext: {
      reason: "address-claimed",
      path,
      holderCollection: holder.collection,
      holderId: holder.id,
    },
  });
}

/**
 * Give `holder` the address, or refuse naming who holds it: the address
 * itself, or the paginated list whose later pages it is one of. Claiming an
 * address one already holds changes nothing.
 */
export async function claimAddress(
  claims: Claims,
  tx: Tx,
  claim: {
    readonly address: ServedAddress;
    readonly holder: Holder;
    readonly describe: DescribeHolder;
  }
): Promise<void> {
  const held = await heldAt(claims, tx, claim.address);
  const other = held.find(row => !sameHolder(row.holder, claim.holder));
  if (other !== undefined) {
    throw await refusal(claim.address, other, claim.describe);
  }
  if (held.length > 0) return;
  if (
    (await insert(claims, tx, addressColumns(claim.address, claim.holder))) !==
    null
  ) {
    return;
  }
  // Claimed by a save that committed while this one wrote.
  const [winner] = await keyed(claims, tx, [
    claimKey("address", claim.address),
  ]);
  if (sameHolder(winner?.holder ?? null, claim.holder)) return;
  throw await refusal(claim.address, winner, claim.describe);
}

/**
 * Give `holder`, a paginated list at `list`, every later page's address
 * (`/news/page/2`, …), or refuse naming a document already at one of them.
 * The space is one claim however many pages the list has, so a list that
 * grows or shrinks writes nothing here.
 */
export async function claimSpace(
  claims: Claims,
  tx: Tx,
  claim: {
    readonly list: ServedAddress;
    readonly holder: Holder;
    readonly describe: DescribeHolder;
  }
): Promise<void> {
  await lock(claims, tx, claim.list);
  const key = claimKey("space", claim.list);
  const [existing] = await keyed(claims, tx, [key]);
  if (existing !== undefined) {
    if (sameHolder(existing.holder, claim.holder)) return;
    throw await refusal(laterPage(claim.list), existing, claim.describe);
  }
  const stored = storedKey(key);
  const [first] = await claimsIn(
    claims,
    tx,
    { kind: { equals: "address" }, space: { equals: stored } },
    row => row.kind === "address" && row.space === stored
  );
  if (first !== undefined && first.address !== null) {
    throw await refusal(first.address, first, claim.describe);
  }
  if (
    (await insert(
      claims,
      tx,
      columns("space", key, claim.list, claim.holder)
    )) !== null
  ) {
    return;
  }
  const [winner] = await keyed(claims, tx, [key]);
  throw await refusal(laterPage(claim.list), winner, claim.describe);
}

/** The second page of the list at `list`, the first address its space holds. */
function laterPage(list: ServedAddress): ServedAddress {
  return { locale: list.locale, segments: [...list.segments, "page", "2"] };
}

/**
 * Give `holder` the address if nothing holds it, or leave it waiting on each
 * claim that does: it is served there once every one of them is released.
 * Used where a document's address follows from something else (a template
 * published over existing entries), so the document keeps its save and goes
 * unserved rather than being refused.
 */
export async function claimOrWait(
  claims: Claims,
  tx: Tx,
  claim: { readonly address: ServedAddress; readonly holder: Holder }
): Promise<"claimed" | "waiting"> {
  const blocking = await blockingClaims(claims, tx, claim);
  if (blocking === "claimed") return "claimed";
  for (const row of blocking) {
    // Already waiting on this one is a duplicate key, and changes nothing.
    await insert(claims, tx, {
      ...columns(
        "waiting",
        waitingKey(claim.holder, claim.address, row.key),
        claim.address,
        claim.holder
      ),
      blockedBy: row.key,
    });
  }
  return "waiting";
}

/**
 * The claims in the way of `claim`, or "claimed" when there are none and the
 * address is now `claim`'s (or already was).
 */
async function blockingClaims(
  claims: Claims,
  tx: Tx,
  claim: { readonly address: ServedAddress; readonly holder: Holder }
): Promise<ClaimRow[] | "claimed"> {
  const held = await heldAt(claims, tx, claim.address);
  if (held.some(row => sameHolder(row.holder, claim.holder))) return "claimed";
  if (held.length > 0) return held;
  if (
    (await insert(claims, tx, addressColumns(claim.address, claim.holder))) !==
    null
  ) {
    return "claimed";
  }
  // Taken by a save that committed meanwhile, now read.
  const taken = await keyed(claims, tx, [claimKey("address", claim.address)]);
  if (taken.length === 0) {
    throw NextlyError.internal({
      logContext: { reason: "address-held-by-no-claim" },
    });
  }
  return taken;
}

/**
 * The locks releasing `row` takes: an address claim's (its own and its
 * space's, the locks a wait for it takes), and a space's.
 */
function locksOf(row: ClaimRow): ServedAddress[] {
  if (row.address === null) return [];
  if (row.kind === "address") return locksFor(row.address);
  return row.kind === "space" ? [row.address] : [];
}

/** Whether `row`, one of the holder's, is within `scope`. */
function inScope(row: ClaimRow, scope: ReleaseScope): boolean {
  if (scope.kind !== undefined && row.kind !== scope.kind) return false;
  if (scope.address !== undefined) {
    return sameAddress(row.address, scope.address);
  }
  return scope.locale === undefined || row.address?.locale === scope.locale;
}

/**
 * Give up the addresses and spaces `holder` holds, and what it waits for,
 * within `scope` (a language, or one address; everything by default), then
 * serve each document that was waiting only on what was given up. A
 * document moving one language's address releases that one and keeps the
 * rest.
 */
export async function releaseClaims(
  claims: Claims,
  tx: Tx,
  holder: Holder,
  scope: ReleaseScope = {}
): Promise<void> {
  const locale = scope.address?.locale ?? scope.locale;
  const held = await claimsIn(
    claims,
    tx,
    {
      holderCollection: { equals: holder.collection },
      holderId: { equals: holder.id },
      ...(locale === undefined ? {} : { locale: { equals: locale } }),
    },
    row => sameHolder(row.holder, holder) && inScope(row, scope)
  );
  await lockInOrder(claims, tx, held.flatMap(locksOf));
  for (const row of held) {
    if (row.kind !== "lock") await remove(claims, tx, row);
  }
  for (const row of held) {
    if (row.kind === "address" || row.kind === "space") {
      await handOver(claims, tx, row.key);
    }
  }
}

/**
 * Serve each document that waited on the released claim `key` and on
 * nothing else; one still waiting on another claim keeps waiting for it.
 */
async function handOver(claims: Claims, tx: Tx, key: string): Promise<void> {
  const waits = await claimsIn(
    claims,
    tx,
    { kind: { equals: "waiting" }, blockedBy: { equals: key } },
    row => row.kind === "waiting" && row.blockedBy === key
  );
  for (const wait of waits) {
    const { holder, address } = wait;
    if (holder === null || address === null) continue;
    await remove(claims, tx, wait);
    const still = await claimsIn(
      claims,
      tx,
      {
        kind: { equals: "waiting" },
        holderCollection: { equals: holder.collection },
        holderId: { equals: holder.id },
      },
      row =>
        row.kind === "waiting" &&
        sameHolder(row.holder, holder) &&
        sameAddress(row.address, address)
    );
    if (still.length > 0) continue;
    // Read again rather than assumed free: another claim may have been taken
    // there while it waited, a waiter served just now included, and it then
    // waits on that one.
    await claimOrWait(claims, tx, { address, holder });
  }
}

/** What a holder should hold: its addresses, and the spaces of its lists. */
export interface DesiredClaims {
  readonly addresses: readonly ServedAddress[];
  readonly spaces: readonly ServedAddress[];
}

/**
 * Bring what `holder` holds to `desired`, in `tx`: claim each address and
 * space it should hold and does not, then release each it holds and should
 * not, handing a released one to whatever waited on it. A holder that holds
 * exactly what it should is read and left alone, taking no lock.
 *
 * Every lock the change takes is taken first, in key order, so a save
 * moving `/a` to `/b` and one moving `/b` to `/a` never wait on each other
 * crosswise. Claims come before releases, so a claim that is refused leaves
 * what the holder held in place, and the refusal rolls the save back whole.
 *
 * With `wait`, an address another document holds is not refused: the
 * holder waits for it instead ({@link claimOrWait}), as a document does whose
 * address follows from something no one is saving now (a template published
 * over existing entries, or a start-up pass).
 *
 * @returns Whether anything changed.
 */
export async function reconcileHolder(
  claims: Claims,
  tx: Tx,
  holder: Holder,
  desired: DesiredClaims,
  describe: DescribeHolder,
  options: { readonly wait?: boolean } = {}
): Promise<boolean> {
  const held = await claimsIn(
    claims,
    tx,
    {
      holderCollection: { equals: holder.collection },
      holderId: { equals: holder.id },
    },
    row =>
      sameHolder(row.holder, holder) &&
      (row.kind === "address" || row.kind === "space" || row.kind === "waiting")
  );
  const waits = held.filter(row => row.kind === "waiting");
  const owned = held.filter(row => row.kind !== "waiting");
  const heldKeys = new Set(owned.map(row => row.key));
  const wanted = new Set([
    ...desired.addresses.map(at => storedKey(claimKey("address", at))),
    ...desired.spaces.map(at => storedKey(claimKey("space", at))),
  ]);
  const claimAddresses = desired.addresses.filter(
    at => !heldKeys.has(storedKey(claimKey("address", at)))
  );
  const claimSpaces = desired.spaces.filter(
    at => !heldKeys.has(storedKey(claimKey("space", at)))
  );
  const release = owned.filter(row => !wanted.has(row.key));
  // A wait for an address the holder no longer wants (it moved, or stopped
  // being published) is dropped, so releasing what blocked it never hands
  // the holder an address it gave up.
  const wantedAddresses = new Set(
    desired.addresses.map(at => claimKey("address", at))
  );
  const staleWaits = waits.filter(
    row =>
      row.address === null ||
      !wantedAddresses.has(claimKey("address", row.address))
  );
  if (
    claimAddresses.length === 0 &&
    claimSpaces.length === 0 &&
    release.length === 0 &&
    staleWaits.length === 0
  ) {
    return false;
  }
  await lockInOrder(claims, tx, [
    ...claimAddresses.flatMap(locksFor),
    ...claimSpaces,
    ...release.flatMap(locksOf),
    ...staleWaits.flatMap(row =>
      row.address === null ? [] : locksFor(row.address)
    ),
  ]);
  for (const row of staleWaits) await remove(claims, tx, row);
  for (const address of claimAddresses) {
    if (options.wait === true) {
      await claimOrWait(claims, tx, { address, holder });
    } else {
      await claimAddress(claims, tx, { address, holder, describe });
    }
  }
  for (const list of claimSpaces) {
    await claimSpace(claims, tx, { list, holder, describe });
  }
  for (const row of release) {
    if (row.address === null) continue;
    await releaseClaims(claims, tx, holder, {
      address: row.address,
      kind: row.kind === "space" ? "space" : "address",
    });
  }
  return true;
}

/**
 * Hold the locks on `addresses` until `tx` ends, in key order, so saves that
 * must not judge the same thing at once take turns: whatever else locks one
 * of them waits for this transaction, then reads what it committed.
 */
export async function holdLocks(
  claims: Claims,
  tx: Tx,
  addresses: readonly ServedAddress[]
): Promise<void> {
  await lockInOrder(claims, tx, addresses);
}

/** Who holds an address, as the route serving it is told. */
export interface AddressHolding {
  readonly holder: Holder;
  /**
   * `"address"` when the holder is served at the address itself, `"space"`
   * when the address is a later page of the holder's paginated list.
   */
  readonly kind: "address" | "space";
}

/**
 * Who holds `address`, as last committed: the document claiming it, else the
 * paginated list whose later pages it is one of, else null. Takes no lock and
 * joins no transaction, so a request reading it never waits on a save; what
 * it answers is what the last committed save left.
 */
export async function committedHolderAt(
  claims: Claims,
  address: ServedAddress
): Promise<AddressHolding | null> {
  const space = spaceHolding(address);
  const own = storedKey(claimKey("address", address));
  const list = space === null ? null : storedKey(claimKey("space", space));
  const { rows } = await committedClaims(
    claims,
    { claimKey: { in: list === null ? [own] : [own, list] } },
    { limit: 2 }
  );
  // Matched again exactly, as every read here is: the database's comparison
  // of the key column is not trusted to be exact on every dialect.
  const at = rows.find(row => row.key === own && row.kind === "address");
  if (at?.holder) return { holder: at.holder, kind: "address" };
  const over =
    list === null
      ? undefined
      : rows.find(row => row.key === list && row.kind === "space");
  if (over?.holder) return { holder: over.holder, kind: "space" };
  return null;
}

/**
 * Up to `limit` of the addresses held in `locale`, as last committed, from
 * `page`, with how many there are in all: what a route pre-renders.
 */
export async function committedAddresses(
  claims: Claims,
  locale: string,
  { limit, page = 1 }: { limit: number; page?: number }
): Promise<{ addresses: ServedAddress[]; total: number }> {
  const { rows, total } = await committedClaims(
    claims,
    { kind: { equals: "address" }, locale: { equals: locale } },
    { limit, page }
  );
  const addresses = rows.flatMap(row =>
    row.kind === "address" &&
    row.holder !== null &&
    row.address !== null &&
    row.address.locale === locale
      ? [row.address]
      : []
  );
  return { addresses, total };
}
