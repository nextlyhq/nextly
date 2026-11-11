/**
 * A cached read's release bound is taken after Nextly has started, not while
 * the start is still under way.
 *
 * The start-up hook no longer holds a request until the start is done, so a
 * cold request can reach a content route mid-start. The bound reads the
 * registered adapter; taken before the start registers it, it is the
 * no-release bound, and the read caches its document past the next scheduled
 * release. Here the adapter appears only once the start in flight finishes.
 *
 * @module runtime/cache/__tests__/release-cache-window-waits-for-start.test
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ adapterRegistered: false }));

vi.mock("../../../di/container", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../di/container")>();
  return {
    ...actual,
    container: new Proxy(actual.container, {
      get(target, key, receiver) {
        if (key === "has") {
          return (name: string) =>
            name === "adapter" ? state.adapterRegistered : target.has(name);
        }
        if (key === "get") {
          return (name: string) =>
            name === "adapter" ? {} : target.get(name as never);
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
    }),
  };
});
vi.mock("../../../domains/releases/release-cache-bound", () => ({
  NO_RELEASE_CACHE_BOUND: { maxCacheSeconds: async () => false },
  releaseCacheBoundFor: () => ({ maxCacheSeconds: async () => 30 }),
}));

import type { Nextly } from "../../../init/nextly-instance";
import { clearStart, publishStart } from "../../../init/start-in-flight";
import { releaseBoundedRevalidate } from "../release-cache-window";

// Loaded before the cases: the bound loads the start's module on first use,
// and that load alone takes long enough for the start below to finish, which
// would let a bound that never waited pass.
beforeAll(async () => {
  await import("../../../init");
}, 60_000);

afterEach(() => {
  clearStart();
  state.adapterRegistered = false;
});

describe("releaseBoundedRevalidate during a start", () => {
  it("takes the bound of the adapter the start registers, once it has", async () => {
    let finish: () => void = () => {};
    const start = new Promise<Nextly>(resolve => {
      finish = () => {
        state.adapterRegistered = true;
        resolve({} as Nextly);
      };
    });
    publishStart(start);

    const lifetime = releaseBoundedRevalidate(false);
    // The start finishes after the read asked for its lifetime.
    setTimeout(() => {
      clearStart();
      finish();
    }, 50);

    expect(await lifetime).toBe(30);
  });

  it("takes the no-release bound when nothing is starting and nothing is registered", async () => {
    // The control: without a start to wait for, the bound is the one for no
    // adapter, so the case above is not passing on a bound that ignores it.
    expect(await releaseBoundedRevalidate(false)).toBe(false);
  });
});
