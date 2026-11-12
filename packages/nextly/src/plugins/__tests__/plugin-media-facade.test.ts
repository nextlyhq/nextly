/**
 * `ctx.services.media` is built over whatever media service the host hands
 * `createPluginContext`, and every plugin context builds it. The service
 * method a write runs is read when the write is called, not when the facade
 * is built: a service without one of them still yields a context whose other
 * writes and reads work, and `delete` runs the `deleteDurably` the service
 * holds at the time of the call.
 */
import { describe, expect, it, vi } from "vitest";

import type { MediaService } from "../../services/media/media-service";
import { mediaForPlugin } from "../plugin-media";

describe("ctx.services.media reads each write's service method when it is called", () => {
  it("builds over a service that has no durable delete", () => {
    const findById = vi.fn(async () => null);
    const service = { findById } as unknown as MediaService;

    const media = mediaForPlugin(service);

    expect(typeof media.delete).toBe("function");
    expect(typeof media.upload).toBe("function");
    expect(media.findById).toBeTypeOf("function");
  });

  it("runs the durable delete the service holds when delete is called", async () => {
    const service = {} as unknown as MediaService & {
      deleteDurably?: (...args: unknown[]) => Promise<unknown>;
    };
    const media = mediaForPlugin(service);
    const deleteDurably = vi.fn(async () => ({ success: true }));
    service.deleteDurably = deleteDurably;

    await expect(media.delete("m1")).resolves.toEqual({ success: true });

    expect(deleteDurably).toHaveBeenCalledTimes(1);
    expect(deleteDurably.mock.calls[0]?.[0]).toBe("m1");
    // Called on the service, so its own state is reachable from the method.
    expect(deleteDurably.mock.contexts[0]).toBe(service);
  });
});
