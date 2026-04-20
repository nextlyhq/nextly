import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionCacheService } from "../services/permission-cache-service";

describe("PermissionCacheService", () => {
  let mockDb: any;
  let mockTables: any;
  let cacheService: PermissionCacheService;

  beforeEach(() => {
    // Reset mocks
    mockDb = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue({ rowCount: 1 }),
    };

    mockTables = {
      permissions: { id: "id", action: "action", resource: "resource" },
      userPermissionCache: {
        id: "id",
        userId: "userId",
        action: "action",
        resource: "resource",
        hasPermission: "hasPermission",
        roleIds: "roleIds",
        expiresAt: "expiresAt",
        createdAt: "createdAt",
      },
    };

    cacheService = new PermissionCacheService(mockDb, mockTables, {
      cacheTtlSeconds: 60, // 1 minute for tests
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getCachedPermission", () => {
    it("should return null for cache miss", async () => {
      mockDb.limit.mockResolvedValue([]);

      const result = await cacheService.getCachedPermission(
        "user-123",
        "read",
        "users"
      );

      expect(result).toBeNull();
      expect(mockDb.select).toHaveBeenCalled();
    });

    it("should return boolean for cache hit", async () => {
      const mockCacheEntry = {
        hasPermission: true,
        expiresAt: new Date(Date.now() + 60000), // Valid for 1 minute
      };
      mockDb.limit.mockResolvedValue([mockCacheEntry]);

      const result = await cacheService.getCachedPermission(
        "user-123",
        "read",
        "users"
      );

      expect(result).toBe(true);
    });

    it("should return null for invalid inputs", async () => {
      const result = await cacheService.getCachedPermission(
        "",
        "read",
        "users"
      );
      expect(result).toBeNull();
    });

    it("should handle database errors gracefully", async () => {
      mockDb.limit.mockRejectedValue(new Error("DB error"));

      const result = await cacheService.getCachedPermission(
        "user-123",
        "read",
        "users"
      );

      expect(result).toBeNull(); // Fail open
    });
  });

  describe("setCachedPermission", () => {
    it("should successfully store cache entry", async () => {
      await cacheService.setCachedPermission(
        "user-123",
        "read",
        "users",
        true,
        ["role-1", "role-2"]
      );

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalled();
      expect(mockDb.onConflictDoUpdate).toHaveBeenCalled();
    });

    it("should skip for invalid inputs", async () => {
      await cacheService.setCachedPermission("", "read", "users", true, []);

      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("should not throw on database errors", async () => {
      mockDb.onConflictDoUpdate.mockRejectedValue(new Error("DB error"));

      await expect(
        cacheService.setCachedPermission("user-123", "read", "users", true, [
          "role-1",
        ])
      ).resolves.not.toThrow();
    });
  });

  describe("invalidateByUser", () => {
    it("should invalidate (tombstone) all cache entries for user", async () => {
      mockDb.where.mockResolvedValue({ rowCount: 5 });

      const count = await cacheService.invalidateByUser("user-123");

      expect(count).toBe(5);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt: expect.any(Date),
        })
      );
    });

    it("should return 0 for invalid userId", async () => {
      const count = await cacheService.invalidateByUser("");

      expect(count).toBe(0);
    });

    it("should handle database errors gracefully", async () => {
      mockDb.where.mockRejectedValue(new Error("DB error"));

      const count = await cacheService.invalidateByUser("user-123");

      expect(count).toBe(0);
    });
  });

  describe("invalidateByRole", () => {
    it("should invalidate (tombstone) cache entries containing roleId", async () => {
      mockDb.where.mockResolvedValue({ rowCount: 10 });

      const count = await cacheService.invalidateByRole("role-admin");

      expect(count).toBe(10);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt: expect.any(Date),
        })
      );
    });

    it("should return 0 for invalid roleId", async () => {
      const count = await cacheService.invalidateByRole("");

      expect(count).toBe(0);
    });
  });

  describe("cleanupExpired", () => {
    it("should delete expired cache entries", async () => {
      mockDb.where.mockResolvedValue({ rowCount: 15 });

      const count = await cacheService.cleanupExpired();

      expect(count).toBe(15);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("should handle database errors gracefully", async () => {
      mockDb.where.mockRejectedValue(new Error("DB error"));

      const count = await cacheService.cleanupExpired();

      expect(count).toBe(0);
    });
  });

  describe("warmCacheForUser", () => {
    it("should pre-compute permissions for user", async () => {
      const mockPermissions = [
        { id: "perm-1", action: "read", resource: "users" },
        { id: "perm-2", action: "write", resource: "users" },
      ];

      mockDb.from.mockResolvedValue(mockPermissions);

      // Mock getAllPermissionsForRole to return one permission
      const mockChecker = {
        getAllPermissionsForRole: vi.fn().mockResolvedValue(["perm-1"]),
      };
      (cacheService as any).permissionChecker = mockChecker;

      await cacheService.warmCacheForUser("user-123");

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalled();
    });

    it("should skip for invalid userId", async () => {
      await cacheService.warmCacheForUser("");

      expect(mockDb.from).not.toHaveBeenCalled();
    });

    it("should handle no permissions gracefully", async () => {
      mockDb.from.mockResolvedValue([]);

      await expect(
        cacheService.warmCacheForUser("user-123")
      ).resolves.not.toThrow();
    });
  });

  describe("TTL configuration", () => {
    it("should use custom TTL from constructor", () => {
      const customService = new PermissionCacheService(mockDb, mockTables, {
        cacheTtlSeconds: 120, // 2 minutes
      });

      expect((customService as any).cacheTtlMs).toBe(120000);
    });

    it("should use default TTL when not specified", () => {
      const defaultService = new PermissionCacheService(mockDb, mockTables);

      expect((defaultService as any).cacheTtlMs).toBe(86400000); // 24 hours
    });
  });
});
