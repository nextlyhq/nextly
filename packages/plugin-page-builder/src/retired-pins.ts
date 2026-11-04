/**
 * Holding the versions a lost retirement is derived from against retention.
 *
 * When a publish drops fields and the record of their retirement fails, the
 * retirement lives on only in history: the published version from before the
 * removal, which exposes the ids, and the one that dropped them. Retention
 * keeps a bounded number of versions, so enough later saves would prune the
 * first, and a repair made after that could no longer see the removal. The
 * id would then be offered again, and old placement values would come back on
 * the new field.
 *
 * So the pair is pinned, through the versions pin API, until a repair has
 * recorded the retirement. One slot for each side of each lost removal, named
 * by the version that dropped the ids: pinning the same removal again moves
 * nothing, and the slots a component holds are only ever those of removals
 * whose records failed. A repair that records the ids releases the slots of
 * the removals it read, and only those: a removal published after its read,
 * whose record failed too, keeps its slots until a repair reads it.
 *
 * Pins take the component's write lock in a transaction of the plugin's own,
 * so they are made only after the publish has committed: inside a caller's
 * transaction that lock is the caller's, and taking it again would wait on
 * itself.
 *
 * @module retired-pins
 */
import type { RetiredExposures } from "@nextlyhq/blocks-engine";

import {
  exposedIn,
  type ComponentHistory,
  type ComponentHistoryRef,
} from "./retired-history";

/**
 * A pin holder, as `ctx.services.versions.pins` hands one out, over the
 * transaction type it pins in.
 */
export interface RetiredPinHolder<Tx> {
  pin(
    ref: ComponentHistoryRef,
    args: { slot: string; versionNo: number },
    opts: { tx: Tx }
  ): Promise<void>;
  release(
    ref: ComponentHistoryRef,
    args: { slot: string },
    opts: { tx: Tx }
  ): Promise<void>;
  list(
    ref: ComponentHistoryRef,
    opts: { tx: Tx }
  ): Promise<readonly { slot: string; versionNo: number }[]>;
}

/** Pinning and releasing the versions a component's lost removals need. */
export interface RetiredPins {
  /**
   * Pin, for each of these ids, the published versions either side of its
   * newest removal: a published version exposing it, and the next published
   * one, which does not. A later publish exposing an id again does not hide
   * the removal behind it, and ids removed apart are each held. Answers
   * whether every id's removal was found and held.
   *
   * `newerThan`, for a removal written in a transaction that may not have
   * committed yet, takes only removals made by a version newer than it, read
   * down to it however many versions followed.
   */
  hold(
    componentId: string,
    dropped: RetiredExposures,
    lifecycle: boolean,
    newerThan?: number
  ): Promise<boolean>;
  /** The newest version number the component's history shows, or 0. */
  newestVersion(componentId: string): Promise<number>;
  /**
   * Free the slots of the removals a repair has read and recorded: those made
   * by a version no newer than `through`.
   */
  release(componentId: string, through: number): Promise<void>;
}

/**
 * How many published versions `hold` reads looking for the removals, and how
 * many listing pages it reads to find them. It runs right after the publish
 * that made them, so they are usually the newest two published versions,
 * however many drafts sit between; the bounds leave room for publishes made
 * meanwhile, as `deriveRetired` reads under the same ones.
 */
const MAX_SEARCHED = 500;
const MAX_PAGES = 100;

/** How many listed versions one page returns. */
const VERSIONS_PER_PAGE = 50;

/** The pins over the plugin's own holder and transactions. */
export function retiredPins<Tx>(args: {
  /** The plugin's holder, or `undefined` where pins are not offered. */
  readonly holder: () => RetiredPinHolder<Tx> | undefined;
  /** Run `work` in a transaction of the plugin's own. */
  readonly transaction: <R>(work: (tx: Tx) => Promise<R>) => Promise<R>;
  readonly history: () => ComponentHistory;
  /** The RESOLVED slug component definitions are stored under. */
  readonly componentCollection: string;
  /** The field on a component row holding its document. */
  readonly componentField: string;
}): RetiredPins {
  const refOf = (componentId: string): ComponentHistoryRef => ({
    scopeKind: "collection",
    scopeSlug: args.componentCollection,
    entryId: componentId,
  });
  return {
    hold: async (componentId, dropped, lifecycle, newerThan = 0) => {
      const holder = args.holder();
      if (holder === undefined) return false;
      const ref = refOf(componentId);
      const found = await removalsOf(
        args.history(),
        ref,
        args.componentField,
        dropped,
        { lifecycle, floor: newerThan }
      );
      if (found.pairs.length === 0) return false;
      await args.transaction(async tx => {
        for (const pair of found.pairs) {
          await holder.pin(
            ref,
            { slot: `removal-${pair.after}-before`, versionNo: pair.before },
            { tx }
          );
          await holder.pin(
            ref,
            { slot: `removal-${pair.after}`, versionNo: pair.after },
            { tx }
          );
        }
      });
      return found.whole;
    },
    newestVersion: async componentId => {
      const rows = await args.history().list(refOf(componentId), { limit: 1 });
      return rows[0]?.versionNo ?? 0;
    },
    release: async (componentId, through) => {
      const holder = args.holder();
      if (holder === undefined) return;
      const ref = refOf(componentId);
      await args.transaction(async tx => {
        for (const { slot } of await holder.list(ref, { tx })) {
          const removal = removalNumberOf(slot);
          if (removal !== undefined && removal <= through) {
            await holder.release(ref, { slot }, { tx });
          }
        }
      });
    },
  };
}

