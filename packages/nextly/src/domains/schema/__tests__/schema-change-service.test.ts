// Tests for SchemaChangeService classification logic.
// Tests the pure classifyChanges() method which has no DB dependencies.
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { FieldDiffResult } from "../services/field-diff";
import { SchemaChangeService } from "../services/schema-change-service";

// Minimal mocks -- classifyChanges() is pure logic, no DB access needed
const mockAdapter = { getDrizzle: vi.fn() } as any;
const mockRegistry = {
  getTable: vi.fn(),
  registerDynamicSchema: vi.fn(),
  getDialect: vi.fn().mockReturnValue("postgresql"),
} as any;
const mockPushService = {
  preview: vi.fn().mockResolvedValue({
    hasDataLoss: false,
    warnings: [],
    statementsToExecute: [],
    applied: false,
  }),
  apply: vi.fn().mockResolvedValue({
    hasDataLoss: false,
    warnings: [],
    statementsToExecute: [],
    applied: true,
  }),
} as any;

describe("SchemaChangeService.classifyChanges", () => {
  let service: SchemaChangeService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SchemaChangeService(
      mockAdapter,
      mockRegistry,
      mockPushService
    );
  });

  it("classifies new optional field as safe", () => {
    const diff: FieldDiffResult = {
      added: [
        { name: "bio", type: "text", required: false } as FieldDefinition,
      ],
      removed: [],
      changed: [],
      unchanged: ["title"],
      hasChanges: true,
      hasDestructiveChanges: false,
      warnings: [],
    };

    const result = service.classifyChanges(diff, 0);

    expect(result.classification).toBe("safe");
    expect(result.interactiveFields).toHaveLength(0);
  });

  it("classifies removed field with data as destructive", () => {
    const diff: FieldDiffResult = {
      added: [],
      removed: [{ name: "legacy", type: "text" } as FieldDefinition],
      changed: [],
      unchanged: ["title"],
      hasChanges: true,
      hasDestructiveChanges: true,
      warnings: [],
    };

    const result = service.classifyChanges(diff, 100, { legacy: 50 });

    expect(result.classification).toBe("destructive");
    expect(result.changes.removed[0].rowCount).toBe(50);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("classifies removed field with zero data as safe", () => {
    const diff: FieldDiffResult = {
      added: [],
      removed: [{ name: "legacy", type: "text" } as FieldDefinition],
      changed: [],
      unchanged: ["title"],
      hasChanges: true,
      hasDestructiveChanges: true,
      warnings: [],
    };

    const result = service.classifyChanges(diff, 100, { legacy: 0 });

    expect(result.classification).toBe("safe");
    expect(result.changes.removed[0].rowCount).toBe(0);
  });

  it("classifies new required field on non-empty table as interactive", () => {
    const diff: FieldDiffResult = {
      added: [
        {
          name: "author",
          type: "text",
          required: true,
        } as FieldDefinition,
      ],
      removed: [],
      changed: [],
      unchanged: ["title"],
      hasChanges: true,
      hasDestructiveChanges: false,
      warnings: [],
    };

    const result = service.classifyChanges(diff, 500);

    expect(result.classification).toBe("interactive");
    expect(result.interactiveFields).toHaveLength(1);
    expect(result.interactiveFields[0].reason).toBe("new_required_no_default");
    expect(result.interactiveFields[0].tableRowCount).toBe(500);
  });

  it("classifies new required field on empty table as safe", () => {
    const diff: FieldDiffResult = {
      added: [
        {
          name: "author",
          type: "text",
          required: true,
        } as FieldDefinition,
      ],
      removed: [],
      changed: [],
      unchanged: [],
      hasChanges: true,
      hasDestructiveChanges: false,
      warnings: [],
    };

    const result = service.classifyChanges(diff, 0);

    expect(result.classification).toBe("safe");
    expect(result.interactiveFields).toHaveLength(0);
  });

  it("classifies new required field with default as safe", () => {
    const diff: FieldDiffResult = {
      added: [
        {
          name: "status",
          type: "text",
          required: true,
          defaultValue: "draft",
        } as FieldDefinition,
      ],
      removed: [],
      changed: [],
      unchanged: ["title"],
      hasChanges: true,
      hasDestructiveChanges: false,
      warnings: [],
    };

    const result = service.classifyChanges(diff, 500);

    expect(result.classification).toBe("safe");
    expect(result.interactiveFields).toHaveLength(0);
  });

  it("classifies nullable-to-required with existing NULLs as interactive", () => {
    const diff: FieldDiffResult = {
      added: [],
      removed: [],
      changed: [
        {
          name: "title",
          from: "text",
          to: "text",
          reason: "constraint_changed",
        },
      ],
      unchanged: [],
      hasChanges: true,
      hasDestructiveChanges: true,
      warnings: [],
    };

    const result = service.classifyChanges(diff, 100, {}, { title: 47 });

    expect(result.classification).toBe("interactive");
    expect(result.interactiveFields).toHaveLength(1);
    expect(result.interactiveFields[0].reason).toBe(
      "nullable_to_not_null_with_nulls"
    );
    expect(result.interactiveFields[0].nullCount).toBe(47);
  });

  it("classifies nullable-to-required with zero NULLs as safe", () => {
    const diff: FieldDiffResult = {
      added: [],
      removed: [],
      changed: [
        {
          name: "title",
          from: "text",
          to: "text",
          reason: "constraint_changed",
        },
      ],
      unchanged: [],
      hasChanges: true,
      hasDestructiveChanges: true,
      warnings: [],
    };

    const result = service.classifyChanges(diff, 100, {}, { title: 0 });

    expect(result.classification).toBe("safe");
    expect(result.interactiveFields).toHaveLength(0);
  });

  it("classifies type change as destructive", () => {
    const diff: FieldDiffResult = {
      added: [],
      removed: [],
      changed: [
        { name: "count", from: "text", to: "number", reason: "type_changed" },
      ],
      unchanged: [],
      hasChanges: true,
      hasDestructiveChanges: true,
      warnings: [],
    };

    const result = service.classifyChanges(diff, 100);

    expect(result.classification).toBe("destructive");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("count");
  });

  it("uses most severe classification when mixed changes", () => {
    const diff: FieldDiffResult = {
      added: [
        { name: "bio", type: "text", required: false } as FieldDefinition,
      ],
      removed: [{ name: "legacy", type: "text" } as FieldDefinition],
      changed: [],
      unchanged: ["title"],
      hasChanges: true,
      hasDestructiveChanges: true,
      warnings: [],
    };

    // Bio is safe (optional), legacy is destructive (50 rows)
    const result = service.classifyChanges(diff, 100, { legacy: 50 });

    expect(result.classification).toBe("destructive");
  });

  it("interactive beats destructive when both present", () => {
    const diff: FieldDiffResult = {
      added: [
        {
          name: "author",
          type: "text",
          required: true,
        } as FieldDefinition,
      ],
      removed: [{ name: "legacy", type: "text" } as FieldDefinition],
      changed: [],
      unchanged: [],
      hasChanges: true,
      hasDestructiveChanges: true,
      warnings: [],
    };

    const result = service.classifyChanges(diff, 100, { legacy: 50 });

    expect(result.classification).toBe("interactive");
  });

  it("returns no changes for empty diff", () => {
    const diff: FieldDiffResult = {
      added: [],
      removed: [],
      changed: [],
      unchanged: ["title", "body"],
      hasChanges: false,
      hasDestructiveChanges: false,
      warnings: [],
    };

    const result = service.classifyChanges(diff, 100);

    expect(result.classification).toBe("safe");
    expect(result.hasChanges).toBe(false);
  });
});

