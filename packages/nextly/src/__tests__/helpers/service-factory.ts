/**
 * Service Factory for Unit Testing
 *
 * Creates any service that extends BaseService with an in-memory SQLite
 * database and mocked dependencies. Designed to make service tests fast,
 * isolated, and free from external infrastructure.
 *
 * @example
 * ```typescript
 * import { createTestService } from "../helpers/service-factory";
 * import { RoleQueryService } from "../../services/auth/role/role-query-service";
 *
 * describe("RoleQueryService", () => {
 *   let ctx: TestServiceContext<RoleQueryService>;
 *
 *   beforeEach(async () => {
 *     ctx = await createTestService(RoleQueryService);
 *   });
 *
 *   afterEach(() => {
 *     ctx.cleanup();
 *   });
 *
 *   it("should return empty roles", async () => {
 *     const result = await ctx.service.listRoles();
 *     expect(result.data).toEqual([]);
 *   });
 * });
 * ```
 *
 * @packageDocumentation
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { DatabaseCapabilities } from "@revnixhq/adapter-drizzle/types";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { vi } from "vitest";

import * as schema from "@nextly/database/schema/sqlite";

import type { Logger } from "../../services/shared";
import { createTestDb, type TestDb } from "../fixtures/db";

// ============================================================
// Types
// ============================================================

/**
 * Mock adapter that wraps an in-memory SQLite database.
 *
 * Provides just enough of the DrizzleAdapter interface to satisfy
 * BaseService. All methods delegate to the underlying Drizzle instance
 * so that real SQL executes against the in-memory database.
 */
export interface MockAdapter {
  /** Access the underlying Drizzle instance */
  getDrizzle: <T = unknown>() => T;
  /** Returns SQLite capabilities */
  getCapabilities: () => DatabaseCapabilities;
  /** Thin wrapper over db.select() */
  select: DrizzleAdapter["select"];
  /** Thin wrapper over db.selectOne() */
  selectOne: DrizzleAdapter["selectOne"];
  /** Thin wrapper over db.insert() */
  insert: DrizzleAdapter["insert"];
  /** Thin wrapper over db.update() */
  update: DrizzleAdapter["update"];
  /** Thin wrapper over db.delete() */
  delete: DrizzleAdapter["delete"];
  /** Returns "sqlite" */
  getDialect: () => string;
}

/**
 * Mock logger with vitest spies on every method.
 *
 * All log calls are captured and can be asserted on via
 * `expect(ctx.logger.info).toHaveBeenCalledWith(...)`.
 */
