import { describe, expect, it, vi } from "vitest";

import type { DesiredSchema } from "../types.js";

import { createApplyDesiredSchema } from "../apply.js";

// Build a stub deps object. Each dep is a vi.fn() the tests can shape
// per scenario. F3 PR-2: replaced applySingleResource with applyPipeline
// (single full-snapshot call, not per-resource loop).
function makeStubDeps(overrides?: {
  applyPipeline?: ReturnType<typeof vi.fn>;
  readSchemaVersionForSlug?: ReturnType<typeof vi.fn>;
  readNewSchemaVersionsForSlugs?: ReturnType<typeof vi.fn>;
}) {
  return {
    applyPipeline:
      overrides?.applyPipeline ??
      vi.fn().mockResolvedValue({
        success: true,
        statementsExecuted: 1,
        renamesApplied: 0,
      }),
    readSchemaVersionForSlug:
      overrides?.readSchemaVersionForSlug ?? vi.fn().mockResolvedValue(null),
    readNewSchemaVersionsForSlugs:
      overrides?.readNewSchemaVersionsForSlugs ?? vi.fn().mockResolvedValue({}),
  };
}

const emptyDesired: DesiredSchema = {
  collections: {},
  singles: {},
  components: {},
};

const onePostsCollection: DesiredSchema = {
  collections: {
    posts: { slug: "posts", tableName: "dc_posts", fields: [] },
  },
  singles: {},
  components: {},
};