describe("SchemaChangeService.processResolutions", () => {
  let service: SchemaChangeService;

  beforeEach(() => {
    service = new SchemaChangeService(
      mockAdapter,
      mockRegistry,
      mockPushService
    );
  });

  it("adds defaultValue when resolution is provide_default", () => {
    const fields = [
      { name: "author", type: "text", required: true } as FieldDefinition,
      { name: "title", type: "text" } as FieldDefinition,
    ];
    const resolutions = {
      author: { action: "provide_default" as const, value: "Unknown" },
    };

    // Access private method via prototype for testing
    const resolved = (service as any).processResolutions(fields, resolutions);

    expect(resolved[0].defaultValue).toBe("Unknown");
    expect(resolved[1].defaultValue).toBeUndefined(); // title unchanged
  });

  it("sets required=false when resolution is mark_nullable", () => {
    const fields = [
      { name: "author", type: "text", required: true } as FieldDefinition,
    ];
    const resolutions = {
      author: { action: "mark_nullable" as const },
    };

    const resolved = (service as any).processResolutions(fields, resolutions);

    expect(resolved[0].required).toBe(false);
  });

  it("returns fields unchanged when no resolutions", () => {
    const fields = [{ name: "title", type: "text" } as FieldDefinition];

    const resolved = (service as any).processResolutions(fields, undefined);

    expect(resolved).toEqual(fields);
  });
});