export interface MockLogger {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

/**
 * Context returned by createTestService.
 *
 * Contains the instantiated service, database references, and a
 * cleanup function that MUST be called after each test (typically
 * in afterEach or afterAll).
 */
export interface TestServiceContext<T> {
  /** The instantiated service under test */
  service: T;
  /** Drizzle database instance for direct assertions */
  db: BetterSQLite3Database<typeof schema>;
  /** The full test database context (includes reset and raw sqlite) */
  testDb: TestDb;
  /** Mock adapter passed to the service */
  adapter: MockAdapter;
  /** Mock logger passed to the service (all methods are vi.fn spies) */
  logger: MockLogger;
  /** Close the in-memory database. Call in afterEach/afterAll. */
  cleanup: () => void;
}

// ============================================================
// Mock Factories
// ============================================================

/** SQLite capability flags returned by the mock adapter. */
const SQLITE_CAPABILITIES: DatabaseCapabilities = {
  dialect: "sqlite",
  supportsJsonb: false,
  supportsJson: true,
  supportsArrays: false,
  supportsGeneratedColumns: true,
  supportsIlike: false,
  supportsReturning: true,
  supportsSavepoints: true,
  supportsOnConflict: true,
  supportsFts: false,
  maxParamsPerQuery: 999,
  maxIdentifierLength: 1024,
};

/**
 * Create a mock adapter backed by the given Drizzle instance.
 *
 * The adapter's CRUD methods are stubs that throw "not implemented"
 * by default. Services that go through BaseService.db (the Drizzle
 * query builder) will work because getDrizzle() returns the real
 * Drizzle instance. Services that call adapter.select() etc. directly
 * should have those methods overridden via the `overrides` parameter.
 */
function createMockAdapter(
  testDb: TestDb,
  overrides?: Partial<MockAdapter>
): MockAdapter {
  const base: MockAdapter = {
    getDrizzle: <T = unknown>(): T => {
      return testDb.db as unknown as T;
    },
    getCapabilities: () => SQLITE_CAPABILITIES,
    getDialect: () => "sqlite",

    // Default stubs for adapter CRUD methods.
    // BaseService typically accesses the DB through this.db (the Drizzle
    // instance from getDrizzle()), not through these methods directly.
    // Override via createTestService's overrides param if your service
    // calls adapter.select() etc.
    select: vi
      .fn()
      .mockRejectedValue(
        new Error(
          "MockAdapter.select() not implemented. " +
            "Override via createTestService overrides if your service uses adapter.select()."
        )
      ),
    selectOne: vi
      .fn()
      .mockRejectedValue(
        new Error(
          "MockAdapter.selectOne() not implemented. " +
            "Override via createTestService overrides if your service uses adapter.selectOne()."
        )
      ),
    insert: vi
      .fn()
      .mockRejectedValue(
        new Error(
          "MockAdapter.insert() not implemented. " +
            "Override via createTestService overrides if your service uses adapter.insert()."
        )
      ),
    update: vi
      .fn()
      .mockRejectedValue(
        new Error(
          "MockAdapter.update() not implemented. " +
            "Override via createTestService overrides if your service uses adapter.update()."
        )
      ),
    delete: vi
      .fn()
      .mockRejectedValue(
        new Error(
          "MockAdapter.delete() not implemented. " +
            "Override via createTestService overrides if your service uses adapter.delete()."
        )
      ),
  };

  return { ...base, ...overrides };
}

/**
 * Create a mock logger where every method is a vitest spy.
 *
 * If overrides are provided, the override implementations are used as
 * the spy's underlying implementation via `mockImplementation()`, so
 * the spy capabilities (call tracking, assertions) are preserved.
 */
function createMockLogger(overrides?: Partial<Logger>): MockLogger {
  const logger: MockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  if (overrides?.debug) logger.debug.mockImplementation(overrides.debug);
  if (overrides?.info) logger.info.mockImplementation(overrides.info);
  if (overrides?.warn) logger.warn.mockImplementation(overrides.warn);
  if (overrides?.error) logger.error.mockImplementation(overrides.error);

  return logger;
}

// ============================================================
// Main Factory
// ============================================================

/**
 * Create an instance of any service that extends BaseService, wired to an
 * in-memory SQLite database with mocked dependencies.
 *
 * @param ServiceClass - The service constructor (must accept `(adapter, logger)`)
 * @param overrides - Optional partial overrides for the adapter and/or logger
 * @returns A TestServiceContext with the service, database, and cleanup function
 *
 * @example Basic usage
 * ```typescript
 * const ctx = await createTestService(UserQueryService);
 * // ... run tests against ctx.service ...
 * ctx.cleanup();
 * ```
 *
 * @example With adapter overrides
 * ```typescript
 * const ctx = await createTestService(CollectionEntryService, {
 *   adapter: {
 *     select: vi.fn().mockResolvedValue([{ id: "1", title: "Test" }]),
 *   },
 * });
 * ```
 *
 * @example With custom logger
 * ```typescript
 * const ctx = await createTestService(RoleMutationService, {
 *   logger: {
 *     error: vi.fn().mockImplementation((msg) => console.error("TEST:", msg)),
 *   },
 * });
 * ```
 */
export async function createTestService<T>(
   
  ServiceClass: new (adapter: any, logger: any) => T,
  overrides?: {
    adapter?: Partial<MockAdapter>;
    logger?: Partial<Logger>;
  }
): Promise<TestServiceContext<T>> {
  const testDb = await createTestDb();
  const adapter = createMockAdapter(testDb, overrides?.adapter);
  const logger = createMockLogger(overrides?.logger);

  const service = new ServiceClass(adapter, logger);

  const cleanup = () => {
    testDb.close();
  };

  return {
    service,
    db: testDb.db,
    testDb,
    adapter,
    logger,
    cleanup,
  };
}
