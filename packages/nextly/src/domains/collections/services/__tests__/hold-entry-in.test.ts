/**
 * What `CollectionMetadataService.holdEntryIn` asks of the database, and in
 * which order, over stand-in services that record each call.
 *
 * A collection delete locks the collection's registry row, not its entries'
 * rows, before it runs its `onCollectionDelete` handlers. So the hold takes
 * the collection first: holding the entry's row alone would let those
 * handlers run before the write has stored what names the entry. The
 * separating property is the order, and the answer for a collection the
 * share hold finds gone while its record can still be read (a stale cache
 * does that): a hold that reads the record and the row first answers that
 * the entry exists.
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { CollectionMetadataService } from "../collection-metadata-service";

/** The calls each stand-in received, in the order they came. */
type Call =
  | { kind: "holdCollections"; slugs: readonly string[]; strength: string }
  | { kind: "getCollection"; slug: string }
  | { kind: "select"; table: string; forShare: boolean };

/** The hold's service over stand-ins answering as `world` says. */
function holding(world: {
  /** The slugs the registry still holds a row for. */
  registered: readonly string[];
  /** The record a registry read answers with, or none. */
  record?: Record<string, unknown>;
  /** The ids the entry table holds. */
  entries: readonly string[];
}): {
  hold: (slug: string, id: string) => Promise<boolean>;
  calls: Call[];
} {
  const calls: Call[] = [];
  const instance = Object.create(
    CollectionMetadataService.prototype
  ) as CollectionMetadataService;
  Object.assign(instance, {
    collectionService: {
      holdCollectionsIn: vi.fn(
        async (_tx: unknown, slugs: readonly string[], strength: string) => {
          calls.push({ kind: "holdCollections", slugs, strength });
          return {
            existing: slugs.filter(slug => world.registered.includes(slug)),
            ids: new Map(),
            release: async () => undefined,
          };
        }
      ),
      getCollection: vi.fn(async (slug: string) => {
        calls.push({ kind: "getCollection", slug });
        if (!world.record) {
          throw NextlyError.notFound({ logContext: { collection: slug } });
        }
        return world.record;
      }),
    },
  });
  const tx = {
    getDrizzle: () => ({}),
    select: vi.fn(
      async (
        table: string,
        options: {
          where: { and: { value: unknown }[] };
          forShare?: boolean;
        }
      ) => {
        calls.push({
          kind: "select",
          table,
          forShare: options.forShare === true,
        });
        const id = options.where.and[0]?.value;
        return world.entries.includes(String(id)) ? [{ id }] : [];
      }
    ),
  } as unknown as TransactionContext;
  return { hold: (slug, id) => instance.holdEntryIn(tx, slug, id), calls };
}

describe("CollectionMetadataService.holdEntryIn", () => {
  it("holds the collection for share before it reads the collection's record or holds the entry's row", async () => {
    const { hold, calls } = holding({
      registered: ["posts"],
      record: { tableName: "dc_posts" },
      entries: ["1"],
    });

    expect(await hold("posts", "1")).toBe(true);
    expect(calls).toEqual([
      { kind: "holdCollections", slugs: ["posts"], strength: "share" },
      { kind: "getCollection", slug: "posts" },
      { kind: "select", table: "dc_posts", forShare: true },
    ]);
  });

  it("answers false for a collection that is gone, reading neither its record nor the entry's row", async () => {
    // The record and the row are both still readable: only the hold on the
    // registry row can tell this hold the collection is gone.
    const { hold, calls } = holding({
      registered: [],
      record: { tableName: "dc_posts" },
      entries: ["1"],
    });

    expect(await hold("posts", "1")).toBe(false);
    expect(calls).toEqual([
      { kind: "holdCollections", slugs: ["posts"], strength: "share" },
    ]);
  });

  it("answers false for an entry that is not there, once the collection is held", async () => {
    const { hold, calls } = holding({
      registered: ["posts"],
      record: { tableName: "dc_posts" },
      entries: ["1"],
    });

    expect(await hold("posts", "2")).toBe(false);
    expect(calls.map(call => call.kind)).toEqual([
      "holdCollections",
      "getCollection",
      "select",
    ]);
  });

  it("answers false when the registry record cannot be found once the collection is held", async () => {
    const { hold, calls } = holding({ registered: ["posts"], entries: ["1"] });

    expect(await hold("posts", "1")).toBe(false);
    expect(calls.map(call => call.kind)).toEqual([
      "holdCollections",
      "getCollection",
    ]);
  });
});
