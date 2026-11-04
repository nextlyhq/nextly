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
   * Pin the published versions either side of the removal that dropped these
   * ids: the newest published version that does not expose one of them, and
   * the published version before it that does. Answers whether it pinned.
   */
  hold(
    componentId: string,
    dropped: RetiredExposures,
    lifecycle: boolean
  ): Promise<boolean>;
  /**
   * Free the slots of the removals a repair has read and recorded: those made
   * by a version no newer than `through`.
   */
  release(componentId: string, through: number): Promise<void>;
}

/**
 * How many published versions `hold` reads looking for the removal. It runs
 * right after the publish that made it, so the pair is the newest two.
 */
const MAX_SEARCHED = 10;

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
    hold: async (componentId, dropped, lifecycle) => {
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
      if (pair === undefined) return false;
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
  const rows = await history.list(ref, { limit: VERSIONS_PER_PAGE });
  const served = rows
    .filter(row => !lifecycle || row.status === "published")
    .flatMap(row => (typeof row.versionNo === "number" ? [row.versionNo] : []))
    .slice(0, MAX_SEARCHED);
  let after: number | undefined;
  for (const versionNo of served) {
    const exposure = exposedIn(
      (await history.get(ref, versionNo)).snapshot,
      field
    );
    if (typeof exposure === "string") continue;
    if (exposesAny(exposure, dropped)) {
      return after === undefined ? undefined : { before: versionNo, after };
    }
    after = versionNo;
  }
  return undefined;
}

/** Whether a definition exposes any of these ids. */
function exposesAny(
  exposure: RetiredExposures,
  ids: RetiredExposures
): boolean {
  return (
    ids.properties.some(id => exposure.properties.includes(id)) ||
    ids.slots.some(id => exposure.slots.includes(id))
  );
}
