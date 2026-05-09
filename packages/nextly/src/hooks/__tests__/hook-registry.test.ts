/**
 * Unit Tests for HookRegistry
 *
 * Tests the core hook registry functionality including:
 * - Hook registration and unregistration
 * - Hook execution and data transformation
 * - Global vs collection-specific hooks
 * - Execution order (FIFO)
 * - Shared context between hooks
 * - Error handling and propagation
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { HookRegistry, resetHookRegistry } from "../hook-registry";
import type { HookContext, HookHandler, HookType } from "../types";

describe("HookRegistry", () => {
  let registry: HookRegistry;

  beforeEach(() => {
    resetHookRegistry();
    registry = new HookRegistry();
  });

  // ==========================================================================
  // REGISTRATION TESTS
  // ==========================================================================

  describe("register()", () => {
    it("should register a hook for a specific collection", () => {
      const handler = vi.fn();
      registry.register("beforeCreate", "posts", handler);

      expect(registry.getHookCount("beforeCreate", "posts")).toBe(1);
    });

    it("should register multiple hooks for the same type/collection", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      registry.register("beforeCreate", "posts", handler1);
      registry.register("beforeCreate", "posts", handler2);
      registry.register("beforeCreate", "posts", handler3);

      expect(registry.getHookCount("beforeCreate", "posts")).toBe(3);
    });

    it("should register global hooks using * wildcard", () => {
      const handler = vi.fn();
      registry.register("beforeCreate", "*", handler);

      expect(registry.getHookCount("beforeCreate", "*")).toBe(1);
    });

    it("should register different hook types independently", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      registry.register("beforeCreate", "posts", handler1);
      registry.register("afterCreate", "posts", handler2);

      expect(registry.getHookCount("beforeCreate", "posts")).toBe(1);
      expect(registry.getHookCount("afterCreate", "posts")).toBe(1);
    });

    it("should register same hook type for different collections independently", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      registry.register("beforeCreate", "posts", handler1);
      registry.register("beforeCreate", "users", handler2);

      expect(registry.getHookCount("beforeCreate", "posts")).toBe(1);
      expect(registry.getHookCount("beforeCreate", "users")).toBe(1);
    });
  });

  // ==========================================================================
  // UNREGISTRATION TESTS
  // ==========================================================================

  describe("unregister()", () => {
    it("should unregister a specific hook", () => {
      const handler = vi.fn();
      registry.register("beforeCreate", "posts", handler);
      registry.unregister("beforeCreate", "posts", handler);

      expect(registry.getHookCount("beforeCreate", "posts")).toBe(0);
    });

    it("should only unregister the exact handler", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      registry.register("beforeCreate", "posts", handler1);
      registry.register("beforeCreate", "posts", handler2);

      registry.unregister("beforeCreate", "posts", handler1);

      expect(registry.getHookCount("beforeCreate", "posts")).toBe(1);
    });

    it("should not throw if unregistering non-existent hook", () => {
      const handler = vi.fn();
      expect(() => {
        registry.unregister("beforeCreate", "posts", handler);
      }).not.toThrow();
    });

    it("should clean up empty arrays after unregistering all hooks", () => {
      const handler = vi.fn();
      registry.register("beforeCreate", "posts", handler);
      registry.unregister("beforeCreate", "posts", handler);

      const allHooks = registry.getAll();
      expect(allHooks.size).toBe(0);
    });
  });

  // ==========================================================================
  // CLEAR OPERATIONS
  // ==========================================================================

  describe("clearCollection()", () => {
    it("should clear all hooks for a specific collection", () => {
      const handler = vi.fn();

      registry.register("beforeCreate", "posts", handler);
      registry.register("afterCreate", "posts", handler);
      registry.register("beforeUpdate", "posts", handler);

      registry.clearCollection("posts");

      expect(registry.getHookCount("beforeCreate", "posts")).toBe(0);
      expect(registry.getHookCount("afterCreate", "posts")).toBe(0);
      expect(registry.getHookCount("beforeUpdate", "posts")).toBe(0);
    });

    it("should not affect other collections", () => {
      const handler = vi.fn();

      registry.register("beforeCreate", "posts", handler);
      registry.register("beforeCreate", "users", handler);

      registry.clearCollection("posts");

      expect(registry.getHookCount("beforeCreate", "posts")).toBe(0);
      expect(registry.getHookCount("beforeCreate", "users")).toBe(1);
    });

    it("should clear global hooks when using *", () => {
      const handler = vi.fn();

      registry.register("beforeCreate", "*", handler);
      registry.register("afterCreate", "*", handler);

      registry.clearCollection("*");

      expect(registry.getHookCount("beforeCreate", "*")).toBe(0);
      expect(registry.getHookCount("afterCreate", "*")).toBe(0);
    });
  });

  describe("clear()", () => {
    it("should clear all hooks from all collections", () => {
      const handler = vi.fn();

      registry.register("beforeCreate", "posts", handler);
      registry.register("afterCreate", "users", handler);
      registry.register("beforeUpdate", "*", handler);

      registry.clear();

      expect(registry.getHookCount("beforeCreate", "posts")).toBe(0);
      expect(registry.getHookCount("afterCreate", "users")).toBe(0);
      expect(registry.getHookCount("beforeUpdate", "*")).toBe(0);

      const allHooks = registry.getAll();
      expect(allHooks.size).toBe(0);
    });
  });

  // ==========================================================================
  // EXECUTION TESTS - BASIC
  // ==========================================================================

  describe("execute()", () => {
    it("should execute a registered hook", async () => {
      const handler = vi.fn();
      registry.register("beforeCreate", "posts", handler);

      const context: HookContext = {
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: {},
      };

      await registry.execute("beforeCreate", context);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(context);
    });

    it("should return original data if no hooks registered", async () => {
      const context: HookContext = {
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: {},
      };

      const result = await registry.execute("beforeCreate", context);

      expect(result).toEqual({ title: "Test" });
    });

    it("should execute multiple hooks in registration order (FIFO)", async () => {
      const executionOrder: number[] = [];

      const handler1 = vi.fn(async () => {
        executionOrder.push(1);
      });
      const handler2 = vi.fn(async () => {
        executionOrder.push(2);
      });
      const handler3 = vi.fn(async () => {
        executionOrder.push(3);
      });

      registry.register("beforeCreate", "posts", handler1);
      registry.register("beforeCreate", "posts", handler2);
      registry.register("beforeCreate", "posts", handler3);

      const context: HookContext = {
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: {},
      };

      await registry.execute("beforeCreate", context);

      expect(executionOrder).toEqual([1, 2, 3]);
    });
  });

  // ==========================================================================
  // EXECUTION TESTS - DATA TRANSFORMATION
  // ==========================================================================

  describe("execute() - Data Transformation", () => {
    it("should use modified data from hook return value", async () => {
      const handler = vi.fn(async (ctx: HookContext) => {
        return { ...ctx.data, slug: "test-slug" };
      });

      registry.register("beforeCreate", "posts", handler);

      const context: HookContext = {
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: {},
      };

      const result = await registry.execute("beforeCreate", context);

      expect(result).toEqual({ title: "Test", slug: "test-slug" });
    });

    it("should chain data transformations through multiple hooks", async () => {
      const handler1 = vi.fn(async (ctx: HookContext) => {
        return { ...ctx.data, slug: "test-slug" };
      });

      const handler2 = vi.fn(async (ctx: HookContext) => {
        return { ...ctx.data, published: true };
      });

      const handler3 = vi.fn(async (ctx: HookContext) => {
        return { ...ctx.data, createdAt: "2024-01-01" };
      });

      registry.register("beforeCreate", "posts", handler1);
      registry.register("beforeCreate", "posts", handler2);
      registry.register("beforeCreate", "posts", handler3);

      const context: HookContext = {
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: {},
      };

      const result = await registry.execute("beforeCreate", context);

      expect(result).toEqual({
        title: "Test",
        slug: "test-slug",
        published: true,
        createdAt: "2024-01-01",
      });
    });

    it("should pass modified data from previous hook to next hook", async () => {
      let receivedData: any;

      const handler1 = vi.fn(async (ctx: HookContext) => {
        return { ...ctx.data, addedByHook1: true };
      });

      const handler2 = vi.fn(async (ctx: HookContext) => {
        receivedData = ctx.data;
        return ctx.data;
      });

      registry.register("beforeCreate", "posts", handler1);
      registry.register("beforeCreate", "posts", handler2);

      const context: HookContext = {
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: {},
      };

      await registry.execute("beforeCreate", context);

      expect(receivedData).toEqual({
        title: "Test",
        addedByHook1: true,
      });
    });

    it("should preserve original data if hook returns undefined", async () => {
      const handler = vi.fn(async () => {
        return undefined;
      });

      registry.register("beforeCreate", "posts", handler);

      const context: HookContext = {
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: {},
      };

      const result = await registry.execute("beforeCreate", context);

      expect(result).toEqual({ title: "Test" });
    });
  });

  // ==========================================================================
  // EXECUTION TESTS - GLOBAL HOOKS
  // ==========================================================================

  describe("execute() - Global Hooks", () => {
    it("should execute global hooks for any collection", async () => {
      const handler = vi.fn();
      registry.register("beforeCreate", "*", handler);

      const context: HookContext = {
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: {},
      };

      await registry.execute("beforeCreate", context);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should execute global hooks before collection-specific hooks", async () => {
      const executionOrder: string[] = [];

      const globalHandler = vi.fn(async () => {
        executionOrder.push("global");
      });

      const specificHandler = vi.fn(async () => {
        executionOrder.push("specific");
      });

      registry.register("beforeCreate", "*", globalHandler);
      registry.register("beforeCreate", "posts", specificHandler);

      const context: HookContext = {
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: {},
      };

      await registry.execute("beforeCreate", context);

      expect(executionOrder).toEqual(["global", "specific"]);
    });

    it("should execute multiple global hooks in registration order", async () => {
      const executionOrder: number[] = [];

      const handler1 = vi.fn(async () => {
        executionOrder.push(1);
      });
      const handler2 = vi.fn(async () => {
        executionOrder.push(2);
      });

      registry.register("beforeCreate", "*", handler1);
      registry.register("beforeCreate", "*", handler2);

      const context: HookContext = {
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: {},
      };

      await registry.execute("beforeCreate", context);

      expect(executionOrder).toEqual([1, 2]);
    });

    it("should chain data transformations from global to specific hooks", async () => {
      const globalHandler = vi.fn(async (ctx: HookContext) => {
        return { ...ctx.data, addedByGlobal: true };
      });

      const specificHandler = vi.fn(async (ctx: HookContext) => {
        return { ...ctx.data, addedBySpecific: true };
      });

      registry.register("beforeCreate", "*", globalHandler);
      registry.register("beforeCreate", "posts", specificHandler);

      const context: HookContext = {
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: {},
      };

      const result = await registry.execute("beforeCreate", context);

      expect(result).toEqual({
        title: "Test",
        addedByGlobal: true,
        addedBySpecific: true,
      });
    });
  });

  // ==========================================================================
  // EXECUTION TESTS - SHARED CONTEXT
  // ==========================================================================

  describe("execute() - Shared Context", () => {
    it("should pass shared context to all hooks", async () => {
      const sharedContext = { transactionId: "txn123" };

      const handler = vi.fn();
      registry.register("beforeCreate", "posts", handler);

      const context: HookContext = {
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: sharedContext,
      };

      await registry.execute("beforeCreate", context);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          context: sharedContext,
        })
      );
    });

    it("should allow hooks to modify shared context", async () => {
      const sharedContext: Record<string, any> = {};

      const handler1 = vi.fn(async (ctx: HookContext) => {
        ctx.context.step1Complete = true;
        return ctx.data;
      });

      const handler2 = vi.fn(async (ctx: HookContext) => {
        ctx.context.step2Complete = true;
        return ctx.data;
      });

      registry.register("beforeCreate", "posts", handler1);
      registry.register("beforeCreate", "posts", handler2);

      const context: HookContext = {
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: sharedContext,
      };

      await registry.execute("beforeCreate", context);

      expect(sharedContext).toEqual({
        step1Complete: true,
        step2Complete: true,
      });
    });

    it("should preserve shared context modifications across hooks", async () => {
      const sharedContext: Record<string, any> = {};
      let receivedContext: any;

      const handler1 = vi.fn(async (ctx: HookContext) => {
        ctx.context.valueFromHook1 = "test";
        return ctx.data;
      });

      const handler2 = vi.fn(async (ctx: HookContext) => {
        receivedContext = { ...ctx.context };
        return ctx.data;
      });

      registry.register("beforeCreate", "posts", handler1);
      registry.register("beforeCreate", "posts", handler2);

      const context: HookContext = {
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: sharedContext,
      };

      await registry.execute("beforeCreate", context);

      expect(receivedContext).toEqual({ valueFromHook1: "test" });
    });
  });

  // ==========================================================================
  // ERROR HANDLING TESTS
  // ==========================================================================

  describe("execute() - Error Handling", () => {
    it("should propagate errors from hooks", async () => {
      const handler = vi.fn(async () => {
        throw new Error("Hook validation failed");
      });

      registry.register("beforeCreate", "posts", handler);

      const context: HookContext = {
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: {},
      };

      await expect(registry.execute("beforeCreate", context)).rejects.toThrow(
        "Hook execution failed for beforeCreate on posts: Hook validation failed"
      );
    });

    it("should stop execution on first error", async () => {
      const handler1 = vi.fn(async () => {
        throw new Error("First hook failed");
      });

      const handler2 = vi.fn(); // Should not be called

      registry.register("beforeCreate", "posts", handler1);
      registry.register("beforeCreate", "posts", handler2);

      const context: HookContext = {
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: {},
      };

      await expect(registry.execute("beforeCreate", context)).rejects.toThrow();

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();
    });

    it("should include hook type and collection in error message", async () => {
      const handler = vi.fn(async () => {
        throw new Error("Custom error");
      });

      registry.register("afterUpdate", "users", handler);

      const context: HookContext = {
        collection: "users",
        operation: "update",
        data: { id: "1" },
        context: {},
      };

      await expect(registry.execute("afterUpdate", context)).rejects.toThrow(
        "Hook execution failed for afterUpdate on users: Custom error"
      );
    });
  });

  // ==========================================================================
  // QUERY METHODS TESTS
  // ==========================================================================

  describe("hasHooks()", () => {
    it("should return false when no hooks registered", () => {
      expect(registry.hasHooks("beforeCreate", "posts")).toBe(false);
    });

    it("should return true when collection-specific hook registered", () => {
      const handler = vi.fn();
      registry.register("beforeCreate", "posts", handler);

      expect(registry.hasHooks("beforeCreate", "posts")).toBe(true);
    });

    it("should return true when global hook registered", () => {
      const handler = vi.fn();
      registry.register("beforeCreate", "*", handler);

      expect(registry.hasHooks("beforeCreate", "posts")).toBe(true);
    });

    it("should return true when both global and specific hooks registered", () => {
      const handler = vi.fn();
      registry.register("beforeCreate", "*", handler);
      registry.register("beforeCreate", "posts", handler);

      expect(registry.hasHooks("beforeCreate", "posts")).toBe(true);
    });

    it("should return false for different hook types", () => {
      const handler = vi.fn();
      registry.register("beforeCreate", "posts", handler);

      expect(registry.hasHooks("afterCreate", "posts")).toBe(false);
    });
  });

  describe("getHookCount()", () => {
    it("should return 0 when no hooks registered", () => {
      expect(registry.getHookCount("beforeCreate", "posts")).toBe(0);
    });

    it("should return correct count for single hook", () => {
      const handler = vi.fn();
      registry.register("beforeCreate", "posts", handler);

      expect(registry.getHookCount("beforeCreate", "posts")).toBe(1);
    });

    it("should return correct count for multiple hooks", () => {
      const handler = vi.fn();
      registry.register("beforeCreate", "posts", handler);
      registry.register("beforeCreate", "posts", handler);
      registry.register("beforeCreate", "posts", handler);

      expect(registry.getHookCount("beforeCreate", "posts")).toBe(3);
    });

    it("should count global and specific hooks separately", () => {
      const handler = vi.fn();
      registry.register("beforeCreate", "*", handler);
      registry.register("beforeCreate", "posts", handler);

      expect(registry.getHookCount("beforeCreate", "*")).toBe(1);
      expect(registry.getHookCount("beforeCreate", "posts")).toBe(1);
    });
  });

  describe("getAll()", () => {
    it("should return empty map when no hooks registered", () => {
      const hooks = registry.getAll();
      expect(hooks.size).toBe(0);
    });

    it("should return all registered hooks", () => {
      const handler = vi.fn();
      registry.register("beforeCreate", "posts", handler);
      registry.register("afterCreate", "users", handler);

      const hooks = registry.getAll();
      expect(hooks.size).toBe(2);
    });

    it("should return a copy to prevent external mutation", () => {
      const handler = vi.fn();
      registry.register("beforeCreate", "posts", handler);

      const hooks1 = registry.getAll();
      hooks1.clear(); // Modify the copy

      const hooks2 = registry.getAll();
      expect(hooks2.size).toBe(1); // Original not affected
    });
  });

  // ==========================================================================
  // ALL HOOK TYPES TESTS
  // ==========================================================================

  describe("All Hook Types", () => {
    const hookTypes: HookType[] = [
      "beforeCreate",
      "afterCreate",
      "beforeUpdate",
      "afterUpdate",
      "beforeDelete",
      "afterDelete",
      "beforeRead",
      "afterRead",
    ];

    hookTypes.forEach(hookType => {
      it(`should register and execute ${hookType} hooks`, async () => {
        const handler = vi.fn();
        registry.register(hookType, "posts", handler);

        const context: HookContext = {
          collection: "posts",
          operation: hookType.replace(/^(before|after)/, "").toLowerCase(),
          data: { id: "1" },
          context: {},
        };

        await registry.execute(hookType, context);

        expect(handler).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ==========================================================================
  // SINGLETON PATTERN TESTS
  // ==========================================================================

  describe("Singleton Pattern (via exported functions)", () => {
    it("should provide resetHookRegistry for testing", () => {
      const handler = vi.fn();
      const registry1 = new HookRegistry();
      registry1.register("beforeCreate", "posts", handler);

      resetHookRegistry();

      const registry2 = new HookRegistry();
      expect(registry2.getHookCount("beforeCreate", "posts")).toBe(0);
    });
  });
});