// What: verify that DDL failures are surfaced honestly instead of being swallowed.
// Why: the previous behaviour caught DDL errors, marked migrationStatus: "pending",
// and returned success: true with a reassuring message. Admin UI showed green toasts
// while the database was unchanged. Task 11 requires failed applies to return
// success: false with the real error and to roll back metadata/registry state.
vi.mock("../services/runtime-schema-generator.js", () => ({
  generateRuntimeSchema: vi.fn((tableName: string) => ({
    table: { __fakeTable: true, _: { name: tableName } },
    schemaRecord: { tableName, columns: {} },
  })),
}));

describe("SchemaChangeService.apply - DDL failure surfacing", () => {
  let service: SchemaChangeService;
  let failingPushService: { apply: ReturnType<typeof vi.fn> };
  let collectionRegistryMock: {
    updateCollection: ReturnType<typeof vi.fn>;
    getCollectionBySlug: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    failingPushService = {
      apply: vi
        .fn()
        .mockRejectedValue(new Error("drizzle-kit not resolvable in bundler")),
    };
    collectionRegistryMock = {
      updateCollection: vi.fn().mockResolvedValue({}),
      getCollectionBySlug: vi.fn().mockResolvedValue(null),
    };
    // Adapter mock that returns a drizzle-like object supporting the
    // methods runBackfills might call. We only care that backfills doesn't
    // throw for this test scenario (no interactive resolutions).
    const adapterMock = {
      getDrizzle: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          set: vi
            .fn()
            .mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
        }),
      }),
    } as any;
    const schemaRegistryMock = {
      getTable: vi.fn().mockReturnValue({ __fakeOldTable: true }),
      registerDynamicSchema: vi.fn(),
      getDialect: vi.fn().mockReturnValue("postgresql"),
    } as any;

    service = new SchemaChangeService(
      adapterMock,
      schemaRegistryMock,
      failingPushService as any
    );
  });

  it("returns success: false with the DDL error when pushService.apply throws", async () => {
    const currentFields: FieldDefinition[] = [
      { name: "title", type: "text", required: true } as FieldDefinition,
    ];
    const newFields: FieldDefinition[] = [
      { name: "title", type: "text", required: true } as FieldDefinition,
      { name: "views", type: "number", required: false } as FieldDefinition,
    ];

    const result = await service.apply(
      "posts",
      "posts",
      currentFields,
      newFields,
      1,
      collectionRegistryMock as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("drizzle-kit not resolvable in bundler");
    // Why: the caller (admin UI or wrapper) needs the raw error to surface to the user.
    expect(result.message).not.toContain("applied successfully");
  });

  it("rolls back the dynamic_collections metadata on DDL failure", async () => {
    const currentFields: FieldDefinition[] = [
      { name: "title", type: "text" } as FieldDefinition,
    ];
    const newFields: FieldDefinition[] = [
      { name: "title", type: "text" } as FieldDefinition,
      { name: "views", type: "number" } as FieldDefinition,
    ];

    await service.apply(
      "posts",
      "posts",
      currentFields,
      newFields,
      1,
      collectionRegistryMock as any
    );

    // First call writes the new state ("applied"). Second call rolls back to
    // the original state once DDL fails. We do not want migrationStatus left
    // as "applied" or "pending" after a failure - it should be "failed" or
    // match the original state so the next apply attempt starts clean.
    const updateCalls = collectionRegistryMock.updateCollection.mock.calls;
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);
    const rollbackCall = updateCalls[updateCalls.length - 1];
    expect(rollbackCall[0]).toBe("posts");
    const rollbackPayload = rollbackCall[1] as Record<string, unknown>;
    // Rollback should restore fields to currentFields and not keep schemaVersion bumped.
    expect(rollbackPayload.fields).toEqual(currentFields);
  });
});
