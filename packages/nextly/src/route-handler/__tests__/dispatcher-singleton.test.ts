/**
 * One dispatcher per process, however many requests ask for it at once.
 *
 * The dispatcher class is loaded when the first request needs one, so the
 * getter awaits before it can build it. If that await fell between "is there a
 * dispatcher yet" and building one, two first requests would both find none
 * and each build its own. The class here counts its constructions, so that
 * reads as two.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const constructed = vi.hoisted(() => ({ count: 0 }));

// The first load of the real module takes time, and it is during that load
// that a second request can arrive. Held open here, so both requests are
// waiting on it at once; resolved at once, the first would have built its
// dispatcher before the second even looked, and the test would pass whichever
// way round the getter was written.
vi.mock("../../services/dispatcher", async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  return {
    ServiceDispatcher: class {
      constructor() {
        constructed.count += 1;
      }
    },
  };
});
// The services read as registered, so the getter's boot does no work, and the
// gates it waits on resolve at once.
vi.mock("../../di/register", () => ({
  registerServices: vi.fn(),
  shutdownServices: vi.fn(),
}));
vi.mock("../../di", () => ({
  isServicesRegistered: () => true,
  getService: () => undefined,
}));
vi.mock("../../init/boot-migrations-gate", () => ({
  awaitBootMigrations: async () => {},
}));
vi.mock("../../init/seed-permissions", () => ({
  awaitBootSeeding: async () => {},
  holdBootSeeding: () => () => {},
  seedPermissionsAndRolePresets: vi.fn(),
}));
vi.mock("../../auth/handlers/deps-bridge", () => ({
  buildAuthRouterDeps: vi.fn(),
}));
vi.mock("../../auth/handlers/router", () => ({ routeAuthRequest: vi.fn() }));
vi.mock("../../runtime/hmr-listener", () => ({ ensureHmrListener: vi.fn() }));
vi.mock("../../storage/image-processor", () => ({
  getImageProcessor: () => undefined,
}));

import { getDispatcher, resetDispatcherForTests } from "../auth-handler";

describe("the request path's dispatcher", () => {
  beforeEach(() => {
    resetDispatcherForTests();
    constructed.count = 0;
  });

  it("is one instance for two first requests that ask at once", async () => {
    const [first, second] = await Promise.all([
      getDispatcher(),
      getDispatcher(),
    ]);

    expect(first).toBe(second);
    expect(constructed.count).toBe(1);
  });

  it("is the same instance on a later request", async () => {
    const first = await getDispatcher();
    const later = await getDispatcher();

    expect(later).toBe(first);
    expect(constructed.count).toBe(1);
  });
});
