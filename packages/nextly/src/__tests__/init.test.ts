/**
 * Tests for Nextly initialization API
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  expectTypeOf,
} from "vitest";

import { defineConfig } from "../collections/config/define-config";
import { isServicesRegistered, registerServices } from "../di/register";
import { buildServiceConfig } from "../init/build-service-config";
import {
  getCachedNextly,
  getNextly,
  shutdownNextly,
  type Nextly,
} from "../init";

// Mock console.log to avoid noise in tests
const originalLog = console.log;
beforeEach(() => {
  console.log = vi.fn();
});
afterEach(() => {
  console.log = originalLog;
});

function testOptions(): Parameters<typeof getNextly>[0] {
  return {
    config: defineConfig({}),
  };
}

describe("init - Nextly API", () => {
  // Clean up after each test
  afterEach(async () => {
    await shutdownNextly();
  });

  describe("getNextly()", () => {
    it("should return a Nextly instance with all services", async () => {
      const nextly = await getNextly(testOptions());

      // Verify structure
      expect(nextly).toBeDefined();
      expect(nextly.collections).toBeDefined();
      expect(nextly.users).toBeDefined();
      expect(nextly.media).toBeDefined();
      expect(nextly.adapter).toBeDefined();
      expect(nextly.shutdown).toBeDefined();
      expect(typeof nextly.shutdown).toBe("function");
    });

    it("should return the same instance on subsequent calls (singleton)", async () => {
      const nextly1 = await getNextly(testOptions());
      const nextly2 = await getNextly(testOptions());

      // Should be the exact same instance
      expect(nextly1).toBe(nextly2);
      expect(nextly1.adapter).toBe(nextly2.adapter);
    });

    it("should log database capabilities on first initialization", async () => {
      const mockLog = vi.fn();
      console.log = mockLog;

      await getNextly(testOptions());

      // Should have logged initialization message
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining("Nextly initialized")
      );
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining("JSONB support")
      );
    });

    it("should not log on subsequent calls (cached)", async () => {
      // First call
      await getNextly(testOptions());

      // Clear mock
      const mockLog = vi.fn();
      console.log = mockLog;

      // Second call - should not log
      await getNextly(testOptions());

      expect(mockLog).not.toHaveBeenCalled();
    });
  });

  describe("shutdownNextly()", () => {
    it("should shutdown the instance and clear cache", async () => {
      const nextly1 = await getNextly(testOptions());
      await shutdownNextly();

      // After shutdown, new call should create new instance
      const nextly2 = await getNextly(testOptions());

      // Should be different instances
      expect(nextly1).not.toBe(nextly2);
    });

    it("should log shutdown message", async () => {
      await getNextly(testOptions());

      const mockLog = vi.fn();
      console.log = mockLog;

      await shutdownNextly();

      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining("Nextly shutdown complete")
      );
    });

    it("should handle being called when no instance exists", async () => {
      // Should not throw
      await expect(shutdownNextly()).resolves.toBeUndefined();
    });
  });

  describe("Nextly instance methods", () => {
    it("should allow shutdown via instance method", async () => {
      const nextly = await getNextly(testOptions());

      const mockLog = vi.fn();
      console.log = mockLog;

      await nextly.shutdown();

      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining("Nextly shutdown complete")
      );
    });
  });

  describe("Type exports", () => {
    it("should export Nextly type", () => {
      expectTypeOf<Nextly>().toBeObject();
    });
  });

  describe("getCachedNextly() — fallback path", () => {
    // The full public surface, pinned by name so a member dropped from the
    // instance construction fails HERE with the member it is missing,
    // rather than as a shape diff against whatever the code still builds.
    // The compiler enforces the same list on the annotated literal; this
    // pins it on the object the process actually hands out.
    const PUBLIC_MEMBERS = [
      "access",
      "adapter",
      "bulkDelete",
      "changePassword",
      "collections",
      "count",
      "create",
      "delete",
      "duplicate",
      "email",
      "emailProviders",
      "emailTemplates",
      "fieldGroups",
      "find",
      "findByID",
      "findSingle",
      "findSingles",
      "forgotPassword",
      "forms",
      "jobs",
      "login",
      "logout",
      "me",
      "media",
      "mediaService",
      "meta",
      "permissions",
      "register",
      "releases",
      "resetPassword",
      "roles",
      "shutdown",
      "storage",
      "update",
      "updateMe",
      "updateSingle",
      "userFields",
      "userService",
      "users",
      "verifyEmail",
    ];

    function shapeOf(instance: Nextly): Record<string, string> {
      const shape: Record<string, string> = {};
      for (const key of Object.keys(instance).sort()) {
        shape[key] = typeof instance[key];
      }
      return shape;
    }

    it("builds the same instance the public factory builds", async () => {
      const normal = await getNextly(testOptions());
      // The factory-path instance carries the full surface — the control
      // that separates "fallback is incomplete" from "everything is".
      expect(Object.keys(shapeOf(normal))).toEqual(PUBLIC_MEMBERS);

      await shutdownNextly();
      expect(isServicesRegistered()).toBe(false);

      // The request-path boot: services registered directly, without the
      // public factory ever running — the state route-handler's
      // ensureServicesInitialized leaves the process in.
      await registerServices(buildServiceConfig(testOptions()));

      const fallback = await getCachedNextly();
      expect(Object.keys(shapeOf(fallback))).toEqual(PUBLIC_MEMBERS);
      expect(shapeOf(fallback)).toEqual(shapeOf(normal));
    });

    it("caches the fallback instance and shuts it down cleanly", async () => {
      await registerServices(buildServiceConfig(testOptions()));

      const first = await getCachedNextly();
      const second = await getCachedNextly();
      expect(second).toBe(first);

      const mockLog = vi.fn();
      console.log = mockLog;
      await first.shutdown();
      expect(isServicesRegistered()).toBe(false);
      // Both construction paths share one shutdown, so the fallback logs
      // the completion line the factory path always has. Pins the unified
      // behavior.
      expect(mockLog).toHaveBeenCalledWith("Nextly shutdown complete");
    });
  });
});
