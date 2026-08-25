/**
 * The batch scope's own contract, at the level the integration tests cannot
 * reach.
 *
 * `MediaService.bulkDelete` fans out under `Promise.allSettled` and catches
 * every per-id failure, so it settles normally however badly it goes — driving
 * it can never exercise what the scope does when the work it wraps THROWS.
 * That branch decides whether a fan-out that dies part-way leaves already-
 * deleted rows serving from cache, so it is tested directly here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { container } from "../../../di/container";
import { NoopRevalidator } from "../../../revalidation/noop-revalidator";
import type { CacheRevalidator } from "../../../revalidation/types";
import {
  revalidateMedia,
  withMediaRevalidationBatch,
} from "../revalidate-media";

/** Register a recording revalidator and hand back the intents it receives. */
function captureFlushes(): { intents: { tags: string[] }[] } {
  const captured: { tags: string[] }[] = [];
  const revalidator: CacheRevalidator = {
    flush: intents => {
      captured.push(...intents);
    },
  };
  container.register("cacheRevalidator", () => revalidator);
  return { intents: captured };
}

afterEach(() => {
  // The container is global and survives this file — `clear()` would wipe what
  // a sibling file registered in the same worker. Restoring the production
  // default instead leaves it inert rather than pointing at a captured array.
  container.register("cacheRevalidator", () => new NoopRevalidator());
  vi.restoreAllMocks();
});

describe("withMediaRevalidationBatch", () => {
  it("flushes ids collected before the wrapped work threw", async () => {
    const { intents } = captureFlushes();

    await expect(
      withMediaRevalidationBatch(async () => {
        await revalidateMedia(["committed-1"]);
        throw new Error("fan-out died");
      })
    ).rejects.toThrow("fan-out died");

    // The row was already deleted when the throw happened. Losing its bust
    // because a LATER item failed leaves a gone file rendering from cache.
    expect(intents).toHaveLength(1);
    expect(intents[0]?.tags).toContain("nextly:media:id:committed-1");
  });

  it("does not flush at all when nothing was collected", async () => {
    const { intents } = captureFlushes();

    await withMediaRevalidationBatch(async () => "nothing written");

    // An empty flush still costs the sink a call, and for the Next adapter that
    // is a `revalidateTag` for a write that never happened.
    expect(intents).toHaveLength(0);
  });

  it("collapses N calls inside one scope into a single intent", async () => {
    const { intents } = captureFlushes();

    await withMediaRevalidationBatch(async () => {
      await revalidateMedia(["a"]);
      await revalidateMedia(["b"]);
      await revalidateMedia(["a"]);
    });

    expect(intents).toHaveLength(1);
    const tags = intents[0]?.tags ?? [];
    expect(tags).toContain("nextly:media:id:a");
    expect(tags).toContain("nextly:media:id:b");
    // The repeated id contributed nothing the second time, and the shared
    // collection tag appears once however many files the batch held.
    expect(tags.filter(t => t === "nextly:media")).toHaveLength(1);
  });

  it("lets an inner scope flush its own ids without the outer repeating them", async () => {
    const { intents } = captureFlushes();

    await withMediaRevalidationBatch(async () => {
      await revalidateMedia(["outer"]);
      await withMediaRevalidationBatch(async () => {
        await revalidateMedia(["inner"]);
      });
    });

    // Two flushes, inner first — and `inner` must not appear in the outer's,
    // which is what distinguishes shadowing from a record-into-every-scope
    // stack. Repeating it there is exactly the duplicate bust the scope exists
    // to remove.
    expect(intents).toHaveLength(2);
    expect(intents[0]?.tags).toContain("nextly:media:id:inner");
    expect(intents[1]?.tags).toContain("nextly:media:id:outer");
    expect(intents[1]?.tags).not.toContain("nextly:media:id:inner");
  });

  it("flushes immediately when no scope is open", async () => {
    const { intents } = captureFlushes();

    await revalidateMedia(["loose-1"]);
    await revalidateMedia(["loose-2"]);

    // The control on the batching tests above: without this, "one intent" could
    // be reporting a sink that only ever receives one call.
    expect(intents).toHaveLength(2);
  });

  it("does not fail the caller when the sink throws", async () => {
    const revalidator: CacheRevalidator = {
      flush: () => {
        throw new Error("cache unreachable");
      },
    };
    container.register("cacheRevalidator", () => revalidator);
    const logger = { error: vi.fn() };

    await expect(
      withMediaRevalidationBatch(async () => {
        await revalidateMedia(["written"]);
        return "ok";
      }, logger)
    ).resolves.toBe("ok");

    // The control: the throwing sink was actually reached, so this is not
    // passing because nothing was flushed.
    expect(logger.error).toHaveBeenCalled();
  });
});
