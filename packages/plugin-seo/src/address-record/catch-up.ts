/**
 * Bringing the SEO plugin's address record up to date at start, without any
 * save: a site that had content before the plugin arrived, or whose addresses
 * a deploy moved, is recorded as its pages now stand.
 *
 * It runs only where the record is empty or the fingerprint core gives of
 * every address template differs from the one stored at the last run, and it
 * works in two passes so a deploy that moves one page off an address and
 * another onto it is no clash:
 *
 * 1. every page keeps the addresses it already holds and still resolves to,
 *    and lets go of the rest; a page that no longer exists lets go of all;
 * 2. every page then claims what it newly holds, oldest first. One whose new
 *    address another page holds is left without it, and listed.
 *
 * The page already holding an address keeps it, newer or not: content never
 * takes the site down, and visitors keep reaching what they reached before.
 * The fingerprint is stored last, so a start interrupted part-way runs the
 * whole catch-up again.
 *
 * @module address-record/catch-up
 */
import { createHash } from "node:crypto";

import {
  NextlyError,
  type AddressHolder,
  type HeldAddress,
  type HeldAddressUpdate,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { ADDRESS_RECORD_SLUG } from "./collection";
import { rowOf, type RecordRow } from "./participant";

/** A page left without an address another page holds. */
export interface LostAddress {
  holder: AddressHolder;
  address: HeldAddress;
  heldBy: AddressHolder;
}

/** What a catch-up did. */
export interface CatchUpReport {
  /** Whether it ran, rather than finding the record current. */
  ran: boolean;
  /** How many pages claimed addresses they newly hold. */
  recorded: number;
  lost: LostAddress[];
}

/** The key of the row that stores the fingerprint of the last run. */
const FINGERPRINT_KEY = createHash("sha256")
  .update("meta:fingerprint", "utf8")
  .digest("hex");

/** How many rows or pages one read takes. */
const PAGE = 200;

const NOTHING: CatchUpReport = { ran: false, recorded: 0, lost: [] };

/** The last catch-up started, and the context it ran with. */
let started: { ctx: PluginContext; run: Promise<CatchUpReport> } | undefined;

/**
 * Start a catch-up for the SEO plugin's context `ctx`, not awaited by the
 * caller: it waits for the boot to finish, and logs rather than throws.
 */
export function startCatchUp(ctx: PluginContext): Promise<CatchUpReport> {
  const run = caughtUp(ctx);
  started = { ctx, run };
  return run;
}

/** The last catch-up started, to wait for. */
export function lastCatchUp(): Promise<CatchUpReport> | undefined {
  return started?.run;
}

/** Run the catch-up again with the last context, as the next start would. */
export async function catchUp(): Promise<CatchUpReport> {
  if (started === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "address-catch-up-never-started" },
    });
  }
  await started.run;
  return startCatchUp(started.ctx);
}

async function caughtUp(ctx: PluginContext): Promise<CatchUpReport> {
  try {
    return await runCatchUp(ctx);
  } catch (error) {
    ctx.logger.error("The SEO address record could not be brought up to date", {
      error,
    });
    return NOTHING;
  }
}

const holderKey = (holder: AddressHolder) =>
  `${holder.collection}:${holder.id}`;

const sameAddress = (a: HeldAddress, b: HeldAddress) =>
  a.locale === b.locale && a.path === b.path && a.range === b.range;

/** The record's rows, held addresses and the stored fingerprint. */
async function readRecord(ctx: PluginContext): Promise<{
  held: RecordRow[];
  fingerprint?: { id: string; value: unknown };
}> {
  const held: RecordRow[] = [];
  let fingerprint: { id: string; value: unknown } | undefined;
  for (let page = 1; ; page++) {
    const { data } = await ctx.services.ownCollections.listEntries(
      ADDRESS_RECORD_SLUG,
      {
        where: { kind: { in: ["address", "range", "meta"] } },
        pagination: { limit: PAGE, page },
        sort: { field: "claimKey", direction: "asc" },
        depth: 0,
      }
    );
    for (const entry of data as Record<string, unknown>[]) {
      if (entry.claimKey === FINGERPRINT_KEY) {
        fingerprint = { id: String(entry.id), value: entry.path };
      } else {
        held.push(rowOf(entry));
      }
    }
    if ((data as unknown[]).length < PAGE) return { held, fingerprint };
  }
}

/** Every page of every site type, oldest first within each type. */
async function everyPage(ctx: PluginContext): Promise<HeldAddressUpdate[]> {
  const updates: HeldAddressUpdate[] = [];
  for (const type of await ctx.publicAddresses.types()) {
    let after: string | undefined;
    do {
      const page = await ctx.publicAddresses.held({ type, after, limit: PAGE });
      updates.push(...page.items);
      after = page.next;
    } while (after !== undefined);
  }
  return updates;
}

