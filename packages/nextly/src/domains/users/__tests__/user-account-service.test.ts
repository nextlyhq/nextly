/**
 * UserAccountService Tests
 *
 * Tests for user account management operations: profile updates, password
 * management, and safety checks. The service no longer lists or unlinks
 * linked external accounts: those endpoints are retired, and their tests
 * went with them.
 *
 * Covers:
 * - getCurrentUser delegates to UserQueryService.getUserById
 * - updateCurrentUser with name change
 * - updateCurrentUser with image change
 * - updateCurrentUser with both name and image
 * - updateCurrentUser for non-existent user (404)
 * - updatePasswordHash success, ending the account's sessions
 * - updatePasswordHash for non-existent user (404)
 * - hasPassword returns true when password exists
 * - hasPassword returns false when no password
 * - hasPassword returns false for empty password string
 * - getUserPasswordHashById returns hash
 * - getUserPasswordHashById returns null when no hash
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

/**
 * Creates a chainable update mock: db.update(table).set(data).where(cond).
 * Resolves to better-sqlite3's run result, one row changed.
 */
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
        return Promise.resolve({ changes: 1 }).then(resolve, reject);
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
  deactivatedAt: Symbol("users.deactivatedAt"),
};

const refreshTokensColumns = {
  userId: Symbol("refreshTokens.userId"),
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
  refreshTokens: refreshTokensColumns,
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
    // The adapter's own transaction, which a SQLite service's
    // `withTransaction` runs its work in, over the same handle.
    transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
      work(mockDb)
    ),
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
    // A value of a real bcrypt hash's shape: the write refuses anything else.
    const HASH = "$2b$10$" + "h".repeat(53);

    it("should update password hash and return void", async () => {
      mockDb.query.users.findFirst.mockResolvedValue({ id: "user-1" });

      // Post-migration: returns void on success, throws on failure.
      await expect(
        service.updatePasswordHash("user-1", HASH)
      ).resolves.toBeUndefined();

      expect(mockDb.update).toHaveBeenCalled();
      // An administrator's new password ends the account's sessions.
      expect(mockDb.delete).toHaveBeenCalledWith(refreshTokensColumns);
    });

    it("refuses a raw password before reading or writing anything", async () => {
      // The one write that takes a hash from its caller: a password sent
      // here was stored as given.
      await expect(
        service.updatePasswordHash(
          "user-1",
          "Correct-Horse:Battery-Staple:2026-Phrase"
        )
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(mockDb.query.users.findFirst).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("leaves a user's own password write to the hasher that made it", async () => {
      // An app's configured `passwordHasher` writes its own format through
      // the shared password write; only the route above checks a format.
      const appHash = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaGhhc2g";
      await expect(
        service.changeOwnPasswordHash("user-1", appHash)
      ).resolves.toBeTypeOf("boolean");
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("should throw NextlyError(NOT_FOUND) when user not found", async () => {
      mockDb.query.users.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePasswordHash("nonexistent", HASH)
      ).rejects.toSatisfy((err: unknown) => NextlyError.isNotFound(err));
    });

    it("should throw NextlyError on database error during password update", async () => {
      mockDb.query.users.findFirst.mockResolvedValue({ id: "user-1" });
      mockDb.update.mockImplementation(() => {
        throw new Error("DB write error");
      });

      await expect(
        service.updatePasswordHash("user-1", HASH)
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
});
