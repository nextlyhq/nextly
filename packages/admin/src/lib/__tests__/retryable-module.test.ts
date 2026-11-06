/**
 * A failed fetch is forgotten, so the next attempt fetches afresh; what
 * arrived is kept; and a preload and a use share one fetch.
 */
import { describe, expect, it, vi } from "vitest";

import { retryableModule } from "../retryable-module";

describe("retryableModule", () => {
  it("fetches afresh after a failure, then keeps what arrived", async () => {
    const fetch = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("chunk missing"))
      .mockResolvedValueOnce("module");
    const module = retryableModule(fetch);

    await expect(module.load()).rejects.toThrow("chunk missing");
    expect(module.loaded()).toBeNull();
    await expect(module.load()).resolves.toBe("module");
    expect(module.loaded()).toBe("module");
    // Kept: a later use does not fetch again.
    await expect(module.load()).resolves.toBe("module");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shares one fetch between a preload and a use", async () => {
    const fetch = vi.fn(() => Promise.resolve("module"));
    const module = retryableModule(fetch);
    module.preload();
    await expect(module.load()).resolves.toBe("module");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("says nothing when a preload fails, and the use fetches again", async () => {
    const fetch = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("module");
    const module = retryableModule(fetch);
    module.preload();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await expect(module.load()).resolves.toBe("module");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