/** Make `updates` on a transaction of their own, asking every participant. */
function move(ctx: PluginContext, updates: HeldAddressUpdate[]) {
  return ctx.services.collections.withTransaction(transaction =>
    ctx.publicAddresses.move(updates, transaction)
  );
}

/** Claim `update`'s addresses, giving up each one another page holds. */
async function claim(
  ctx: PluginContext,
  update: HeldAddressUpdate,
  lost: LostAddress[]
): Promise<void> {
  let holds = [...update.holds];
  for (;;) {
    const { refused } = await move(ctx, [{ ...update, holds }]);
    const first = refused[0];
    if (first === undefined) return;
    lost.push({
      holder: update.holder,
      address: first.address,
      heldBy: first.heldBy,
    });
    holds = holds.filter(held => !sameAddress(held, first.address));
  }
}

/** What each holder the record names holds now, by holder key. */
function heldBefore(
  rows: readonly RecordRow[]
): Map<string, { holder: AddressHolder; holds: HeldAddress[] }> {
  const was = new Map<
    string,
    { holder: AddressHolder; holds: HeldAddress[] }
  >();
  for (const row of rows) {
    if (row.holder === null || row.address === null) continue;
    const key = holderKey(row.holder);
    const entry = was.get(key) ?? { holder: row.holder, holds: [] };
    entry.holds.push(row.address);
    was.set(key, entry);
  }
  return was;
}

/**
 * Pass 1: every page keeps what it held and still holds, and lets go of the
 * rest; answers what each page kept.
 */
async function keepWhatStands(
  ctx: PluginContext,
  pages: readonly HeldAddressUpdate[],
  was: ReadonlyMap<string, { holds: HeldAddress[] }>
): Promise<Map<string, HeldAddress[]>> {
  const kept = new Map<string, HeldAddress[]>();
  for (const page of pages) {
    const before = was.get(holderKey(page.holder))?.holds ?? [];
    const keep = page.holds.filter(held =>
      before.some(b => sameAddress(b, held))
    );
    kept.set(holderKey(page.holder), keep);
    if (keep.length !== before.length) {
      await move(ctx, [{ holder: page.holder, holds: keep }]);
    }
  }
  return kept;
}

/**
 * A page of a site type that no longer exists lets go of everything. A holder
 * of any other type (a plugin's own page) is that plugin's to judge.
 */
async function letGoOfTheGone(
  ctx: PluginContext,
  was: ReadonlyMap<string, { holder: AddressHolder }>,
  kept: ReadonlyMap<string, unknown>
): Promise<void> {
  const siteTypes = new Set(
    (await ctx.publicAddresses.types()).map(type =>
      type.kind === "single" ? `single:${type.slug}` : type.slug
    )
  );
  for (const [key, entry] of was) {
    if (!kept.has(key) && siteTypes.has(entry.holder.collection)) {
      await move(ctx, [{ holder: entry.holder, holds: [] }]);
    }
  }
}

/** Pass 2: every page claims what it newly holds, oldest first. */
async function claimTheNew(
  ctx: PluginContext,
  pages: readonly HeldAddressUpdate[],
  kept: ReadonlyMap<string, HeldAddress[]>
): Promise<{ recorded: number; lost: LostAddress[] }> {
  let recorded = 0;
  const lost: LostAddress[] = [];
  for (const page of pages) {
    const keep = kept.get(holderKey(page.holder)) ?? [];
    if (page.holds.length === keep.length) continue;
    await claim(ctx, page, lost);
    recorded += 1;
  }
  for (const each of lost) {
    ctx.logger.warn(
      "A page lost its public address to the page already holding it",
      { address: each.address, page: each.holder, heldBy: each.heldBy }
    );
  }
  return { recorded, lost };
}

async function runCatchUp(ctx: PluginContext): Promise<CatchUpReport> {
  const fingerprint = await ctx.publicAddresses.fingerprint();
  const record = await readRecord(ctx);
  if (record.fingerprint?.value === fingerprint && record.held.length > 0) {
    return NOTHING;
  }
  const pages = await everyPage(ctx);
  const was = heldBefore(record.held);
  const kept = await keepWhatStands(ctx, pages, was);
  await letGoOfTheGone(ctx, was, kept);
  const { recorded, lost } = await claimTheNew(ctx, pages, kept);
  // Stored last: a start interrupted before this point runs it all again.
  await storeFingerprint(ctx, record.fingerprint?.id, fingerprint);
  return { ran: true, recorded, lost };
}

async function storeFingerprint(
  ctx: PluginContext,
  id: string | undefined,
  fingerprint: string
): Promise<void> {
  if (id === undefined) {
    await ctx.services.collections.createEntry(ADDRESS_RECORD_SLUG, {
      claimKey: FINGERPRINT_KEY,
      kind: "meta",
      path: fingerprint,
    });
    return;
  }
  await ctx.services.collections.updateEntry(ADDRESS_RECORD_SLUG, id, {
    path: fingerprint,
    _overwrite: true,
  });
}
