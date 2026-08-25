/**
 * A media write must bust the caches that could be serving that file.
 *
 * Media reads are not cached by core, so nothing here is invalidating media's
 * own cache. What goes stale is a PAGE that rendered the file — a cached read
 * tagged with `nextlyTags("media", id)` — and before this the write side emitted
 * nothing at all, so no tag a caller attached could ever be busted.
 *
 * Driven through the registered service rather than a hand-built one, so the DI
 * wiring is under test too: a service that flushes correctly but is constructed
 * without a revalidator invalidates nothing, and that is the failure this is
 * most likely to actually have.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CacheRevalidator } from "../../../revalidation/types";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  vi.restoreAllMocks();
});

/** The tags a write actually asked to invalidate. */
function flushedTags(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.flatMap(call => {
    const intents = call[0] as { tags: string[] }[];
    return intents.flatMap(intent => intent.tags);
  });
}

async function bootWithSpy(): Promise<{
  handle: TestNextly;
  flush: ReturnType<typeof vi.spyOn>;
}> {
  current = await createTestNextly({});
  const revalidator = current.getService<CacheRevalidator>("cacheRevalidator");
  return {
    handle: current,
    flush: vi.spyOn(revalidator, "flush"),
  };
}

describe("media writes bust their cache tags (integration)", () => {
  it("busts the file's tags on upload", async () => {
    const { handle, flush } = await bootWithSpy();

    const uploaded = await handle.nextly.media.upload({
      file: {
        data: Buffer.from("x"),
        name: "doc.pdf",
        mimetype: "application/pdf",
        size: 1,
      },
    });

    // The control. Without it, an assertion about flushed tags is satisfied by
    // a write that never happened — and a failed upload flushes nothing for a
    // reason that has nothing to do with caching.
    expect(uploaded.id).toBeTruthy();

    const tags = flushedTags(flush);
    expect(tags).toContain("nextly:media");
    expect(tags).toContain(`nextly:media:id:${uploaded.id}`);
  });

  it("busts the file's tags on delete", async () => {
    const { handle, flush } = await bootWithSpy();

    const uploaded = await handle.nextly.media.upload({
      file: {
        data: Buffer.from("x"),
        name: "gone.pdf",
        mimetype: "application/pdf",
        size: 1,
      },
    });
    expect(uploaded.id).toBeTruthy();
    flush.mockClear();

    await handle.nextly.media.delete({ id: uploaded.id });

    // Asserted after clearing, so this cannot be satisfied by the upload's own
    // flush — the two writes are separate events and a delete that busts
    // nothing leaves a removed file rendering from cache.
    const tags = flushedTags(flush);
    expect(tags).toContain(`nextly:media:id:${uploaded.id}`);
  });

  it("does not fail the write when the revalidator throws", async () => {
    const { handle, flush } = await bootWithSpy();
    flush.mockImplementation(() => {
      throw new Error("cache unreachable");
    });

    // The file is already committed by the time the flush runs. Turning a cache
    // failure into an upload failure would tell the caller their file was lost
    // while it sits in storage.
    const uploaded = await handle.nextly.media.upload({
      file: {
        data: Buffer.from("x"),
        name: "resilient.pdf",
        mimetype: "application/pdf",
        size: 1,
      },
    });

    expect(uploaded.id).toBeTruthy();
    // The control: the throwing path was actually reached, so this is not
    // passing because the revalidator was never called.
    expect(flush).toHaveBeenCalled();
  });
});
