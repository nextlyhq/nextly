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
   * Pin the published versions either side of the newest removal of one of
   * these ids: a published version exposing it, and the next published one,
   * which does not. A later publish exposing it again does not hide the
   * removal behind it. Only a removal made by a version newer than
   * `newerThan` counts. Answers whether it pinned.
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
 * How many published versions `hold` reads looking for the removal, and how
 * many listing pages it reads to find them. It runs right after the publish
 * that made it, so the pair is the newest two published versions, however
 * many drafts were saved between them, up to the pages' bound.
 */
const MAX_SEARCHED = 10;
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
      const pair = await removalOf(
        args.history(),
        ref,
        args.componentField,
        dropped,
        lifecycle
      );
      if (pair === undefined || pair.after <= newerThan) return false;
      await args.transaction(async tx => {
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
      });
      return true;
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
 * The version numbers of the removal: the newest published version exposing
 * none of the dropped ids it is asked about, and the published one before it
 * exposing at least one. `undefined` when the newest versions read show no
 * such pair.
 */
async function removalOf(
  history: ComponentHistory,
  ref: ComponentHistoryRef,
  field: string,
  dropped: RetiredExposures,
  lifecycle: boolean
): Promise<{ before: number; after: number } | undefined> {
  let newer: { versionNo: number; exposure: RetiredExposures } | undefined;
  for await (const versionNo of servedVersions(history, ref, lifecycle)) {
    const exposure = exposedIn(
      (await history.get(ref, versionNo)).snapshot,
      field
    );
    if (typeof exposure === "string") continue;
    if (newer !== undefined && dropsAny(exposure, newer.exposure, dropped)) {
      return { before: versionNo, after: newer.versionNo };
    }
    newer = { versionNo, exposure };
  }
  return undefined;
}

/**
 * The served versions' numbers, newest first, paged past drafts, at most
 * {@link MAX_SEARCHED} of them from at most {@link MAX_PAGES} pages.
 */
async function* servedVersions(
  history: ComponentHistory,
  ref: ComponentHistoryRef,
  lifecycle: boolean
): AsyncGenerator<number> {
  let cursor: number | undefined;
  let served = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await history.list(ref, pageAfter(cursor));
    for (const versionNo of servedIn(rows, lifecycle)) {
      if (served === MAX_SEARCHED) return;
      served += 1;
      yield versionNo;
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

/** Whether going from `before` to `after` drops any of these ids. */
function dropsAny(
  before: RetiredExposures,
  after: RetiredExposures,
  ids: RetiredExposures
): boolean {
  return (
    ids.properties.some(
      id => before.properties.includes(id) && !after.properties.includes(id)
    ) ||
    ids.slots.some(id => before.slots.includes(id) && !after.slots.includes(id))
  );
}
