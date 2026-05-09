/**
 * UserAccountService Tests
 *
 * Tests for user account management operations: profile updates, password
 * management, OAuth account listing/unlinking, and safety checks.
 *
 * Covers:
 * - getCurrentUser delegates to UserQueryService.getUserById
 * - updateCurrentUser with name change
 * - updateCurrentUser with image change
 * - updateCurrentUser with both name and image
 * - updateCurrentUser for non-existent user (404)
 * - updatePasswordHash success
 * - updatePasswordHash for non-existent user (404)
 * - hasPassword returns true when password exists
 * - hasPassword returns false when no password
 * - hasPassword returns false for empty password string
 * - getUserPasswordHashById returns hash
 * - getUserPasswordHashById returns null when no hash
 * - getAccounts returns linked accounts
 * - getAccounts returns 404 when no accounts
 * - deleteUserAccount removes account and returns count
 * - deleteUserAccount returns 0 when account not found
 * - unlinkAccountForUser success
 * - unlinkAccountForUser blocks last auth method removal
 * - unlinkAccountForUser returns 404 when account not found
 * - unlinkAccountForUser allows unlink when password is set
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { NextlyError } from "../../../errors";
import { UserAccountService } from "../services/user-account-service";

// ── Mock Modules ───────────────────────────────────────────────────────

vi.mock("../../../di/container", () => ({
  container: {
    get: vi.fn(),
    has: vi.fn().mockReturnValue(false),
  },
}));

vi.mock("../../../database/index", () => ({
  getDialectTables: vi.fn(() => mockTables),
}));

// Post-migration (PR 4): UserAccountService no longer imports
// `mapDbErrorToServiceError` — DB errors throw via NextlyError directly. We
// mock the database/errors module so DB-error isDbError checks behave
// predictably; raw thrown Errors flow through NextlyError.fromDatabaseError.

vi.mock("../../../services/index", () => ({
  ServiceContainer: vi.fn().mockImplementation(() => ({
    userRoles: {
      listUserRoles: vi.fn().mockResolvedValue(["admin"]),
    },
  })),
}));

// ── Chainable Query Builder Mock ───────────────────────────────────────

function createChainableMock(resolveData: () => Record<string, unknown>[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    "select",
    "from",
    "leftJoin",
    "where",
    "orderBy",
    "limit",
    "offset",
    "set",
  ];
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = vi
    .fn()
    .mockImplementation(
      (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown
      ) => {
        return Promise.resolve(resolveData()).then(resolve, reject);
      }
    );
  return chain;
}

/** Creates a chainable update mock: db.update(table).set(data).where(cond) */
function createUpdateChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.set = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.then = vi
    .fn()
    .mockImplementation(
      (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown
      ) => {
        return Promise.resolve(undefined).then(resolve, reject);
      }
    );
  return chain;
}

/** Creates a chainable delete mock: db.delete(table).where(cond) */
function createDeleteChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.where = vi.fn().mockReturnValue(chain);
  chain.then = vi
    .fn()
    .mockImplementation(
      (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown
      ) => {
        return Promise.resolve(undefined).then(resolve, reject);
      }
    );
  return chain;
}

// ── Mock Tables ────────────────────────────────────────────────────────

const usersColumns = {
  id: Symbol("users.id"),
  email: Symbol("users.email"),
  emailVerified: Symbol("users.emailVerified"),
  name: Symbol("users.name"),
  image: Symbol("users.image"),
  isActive: Symbol("users.isActive"),
  createdAt: Symbol("users.createdAt"),
  updatedAt: Symbol("users.updatedAt"),
  passwordHash: Symbol("users.passwordHash"),
};

const rolesColumns = {
  id: Symbol("roles.id"),
  name: Symbol("roles.name"),
};

const userRolesColumns = {
  userId: Symbol("userRoles.userId"),
  roleId: Symbol("userRoles.roleId"),
};

const accountsColumns = {
  id: Symbol("accounts.id"),
  userId: Symbol("accounts.userId"),
  provider: Symbol("accounts.provider"),
  providerAccountId: Symbol("accounts.providerAccountId"),
  type: Symbol("accounts.type"),
};

const mockTables = {
  users: usersColumns,
  roles: rolesColumns,
  userRoles: userRolesColumns,
  accounts: accountsColumns,
};

// ── Mock DB ────────────────────────────────────────────────────────────

let getUserByIdData: Record<string, unknown>[] = [];

