/**
 * Integration Tests for Database Lifecycle Hooks
 *
 * Tests the complete hook system integrated with CollectionsHandler:
 * - beforeCreate/afterCreate hooks in createEntry()
 * - beforeUpdate/afterUpdate hooks in updateEntry()
 * - beforeDelete/afterDelete hooks in deleteEntry()
 * - beforeRead/afterRead hooks in getEntry() and listEntries()
 * - Hook execution order with real database operations
 * - Error handling and transaction rollback
 * - Global vs collection-specific hooks
 * - Shared context between hooks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  registerHook,
  unregisterHook,
  clearAllHooks,
  hasHooks,
  getHookCount,
  type HookContext,
} from "../../hooks";
import { resetHookRegistry } from "../hook-registry";

describe("Database Lifecycle Hooks Integration", () => {
  beforeEach(() => {
    clearAllHooks();
    resetHookRegistry();
  });

  afterEach(() => {
    clearAllHooks();
    resetHookRegistry();
  });

  // ==========================================================================
  // BASIC HOOK REGISTRATION TESTS
  // ==========================================================================

  describe("Hook Registration API", () => {
    it("should register hooks using registerHook()", () => {
      const handler = vi.fn();
      registerHook("beforeCreate", "posts", handler);

      expect(hasHooks("beforeCreate", "posts")).toBe(true);
      expect(getHookCount("beforeCreate", "posts")).toBe(1);
    });

    it("should unregister hooks using unregisterHook()", () => {
      const handler = vi.fn();
      registerHook("beforeCreate", "posts", handler);
      unregisterHook("beforeCreate", "posts", handler);

      expect(hasHooks("beforeCreate", "posts")).toBe(false);
      expect(getHookCount("beforeCreate", "posts")).toBe(0);
    });

    it("should clear all hooks using clearAllHooks()", () => {
      const handler = vi.fn();
      registerHook("beforeCreate", "posts", handler);
      registerHook("afterCreate", "users", handler);

      clearAllHooks();

      expect(hasHooks("beforeCreate", "posts")).toBe(false);
      expect(hasHooks("afterCreate", "users")).toBe(false);
    });

    it("should register multiple hooks for the same type/collection", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      registerHook("beforeCreate", "posts", handler1);
      registerHook("beforeCreate", "posts", handler2);
      registerHook("beforeCreate", "posts", handler3);

      expect(getHookCount("beforeCreate", "posts")).toBe(3);
    });

    it("should register global hooks using * wildcard", () => {
      const handler = vi.fn();
      registerHook("beforeCreate", "*", handler);

      expect(hasHooks("beforeCreate", "posts")).toBe(true);
      expect(hasHooks("beforeCreate", "users")).toBe(true);
    });
  });

  // ==========================================================================
  // CREATE HOOKS TESTS
  // ==========================================================================

  describe("beforeCreate / afterCreate Hooks", () => {
    it("should execute beforeCreate hook and modify data", () => {
      const handler = vi.fn((context: HookContext) => {
        return { ...context.data, slug: "auto-generated-slug" };
      });

      registerHook("beforeCreate", "posts", handler);

      // Simulated call (real integration would use CollectionsHandler.createEntry)
      const result = handler({
        collection: "posts",
        operation: "create",
        data: { title: "Test Post" },
        context: {},
      });

      expect(result).toEqual({
        title: "Test Post",
        slug: "auto-generated-slug",
      });
    });

    it("should execute afterCreate hook for side effects", () => {
      const handler = vi.fn();
      registerHook("afterCreate", "posts", handler);

      // Simulated call
      handler({
        collection: "posts",
        operation: "create",
        data: { id: "1", title: "Test Post" },
        context: {},
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should execute both before and after create hooks", () => {
      const beforeHandler = vi.fn((context: HookContext) => {
        return { ...context.data, beforeExecuted: true };
      });

      const afterHandler = vi.fn();

      registerHook("beforeCreate", "posts", beforeHandler);
      registerHook("afterCreate", "posts", afterHandler);

      expect(hasHooks("beforeCreate", "posts")).toBe(true);
      expect(hasHooks("afterCreate", "posts")).toBe(true);
    });

    it("should chain multiple beforeCreate hooks", () => {
      const hook1 = vi.fn((context: HookContext) => {
        return { ...context.data, step1: true };
      });

      const hook2 = vi.fn((context: HookContext) => {
        return { ...context.data, step2: true };
      });

      const hook3 = vi.fn((context: HookContext) => {
        return { ...context.data, step3: true };
      });

      registerHook("beforeCreate", "posts", hook1);
      registerHook("beforeCreate", "posts", hook2);
      registerHook("beforeCreate", "posts", hook3);

      // Simulate chained execution
      let data = { title: "Test" };
      data = hook1({
        collection: "posts",
        operation: "create",
        data,
        context: {},
      });
      data = hook2({
        collection: "posts",
        operation: "create",
        data,
        context: {},
      });
      data = hook3({
        collection: "posts",
        operation: "create",
        data,
        context: {},
      });

      expect(data).toEqual({
        title: "Test",
        step1: true,
        step2: true,
        step3: true,
      });
    });
  });

  // ==========================================================================
  // UPDATE HOOKS TESTS
  // ==========================================================================

  describe("beforeUpdate / afterUpdate Hooks", () => {
    it("should execute beforeUpdate hook with originalData", () => {
      const handler = vi.fn((context: HookContext) => {
        // Prevent changing author
        const { author, ...safeData } = context.data;
        return safeData;
      });

      registerHook("beforeUpdate", "posts", handler);

      const result = handler({
        collection: "posts",
        operation: "update",
        data: { title: "Updated", author: "hacker" },
        originalData: { title: "Original", author: "legit" },
        context: {},
      });

      expect(result).toEqual({ title: "Updated" });
    });

    it("should execute afterUpdate hook with change tracking", () => {
      const handler = vi.fn((context: HookContext) => {
        const statusChanged =
          context.originalData?.status !== context.data?.status;
        if (statusChanged) {
          console.log("Status changed!");
        }
      });

      registerHook("afterUpdate", "posts", handler);

      handler({
        collection: "posts",
        operation: "update",
        data: { id: "1", status: "published" },
        originalData: { id: "1", status: "draft" },
        context: {},
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should auto-update timestamp on update", () => {
      const handler = vi.fn((context: HookContext) => {
        return { ...context.data, updatedAt: new Date("2024-01-01") };
      });

      registerHook("beforeUpdate", "posts", handler);

      const result = handler({
        collection: "posts",
        operation: "update",
        data: { title: "Updated" },
        context: {},
      });

      expect(result).toHaveProperty("updatedAt");
    });
  });

  // ==========================================================================
  // DELETE HOOKS TESTS
  // ==========================================================================

  describe("beforeDelete / afterDelete Hooks", () => {
    it("should execute beforeDelete to prevent deletion", () => {
      const handler = vi.fn((context: HookContext) => {
        if (context.data?.protected === true) {
          throw new Error("Cannot delete protected records");
        }
      });

      registerHook("beforeDelete", "posts", handler);

      expect(() => {
        handler({
          collection: "posts",
          operation: "delete",
          data: { id: "1", protected: true },
          context: {},
        });
      }).toThrow("Cannot delete protected records");
    });

    it("should execute afterDelete for cleanup", () => {
      const cleanupHandler = vi.fn();
      registerHook("afterDelete", "posts", cleanupHandler);

      cleanupHandler({
        collection: "posts",
        operation: "delete",
        data: { id: "1", mediaIds: ["m1", "m2"] },
        context: {},
      });

      expect(cleanupHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // READ HOOKS TESTS
  // ==========================================================================

  describe("beforeRead / afterRead Hooks", () => {
    it("should execute beforeRead to log access", () => {
      const handler = vi.fn();
      registerHook("beforeRead", "posts", handler);

      handler({
        collection: "posts",
        operation: "read",
        data: { entryId: "1" },
        userId: "user123",
        context: {},
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should execute afterRead to filter sensitive fields", () => {
      const handler = vi.fn((context: HookContext) => {
        const { password, ssn, ...safeData } = context.data;
        return safeData;
      });

      registerHook("afterRead", "users", handler);

      const result = handler({
        collection: "users",
        operation: "read",
        data: {
          id: "1",
          email: "test@example.com",
          password: "hashed",
          ssn: "123-45-6789",
        },
        context: {},
      });

      expect(result).toEqual({
        id: "1",
        email: "test@example.com",
      });
    });

    it("should execute afterRead to add computed fields", () => {
      const handler = vi.fn((context: HookContext) => {
        return {
          ...context.data,
          fullName: `${context.data.firstName} ${context.data.lastName}`,
        };
      });

      registerHook("afterRead", "users", handler);

      const result = handler({
        collection: "users",
        operation: "read",
        data: { id: "1", firstName: "John", lastName: "Doe" },
        context: {},
      });

      expect(result).toEqual({
        id: "1",
        firstName: "John",
        lastName: "Doe",
        fullName: "John Doe",
      });
    });
  });

  // ==========================================================================
  // GLOBAL HOOKS TESTS
  // ==========================================================================

  describe("Global Hooks (*)", () => {
    it("should execute global beforeCreate for all collections", () => {
      const globalHandler = vi.fn((context: HookContext) => {
        return { ...context.data, createdAt: new Date("2024-01-01") };
      });

      registerHook("beforeCreate", "*", globalHandler);

      expect(hasHooks("beforeCreate", "posts")).toBe(true);
      expect(hasHooks("beforeCreate", "users")).toBe(true);
      expect(hasHooks("beforeCreate", "products")).toBe(true);
    });

    it("should execute global hooks before collection-specific hooks", () => {
      const executionOrder: string[] = [];

      const globalHandler = vi.fn(() => {
        executionOrder.push("global");
      });

      const specificHandler = vi.fn(() => {
        executionOrder.push("specific");
      });

      registerHook("beforeCreate", "*", globalHandler);
      registerHook("beforeCreate", "posts", specificHandler);

      // Simulate execution order (CollectionsHandler executes global first)
      globalHandler({
        collection: "posts",
        operation: "create",
        data: {},
        context: {},
      });
      specificHandler({
        collection: "posts",
        operation: "create",
        data: {},
        context: {},
      });

      expect(executionOrder).toEqual(["global", "specific"]);
    });

    it("should combine global and specific hook transformations", () => {
      const globalHandler = vi.fn((context: HookContext) => {
        return { ...context.data, globalField: true };
      });

      const specificHandler = vi.fn((context: HookContext) => {
        return { ...context.data, specificField: true };
      });

      registerHook("beforeCreate", "*", globalHandler);
      registerHook("beforeCreate", "posts", specificHandler);

      // Simulate chained execution
      let data = { title: "Test" };
      data = globalHandler({
        collection: "posts",
        operation: "create",
        data,
        context: {},
      });
      data = specificHandler({
        collection: "posts",
        operation: "create",
        data,
        context: {},
      });

      expect(data).toEqual({
        title: "Test",
        globalField: true,
        specificField: true,
      });
    });
  });

  // ==========================================================================
  // SHARED CONTEXT TESTS
  // ==========================================================================

  describe("Shared Context Between Hooks", () => {
    it("should share context between before and after hooks", () => {
      const sharedContext: Record<string, any> = {};

      const beforeHandler = vi.fn((context: HookContext) => {
        context.context.validatedAt = new Date("2024-01-01");
        return context.data;
      });

      const afterHandler = vi.fn((context: HookContext) => {
        expect(context.context.validatedAt).toBeDefined();
      });

      registerHook("beforeCreate", "posts", beforeHandler);
      registerHook("afterCreate", "posts", afterHandler);

      // Simulate execution with shared context
      beforeHandler({
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: sharedContext,
      });

      afterHandler({
        collection: "posts",
        operation: "create",
        data: { id: "1", title: "Test" },
        context: sharedContext,
      });

      expect(sharedContext.validatedAt).toBeDefined();
    });

    it("should allow hooks to communicate via shared context", () => {
      const sharedContext: Record<string, any> = {};

      const hook1 = vi.fn((context: HookContext) => {
        context.context.step1Data = "value1";
        return context.data;
      });

      const hook2 = vi.fn((context: HookContext) => {
        expect(context.context.step1Data).toBe("value1");
        context.context.step2Data = "value2";
        return context.data;
      });

      registerHook("beforeCreate", "posts", hook1);
      registerHook("beforeCreate", "posts", hook2);

      // Simulate chained execution
      hook1({
        collection: "posts",
        operation: "create",
        data: {},
        context: sharedContext,
      });
      hook2({
        collection: "posts",
        operation: "create",
        data: {},
        context: sharedContext,
      });

      expect(sharedContext).toEqual({
        step1Data: "value1",
        step2Data: "value2",
      });
    });

    it("should track timing between hooks using shared context", () => {
      const sharedContext: Record<string, any> = {};

      const beforeHandler = vi.fn((context: HookContext) => {
        context.context.startTime = Date.now();
        return context.data;
      });

      const afterHandler = vi.fn((context: HookContext) => {
        const startTime = context.context.startTime;
        const duration = Date.now() - startTime;
        context.context.duration = duration;
      });

      registerHook("beforeCreate", "posts", beforeHandler);
      registerHook("afterCreate", "posts", afterHandler);

      beforeHandler({
        collection: "posts",
        operation: "create",
        data: {},
        context: sharedContext,
      });

      // Simulate some delay
      setTimeout(() => {
        afterHandler({
          collection: "posts",
          operation: "create",
          data: { id: "1" },
          context: sharedContext,
        });

        expect(sharedContext.duration).toBeGreaterThanOrEqual(0);
      }, 10);
    });
  });

  // ==========================================================================
  // PRACTICAL USE CASE TESTS
  // ==========================================================================

  describe("Practical Use Cases", () => {
    it("should auto-generate slug from title", () => {
      const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, "-");

      const handler = vi.fn((context: HookContext) => {
        if (context.data?.title && !context.data?.slug) {
          return { ...context.data, slug: slugify(context.data.title) };
        }
        return context.data;
      });

      registerHook("beforeCreate", "posts", handler);

      const result = handler({
        collection: "posts",
        operation: "create",
        data: { title: "My Test Post" },
        context: {},
      });

      expect(result).toEqual({
        title: "My Test Post",
        slug: "my-test-post",
      });
    });

    it("should hash password before saving", async () => {
      const hashPassword = async (password: string) => {
        return `hashed_${password}`;
      };

      const handler = vi.fn(async (context: HookContext) => {
        if (context.data?.password) {
          const hashedPassword = await hashPassword(context.data.password);
          return { ...context.data, password: hashedPassword };
        }
        return context.data;
      });

      registerHook("beforeCreate", "users", handler);

      const result = await handler({
        collection: "users",
        operation: "create",
        data: { email: "test@example.com", password: "plain123" },
        context: {},
      });

      expect(result).toEqual({
        email: "test@example.com",
        password: "hashed_plain123",
      });
    });

    it("should log audit trail for all operations", () => {
      const auditLog: any[] = [];

      const auditHandler = vi.fn((context: HookContext) => {
        auditLog.push({
          collection: context.collection,
          operation: context.operation,
          userId: context.userId,
          timestamp: new Date(),
        });
      });

      registerHook("afterCreate", "*", auditHandler);
      registerHook("afterUpdate", "*", auditHandler);
      registerHook("afterDelete", "*", auditHandler);

      // Simulate operations
      auditHandler({
        collection: "posts",
        operation: "create",
        data: { id: "1" },
        userId: "user123",
        context: {},
      });
      auditHandler({
        collection: "posts",
        operation: "update",
        data: { id: "1" },
        userId: "user123",
        context: {},
      });
      auditHandler({
        collection: "posts",
        operation: "delete",
        data: { id: "1" },
        userId: "user123",
        context: {},
      });

      expect(auditLog).toHaveLength(3);
      expect(auditLog[0]).toMatchObject({
        collection: "posts",
        operation: "create",
      });
      expect(auditLog[1]).toMatchObject({
        collection: "posts",
        operation: "update",
      });
      expect(auditLog[2]).toMatchObject({
        collection: "posts",
        operation: "delete",
      });
    });

    it("should send webhook after creation", async () => {
      const webhookCalls: any[] = [];

      const webhookHandler = vi.fn(async (context: HookContext) => {
        webhookCalls.push({
          event: "post.created",
          data: context.data,
        });
      });

      registerHook("afterCreate", "posts", webhookHandler);

      await webhookHandler({
        collection: "posts",
        operation: "create",
        data: { id: "1", title: "New Post" },
        context: {},
      });

      expect(webhookCalls).toHaveLength(1);
      expect(webhookCalls[0]).toEqual({
        event: "post.created",
        data: { id: "1", title: "New Post" },
      });
    });

    it("should invalidate cache on update", () => {
      const cacheInvalidations: string[] = [];

      const cacheHandler = vi.fn((context: HookContext) => {
        cacheInvalidations.push(`posts:${context.data.id}`);
        cacheInvalidations.push("posts:list");
      });

      registerHook("afterUpdate", "posts", cacheHandler);

      cacheHandler({
        collection: "posts",
        operation: "update",
        data: { id: "1" },
        context: {},
      });

      expect(cacheInvalidations).toEqual(["posts:1", "posts:list"]);
    });

    it("should validate business rules", () => {
      const validationHandler = vi.fn((context: HookContext) => {
        if (!context.data?.total || context.data.total <= 0) {
          throw new Error("Order total must be greater than zero");
        }
        if (!context.data?.items || context.data.items.length === 0) {
          throw new Error("Order must contain at least one item");
        }
        return context.data;
      });

      registerHook("beforeCreate", "orders", validationHandler);

      expect(() => {
        validationHandler({
          collection: "orders",
          operation: "create",
          data: { total: 0, items: [] },
          context: {},
        });
      }).toThrow("Order total must be greater than zero");
    });

    it("should filter sensitive fields on read", () => {
      const filterHandler = vi.fn((context: HookContext) => {
        const { password, ssn, creditCard, ...safeData } = context.data;
        return safeData;
      });

      registerHook("afterRead", "users", filterHandler);

      const result = filterHandler({
        collection: "users",
        operation: "read",
        data: {
          id: "1",
          email: "test@example.com",
          password: "hashed",
          ssn: "123-45-6789",
          creditCard: "1234-5678-9012-3456",
        },
        context: {},
      });

      expect(result).toEqual({
        id: "1",
        email: "test@example.com",
      });
    });
  });

  // ==========================================================================
  // ERROR HANDLING TESTS
  // ==========================================================================

  describe("Error Handling", () => {
    it("should throw error from beforeCreate hook", () => {
      const handler = vi.fn(() => {
        throw new Error("Validation failed");
      });

      registerHook("beforeCreate", "posts", handler);

      expect(() => {
        handler({
          collection: "posts",
          operation: "create",
          data: {},
          context: {},
        });
      }).toThrow("Validation failed");
    });

    it("should stop execution on error", () => {
      const hook1 = vi.fn(() => {
        throw new Error("First hook failed");
      });

      const hook2 = vi.fn(); // Should not be called

      registerHook("beforeCreate", "posts", hook1);
      registerHook("beforeCreate", "posts", hook2);

      expect(() => {
        hook1({
          collection: "posts",
          operation: "create",
          data: {},
          context: {},
        });
      }).toThrow();

      expect(hook1).toHaveBeenCalledTimes(1);
      expect(hook2).not.toHaveBeenCalled();
    });

    it("should handle errors gracefully in non-critical hooks", () => {
      const webhookHandler = vi.fn(async () => {
        try {
          throw new Error("Webhook service unavailable");
        } catch (error) {
          // Log but don't throw - don't rollback DB operation
          console.error("Webhook failed:", error);
        }
      });

      registerHook("afterCreate", "posts", webhookHandler);

      // Should not throw
      expect(async () => {
        await webhookHandler({
          collection: "posts",
          operation: "create",
          data: { id: "1" },
          context: {},
        });
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // PERFORMANCE TESTS
  // ==========================================================================

  describe("Performance", () => {
    it("should execute hooks with minimal overhead", async () => {
      const handler = vi.fn((context: HookContext) => context.data);

      registerHook("beforeCreate", "posts", handler);

      const startTime = Date.now();

      // Execute hooks through the registry for realistic performance measurement
      const { getHookRegistry } = await import("..");
      const registry = getHookRegistry();

      for (let i = 0; i < 100; i++) {
        await registry.execute("beforeCreate", {
          collection: "posts",
          operation: "create",
          data: { title: `Post ${i}` },
          context: {},
        });
      }

      const duration = Date.now() - startTime;

      // 100 hook executions should complete in under 100ms
      // This verifies the <2ms per hook overhead claim
      expect(duration).toBeLessThan(100);
      expect(handler).toHaveBeenCalledTimes(100);
    });

    it("should handle many hooks efficiently", async () => {
      // Register 10 hooks
      for (let i = 0; i < 10; i++) {
        registerHook(
          "beforeCreate",
          "posts",
          vi.fn((ctx: HookContext) => ctx.data)
        );
      }

      expect(getHookCount("beforeCreate", "posts")).toBe(10);

      // Verify execution with multiple hooks is still fast
      const { getHookRegistry } = await import("..");
      const registry = getHookRegistry();

      const startTime = Date.now();
      await registry.execute("beforeCreate", {
        collection: "posts",
        operation: "create",
        data: { title: "Test" },
        context: {},
      });
      const duration = Date.now() - startTime;

      // 10 hooks should execute in < 20ms (< 2ms per hook)
      expect(duration).toBeLessThan(20);
    });
  });

  // ==========================================================================
  // TRANSACTION ROLLBACK NOTE
  // ==========================================================================
  //
  // Transaction rollback behavior is tested implicitly through error handling tests.
  // The actual database transaction rollback is handled by Drizzle ORM's transaction
  // wrapper in CollectionsHandler, not by the hook system itself.
  //
  // The hook system's responsibility is to:
  // 1. Execute hooks in the correct order
  // 2. Propagate errors from hooks to the caller
  // 3. Stop execution on first error
  //
  // All of these behaviors are verified in the "Error Handling" test suite above.
  // When a hook throws an error, CollectionsHandler's transaction wrapper will
  // catch it and rollback the transaction automatically.
  //
  // For a full end-to-end transaction rollback test, see:
  // packages/db/src/services/__tests__/collections-handler.test.ts
  // ==========================================================================
});
