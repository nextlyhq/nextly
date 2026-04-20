import { vi } from "vitest";

import type { Logger } from "../../../services/shared";

 
type MockRecord = Record<string, any>;

export function createSilentLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

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

export function createMockTxContext(overrides: MockRecord = {}): MockRecord {
  return {
    select: vi.fn().mockResolvedValue([]),
    selectOne: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockResolvedValue({ id: "tx-new-id" }),
    update: vi.fn().mockResolvedValue([{ id: "tx-updated-id" }]),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Create a mock ComponentRegistryService that returns canned component metadata
 * keyed by slug. Use `registerComponent(slug, meta)` to add new entries.
 */
export function createMockComponentRegistry(): MockRecord {
  const components = new Map<string, MockRecord>();

  const registerComponent = (slug: string, meta: Partial<MockRecord> = {}) => {
    components.set(slug, {
      id: `component-${slug}`,
      slug,
      label: slug,
      tableName: `comp_${slug}`,
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
    components,
    registerComponent,
    getComponent: vi.fn().mockImplementation(async (slug: string) => {
      const meta = components.get(slug);
      if (!meta) {
        throw new Error(`Component "${slug}" not found`);
      }
      return meta;
    }),
    getComponentBySlug: vi.fn().mockImplementation(async (slug: string) => {
      return components.get(slug) ?? null;
    }),
  };
}

export function createMockRelationshipService(): MockRecord {
  return {
    expandRelationships: vi
      .fn()
      .mockImplementation((data: Record<string, unknown>) =>
        Promise.resolve(data)
      ),
  };
}

export function seoComponentField() {
  return {
    name: "seo",
    type: "component",
    component: "seo",
  };
}

export function repeatableComponentField() {
  return {
    name: "features",
    type: "component",
    component: "feature",
    repeatable: true,
  };
}

export function multiComponentField() {
  return {
    name: "layout",
    type: "component",
    components: ["hero", "cta"],
    repeatable: true,
  };
}

export function seoComponentMeta() {
  return {
    slug: "seo",
    tableName: "comp_seo",
    fields: [
      { name: "metaTitle", type: "text" },
      { name: "metaDescription", type: "text" },
    ],
  };
}

export function featureComponentMeta() {
  return {
    slug: "feature",
    tableName: "comp_feature",
    fields: [
      { name: "title", type: "text" },
      { name: "description", type: "text" },
    ],
  };
}

export function heroComponentMeta() {
  return {
    slug: "hero",
    tableName: "comp_hero",
    fields: [
      { name: "heading", type: "text" },
      { name: "subheading", type: "text" },
    ],
  };
}

export function ctaComponentMeta() {
  return {
    slug: "cta",
    tableName: "comp_cta",
    fields: [
      { name: "label", type: "text" },
      { name: "href", type: "text" },
    ],
  };
}
