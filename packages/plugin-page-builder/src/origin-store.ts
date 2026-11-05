/**
 * Where a duplicated component came from, kept in the plugin's own
 * bookkeeping table beside the retired field ids rather than on the
 * component: the published block contract does not change, and the origin
 * does not travel in an export.
 *
 * One row per copy, keyed by the copy and the kind, so a repeated record adds
 * no second row.
 *
 * @module origin-store
 */
import type { ClassUsageDirectApi } from "./class-usage-runtime";
import { retiredKey } from "./collections/component-retired-exposures";

/** The bookkeeping kind an origin row is filed under. */
export const DUPLICATED_FROM = "duplicated-from";

/** The Direct API the store reads and writes through, as the system. */
export type OriginDirectApi = Pick<ClassUsageDirectApi, "find" | "create">;

/** Record and read where a duplicate came from. */
export interface OriginStore {
  record(copyId: string, sourceId: string): Promise<void>;
  /** The component a copy was duplicated from, or `null`. */
  sourceOf(copyId: string): Promise<string | null>;
}

export function originStore(args: {
  nextly: () => Promise<OriginDirectApi>;
  collection: string;
}): OriginStore {
  const read = async (nextly: OriginDirectApi, copyId: string) => {
    const found = await nextly.find({
      collection: args.collection,
      where: {
        componentId: { equals: copyId },
        kind: { equals: DUPLICATED_FROM },
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    });
    const row = found.items[0] as { exposureId?: unknown } | undefined;
    return typeof row?.exposureId === "string" ? row.exposureId : null;
  };
  return {
    record: async (copyId, sourceId) => {
      const nextly = await args.nextly();
      if ((await read(nextly, copyId)) !== null) return;
      await nextly.create({
        collection: args.collection,
        data: {
          identity: await retiredKey(copyId, DUPLICATED_FROM, ""),
          componentId: copyId,
          kind: DUPLICATED_FROM,
          exposureId: sourceId,
        },
        overrideAccess: true,
      });
    },
    sourceOf: async copyId => read(await args.nextly(), copyId),
  };
}
