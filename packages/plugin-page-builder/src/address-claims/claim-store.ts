/**
 * Claiming, waiting for and releasing served addresses, inside the
 * transaction of the save that takes or gives one up.
 *
 * Every write here runs in the caller's transaction, so a claim stands or
 * falls with the save it belongs to. Every read is of COMMITTED rows: a
 * plugin's reads do not run on the transaction's connection on PostgreSQL
 * and MySQL, so a row this transaction wrote is invisible to them, and one it
 * deleted still shows. The operations below are written for that: rows this
 * transaction deleted are tracked and skipped, and what is decided from a
 * read is decided only once the reads that could contradict it are
 * serialised.
 *
 * Two holders of one address are refused by the claim key's unique index:
 * the second insert fails, and the refusal names the first. A paginated
 * list's space and an address inside it have different keys, so the index
 * cannot see them collide; both take the space's lock row first, so the
 * second waits for the first to commit and then reads its claim.
 *
 * @module address-claims/claim-store
 */
import {
  NextlyError,
  type PluginCollectionTransaction,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";

import {
  claimKey,
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

/** A claim as stored. */
export interface ClaimRow {
  readonly id: string;
  readonly key: string;
  readonly kind: ClaimKind;
  readonly address: ServedAddress | null;
  readonly holder: Holder | null;
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
}

type Tx = PluginCollectionTransaction;

/** Names a holder in a refusal, as the person asking may see it. */
export type DescribeHolder = (holder: Holder) => Promise<string>;

/**
 * The most claims one read returns. A document holds one address per
 * language it is published in, a space for each list it paginates, and a
 * waiting row per claim blocking it, so a read that reaches this is a store
 * in a state no save makes.
 */
const MAX_READ = 500;

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

/** The committed claims among `keys`, less those in `ignore`. */
async function keyed(
  claims: Claims,
  keys: readonly string[],
  ignore: ReadonlySet<string> = new Set()
): Promise<ClaimRow[]> {
  const { rows } = await committedClaims(
    claims,
    { claimKey: { in: [...keys] } },
    { limit: keys.length }
  );
  return rows.filter(row => !ignore.has(row.id));
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
    blockedBy: text(row.blockedBy),
  };
}

function sameHolder(a: Holder | null, b: Holder): boolean {
  return a !== null && a.collection === b.collection && a.id === b.id;
}

/** The columns of a claim held by `holder` on `address`. */
function columns(
  kind: ClaimKind,
  key: string,
  address: ServedAddress,
  holder: Holder | null
): Record<string, unknown> {
  return {
    claimKey: key,
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
    space: space === null ? null : claimKey("space", space),
  };
}

/**
 * Write a claim, answering false when its key is already held. The insert
 * runs under a savepoint (or, on MySQL, fails alone), so a refused one leaves
 * the transaction usable.
 */
async function insert(
  claims: Claims,
  tx: Tx,
  data: Record<string, unknown>
): Promise<boolean> {
  try {
    await claims.services.collections.createEntryInTransaction(
      tx,
      claims.slug,
      data
    );
    return true;
  } catch (error) {
    if (NextlyError.isCode(error, "DUPLICATE")) return false;
    throw error;
  }
}

/**
 * Hold `list`'s lock row until this transaction ends, so whatever else
 * claims in that space waits, then reads what this transaction claimed.
 *
 * A lock row created here is held the same way: another transaction creating
 * it waits on the key's index for this one to end, is refused as a
 * duplicate, and then finds it. One that already exists is held by updating
 * it, which reads it for update.
 */
async function lock(
  claims: Claims,
  tx: Tx,
  list: ServedAddress
): Promise<void> {
  const key = claimKey("lock", list);
  let [row] = await keyed(claims, [key]);
  if (row === undefined) {
    if (await insert(claims, tx, columns("lock", key, list, null))) return;
    [row] = await keyed(claims, [key]);
    if (row === undefined) {
      throw NextlyError.internal({
        logContext: { reason: "address-lock-vanished", key },
      });
    }
  }
  await claims.services.collections.updateEntryInTransaction(
    tx,
    claims.slug,
    row.id,
    { path: pathOf(list) }
  );
}

/**
 * The committed claims an address claim would contend with: the address
 * itself, and the space that holds it, if any, read under that space's lock.
 */
async function heldAt(
  claims: Claims,
  tx: Tx,
  address: ServedAddress,
  ignore: ReadonlySet<string> = new Set()
): Promise<ClaimRow[]> {
  const space = spaceHolding(address);
  if (space !== null) await lock(claims, tx, space);
  return keyed(
    claims,
    [
      claimKey("address", address),
      ...(space === null ? [] : [claimKey("space", space)]),
    ],
    ignore
  );
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
  const message =
    held?.kind === "space"
      ? `${path} is one of the later pages of the list at ${held.address === null ? "another address" : pathOf(held.address)}, on ${named}.`
      : `${path} is already the address of ${named}.`;
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
  if (await insert(claims, tx, addressColumns(claim.address, claim.holder))) {
    return;
  }
  // Claimed by a save that committed while this one wrote.
  const [winner] = await keyed(claims, [claimKey("address", claim.address)]);
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
  const [existing] = await keyed(claims, [key]);
  if (existing !== undefined) {
    if (sameHolder(existing.holder, claim.holder)) return;
    throw await refusal(laterPage(claim.list), existing, claim.describe);
  }
  const { rows: inside } = await committedClaims(
    claims,
    { kind: { equals: "address" }, space: { equals: key } },
    { limit: 1 }
  );
  const [first] = inside;
  if (first !== undefined && first.address !== null) {
    throw await refusal(first.address, first, claim.describe);
  }
  if (
    await insert(claims, tx, columns("space", key, claim.list, claim.holder))
  ) {
    return;
  }
  const [winner] = await keyed(claims, [key]);
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
  claim: { readonly address: ServedAddress; readonly holder: Holder },
  ignore: ReadonlySet<string> = new Set()
): Promise<"claimed" | "waiting"> {
  let blocking = await heldAt(claims, tx, claim.address, ignore);
  if (blocking.some(row => sameHolder(row.holder, claim.holder))) {
    return "claimed";
  }
  if (blocking.length === 0) {
    if (await insert(claims, tx, addressColumns(claim.address, claim.holder))) {
      return "claimed";
    }
    blocking = await keyed(claims, [claimKey("address", claim.address)]);
  }
  for (const row of blocking) {
    // Already waiting on this one is a duplicate key, and changes nothing.
    await insert(claims, tx, {
      ...columns(
        "waiting",
        waitingKey(claim.holder, row.key),
        claim.address,
        claim.holder
      ),
      blockedBy: row.key,
    });
  }
  return "waiting";
}

/** The space whose later pages `row` holds, or holds one of, if any. */
function spaceOf(row: ClaimRow): ServedAddress | null {
  if (row.address === null) return null;
  return row.kind === "space" ? row.address : spaceHolding(row.address);
}

/**
 * Lock every space `rows` touch, in key order, so two releases never wait on
 * each other crosswise.
 */
async function lockSpacesOf(
  claims: Claims,
  tx: Tx,
  rows: readonly ClaimRow[]
): Promise<void> {
  const spaces = new Map<string, ServedAddress>();
  for (const row of rows) {
    const space = spaceOf(row);
    if (space !== null) spaces.set(claimKey("lock", space), space);
  }
  // Plain code-unit order, the same in every process, whatever its locale.
  for (const key of [...spaces.keys()].sort()) {
    const space = spaces.get(key);
    if (space !== undefined) await lock(claims, tx, space);
  }
}

/**
 * Give up every address and space `holder` holds, and everything it waits
 * for, then serve each document that was waiting only on what was given up.
 */
export async function releaseClaims(
  claims: Claims,
  tx: Tx,
  holder: Holder
): Promise<void> {
  const { rows: held } = await committedClaims(
    claims,
    {
      holderCollection: { equals: holder.collection },
      holderId: { equals: holder.id },
    },
    { limit: MAX_READ }
  );
  await lockSpacesOf(claims, tx, held);
  const gone = new Set<string>();
  for (const row of held) {
    if (row.kind === "lock") continue;
    await claims.services.collections.deleteEntryInTransaction(
      tx,
      claims.slug,
      row.id
    );
    gone.add(row.id);
  }
  for (const row of held) {
    if (row.kind === "address" || row.kind === "space") {
      await handOver(claims, tx, row.key, gone);
    }
  }
}

/**
 * Serve each document that waited on the released claim `key` and on
 * nothing else; one still waiting on another claim keeps waiting for it.
 * `gone` is every row this transaction deleted, which committed reads still
 * show.
 */
async function handOver(
  claims: Claims,
  tx: Tx,
  key: string,
  gone: Set<string>
): Promise<void> {
  const { rows: waits } = await committedClaims(
    claims,
    { kind: { equals: "waiting" }, blockedBy: { equals: key } },
    { limit: MAX_READ }
  );
  for (const wait of waits) {
    if (gone.has(wait.id) || wait.holder === null || wait.address === null) {
      continue;
    }
    await claims.services.collections.deleteEntryInTransaction(
      tx,
      claims.slug,
      wait.id
    );
    gone.add(wait.id);
    const { rows: still } = await committedClaims(
      claims,
      {
        kind: { equals: "waiting" },
        holderCollection: { equals: wait.holder.collection },
        holderId: { equals: wait.holder.id },
        locale: { equals: wait.address.locale },
        path: { equals: pathOf(wait.address) },
      },
      { limit: MAX_READ }
    );
    if (still.some(row => !gone.has(row.id))) continue;
    // Read again rather than assumed free: another claim may have been taken
    // there while it waited, and it then waits on that one.
    await claimOrWait(
      claims,
      tx,
      { address: wait.address, holder: wait.holder },
      gone
    );
  }
}
