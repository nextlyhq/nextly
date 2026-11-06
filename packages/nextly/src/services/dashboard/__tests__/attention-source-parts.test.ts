/**
 * Needs attention's grouped answer when one collection cannot be counted: that
 * collection's part is left out, the kind it belongs to becomes a floor, and
 * every other part and kind is still answered. The database-backed cases are
 * in `attention-source.integration.test.ts` and
 * `needs-attention-card.integration.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const countEntriesUpTo = vi.fn();
const warn = vi.fn();

vi.mock("../../../di/container", () => ({
  container: {
    has: () => true,
    get: (name: string) => {
      if (name === "collectionsHandler") return { countEntriesUpTo };
      throw new Error(`unexpected container.get("${name}") in this test`);
    },
  },
}));
// The reader's collections, each with a source to count.
vi.mock("../../../domains/widgets/reader-content", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../domains/widgets/reader-content")
  >()),
  readableCollectionSlugs: () => Promise.resolve(["broken", "posts"]),
  queryableSlugs: (_kind: string, readable: readonly string[]) => [...readable],
}));
// A reader of no releases and no Single: only the unpublished kind's
// collection parts are in the answer.
vi.mock("../../../domains/releases/releases-widget-source", () => ({
  callerMayReadReleases: () => Promise.resolve(false),
  overdueReleaseCount: () => Promise.resolve(0),
  stoppedReleaseCount: () => Promise.resolve(0),
}));
vi.mock("../../../domains/versions/versions-widget-source", () => ({
  singlesWithPendingChanges: () =>
    Promise.resolve({ singles: [], atLeast: false, anyReadable: false }),
}));

import { attentionPartKey } from "../../../domains/widgets/attention-keys";
import type { WidgetQuery } from "../../../domains/widgets/query";
import { sourceResolver } from "../../../domains/widgets/resolved-sources";
import { clearSources } from "../../../domains/widgets/sources";
import { ATTENTION_SOURCE_ID } from "../../../domains/widgets/system-source-ids";
import { clearSystemResolvers } from "../../../domains/widgets/system-sources";
import { setNextlyLogger } from "../../../observability/logger";
import { registerAttentionWidgetSource } from "../attention-source";

const QUERY: WidgetQuery = {
  source: ATTENTION_SOURCE_ID,
  op: "groupBy",
  groupBy: "item",
};

const caller = { user: { id: "user-1", roles: ["editor"] } };

/** The answer's buckets, by key. */
async function buckets() {
  const resolve = sourceResolver(ATTENTION_SOURCE_ID);
  if (!resolve) throw new Error("system:attention is not registered");
  const result = await resolve(QUERY, caller);
  if (result.op !== "groupBy") throw new Error(result.op);
  return Object.fromEntries(
    result.buckets.map(bucket => [
      bucket.value,
      `${bucket.count}${bucket.atLeast === true ? "+" : ""}`,
    ])
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setNextlyLogger({
    error: () => {},
    warn,
    info: () => {},
    debug: () => {},
  });
  clearSources();
  clearSystemResolvers();
  registerAttentionWidgetSource();
});

describe("a collection Needs attention cannot count", () => {
  it("fails only its own part: the others are counted and the kind is a floor", async () => {
    countEntriesUpTo.mockImplementation(({ collectionName }) =>
      Promise.resolve(
        collectionName === "broken"
          ? {
              success: false,
              statusCode: 500,
              message: "The collection's table could not be read.",
              data: null,
            }
          : { success: true, data: { count: 2, atLeast: false } }
      )
    );

    expect(await buckets()).toEqual({
      unpublished: "2+",
      [attentionPartKey("unpublished", "collection", "posts")]: "2",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "attention-part-failed",
        collection: "broken",
      })
    );
  });

  it("fails only its own part when its count throws rather than answers", async () => {
    countEntriesUpTo.mockImplementation(({ collectionName }) =>
      collectionName === "broken"
        ? Promise.reject(new Error("no such table: dc_broken"))
        : Promise.resolve({ success: true, data: { count: 1, atLeast: false } })
    );

    expect(await buckets()).toEqual({
      unpublished: "1+",
      [attentionPartKey("unpublished", "collection", "posts")]: "1",
    });
  });

  it("keeps a floor of zero when the one it could not count was the only one with anything", async () => {
    countEntriesUpTo.mockImplementation(({ collectionName }) =>
      Promise.resolve(
        collectionName === "broken"
          ? { success: false, statusCode: 500, message: "x", data: null }
          : { success: true, data: { count: 0, atLeast: false } }
      )
    );

    // Not absent, which would read as "All clear" over a list never read.
    expect(await buckets()).toEqual({ unpublished: "0+" });
  });
});
