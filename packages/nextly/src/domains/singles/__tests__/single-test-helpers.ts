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
  return {
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
    ...overrides,
  };
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
    deleteComponentData: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Mock RBACAccessControlService ───────────────────────────────────────

export function createMockRBACService(allowed: boolean = true): MockRecord {
  return {
    checkAccess: vi.fn().mockResolvedValue(allowed),
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