/** The version that made the removal a slot is held for, from its name. */
function removalNumberOf(slot: string): number | undefined {
  const match = /^removal-(\d+)(?:-before)?$/.exec(slot);
  return match === null ? undefined : Number(match[1]);
}

/**
 * Each requested id's newest removal: the published version exposing it and
 * the next published one, which does not. `whole` when every id's was found;
 * the scan stops at the first version at or below the floor, so every pair
 * it finds was made above it.
 */
async function removalsOf(
  history: ComponentHistory,
  ref: ComponentHistoryRef,
  field: string,
  dropped: RetiredExposures,
  scan: { lifecycle: boolean; floor: number }
): Promise<{ pairs: { before: number; after: number }[]; whole: boolean }> {
  const left = {
    properties: new Set(dropped.properties),
    slots: new Set(dropped.slots),
  };
  const pairs: { before: number; after: number }[] = [];
  let newer: { versionNo: number; exposure: RetiredExposures } | undefined;
  for await (const versionNo of servedVersions(history, ref, scan)) {
    const exposure = exposedIn(
      (await history.get(ref, versionNo)).snapshot,
      field
    );
    if (typeof exposure === "string") continue;
    if (newer !== undefined && takeDropped(exposure, newer.exposure, left)) {
      pairs.push({ before: versionNo, after: newer.versionNo });
      if (left.properties.size === 0 && left.slots.size === 0) {
        return { pairs, whole: true };
      }
    }
    newer = { versionNo, exposure };
  }
  return { pairs, whole: false };
}

/**
 * The served versions' numbers, newest first, paged past drafts, from at most
 * {@link MAX_PAGES} pages. With no floor, at most {@link MAX_SEARCHED} of
 * them; with one, every one down to the first at or below it, which is the
 * version a removal made above the floor is compared with.
 */
async function* servedVersions(
  history: ComponentHistory,
  ref: ComponentHistoryRef,
  scan: { lifecycle: boolean; floor: number }
): AsyncGenerator<number> {
  let cursor: number | undefined;
  let served = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await history.list(ref, pageAfter(cursor));
    for (const versionNo of servedIn(rows, scan.lifecycle)) {
      if (scan.floor === 0 && served === MAX_SEARCHED) return;
      served += 1;
      yield versionNo;
      if (scan.floor > 0 && versionNo <= scan.floor) return;
    }
    if (rows.length < VERSIONS_PER_PAGE) return;
    cursor = oldestIn(rows) ?? cursor;
  }
}

/** One page of the listing, below `cursor` when one is given. */
function pageAfter(cursor: number | undefined): {
  limit: number;
  cursor?: number;
} {
  return cursor === undefined
    ? { limit: VERSIONS_PER_PAGE }
    : { limit: VERSIONS_PER_PAGE, cursor };
}

/** The numbers of a page's served versions, newest first. */
function servedIn(
  rows: readonly { versionNo: number | null; status: string }[],
  lifecycle: boolean
): number[] {
  return rows.flatMap(row =>
    typeof row.versionNo === "number" &&
    (!lifecycle || row.status === "published")
      ? [row.versionNo]
      : []
  );
}

/** The oldest version number a page lists: where the next page starts. */
function oldestIn(
  rows: readonly { versionNo: number | null }[]
): number | undefined {
  const numbers = rows.flatMap(row =>
    typeof row.versionNo === "number" ? [row.versionNo] : []
  );
  return numbers.at(-1);
}

/**
 * Whether going from `before` to `after` drops any id still `left`; those it
 * drops are taken out of `left`.
 */
function takeDropped(
  before: RetiredExposures,
  after: RetiredExposures,
  left: { properties: Set<string>; slots: Set<string> }
): boolean {
  let took = false;
  for (const [ids, was, now] of [
    [left.properties, before.properties, after.properties],
    [left.slots, before.slots, after.slots],
  ] as const) {
    for (const id of [...ids]) {
      if (was.includes(id) && !now.includes(id)) {
        ids.delete(id);
        took = true;
      }
    }
  }
  return took;
}
