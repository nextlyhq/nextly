/**
 * Shared mock factories for SingleEntryService and SingleRegistryService
 * contract tests.
 *
 * Captures the behavior of the two god files before decomposition so the
 * split services can be verified against the same expectations.
 */

import { vi } from "vitest";

import type { Logger } from "../../../services/shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockRecord = Record<string, any>;

// ── Silent Logger ───────────────────────────────────────────────────────

export function createSilentLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

// ── Mock Adapter ────────────────────────────────────────────────────────

/**
 * Create a mock DrizzleAdapter with stubbed CRUD methods.
 *
 * By default:
 * - select() → []
 * - selectOne() → null
 * - insert() → { id }
 * - update() → [{ id }]
 * - delete() → undefined
 * - tableExists() → true
 * - executeQuery() → undefined
 *
 * Override any method via the `overrides` parameter.
 */
export function createMockAdapter(overrides: MockRecord = {}): MockRecord {
  const adapter: MockRecord = {
    dialect: "postgresql",
    getCapabilities: vi.fn().mockReturnValue({
      dialect: "postgresql",
      supportsIlike: true,
      supportsReturning: true,
      supportsJsonb: true,
      supportsJson: true,
      supportsArrays: true,
      supportsSavepoints: true,
      supportsOnConflict: true,
      supportsFts: true,
    }),
    select: vi.fn().mockResolvedValue([]),
    selectOne: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockResolvedValue({ id: "new-id" }),
    update: vi.fn().mockResolvedValue([{ id: "updated-id" }]),
    delete: vi.fn().mockResolvedValue(undefined),
    tableExists: vi.fn().mockResolvedValue(true),
    executeQuery: vi.fn().mockResolvedValue(undefined),
    getDialect: vi.fn().mockReturnValue("postgresql"),
    // The webhook read-shape assembly reads components on the transaction's
    // Drizzle handle; the component mocks ignore the executor, so a stub is fine.
    getDrizzle: vi.fn().mockReturnValue({}),
    // The update takes the row lock before its prior-state read; the real
    // adapter no-ops where locking is unsupported, so a resolved stub matches.
    lockRow: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  // Run a transaction callback with the adapter itself as the tx context, so
  // `tx.update`/`tx.insert` resolve to the same mocks the tests assert on and
  // callers that write inside `adapter.transaction(...)` behave like the real
  // adapter. Only default it when an override did not provide one.
  if (!adapter.transaction) {
    adapter.transaction = vi
      .fn()
      .mockImplementation(async (cb: (tx: MockRecord) => Promise<unknown>) =>
        cb(adapter)
      );
  }
  return adapter;
}

// ── Mock SingleRegistryService ──────────────────────────────────────────

/**
 * Create a mock SingleRegistryService that returns canned single metadata
 * keyed by slug. Use `registerSingle(slug, meta)` to add new entries.
 */
export function createMockSingleRegistry(): MockRecord {
  const singles = new Map<string, MockRecord>();

  const registerSingle = (slug: string, meta: Partial<MockRecord> = {}) => {
    singles.set(slug, {
      id: `single-${slug}`,
      slug,
      label: slug,
      tableName: `single_${slug.replace(/-/g, "_")}`,
      fields: [],
      source: "code",
      locked: true,
      schemaHash: "hash",
      schemaVersion: 1,
      migrationStatus: "applied",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...meta,
    });
  };

  return {
    singles,
    registerSingle,
    getSingle: vi.fn().mockImplementation(async (slug: string) => {
      const meta = singles.get(slug);
      if (!meta) {
        throw new Error(`Single "${slug}" not found`);
      }
      return meta;
    }),
    getSingleBySlug: vi.fn().mockImplementation(async (slug: string) => {
      return singles.get(slug) ?? null;
    }),
  };
}

// ── Mock HookRegistry ───────────────────────────────────────────────────

/**
 * Create a mock HookRegistry. By default `hasHooks()` returns false so
 * tests don't need to stub every possible hook phase. Override per-test
 * as needed.
 */
export function createMockHookRegistry(): MockRecord {
  return {
    hasHooks: vi.fn().mockReturnValue(false),
    execute: vi.fn().mockResolvedValue(undefined),
    executeBeforeOperation: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Mock ComponentDataService ───────────────────────────────────────────

export function createMockComponentDataService(): MockRecord {
  return {
    populateComponentData: vi
      .fn()
      .mockImplementation(
        async ({ entry }: { entry: Record<string, unknown> }) => entry
      ),
    saveComponentData: vi.fn().mockResolvedValue(undefined),
    saveComponentDataInTransaction: vi.fn().mockResolvedValue(undefined),
    deleteComponentData: vi.fn().mockResolvedValue(undefined),
    // The webhook field tree expands component references to find nested
    // secrets; null = no nested component schema for this slug in the mock.
    getComponentFields: vi.fn().mockResolvedValue(null),
  };
}

// ── Mock RBACAccessControlService ───────────────────────────────────────

export function createMockRBACService(allowed: boolean = true): MockRecord {
  return {
    checkAccess: vi.fn().mockResolvedValue(allowed),
    // Consulted by the API-key scope path to evaluate a code-defined access
    // rule; no rule by default.
    getRegisteredAccess: vi.fn().mockReturnValue(undefined),
  };
}

// ── Mock PermissionSeedService ──────────────────────────────────────────

export function createMockPermissionSeedService(): MockRecord {
  return {
    seedSinglePermissions: vi.fn().mockResolvedValue({
      created: 0,
      skipped: 0,
      newPermissionIds: [],
    }),
    assignNewPermissionsToSuperAdmin: vi.fn().mockResolvedValue(undefined),
    deletePermissionsForResource: vi
      .fn()
      .mockResolvedValue({ created: 0, skipped: 0 }),
  };
}

// ── Sample Single Field Definitions ─────────────────────────────────────

export function textField(name: string = "siteName") {
  return { name, type: "text" as const };
}

export function richTextField(name: string = "body") {
  return { name, type: "richText" as const };
}

export function jsonField(name: string = "settings") {
  return { name, type: "json" as const };
}

export function uploadField(name: string = "logo", hasMany = false) {
  return { name, type: "upload" as const, hasMany };
}

export function componentFieldDef(name: string = "seo", component = "seo") {
  return { name, type: "component" as const, component };
}

// ── Sample Single Metadata ──────────────────────────────────────────────

export function siteSettingsMeta(overrides: Partial<MockRecord> = {}) {
  return {
    id: "single-site-settings",
    slug: "site-settings",
    label: "Site Settings",
    tableName: "single_site_settings",
    fields: [textField("siteName"), textField("tagline")],
    source: "code" as const,
    locked: true,
    schemaHash: "hash",
    schemaVersion: 1,
    migrationStatus: "applied" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
