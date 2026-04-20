/**
 * Tests for Nextly initialization API
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { NextlyServiceConfig } from "../di/register";
import { getNextly, shutdownNextly, type Nextly } from "../init";

// Mock console.log to avoid noise in tests
const originalLog = console.log;
beforeEach(() => {
  console.log = vi.fn();
});
afterEach(() => {
  console.log = originalLog;
});

describe("init - Nextly API", () => {
  // Clean up after each test
  afterEach(async () => {
    await shutdownNextly();
  });

  describe("getNextly()", () => {
    it("should return a Nextly instance with all services", async () => {
      // Mock config (minimal for testing)
      const config: NextlyServiceConfig = {
        storage: {
          upload: vi.fn(),
          delete: vi.fn(),
          getUrl: vi.fn(),
          exists: vi.fn(),
          getMetadata: vi.fn(),
        } as any,
        imageProcessor: {
          resize: vi.fn(),
          optimize: vi.fn(),
        } as any,
      };

      const nextly = await getNextly(config);

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
      const config: NextlyServiceConfig = {
        storage: {
          upload: vi.fn(),
          delete: vi.fn(),
          getUrl: vi.fn(),
          exists: vi.fn(),
          getMetadata: vi.fn(),
        } as any,
        imageProcessor: {
          resize: vi.fn(),
          optimize: vi.fn(),
        } as any,
      };

      const nextly1 = await getNextly(config);
      const nextly2 = await getNextly(config);

      // Should be the exact same instance
      expect(nextly1).toBe(nextly2);
      expect(nextly1.adapter).toBe(nextly2.adapter);
    });

    it("should log database capabilities on first initialization", async () => {
      const mockLog = vi.fn();
      console.log = mockLog;

      const config: NextlyServiceConfig = {
        storage: {
          upload: vi.fn(),
          delete: vi.fn(),
          getUrl: vi.fn(),
          exists: vi.fn(),
          getMetadata: vi.fn(),
        } as any,
        imageProcessor: {
          resize: vi.fn(),
          optimize: vi.fn(),
        } as any,
      };

      await getNextly(config);

      // Should have logged initialization message
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining("Nextly initialized")
      );
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining("JSONB support")
      );
    });

    it("should not log on subsequent calls (cached)", async () => {
      const config: NextlyServiceConfig = {
        storage: {
          upload: vi.fn(),
          delete: vi.fn(),
          getUrl: vi.fn(),
          exists: vi.fn(),
          getMetadata: vi.fn(),
        } as any,
        imageProcessor: {
          resize: vi.fn(),
          optimize: vi.fn(),
        } as any,
      };

      // First call
      await getNextly(config);

      // Clear mock
      const mockLog = vi.fn();
      console.log = mockLog;

      // Second call - should not log
      await getNextly(config);

      expect(mockLog).not.toHaveBeenCalled();
    });
  });

  describe("shutdownNextly()", () => {
    it("should shutdown the instance and clear cache", async () => {
      const config: NextlyServiceConfig = {
        storage: {
          upload: vi.fn(),
          delete: vi.fn(),
          getUrl: vi.fn(),
          exists: vi.fn(),
          getMetadata: vi.fn(),
        } as any,
        imageProcessor: {
          resize: vi.fn(),
          optimize: vi.fn(),
        } as any,
      };

      const nextly1 = await getNextly(config);
      await shutdownNextly();

      // After shutdown, new call should create new instance
      const nextly2 = await getNextly(config);

      // Should be different instances
      expect(nextly1).not.toBe(nextly2);
    });

    it("should log shutdown message", async () => {
      const config: NextlyServiceConfig = {
        storage: {
          upload: vi.fn(),
          delete: vi.fn(),
          getUrl: vi.fn(),
          exists: vi.fn(),
          getMetadata: vi.fn(),
        } as any,
        imageProcessor: {
          resize: vi.fn(),
          optimize: vi.fn(),
        } as any,
      };

      await getNextly(config);

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
      const config: NextlyServiceConfig = {
        storage: {
          upload: vi.fn(),
          delete: vi.fn(),
          getUrl: vi.fn(),
          exists: vi.fn(),
          getMetadata: vi.fn(),
        } as any,
        imageProcessor: {
          resize: vi.fn(),
          optimize: vi.fn(),
        } as any,
      };

      const nextly = await getNextly(config);

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
      // This is a compile-time check - if it compiles, the type exists
      const nextly: Nextly = {
        collections: {} as any,
        users: {} as any,
        media: {} as any,
        adapter: {} as any,
        shutdown: async () => {},
      };

      expect(nextly).toBeDefined();
    });
  });
});
