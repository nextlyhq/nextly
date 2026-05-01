/**
 * Direct API - Users Namespace Tests
 *
 * Tests: users.find, users.findOne, users.findByID, users.create, users.update, users.delete
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import type { Nextly } from "../nextly";

import { setupTestNextly, type TestMocks } from "./helpers/test-setup";

describe("Direct API - Users Operations", () => {
  let nextly: Nextly;
  let mocks: TestMocks;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = setupTestNextly();
    nextly = setup.nextly;
    mocks = setup.mocks;
    cleanup = setup.cleanup;
  });

  afterAll(() => {
    cleanup?.();
  });

  describe("users.find()", () => {
    // Phase 4 (Task 13): Direct API now returns the canonical
    // `ListResult<T>` envelope (`{ items, meta }`). Tests that read
    // pagination metadata read it from `result.meta.*` (not from the
    // top-level legacy `totalDocs`/`hasNextPage`/`hasPrevPage` fields).
    it("should return paginated users", async () => {
      const mockUsers = [
        { id: "u1", email: "a@test.com", name: "Alice" },
        { id: "u2", email: "b@test.com", name: "Bob" },
      ];
      mocks.userService.listUsers.mockResolvedValue({
        data: mockUsers,
        pagination: { total: 2, limit: 10, offset: 0, hasMore: false },
      });

      const result = await nextly.users.find();

      expect(result.items).toEqual(mockUsers);
      expect(result.meta.total).toBe(2);
      expect(result.meta.limit).toBe(10);
      expect(result.meta.page).toBe(1);
    });

    it("should use provided limit and page", async () => {
      mocks.userService.listUsers.mockResolvedValue({
        data: [],
        pagination: { total: 50, limit: 5, offset: 5, hasMore: true },
      });

      const result = await nextly.users.find({ limit: 5, page: 2 });

      expect(result.meta.limit).toBe(5);
      expect(result.meta.page).toBe(2);
      expect(result.meta.total).toBe(50);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.hasPrev).toBe(true);
      expect(mocks.userService.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          pagination: { limit: 5, page: 2 },
        }),
        expect.any(Object) // RequestContext
      );
    });

    it("should calculate pagination fields correctly", async () => {
      mocks.userService.listUsers.mockResolvedValue({
        data: [],
        pagination: { total: 25, limit: 10, offset: 0, hasMore: true },
      });

      const result = await nextly.users.find({ limit: 10, page: 1 });

      expect(result.meta.totalPages).toBe(3); // ceil(25/10)
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.hasPrev).toBe(false);
    });

    it("should pass search filter to listUsers", async () => {
      mocks.userService.listUsers.mockResolvedValue({
        data: [],
        pagination: { total: 0, limit: 10, offset: 0, hasMore: false },
      });

      await nextly.users.find({ search: "john" });

      expect(mocks.userService.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ search: "john" }),
        expect.any(Object)
      );
    });

    it("should pass emailVerified filter to listUsers", async () => {
      mocks.userService.listUsers.mockResolvedValue({
        data: [],
        pagination: { total: 0, limit: 10, offset: 0, hasMore: false },
      });

      await nextly.users.find({ emailVerified: true });

      expect(mocks.userService.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ emailVerified: true }),
        expect.any(Object)
      );
    });

    it("should pass hasPassword filter to listUsers", async () => {
      mocks.userService.listUsers.mockResolvedValue({
        data: [],
        pagination: { total: 0, limit: 10, offset: 0, hasMore: false },
      });

      await nextly.users.find({ hasPassword: false });

      expect(mocks.userService.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ hasPassword: false }),
        expect.any(Object)
      );
    });

    it("should pass sortBy and sortOrder to listUsers", async () => {
      mocks.userService.listUsers.mockResolvedValue({
        data: [],
        pagination: { total: 0, limit: 10, offset: 0, hasMore: false },
      });

      await nextly.users.find({ sortBy: "createdAt", sortOrder: "desc" });

      expect(mocks.userService.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: "createdAt", sortOrder: "desc" }),
        expect.any(Object)
      );
    });

    it("should pass all filters together", async () => {
      mocks.userService.listUsers.mockResolvedValue({
        data: [],
        pagination: { total: 0, limit: 20, offset: 0, hasMore: false },
      });

      await nextly.users.find({
        search: "alice",
        emailVerified: true,
        hasPassword: true,
        sortBy: "name",
        sortOrder: "asc",
        limit: 20,
        page: 1,
      });

      expect(mocks.userService.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          search: "alice",
          emailVerified: true,
          hasPassword: true,
          sortBy: "name",
          sortOrder: "asc",
          pagination: { limit: 20, page: 1 },
        }),
        expect.any(Object)
      );
    });
  });

  describe("users.findOne()", () => {
    it("should return the first matching user", async () => {
      const mockUser = { id: "u1", email: "john@example.com", name: "John" };
      mocks.userService.listUsers.mockResolvedValue({
        data: [mockUser],
        pagination: { total: 1, limit: 1, offset: 0, hasMore: false },
      });

      const result = await nextly.users.findOne({ search: "john@example.com" });

      expect(result).toEqual(mockUser);
    });

    it("should return null when no users match", async () => {
      mocks.userService.listUsers.mockResolvedValue({
        data: [],
        pagination: { total: 0, limit: 1, offset: 0, hasMore: false },
      });

      const result = await nextly.users.findOne({
        search: "nobody@example.com",
      });

      expect(result).toBeNull();
    });

    it("should always call listUsers with limit 1 and page 1", async () => {
      mocks.userService.listUsers.mockResolvedValue({
        data: [],
        pagination: { total: 0, limit: 1, offset: 0, hasMore: false },
      });

      await nextly.users.findOne();

      expect(mocks.userService.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          pagination: { limit: 1, page: 1 },
        }),
        expect.any(Object)
      );
    });

    it("should pass search to listUsers", async () => {
      mocks.userService.listUsers.mockResolvedValue({
        data: [],
        pagination: { total: 0, limit: 1, offset: 0, hasMore: false },
      });

      await nextly.users.findOne({ search: "alice" });

      expect(mocks.userService.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ search: "alice" }),
        expect.any(Object)
      );
    });

    it("should pass emailVerified to listUsers", async () => {
      mocks.userService.listUsers.mockResolvedValue({
        data: [],
        pagination: { total: 0, limit: 1, offset: 0, hasMore: false },
      });

      await nextly.users.findOne({ emailVerified: false });

      expect(mocks.userService.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ emailVerified: false }),
        expect.any(Object)
      );
    });

    it("should pass hasPassword to listUsers", async () => {
      mocks.userService.listUsers.mockResolvedValue({
        data: [],
        pagination: { total: 0, limit: 1, offset: 0, hasMore: false },
      });

      await nextly.users.findOne({ hasPassword: true });

      expect(mocks.userService.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ hasPassword: true }),
        expect.any(Object)
      );
    });

    it("should return null with no args when no users exist", async () => {
      mocks.userService.listUsers.mockResolvedValue({
        data: [],
        pagination: { total: 0, limit: 1, offset: 0, hasMore: false },
      });

      const result = await nextly.users.findOne();

      expect(result).toBeNull();
    });
  });

  describe("users.findByID()", () => {
    it("should return user by ID", async () => {
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        name: "Test",
      };
      mocks.userService.findById.mockResolvedValue(mockUser);

      const result = await nextly.users.findByID({ id: "user-1" });

      expect(result).toEqual(mockUser);
      expect(mocks.userService.findById).toHaveBeenCalledWith(
        "user-1",
        expect.any(Object)
      );
    });

    it("should return null with disableErrors when not found", async () => {
      mocks.userService.findById.mockRejectedValue(
        NextlyError.notFound({ logContext: { entity: "user" } })
      );

      const result = await nextly.users.findByID({
        id: "missing",
        disableErrors: true,
      });

      expect(result).toBeNull();
    });

    it("should throw on not found without disableErrors", async () => {
      // Services throw NextlyError directly (post-PR-4); the namespace
      // passes it through unchanged after `convertServiceError` was deleted.
      mocks.userService.findById.mockRejectedValue(
        NextlyError.notFound({ logContext: { entity: "user" } })
      );

      await expect(
        nextly.users.findByID({ id: "missing" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("users.create()", () => {
    // Phase 4 (Task 13): create() now returns `{ message, item }`.
    it("should return created user", async () => {
      const mockUser = { id: "new-1", email: "new@test.com", name: "New User" };
      mocks.userService.create.mockResolvedValue(mockUser);

      const result = await nextly.users.create({
        email: "new@test.com",
        password: "secure123!",
        data: { name: "New User" },
      });

      expect(result.item).toEqual(mockUser);
      expect(result.message).toBe("User created.");
      expect(mocks.userService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "new@test.com",
          password: "secure123!",
          name: "New User",
        }),
        expect.any(Object)
      );
    });

    it("should handle missing data gracefully", async () => {
      mocks.userService.create.mockResolvedValue({
        id: "new-1",
        email: "test@test.com",
        name: "",
      });

      const result = await nextly.users.create({
        email: "test@test.com",
        password: "pass123!",
      });

      // Phase 4 (Task 13): result is `{ message, item }`; item carries the user.
      expect(result.item).toBeDefined();
      expect(result.message).toBe("User created.");
    });

    it("should throw on service error", async () => {
      // Services throw NextlyError directly (post-PR-4); the namespace
      // passes it through unchanged after `convertServiceError` was deleted.
      mocks.userService.create.mockRejectedValue(
        new NextlyError({
          code: "VALIDATION_ERROR",
          publicMessage: "Email already exists",
          statusCode: 400,
        })
      );

      await expect(
        nextly.users.create({
          email: "dup@test.com",
          password: "pass123!",
        })
      ).rejects.toThrow(NextlyError);
    });
  });

  describe("users.update()", () => {
    // Phase 4 (Task 13): update() now returns `{ message, item }`.
    it("should return updated user", async () => {
      const mockUser = {
        id: "user-1",
        email: "test@test.com",
        name: "Updated",
      };
      mocks.userService.update.mockResolvedValue(mockUser);

      const result = await nextly.users.update({
        id: "user-1",
        data: { name: "Updated" },
      });

      expect(result.item).toEqual(mockUser);
      expect(result.message).toBe("User updated.");
      expect(mocks.userService.update).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ name: "Updated" }),
        expect.any(Object)
      );
    });

    it("should throw when id is missing", async () => {
      await expect(
        nextly.users.update({ data: { name: "Test" } } as any)
      ).rejects.toThrow("'id' is required");
    });

    it("should pass data fields correctly", async () => {
      mocks.userService.update.mockResolvedValue({ id: "user-1" });

      await nextly.users.update({
        id: "user-1",
        data: {
          email: "new@test.com",
          name: "New Name",
          image: "https://example.com/avatar.jpg",
          isActive: false,
        },
      });

      expect(mocks.userService.update).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({
          email: "new@test.com",
          name: "New Name",
          image: "https://example.com/avatar.jpg",
          isActive: false,
        }),
        expect.any(Object)
      );
    });
  });

  describe("users.delete()", () => {
    // Phase 4 (Task 13): delete() now returns `{ message, item: { id } }`.
    it("should return MutationResult on success", async () => {
      mocks.userService.delete.mockResolvedValue(undefined);

      const result = await nextly.users.delete({ id: "user-1" });

      expect(result).toEqual({
        message: "User deleted.",
        item: { id: "user-1" },
      });
      expect(mocks.userService.delete).toHaveBeenCalledWith(
        "user-1",
        expect.any(Object)
      );
    });

    it("should throw when id is missing", async () => {
      await expect(nextly.users.delete({} as any)).rejects.toThrow(
        "'id' is required"
      );
    });

    it("should throw on not found", async () => {
      // Services throw NextlyError directly (post-PR-4); the namespace
      // passes it through unchanged after `convertServiceError` was deleted.
      mocks.userService.delete.mockRejectedValue(
        NextlyError.notFound({ logContext: { entity: "user" } })
      );

      await expect(
        nextly.users.delete({ id: "missing" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
