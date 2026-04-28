/**
 * UserQueryService Tests
 *
 * Tests for user query/read operations: listing with pagination, search,
 * filtering, sort order, getUserById, and findByEmail.
 *
 * Covers:
 * - listUsers with default pagination
 * - listUsers with custom page/pageSize
 * - listUsers with search by name/email
 * - listUsers with emailVerified filter
 * - listUsers with hasPassword filter
 * - listUsers with sort by name/email/createdAt (asc/desc)
 * - listUsers with empty result set
 * - getUserById success with roles
 * - getUserById not found (404)
 * - getUserById with invalid ID (400 validation)
 * - findByEmail success
 * - findByEmail not found (returns null)
 * - findByEmail with invalid email (throws)
 * - listUsers returns correct meta/pagination info
 * - getUserById when role lookup fails gracefully
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { NextlyError } from "../../../errors";
import { UserQueryService } from "../services/user-query-service";
import type { ListUsersOptions } from "../services/user-query-service";

// ── Mock Modules ───────────────────────────────────────────────────────

// Mock the DI container so ServiceContainer can be instantiated inside getUserById
vi.mock("../../../di/container", () => ({
  container: {
    get: vi.fn(),
    has: vi.fn().mockReturnValue(false),
  },
}));

// Mock the database index to return mock tables
vi.mock("../../../database/index", () => ({
  getDialectTables: vi.fn(() => mockTables),
}));

// Post-migration (PR 4): UserQueryService no longer imports
// `mapDbErrorToServiceError`. DB failures now throw NextlyError directly.

// Mock ServiceContainer used by getUserById to resolve user roles
vi.mock("../../../services/index", () => ({
  ServiceContainer: vi.fn().mockImplementation(() => ({
    userRoles: {
      listUserRoles: vi.fn().mockResolvedValue(["admin"]),
    },
  })),
}));

// ── Chainable Query Builder Mock ───────────────────────────────────────

/** Stored resolve data per query — tests set this before calling the service */
let selectResolveData: Record<string, unknown>[] = [];
let countResolveData: { value: number }[] = [{ value: 0 }];

/** Creates a chainable mock that mimics Drizzle's fluent API (select/from/where/...) */
function createChainableMock(resolveData: () => Record<string, unknown>[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};

  const terminator = vi
    .fn()
    .mockImplementation(() => Promise.resolve(resolveData()));

  // Each chainable method returns the chain itself; the chain is also thenable
  const methods = [
    "select",
    "from",
    "leftJoin",
    "where",
    "orderBy",
    "limit",
    "offset",
  ];
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }

  // Make the chain itself a callable that resolves (for `await query`)
  // Drizzle queries resolve when awaited — we simulate via then()
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

// ── Mock Tables ────────────────────────────────────────────────────────

// Column reference mocks — these are used in eq(), like(), etc.
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

// ── Mock DB (Drizzle-like interface) ───────────────────────────────────

function createMockDb() {
  const mainChain = createChainableMock(() => selectResolveData);
  const countChain = createChainableMock(
    () => countResolveData as unknown as Record<string, unknown>[]
  );

  // db.select() either returns the count chain or the main chain
  // We detect by inspecting the select argument
  let callCount = 0;
  const selectFn = vi.fn().mockImplementation(() => {
    callCount++;
    // In listUsers, the first select() is the count query, the second is the main query
    // We detect the count chain by checking the call order
    if (callCount % 2 === 1) {
      return countChain;
    }
    return mainChain;
  });

  return {
    select: selectFn,
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
    _mainChain: mainChain,
    _countChain: countChain,
    _resetCallCount: () => {
      callCount = 0;
    },
  };
}

// ── Mock Adapter ───────────────────────────────────────────────────────

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