describe("applyDesiredSchema (via createApplyDesiredSchema factory)", () => {
  it("returns success when pipeline succeeds", async () => {
    const deps = makeStubDeps();
    deps.readNewSchemaVersionsForSlugs = vi
      .fn()
      .mockResolvedValue({ posts: 2 });
    const apply = createApplyDesiredSchema(deps);

    const result = await apply(onePostsCollection, "code", {
      promptChannel: "terminal",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.newSchemaVersions).toEqual({ posts: 2 });
      expect(result.statementsExecuted).toBe(1);
      expect(result.renamesApplied).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns SCHEMA_VERSION_CONFLICT for UI source with stale version (skips pipeline)", async () => {
    const deps = makeStubDeps({
      readSchemaVersionForSlug: vi.fn().mockResolvedValue(5),
    });
    const apply = createApplyDesiredSchema(deps);

    const result = await apply(onePostsCollection, "ui", {
      schemaVersions: { posts: 4 },
      promptChannel: "auto",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("SCHEMA_VERSION_CONFLICT");
      expect(result.error.message).toContain("posts");
    }
    expect(deps.applyPipeline).not.toHaveBeenCalled();
  });

  it("skips version check when source is 'code' even if schemaVersions provided", async () => {
    const deps = makeStubDeps({
      readSchemaVersionForSlug: vi.fn().mockResolvedValue(5),
    });
    deps.readNewSchemaVersionsForSlugs = vi
      .fn()
      .mockResolvedValue({ posts: 6 });
    const apply = createApplyDesiredSchema(deps);

    const result = await apply(onePostsCollection, "code", {
      schemaVersions: { posts: 4 },
      promptChannel: "terminal",
    });

    expect(result.success).toBe(true);
    expect(deps.readSchemaVersionForSlug).not.toHaveBeenCalled();
    expect(deps.applyPipeline).toHaveBeenCalledOnce();
  });

  it("skips version check on fresh DB (read returns null)", async () => {
    const deps = makeStubDeps({
      readSchemaVersionForSlug: vi.fn().mockResolvedValue(null),
    });
    deps.readNewSchemaVersionsForSlugs = vi
      .fn()
      .mockResolvedValue({ posts: 1 });
    const apply = createApplyDesiredSchema(deps);

    const result = await apply(onePostsCollection, "ui", {
      schemaVersions: { posts: 4 },
      promptChannel: "auto",
    });

    expect(result.success).toBe(true);
    expect(deps.applyPipeline).toHaveBeenCalledOnce();
  });

  it("resolves promptChannel 'auto' to 'terminal' (F10 deferred)", async () => {
    const deps = makeStubDeps();
    deps.readNewSchemaVersionsForSlugs = vi
      .fn()
      .mockResolvedValue({ posts: 1 });
    const apply = createApplyDesiredSchema(deps);

    await apply(onePostsCollection, "ui", { promptChannel: "auto" });

    expect(deps.applyPipeline).toHaveBeenCalledWith(
      onePostsCollection,
      "ui",
      "terminal"
    );
  });

  it("calls applyPipeline with the FULL snapshot (not per-resource)", async () => {
    const deps = makeStubDeps();
    const apply = createApplyDesiredSchema(deps);

    const fullSnapshot: DesiredSchema = {
      collections: {
        posts: { slug: "posts", tableName: "dc_posts", fields: [] },
        pages: { slug: "pages", tableName: "dc_pages", fields: [] },
      },
      singles: {},
      components: {},
    };

    await apply(fullSnapshot, "code", { promptChannel: "terminal" });

    // Single call, full snapshot — not one call per resource.
    expect(deps.applyPipeline).toHaveBeenCalledOnce();
    expect(deps.applyPipeline).toHaveBeenCalledWith(
      fullSnapshot,
      "code",
      "terminal"
    );
  });

  it("returns failure with classified error when pipeline throws", async () => {
    const err = new Error("DB connection refused");
    const deps = makeStubDeps({
      applyPipeline: vi.fn().mockRejectedValue(err),
    });
    const apply = createApplyDesiredSchema(deps);

    const result = await apply(onePostsCollection, "code", {
      promptChannel: "terminal",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.message).toBe("DB connection refused");
    }
  });

  it("forwards pipeline failure result through to ApplyResult", async () => {
    const deps = makeStubDeps({
      applyPipeline: vi.fn().mockResolvedValue({
        success: false,
        statementsExecuted: 0,
        renamesApplied: 0,
        error: {
          code: "PUSHSCHEMA_FAILED",
          message: "drizzle-kit blew up",
        },
      }),
    });
    const apply = createApplyDesiredSchema(deps);

    const result = await apply(onePostsCollection, "code", {
      promptChannel: "terminal",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("PUSHSCHEMA_FAILED");
      expect(result.error.message).toBe("drizzle-kit blew up");
    }
  });

  it("forwards partiallyApplied flag from pipeline result (MySQL mid-loop failure)", async () => {
    const deps = makeStubDeps({
      applyPipeline: vi.fn().mockResolvedValue({
        success: false,
        statementsExecuted: 1,
        renamesApplied: 0,
        partiallyApplied: true,
        error: {
          code: "DDL_EXECUTION_FAILED",
          message: "constraint violation on second statement",
        },
      }),
    });
    const apply = createApplyDesiredSchema(deps);

    const result = await apply(onePostsCollection, "code", {
      promptChannel: "terminal",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.partiallyApplied).toBe(true);
      expect(result.error.code).toBe("DDL_EXECUTION_FAILED");
    }
  });

  it("returns success with empty resources (no-op; pipeline still called)", async () => {
    const deps = makeStubDeps();
    deps.readNewSchemaVersionsForSlugs = vi.fn().mockResolvedValue({});
    const apply = createApplyDesiredSchema(deps);

    const result = await apply(emptyDesired, "code", {
      promptChannel: "terminal",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.statementsExecuted).toBe(1); // stub default
      expect(result.renamesApplied).toBe(0);
    }
    expect(deps.applyPipeline).toHaveBeenCalledOnce();
  });

  it("compile-time check: discriminated union narrows to success branch", () => {
    // TypeScript-narrowing assertion. If the discriminated union is
    // misdefined, the .newSchemaVersions read in the success branch
    // would compile without narrowing — which we want to fail at
    // compile time. The runtime test is only a carrier; tsc enforces
    // the actual property access guard.
    const result = {
      success: false,
      error: { code: "INTERNAL_ERROR" as const, message: "x" },
      durationMs: 0,
    } as Awaited<ReturnType<ReturnType<typeof createApplyDesiredSchema>>>;
    if (result.success) {
      const v: Record<string, number> = result.newSchemaVersions;
      expect(v).toBeDefined();
    } else {
      expect(result.error.code).toBe("INTERNAL_ERROR");
    }
  });
});