function createMockDb() {
  const updateChain = createUpdateChain();
  const deleteChain = createDeleteChain();

  // For getUserById (used by getCurrentUser and updateCurrentUser),
  // the service calls db.select(...).from(users).where(...).limit(1)
  const selectFn = vi.fn().mockImplementation(() => {
    return createChainableMock(() => getUserByIdData);
  });

  return {
    select: selectFn,
    update: vi.fn().mockReturnValue(updateChain),
    delete: vi.fn().mockReturnValue(deleteChain),
    query: {
      users: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      accounts: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
    _updateChain: updateChain,
    _deleteChain: deleteChain,
  };
}

let mockDb: ReturnType<typeof createMockDb>;

function createMockAdapter() {
  mockDb = createMockDb();
  return {
    getDrizzle: vi.fn().mockReturnValue(mockDb),
    getDb: vi.fn().mockReturnValue(mockDb),
    getTables: vi.fn().mockReturnValue(mockTables),
    getCapabilities: vi.fn().mockReturnValue({
      dialect: "sqlite",
      supportsIlike: false,
      supportsReturning: true,
      supportsJsonb: false,
      supportsJson: true,
      supportsArrays: false,
      supportsSavepoints: true,
      supportsOnConflict: true,
      supportsFts: false,
    }),
  };
}

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// ── Tests ──────────────────────────────────────────────────────────────

describe("UserAccountService", () => {
  let service: UserAccountService;
  let mockAdapter: ReturnType<typeof createMockAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    getUserByIdData = [];
    mockAdapter = createMockAdapter();
    service = new UserAccountService(
      mockAdapter as never,
      silentLogger as never
    );
  });

  // ── getCurrentUser ───────────────────────────────────────────────────

  describe("getCurrentUser", () => {
    it("should delegate to getUserById and return user directly", async () => {
      getUserByIdData = [
        {
          id: "user-1",
          email: "current@example.com",
          emailVerified: new Date("2026-01-01"),
          name: "Current User",
          image: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      // Post-migration: getCurrentUser returns the user directly (no envelope).
      const user = await service.getCurrentUser("user-1");

      expect(user).not.toBeNull();
      expect(user.id).toBe("user-1");
      expect(user.email).toBe("current@example.com");
    });

    it("should throw NextlyError(NOT_FOUND) when user does not exist", async () => {
      getUserByIdData = [];

      await expect(service.getCurrentUser("nonexistent")).rejects.toSatisfy(
        (err: unknown) => NextlyError.isNotFound(err)
      );
    });
  });

  // ── updateCurrentUser ────────────────────────────────────────────────

  describe("updateCurrentUser", () => {
    it("should update user name and return user directly", async () => {
      getUserByIdData = [
        {
          id: "user-1",
          email: "update@example.com",
          emailVerified: null,
          name: "Updated Name",
          image: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const user = await service.updateCurrentUser("user-1", {
        name: "Updated Name",
      });

      expect(user).not.toBeNull();
      expect(user.id).toBe("user-1");
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("should update user image and return user directly", async () => {
      getUserByIdData = [
        {
          id: "user-1",
          email: "img@example.com",
          emailVerified: null,
          name: "Img User",
          image: "https://new-image.com/photo.jpg",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const user = await service.updateCurrentUser("user-1", {
        image: "https://new-image.com/photo.jpg",
      });

      expect(user.image).toBe("https://new-image.com/photo.jpg");
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("should update both name and image simultaneously", async () => {
      getUserByIdData = [
        {
          id: "user-1",
          email: "both@example.com",
          emailVerified: null,
          name: "Both Updated",
          image: "https://img.com/new.jpg",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const user = await service.updateCurrentUser("user-1", {
        name: "Both Updated",
        image: "https://img.com/new.jpg",
      });

      expect(user.name).toBe("Both Updated");
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("should throw NextlyError(NOT_FOUND) when updating non-existent user", async () => {
      getUserByIdData = [];

      await expect(
        service.updateCurrentUser("nonexistent", { name: "Ghost" })
      ).rejects.toSatisfy((err: unknown) => NextlyError.isNotFound(err));
    });

    it("should throw NextlyError on database error during update", async () => {
      getUserByIdData = [
        {
          id: "user-1",
          email: "error@example.com",
          emailVerified: null,
          name: "Error User",
          image: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      // Make the update throw a non-DbError; fromDatabaseError wraps as
      // INTERNAL_ERROR with statusCode 500.
      mockDb.update.mockImplementation(() => {
        throw new Error("Constraint violation");
      });

      await expect(
        service.updateCurrentUser("user-1", { name: "Fail" })
      ).rejects.toSatisfy(
        (err: unknown) => NextlyError.is(err) && err.statusCode === 500
      );
    });
  });

  // ── updatePasswordHash ───────────────────────────────────────────────

  describe("updatePasswordHash", () => {
    it("should update password hash and return void", async () => {
      mockDb.query.users.findFirst.mockResolvedValue({ id: "user-1" });

      // Post-migration: returns void on success, throws on failure.
      await expect(
        service.updatePasswordHash("user-1", "$2b$10$hashedpassword")
      ).resolves.toBeUndefined();

      expect(mockDb.update).toHaveBeenCalled();
    });

    it("should throw NextlyError(NOT_FOUND) when user not found", async () => {
      mockDb.query.users.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePasswordHash("nonexistent", "$2b$10$hashedpassword")
      ).rejects.toSatisfy((err: unknown) => NextlyError.isNotFound(err));
    });

    it("should throw NextlyError on database error during password update", async () => {
      mockDb.query.users.findFirst.mockResolvedValue({ id: "user-1" });
      mockDb.update.mockImplementation(() => {
        throw new Error("DB write error");
      });

      await expect(
        service.updatePasswordHash("user-1", "$2b$10$newhash")
      ).rejects.toSatisfy(
        (err: unknown) => NextlyError.is(err) && err.statusCode === 500
      );
    });
  });

  // ── hasPassword ──────────────────────────────────────────────────────

  describe("hasPassword", () => {
    it("should return true when user has a password hash", async () => {
      mockDb.query.users.findFirst.mockResolvedValue({
        passwordHash: "$2b$10$validhash",
      });

      const result = await service.hasPassword("user-1");

      expect(result).toBe(true);
    });

    it("should return false when user has no password hash", async () => {
      mockDb.query.users.findFirst.mockResolvedValue({
        passwordHash: null,
      });

      const result = await service.hasPassword("user-1");

      expect(result).toBe(false);
    });

    it("should return false when password hash is empty string", async () => {
      mockDb.query.users.findFirst.mockResolvedValue({
        passwordHash: "",
      });

      const result = await service.hasPassword("user-1");

      expect(result).toBe(false);
    });

    it("should return false when user not found", async () => {
      mockDb.query.users.findFirst.mockResolvedValue(null);

      const result = await service.hasPassword("nonexistent");

      expect(result).toBe(false);
    });
  });

  // ── getUserPasswordHashById ──────────────────────────────────────────

  describe("getUserPasswordHashById", () => {
    it("should return password hash when it exists", async () => {
      mockDb.query.users.findFirst.mockResolvedValue({
        passwordHash: "$2b$10$somehash",
      });

      const result = await service.getUserPasswordHashById("user-1");

      expect(result).toBe("$2b$10$somehash");
    });

    it("should return null when user has no password", async () => {
      mockDb.query.users.findFirst.mockResolvedValue({
        passwordHash: null,
      });

      const result = await service.getUserPasswordHashById("user-1");

      expect(result).toBeNull();
    });

    it("should return null when user not found", async () => {
      mockDb.query.users.findFirst.mockResolvedValue(null);

      const result = await service.getUserPasswordHashById("nonexistent");

      expect(result).toBeNull();
    });
  });

  // ── getAccounts ──────────────────────────────────────────────────────

  describe("getAccounts", () => {
    it("should return linked OAuth accounts as an array", async () => {
      mockDb.query.accounts.findMany.mockResolvedValue([
        {
          id: "acc-1",
          userId: "user-1",
          provider: "google",
          providerAccountId: "google-123",
          type: "oauth",
        },
        {
          id: "acc-2",
          userId: "user-1",
          provider: "github",
          providerAccountId: "github-456",
          type: "oauth",
        },
      ]);

      const accounts = await service.getAccounts("user-1");

      expect(accounts).toHaveLength(2);
      expect(accounts[0].provider).toBe("google");
      expect(accounts[1].provider).toBe("github");
    });

    it("should return empty array when no accounts linked", async () => {
      // Post-migration: zero linked accounts is a normal state, not an error.
      // Pre-migration this returned a 404 envelope; that envelope-quirk is gone.
      mockDb.query.accounts.findMany.mockResolvedValue([]);

      const accounts = await service.getAccounts("user-1");

      expect(accounts).toEqual([]);
    });

    it("should throw NextlyError on database error when fetching accounts", async () => {
      mockDb.query.accounts.findMany.mockRejectedValue(new Error("DB error"));

      await expect(service.getAccounts("user-1")).rejects.toSatisfy(
        (err: unknown) => NextlyError.is(err) && err.statusCode === 500
      );
    });
  });

  // ── deleteUserAccount ────────────────────────────────────────────────

  describe("deleteUserAccount", () => {
    it("should delete account and return 1 when found", async () => {
      // Before: 1 matching row; After: 0 matching rows
      const beforeChain = createChainableMock(() => [{ id: "acc-1" }]);
      const afterChain = createChainableMock(() => []);

      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return beforeChain;
        return afterChain;
      });

      const deleted = await service.deleteUserAccount(
        "user-1",
        "google",
        "google-123"
      );

      expect(deleted).toBe(1);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("should return 0 when account not found", async () => {
      // Before and after both return empty
      const emptyChain = createChainableMock(() => []);
      mockDb.select.mockReturnValue(emptyChain);

      const deleted = await service.deleteUserAccount(
        "user-1",
        "nonexistent",
        "no-id"
      );

      expect(deleted).toBe(0);
    });
  });

  // ── unlinkAccountForUser ─────────────────────────────────────────────

  describe("unlinkAccountForUser", () => {
    it("should successfully unlink account when user has password", async () => {
      // getAccounts returns 1 account
      mockDb.query.accounts.findMany.mockResolvedValue([
        {
          id: "acc-1",
          userId: "user-1",
          provider: "google",
          providerAccountId: "google-123",
          type: "oauth",
        },
      ]);

      // hasPassword returns true
      mockDb.query.users.findFirst.mockResolvedValue({
        passwordHash: "$2b$10$hash",
      });

      // deleteUserAccount: before=1 row, after=0 rows
      const beforeChain = createChainableMock(() => [{ id: "acc-1" }]);
      const afterChain = createChainableMock(() => []);
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return beforeChain;
        return afterChain;
      });

      const result = await service.unlinkAccountForUser(
        "user-1",
        "google",
        "google-123"
      );

      expect(result).toEqual({ ok: true });
    });

    it("should block unlink when it is the last auth method (no password, 1 account)", async () => {
      // getAccounts returns 1 account
      mockDb.query.accounts.findMany.mockResolvedValue([
        {
          id: "acc-1",
          userId: "user-1",
          provider: "google",
          providerAccountId: "google-123",
          type: "oauth",
        },
      ]);

      // hasPassword returns false
      mockDb.query.users.findFirst.mockResolvedValue({
        passwordHash: null,
      });

      const result = await service.unlinkAccountForUser(
        "user-1",
        "google",
        "google-123"
      );

      expect(result).toEqual({
        ok: false,
        status: 400,
        error:
          "Cannot unlink the last authentication method without a password set.",
      });
    });

    it("should allow unlink when user has multiple accounts and no password", async () => {
      // getAccounts returns 2 accounts
      mockDb.query.accounts.findMany.mockResolvedValue([
        {
          id: "acc-1",
          userId: "user-1",
          provider: "google",
          providerAccountId: "google-123",
          type: "oauth",
        },
        {
          id: "acc-2",
          userId: "user-1",
          provider: "github",
          providerAccountId: "github-456",
          type: "oauth",
        },
      ]);

      // hasPassword returns false
      mockDb.query.users.findFirst.mockResolvedValue({
        passwordHash: null,
      });

      // deleteUserAccount: before=1, after=0
      const beforeChain = createChainableMock(() => [{ id: "acc-1" }]);
      const afterChain = createChainableMock(() => []);
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return beforeChain;
        return afterChain;
      });

      const result = await service.unlinkAccountForUser(
        "user-1",
        "google",
        "google-123"
      );

      expect(result).toEqual({ ok: true });
    });

    it("should return 404 when account to unlink is not found", async () => {
      // getAccounts returns 2 accounts (so safety check passes)
      mockDb.query.accounts.findMany.mockResolvedValue([
        {
          id: "acc-1",
          userId: "user-1",
          provider: "google",
          providerAccountId: "google-123",
          type: "oauth",
        },
        {
          id: "acc-2",
          userId: "user-1",
          provider: "github",
          providerAccountId: "github-456",
          type: "oauth",
        },
      ]);

      // hasPassword returns true
      mockDb.query.users.findFirst.mockResolvedValue({
        passwordHash: "$2b$10$hash",
      });

      // deleteUserAccount returns 0 (not found)
      const emptyChain = createChainableMock(() => []);
      mockDb.select.mockReturnValue(emptyChain);

      const result = await service.unlinkAccountForUser(
        "user-1",
        "twitter",
        "twitter-789"
      );

      expect(result).toEqual({ ok: false, status: 404, error: "Not found" });
    });

    it("should block unlink when getAccounts returns no accounts and no password", async () => {
      // getAccounts returns empty (no accounts at all)
      mockDb.query.accounts.findMany.mockResolvedValue([]);

      // hasPassword returns false
      mockDb.query.users.findFirst.mockResolvedValue({
        passwordHash: null,
      });

      const result = await service.unlinkAccountForUser(
        "user-1",
        "google",
        "google-123"
      );

      // numAccounts=0, hasPwd=false => !hasPwd && numAccounts<=1 => blocked
      expect(result).toEqual({
        ok: false,
        status: 400,
        error:
          "Cannot unlink the last authentication method without a password set.",
      });
    });
  });
});