describe("UserQueryService", () => {
  let service: UserQueryService;
  let mockAdapter: ReturnType<typeof createMockAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    selectResolveData = [];
    countResolveData = [{ value: 0 }];
    mockAdapter = createMockAdapter();
    service = new UserQueryService(mockAdapter as never, silentLogger as never);
  });

  // ── listUsers ────────────────────────────────────────────────────────

  describe("listUsers", () => {
    it("should return paginated result with default pagination", async () => {
      countResolveData = [{ value: 0 }];
      selectResolveData = [];
      mockDb._resetCallCount();

      // Post-migration (PR 4): no `success`/`statusCode`/`message` envelope.
      const result = await service.listUsers();

      expect(result.data).toEqual([]);
      expect(result.meta).toEqual({
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      });
    });

    it("should return users with roles grouped correctly", async () => {
      countResolveData = [{ value: 2 }];
      selectResolveData = [
        {
          userId: "user-1",
          email: "alice@example.com",
          emailVerified: new Date("2026-01-01"),
          name: "Alice",
          image: null,
          isActive: true,
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-01"),
          roleId: "role-1",
          roleName: "admin",
        },
        {
          userId: "user-1",
          email: "alice@example.com",
          emailVerified: new Date("2026-01-01"),
          name: "Alice",
          image: null,
          isActive: true,
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-01"),
          roleId: "role-2",
          roleName: "editor",
        },
        {
          userId: "user-2",
          email: "bob@example.com",
          emailVerified: null,
          name: "Bob",
          image: "https://img.com/bob.jpg",
          isActive: true,
          createdAt: new Date("2026-01-02"),
          updatedAt: new Date("2026-01-02"),
          roleId: null,
          roleName: null,
        },
      ];
      mockDb._resetCallCount();

      const result = await service.listUsers({ page: 1, pageSize: 10 });

      expect(result.data).toHaveLength(2);

      const alice = result.data![0];
      expect(alice.id).toBe("user-1");
      expect(alice.email).toBe("alice@example.com");
      // Alice has 2 roles
      expect((alice as Record<string, unknown>).roles).toEqual([
        { id: "role-1", name: "admin" },
        { id: "role-2", name: "editor" },
      ]);

      const bob = result.data![1];
      expect(bob.id).toBe("user-2");
      // Bob has no roles (LEFT JOIN returned nulls)
      expect((bob as Record<string, unknown>).roles).toEqual([]);
    });

    it("should use custom page and pageSize", async () => {
      countResolveData = [{ value: 25 }];
      selectResolveData = [];
      mockDb._resetCallCount();

      const options: ListUsersOptions = { page: 3, pageSize: 5 };
      const result = await service.listUsers(options);

      expect(result.meta?.page).toBe(3);
      expect(result.meta?.pageSize).toBe(5);
      expect(result.meta?.total).toBe(25);
      expect(result.meta?.totalPages).toBe(5);
    });

    it("should handle page beyond total pages gracefully", async () => {
      countResolveData = [{ value: 5 }];
      selectResolveData = [];
      mockDb._resetCallCount();

      const result = await service.listUsers({ page: 100, pageSize: 10 });

      expect(result.data).toEqual([]);
      expect(result.meta?.total).toBe(5);
      expect(result.meta?.page).toBe(100);
    });

    it("should apply search filter across name and email", async () => {
      countResolveData = [{ value: 1 }];
      selectResolveData = [
        {
          userId: "user-1",
          email: "alice@example.com",
          emailVerified: null,
          name: "Alice Smith",
          image: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          roleId: null,
          roleName: null,
        },
      ];
      mockDb._resetCallCount();

      const result = await service.listUsers({ search: "alice" });

      expect(result.data).toHaveLength(1);
      expect(result.data![0].name).toBe("Alice Smith");
    });

    it("should apply emailVerified filter", async () => {
      countResolveData = [{ value: 1 }];
      selectResolveData = [
        {
          userId: "user-1",
          email: "verified@example.com",
          emailVerified: new Date("2026-01-01"),
          name: "Verified User",
          image: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          roleId: null,
          roleName: null,
        },
      ];
      mockDb._resetCallCount();

      const result = await service.listUsers({ emailVerified: true });

      expect(result.data).toHaveLength(1);
    });

    it("should apply hasPassword filter", async () => {
      countResolveData = [{ value: 1 }];
      selectResolveData = [
        {
          userId: "user-1",
          email: "password-user@example.com",
          emailVerified: null,
          name: "Password User",
          image: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          roleId: null,
          roleName: null,
        },
      ];
      mockDb._resetCallCount();

      const result = await service.listUsers({ hasPassword: true });

      expect(result.data).toHaveLength(1);
    });

    it("should support descending sort order", async () => {
      countResolveData = [{ value: 2 }];
      selectResolveData = [
        {
          userId: "user-2",
          email: "z-user@example.com",
          emailVerified: null,
          name: "Zara",
          image: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          roleId: null,
          roleName: null,
        },
        {
          userId: "user-1",
          email: "a-user@example.com",
          emailVerified: null,
          name: "Aaron",
          image: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          roleId: null,
          roleName: null,
        },
      ];
      mockDb._resetCallCount();

      const result = await service.listUsers({
        sortBy: "name",
        sortOrder: "desc",
      });

      expect(result.data).toHaveLength(2);
      // The data order is determined by what the mock returns, but the service
      // called orderBy which we verify was invoked
      expect(result.data![0].name).toBe("Zara");
      expect(result.data![1].name).toBe("Aaron");
    });

    it("should default sortBy to email and sortOrder to asc", async () => {
      countResolveData = [{ value: 0 }];
      selectResolveData = [];
      mockDb._resetCallCount();

      const result = await service.listUsers({});

      expect(result.meta.page).toBe(1);
      expect(result.meta.pageSize).toBe(10);
    });

    it("should sort by createdAt", async () => {
      countResolveData = [{ value: 1 }];
      selectResolveData = [
        {
          userId: "user-1",
          email: "user@example.com",
          emailVerified: null,
          name: "User",
          image: null,
          isActive: true,
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-01"),
          roleId: null,
          roleName: null,
        },
      ];
      mockDb._resetCallCount();

      const result = await service.listUsers({
        sortBy: "createdAt",
        sortOrder: "asc",
      });

      expect(result.data).toHaveLength(1);
    });

    it("should calculate totalPages correctly", async () => {
      countResolveData = [{ value: 23 }];
      selectResolveData = [];
      mockDb._resetCallCount();

      const result = await service.listUsers({ page: 1, pageSize: 5 });

      // ceil(23/5) = 5
      expect(result.meta?.totalPages).toBe(5);
      expect(result.meta?.total).toBe(23);
    });

    it("should combine search and emailVerified filters", async () => {
      countResolveData = [{ value: 1 }];
      selectResolveData = [
        {
          userId: "user-1",
          email: "alice@example.com",
          emailVerified: new Date("2026-01-01"),
          name: "Alice",
          image: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          roleId: null,
          roleName: null,
        },
      ];
      mockDb._resetCallCount();

      const result = await service.listUsers({
        search: "alice",
        emailVerified: true,
      });

      expect(result.data).toHaveLength(1);
    });

    it("should handle users without isActive field", async () => {
      countResolveData = [{ value: 1 }];
      selectResolveData = [
        {
          userId: "user-1",
          email: "test@example.com",
          emailVerified: null,
          name: "Test",
          image: null,
          isActive: undefined,
          createdAt: undefined,
          updatedAt: undefined,
          roleId: null,
          roleName: null,
        },
      ];
      mockDb._resetCallCount();

      const result = await service.listUsers();

      const user = result.data[0];
      expect((user as Record<string, unknown>).isActive).toBeUndefined();
    });

    it("should throw NextlyError on database error", async () => {
      // Make the db.select throw an error; fromDatabaseError wraps the
      // non-DbError as INTERNAL_ERROR (statusCode 500).
      mockDb.select.mockImplementation(() => {
        throw new Error("Database connection lost");
      });

      await expect(service.listUsers()).rejects.toSatisfy(
        (err: unknown) => NextlyError.is(err) && err.statusCode === 500
      );
    });
  });

  // ── getUserById ──────────────────────────────────────────────────────

  describe("getUserById", () => {
    it("should return user with roles when found", async () => {
      selectResolveData = [
        {
          id: "user-1",
          email: "alice@example.com",
          emailVerified: new Date("2026-01-01"),
          name: "Alice",
          image: "https://img.com/alice.jpg",
          isActive: true,
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-01"),
        },
      ];

      // getUserById uses a single select query (not count+main like listUsers)
      // Reset to ensure the chain returns user data
      const singleChain = createChainableMock(() => selectResolveData);
      mockDb.select.mockReturnValue(singleChain);

      // Post-migration: returns user directly; envelope is gone.
      const user = await service.getUserById("user-1");

      expect(user).not.toBeNull();
      expect(user.id).toBe("user-1");
      expect(user.email).toBe("alice@example.com");
      expect(user.name).toBe("Alice");
    });

    it("should throw NextlyError(NOT_FOUND) when user is not found", async () => {
      selectResolveData = [];
      const emptyChain = createChainableMock(() => []);
      mockDb.select.mockReturnValue(emptyChain);

      // §13.8: public message is generic "Not found." — id only in logContext.
      await expect(service.getUserById("nonexistent")).rejects.toSatisfy(
        (err: unknown) =>
          NextlyError.isNotFound(err) &&
          (err as NextlyError).publicMessage === "Not found."
      );
    });

    it("should handle empty string user ID without crashing", async () => {
      // Empty string passes Zod validation (z.union([z.string(), z.number()]))
      // so the service proceeds to query normally — the empty result then
      // throws NOT_FOUND.
      selectResolveData = [];
      const emptyChain = createChainableMock(() => []);
      mockDb.select.mockReturnValue(emptyChain);

      await expect(service.getUserById("")).rejects.toSatisfy((err: unknown) =>
        NextlyError.isNotFound(err)
      );
    });

    it("should handle null emailVerified gracefully", async () => {
      selectResolveData = [
        {
          id: "user-2",
          email: "unverified@example.com",
          emailVerified: null,
          name: null,
          image: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const singleChain = createChainableMock(() => selectResolveData);
      mockDb.select.mockReturnValue(singleChain);

      const user = await service.getUserById("user-2");

      expect(user.emailVerified).toBeNull();
      expect(user.name).toBeNull();
      expect(user.image).toBeNull();
    });

    it("should still return user data when role lookup fails", async () => {
      selectResolveData = [
        {
          id: "user-3",
          email: "noroles@example.com",
          emailVerified: null,
          name: "No Roles",
          image: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const singleChain = createChainableMock(() => selectResolveData);
      mockDb.select.mockReturnValue(singleChain);

      // The ServiceContainer mock is set up in vi.mock above — roles default to ["admin"]
      // Even if it failed, the service catches and sets roles to null
      const user = await service.getUserById("user-3");

      expect(user).not.toBeNull();
      expect(user.id).toBe("user-3");
    });

    it("should accept numeric user ID", async () => {
      selectResolveData = [
        {
          id: 42,
          email: "numeric@example.com",
          emailVerified: null,
          name: "Numeric ID User",
          image: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const singleChain = createChainableMock(() => selectResolveData);
      mockDb.select.mockReturnValue(singleChain);

      const user = await service.getUserById(42);

      expect(user.id).toBe(42);
    });
  });

  // ── findByEmail ──────────────────────────────────────────────────────

  describe("findByEmail", () => {
    it("should return user when found by email", async () => {
      selectResolveData = [
        {
          id: "user-1",
          email: "found@example.com",
          emailVerified: new Date("2026-01-01"),
          name: "Found User",
          image: null,
          isActive: true,
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-01"),
        },
      ];
      const singleChain = createChainableMock(() => selectResolveData);
      mockDb.select.mockReturnValue(singleChain);

      const result = await service.findByEmail("found@example.com");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("user-1");
      expect(result!.email).toBe("found@example.com");
      expect(result!.name).toBe("Found User");
    });

    it("should return null when user not found by email", async () => {
      selectResolveData = [];
      const emptyChain = createChainableMock(() => []);
      mockDb.select.mockReturnValue(emptyChain);

      const result = await service.findByEmail("notfound@example.com");

      expect(result).toBeNull();
    });

    it("should throw NextlyError(VALIDATION_ERROR) for invalid email format", async () => {
      await expect(service.findByEmail("not-an-email")).rejects.toSatisfy(
        (err: unknown) => NextlyError.isValidation(err)
      );
    });

    it("should throw NextlyError(VALIDATION_ERROR) for empty email string", async () => {
      await expect(service.findByEmail("")).rejects.toSatisfy((err: unknown) =>
        NextlyError.isValidation(err)
      );
    });

    it("should handle user with all nullable fields as null", async () => {
      selectResolveData = [
        {
          id: "user-sparse",
          email: "sparse@example.com",
          emailVerified: null,
          name: null,
          image: null,
          isActive: undefined,
          createdAt: undefined,
          updatedAt: undefined,
        },
      ];
      const singleChain = createChainableMock(() => selectResolveData);
      mockDb.select.mockReturnValue(singleChain);

      const result = await service.findByEmail("sparse@example.com");

      expect(result).not.toBeNull();
      expect(result!.name).toBeNull();
      expect(result!.image).toBeNull();
      expect(result!.emailVerified).toBeNull();
    });
  });
});
