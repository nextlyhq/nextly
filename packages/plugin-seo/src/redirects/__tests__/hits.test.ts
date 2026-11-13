/**
 * The Proxy's hit counter: a request never waits on it, and the hits noted
 * on a redirect while its last count is being written are written together,
 * once, with the latest time among them; a write that fails is let go and
 * the next hits still count.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { redirectHits } from "../hits";

const ctx = {
  logger: { warn: vi.fn() },
} as unknown as PluginContext;

/** A writer whose writes finish only when released, recording each. */
function slowWriter() {
  const written: { id: string; hits: number; last: string }[] = [];
  let release: () => void = () => undefined;
  const write = vi.fn(
    (_ctx: PluginContext, id: string, noted: { hits: number; last: string }) =>
      new Promise<void>(resolve => {
        written.push({ id, ...noted });
        release = resolve;
      })
  );
  return { written, write, release: () => release() };
}

describe("redirectHits", () => {
  it("never waits, and writes the hits noted during a write together, once", async () => {
    const writer = slowWriter();
    const hits = redirectHits(writer.write);
    hits.note(ctx, "a", new Date("2026-11-12T10:00:00.000Z"));
    // The first write is under way; these are noted while it runs.
    hits.note(ctx, "a", new Date("2026-11-12T10:00:02.000Z"));
    hits.note(ctx, "a", new Date("2026-11-12T10:00:01.000Z"));
    hits.note(ctx, "b", new Date("2026-11-12T10:00:03.000Z"));
    expect(writer.written).toEqual([
      { id: "a", hits: 1, last: "2026-11-12T10:00:00.000Z" },
    ]);
    writer.release();
    await vi.waitFor(() => expect(writer.written).toHaveLength(2));
    writer.release();
    await vi.waitFor(() => expect(writer.written).toHaveLength(3));
    writer.release();
    await hits.written();
    expect(writer.written).toEqual([
      { id: "a", hits: 1, last: "2026-11-12T10:00:00.000Z" },
      { id: "a", hits: 2, last: "2026-11-12T10:00:02.000Z" },
      { id: "b", hits: 1, last: "2026-11-12T10:00:03.000Z" },
    ]);
  });

  it("lets a failed write go, logging it, and counts the next hits", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("database gone"))
      .mockResolvedValue(undefined);
    const hits = redirectHits(write);
    hits.note(ctx, "a");
    await hits.written();
    expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
    hits.note(ctx, "a");
    await hits.written();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]?.[2]).toMatchObject({ hits: 1 });
  });
});
