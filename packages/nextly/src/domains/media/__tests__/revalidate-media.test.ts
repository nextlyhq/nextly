/**
 * The batch scope's own contract, at the level the integration tests cannot
 * reach.
 *
 * `MediaService.bulkDelete` fans out under `Promise.allSettled` and catches
 * every per-id failure, so it settles normally however badly it goes — driving
 * it can never exercise what the scope does when the work it wraps THROWS, nor
 * what it does for a write arriving after it has already flushed. Both branches
 * decide whether an invalidation is lost, so they are tested directly here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { container } from "../../../di/container";
import { NoopRevalidator } from "../../../revalidation/noop-revalidator";
import type { CacheRevalidator } from "../../../revalidation/types";
import {
  revalidateMedia,
  withMediaRevalidationBatch,
} from "../revalidate-media";
import { MediaService as UnifiedMediaService } from "../services/media-service";

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

/** Every tag handed to the sink, across all intents, in order. */
function allTags(intents: { tags: string[] }[]): string[] {
  return intents.flatMap(intent => intent.tags);
}

afterEach(() => {
  // The container is global and survives this file — `clear()` would wipe what
  // a sibling file registered in the same worker. Restoring the production
  // default instead leaves it inert rather than pointing at a captured array.
  container.register("cacheRevalidator", () => new NoopRevalidator());
  vi.restoreAllMocks();
});

describe("withMediaRevalidationBatch", () => {
  it("busts a row's own tag immediately, without waiting for the scope", async () => {
    const { intents } = captureFlushes();

    await withMediaRevalidationBatch(async () => {
      await revalidateMedia(["a"]);

      // Asserted INSIDE the scope, which is the whole claim. The row is gone
      // the moment its transaction commits, and the delete path then runs a
      // storage cleanup with retry backoffs; holding this until the fan-out
      // settles leaves a deleted file rendering from cache for that whole
      // window, and permanently if the storage call hangs.
      expect(allTags(intents)).toContain("nextly:media:id:a");
    });
  });

  it("defers the shared collection tag to exactly one flush", async () => {
    const { intents } = captureFlushes();

    await withMediaRevalidationBatch(async () => {
      await revalidateMedia(["a"]);
      await revalidateMedia(["b"]);
      await revalidateMedia(["c"]);
    });

    const tags = allTags(intents);
    // Each row's own tag is present...
    for (const id of ["a", "b", "c"]) {
      expect(tags).toContain(`nextly:media:id:${id}`);
    }
    // ...and the string every row shares was paid for once, not once per row.
    // Unbatched this is three synchronous `revalidateTag("nextly:media")`
    // calls for one operation.
    expect(tags.filter(t => t === "nextly:media")).toHaveLength(1);
  });

  it("busts the shared tag only after every write in the scope has landed", async () => {
    const { intents } = captureFlushes();

    await withMediaRevalidationBatch(async () => {
      await revalidateMedia(["first"]);
      // Not yet: a list read cached between this point and the LAST write
      // would still be stale, so an early bust would not cover it.
      expect(allTags(intents)).not.toContain("nextly:media");
      await revalidateMedia(["second"]);
      expect(allTags(intents)).not.toContain("nextly:media");
    });

    expect(allTags(intents)).toContain("nextly:media");
  });

  it("flushes a write that arrives after the scope already closed", async () => {
    const { intents } = captureFlushes();
    let escaped: Promise<void> | undefined;

    await withMediaRevalidationBatch(async () => {
      // A handler that outlives the scope. `events/event-bus.ts` invokes an
      // async handler fire-and-forget, and AsyncLocalStorage propagates this
      // store into it regardless — so a write from there lands on a collector
      // nobody will drain again unless the closed scope refuses to defer.
      escaped = (async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        await revalidateMedia(["late"]);
      })();
      await revalidateMedia(["during"]);
    });

    await escaped;

    const tags = allTags(intents);
    expect(tags).toContain("nextly:media:id:late");
    // The whole intent, not just the row tag: a closed scope defers nothing,
    // so the late write pays its own shared tag rather than losing it.
    expect(tags.filter(t => t === "nextly:media")).toHaveLength(2);
  });

  it("pays the shared tag for rows that committed before the work threw", async () => {
    const { intents } = captureFlushes();

    await expect(
      withMediaRevalidationBatch(async () => {
        await revalidateMedia(["committed-1"]);
        throw new Error("fan-out died");
      })
    ).rejects.toThrow("fan-out died");

    const tags = allTags(intents);
    expect(tags).toContain("nextly:media:id:committed-1");
    expect(tags).toContain("nextly:media");
  });

  it("does not flush at all when the scope wrote nothing", async () => {
    const { intents } = captureFlushes();

    await withMediaRevalidationBatch(async () => "nothing written");

    // An empty flush still costs the sink a call, and for the Next adapter that
    // is a `revalidateTag` for a write that never happened.
    expect(intents).toHaveLength(0);
  });

  it("flushes the whole intent when no scope is open", async () => {
    const { intents } = captureFlushes();

    await revalidateMedia(["loose-1"]);
    await revalidateMedia(["loose-2"]);

    // The control on the batching tests above: without this, "one shared tag"
    // could be reporting a sink that never receives one at all.
    expect(intents).toHaveLength(2);
    expect(allTags(intents).filter(t => t === "nextly:media")).toHaveLength(2);
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
        // The logger goes to the per-write call as well as the scope. Without
        // it here the row's own flush swallows its failure unlogged, and the
        // control below is satisfied entirely by the scope's shared-tag flush
        // — so the per-write error path reads as covered while nothing
        // exercises it. Both flushes are separate `try`/`catch` sites.
        await revalidateMedia(["written"], logger);
        return "ok";
      }, logger)
    ).resolves.toBe("ok");

    // The control: the throwing sink was actually reached, so this is not
    // passing because nothing was flushed.
    //
    // Deliberately not a call COUNT. The row's own flush and the scope's
    // shared-tag flush go through the same `flush()`, so there is one
    // error-handling site and a count would only pin down how the tags happen
    // to be partitioned — making this fire for changes that have nothing to do
    // with whether a cache failure reaches the caller.
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("the bulk surface stays inside a batch scope", () => {
  /**
   * Every PROTOTYPE method whose name marks it a fan-out — and prototype is the
   * operative word.
   *
   * This finds `async bulkDelete(...)` and finds NOTHING for the same method
   * declared as a class field: `bulkArchive = async (...) => ...` is an own
   * property of each instance, initialised in the constructor, never on the
   * prototype. Measured, not reasoned about — adding one leaves every assertion
   * below passing.
   *
   * So the NAME-SET claim is not made here. It lives in
   * `../services/media-bulk-surface.test-d.ts`, where `keyof` sees both
   * declaration forms because they are the same member of the type. What
   * remains here is the source check, which needs a callable and therefore only
   * reaches the prototype form.
   */
  function bulkPrototypeMethods(): string[] {
    return Object.getOwnPropertyNames(UnifiedMediaService.prototype)
      .filter(name => name.startsWith("bulk"))
      .sort();
  }

  it("wraps each prototype bulk method in withMediaRevalidationBatch", () => {
    const names = bulkPrototypeMethods();

    // The control. Without it an empty list satisfies the loop perfectly, and
    // a rename that took every method out of the filter would report as full
    // coverage of nothing.
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const source = String(
        (UnifiedMediaService.prototype as unknown as Record<string, unknown>)[
          name
        ]
      );
      expect(source, `${name} must open a batch scope`).toContain(
        "withMediaRevalidationBatch"
      );
    }
  });
});
