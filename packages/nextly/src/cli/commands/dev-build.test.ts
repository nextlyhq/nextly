// Tests for the CLI seed pipeline's pre-init of Nextly.
// The pre-init is the fix for media-upload-in-seed: it ensures getNextly()
// inside the user's seed script returns a cached instance with storage
// adapters already registered from the user's config.

import { describe, expect, it, vi, beforeEach } from "vitest";

// These mocks must be set up before importing the module under test
// so that the imports inside dev-build.ts resolve to the mocks.
vi.mock("../../init.js", () => ({
  getNextly: vi.fn(async () => ({ adapter: "mocked" })),
}));

vi.mock("../../database/seeders/index.js", () => ({
  seedAll: vi.fn(async () => ({
    success: true,
    created: 0,
    skipped: 0,
    errors: 0,
    total: 0,
  })),
}));

// Dynamically import AFTER the mocks are registered.
const { performSeeding } = await import("./dev-build.js");
const { getNextly } = await import("../../init.js");
const { seedAll } = await import("../../database/seeders/index.js");

describe("performSeeding pre-init", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls getNextly with config and adapter before seedAll", async () => {
    const fakeAdapter = { getCapabilities: () => ({ dialect: "sqlite" }) };
    const fakeConfig = {
      collections: [],
      singles: [],
      components: [],
      storage: [{ type: "local" }],
    };
    const configResult = {
      config: fakeConfig,
      configPath: "/tmp/nextly.config.ts",
      dependencies: [],
    };
    const options = {};
    const context = {
      logger: {
        info: () => {},
        debug: () => {},
        error: () => {},
        newline: () => {},
        success: () => {},
        warn: () => {},
        keyValue: () => {},
        header: () => {},
        divider: () => {},
      },
    };

    await performSeeding(
      fakeAdapter as unknown as Parameters<typeof performSeeding>[0],
      options as unknown as Parameters<typeof performSeeding>[1],
      context as unknown as Parameters<typeof performSeeding>[2],
      configResult as unknown as Parameters<typeof performSeeding>[3]
    );

    // Pre-init must happen before seedAll and with the right args.
    expect(getNextly).toHaveBeenCalledTimes(1);
    expect(getNextly).toHaveBeenCalledWith({
      config: fakeConfig,
      adapter: fakeAdapter,
    });

    // Verify ordering: getNextly before seedAll.
    const preInitOrder = (
      getNextly as unknown as { mock: { invocationCallOrder: number[] } }
    ).mock.invocationCallOrder[0];
    const seedAllOrder = (
      seedAll as unknown as { mock: { invocationCallOrder: number[] } }
    ).mock.invocationCallOrder[0];
    expect(preInitOrder).toBeLessThan(seedAllOrder);
  });
});
