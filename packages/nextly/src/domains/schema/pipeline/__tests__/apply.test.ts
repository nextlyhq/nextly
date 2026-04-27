import { describe, expect, it, vi } from "vitest";

import type { DesiredSchema } from "../types.js";

import { createApplyDesiredSchema } from "../apply.js";

// Build a stub deps object. Each dep is a minimal mock that the test
// can shape per scenario. Helper keeps test bodies focused on behavior.
function makeStubDeps(overrides?: {
  applySingleResource?: ReturnType<typeof vi.fn>;
  readSchemaVersionForSlug?: ReturnType<typeof vi.fn>;
  readNewSchemaVersionsForSlugs?: ReturnType<typeof vi.fn>;
}) {
  return {
    applySingleResource:
      overrides?.applySingleResource ??
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
  it("returns success when single-resource shim succeeds", async () => {
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

  it("returns SCHEMA_VERSION_CONFLICT for UI source with stale version", async () => {
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
    expect(deps.applySingleResource).not.toHaveBeenCalled();
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
    expect(deps.applySingleResource).toHaveBeenCalledOnce();
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
    expect(deps.applySingleResource).toHaveBeenCalledOnce();
  });

  it("resolves promptChannel 'auto' to 'terminal' (F10 deferred)", async () => {
    const deps = makeStubDeps();
    deps.readNewSchemaVersionsForSlugs = vi
      .fn()
      .mockResolvedValue({ posts: 1 });
    const apply = createApplyDesiredSchema(deps);

    await apply(onePostsCollection, "ui", { promptChannel: "auto" });

    expect(deps.applySingleResource).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "posts" }),
      "ui",
      "terminal"
    );
  });

  it("returns failure with classified error when shim throws", async () => {
    const err = new Error("DB connection refused");
    const deps = makeStubDeps({
      applySingleResource: vi.fn().mockRejectedValue(err),
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

  it("sets partiallyApplied=true when second resource fails after first succeeds", async () => {
    let callCount = 0;
    const deps = makeStubDeps({
      applySingleResource: vi.fn().mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({
            success: true,
            statementsExecuted: 1,
            renamesApplied: 0,
          });
        }
        return Promise.reject(new Error("second failed"));
      }),
    });
    const apply = createApplyDesiredSchema(deps);

    const twoCollections: DesiredSchema = {
      collections: {
        posts: { slug: "posts", tableName: "dc_posts", fields: [] },
        pages: { slug: "pages", tableName: "dc_pages", fields: [] },
      },
      singles: {},
      components: {},
    };

    const result = await apply(twoCollections, "code", {
      promptChannel: "terminal",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.partiallyApplied).toBe(true);
    }
  });

  it("returns success with empty resources (no-op)", async () => {
    const deps = makeStubDeps();
    deps.readNewSchemaVersionsForSlugs = vi.fn().mockResolvedValue({});
    const apply = createApplyDesiredSchema(deps);

    const result = await apply(emptyDesired, "code", {
      promptChannel: "terminal",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.statementsExecuted).toBe(0);
      expect(result.renamesApplied).toBe(0);
    }
    expect(deps.applySingleResource).not.toHaveBeenCalled();
  });

  it("compile-time check: discriminated union narrows to success branch", () => {
    // TypeScript-narrowing assertion. If the discriminated union is misdefined,
    // the .newSchemaVersions read in the success branch would compile without
    // narrowing — which we want to fail at compile time. The runtime test is
    // only a carrier; tsc enforces the actual property access guard.
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
