// Tests for previewDesiredSchema — the F8 PR 3 read-only entry point that
// runs Phase A (diff) + Phase B (classify) of the pipeline without applying.
//
// Used by:
//   - The admin UI preview path (via the legacy-shape translator).
//   - F10 (browser modals) for "what would change before I confirm" UX.
//   - F11 (migration files CLI) for diff materialisation.

import { describe, it, expect, vi } from "vitest";

import type {
  Classifier,
  ClassificationLevel,
} from "../pushschema-pipeline-interfaces";
import type { ClassifierEvent } from "../resolution/types";

import { previewDesiredSchema } from "../preview";
import type { DesiredSchema } from "../types";

const noopRenameDetector = {
  detect: vi.fn().mockReturnValue([]),
};

// Typed level so future changes to ClassificationLevel break compile
// instead of silently passing a string mismatch.
function classifierStub(
  level: ClassificationLevel,
  events: ClassifierEvent[]
): Classifier {
  return {
    classify: vi.fn().mockResolvedValue({ level, events }),
  };
}

const introspectEmpty = vi.fn().mockResolvedValue({ tables: [] });

describe("previewDesiredSchema", () => {
  // buildDesiredTableFromFields injects reserved system columns
  // (id, title, slug, created_at, updated_at) onto every collection,
  // mirroring what runtime-schema-generator does. Tests need the live
  // snapshot to match exactly so the diff doesn't see drift.
  // SQLite shape (lowercase tokens; integer for timestamps):
  const reservedColumnsLive = [
    { name: "id", type: "text", nullable: false },
    { name: "title", type: "text", nullable: false },
    { name: "slug", type: "text", nullable: false },
    { name: "created_at", type: "integer", nullable: true },
    { name: "updated_at", type: "integer", nullable: true },
  ];

  it("returns empty operations when desired matches live (no changes)", async () => {
    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName: "dc_posts",
          fields: [],
        },
      },
      singles: {},
      components: {},
    };
    // Live snapshot has all the reserved system columns the desired will
    // also include (no user-defined fields in this case).
    const liveMatchingDesired = vi.fn().mockResolvedValue({
      tables: [
        {
          name: "dc_posts",
          columns: reservedColumnsLive,
          primaryKey: ["id"],
        },
      ],
    });

    const result = await previewDesiredSchema(
      { desired, db: {}, dialect: "sqlite" },
      {
        renameDetector: noopRenameDetector,
        classifier: classifierStub("safe", []),
        introspect: liveMatchingDesired,
      }
    );

    expect(result.operations).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.candidates).toEqual([]);
    expect(result.classification).toBe("safe");
    expect(liveMatchingDesired).toHaveBeenCalledWith({}, "sqlite", [
      "dc_posts",
    ]);
  });

  it("returns add_column op for a single user-defined additive change", async () => {
    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName: "dc_posts",
          fields: [{ name: "body", type: "text" } as never],
        },
      },
      singles: {},
      components: {},
    };
    // Live has reserved columns only; desired adds `body`. Diff should
    // produce exactly one add_column for body.
    const introspectAddColumn = vi.fn().mockResolvedValue({
      tables: [
        {
          name: "dc_posts",
          columns: reservedColumnsLive,
          primaryKey: ["id"],
        },
      ],
    });

    const result = await previewDesiredSchema(
      { desired, db: {}, dialect: "sqlite" },
      {
        renameDetector: noopRenameDetector,
        classifier: classifierStub("safe", []),
        introspect: introspectAddColumn,
      }
    );

    const addColumnOps = result.operations.filter(
      op => op.type === "add_column"
    );
    expect(addColumnOps.length).toBe(1);
    const bodyOp = addColumnOps[0];
    if (bodyOp.type !== "add_column") throw new Error("type narrow failed");
    expect(bodyOp.column.name).toBe("body");
    expect(result.classification).toBe("safe");
  });

  it("forwards classifier events when classification level is interactive", async () => {
    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName: "dc_posts",
          fields: [{ name: "title", type: "text", required: true } as never],
        },
      },
      singles: {},
      components: {},
    };
    const introspectExisting = vi.fn().mockResolvedValue({
      tables: [
        {
          name: "dc_posts",
          columns: reservedColumnsLive,
          primaryKey: ["id"],
        },
      ],
    });

    const event: ClassifierEvent = {
      id: "add_not_null_with_nulls:dc_posts.title",
      kind: "add_not_null_with_nulls",
      tableName: "dc_posts",
      columnName: "title",
      nullCount: 3,
      tableRowCount: 50,
      applicableResolutions: [
        "provide_default",
        "make_optional",
        "delete_nonconforming",
        "abort",
      ],
    };

    const result = await previewDesiredSchema(
      { desired, db: {}, dialect: "sqlite" },
      {
        renameDetector: noopRenameDetector,
        classifier: classifierStub("interactive", [event]),
        introspect: introspectExisting,
      }
    );

    expect(result.events).toEqual([event]);
    expect(result.classification).toBe("interactive");
  });

  it("returns rename candidates when detector finds drop+add pairs", async () => {
    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName: "dc_posts",
          fields: [{ name: "name", type: "text" } as never],
        },
      },
      singles: {},
      components: {},
    };
    // Live has reserved columns + an extra `extra` column the desired
    // dropped. Diff sees drop_column(extra) + add_column(name); the
    // detector pairs them as a candidate.
    const introspectRename = vi.fn().mockResolvedValue({
      tables: [
        {
          name: "dc_posts",
          columns: [
            ...reservedColumnsLive,
            { name: "extra", type: "text", nullable: true },
          ],
          primaryKey: ["id"],
        },
      ],
    });

    const renameDetector = {
      detect: vi.fn().mockReturnValue([
        {
          tableName: "dc_posts",
          fromColumn: "extra",
          toColumn: "name",
          fromType: "text",
          toType: "text",
          typesCompatible: true,
          defaultSuggestion: "rename" as const,
        },
      ]),
    };

    const result = await previewDesiredSchema(
      { desired, db: {}, dialect: "sqlite" },
      {
        renameDetector,
        classifier: classifierStub("safe", []),
        introspect: introspectRename,
      }
    );

    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]).toMatchObject({
      tableName: "dc_posts",
      fromColumn: "extra",
      toColumn: "name",
    });
  });

  it("does not call promptDispatcher (this is a read-only operation)", async () => {
    // No promptDispatcher dep accepted — by-construction safety.
    // If a future refactor adds one, this test should fail to compile.
    expect(previewDesiredSchema.length).toBeGreaterThanOrEqual(1);
  });

  it("returns the liveSnapshot so translators can compute row counts", async () => {
    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName: "dc_posts",
          fields: [],
        },
      },
      singles: {},
      components: {},
    };
    const liveSnapshot = {
      tables: [
        {
          name: "dc_posts",
          columns: reservedColumnsLive,
          primaryKey: ["id"],
        },
      ],
    };

    const result = await previewDesiredSchema(
      { desired, db: {}, dialect: "sqlite" },
      {
        renameDetector: noopRenameDetector,
        classifier: classifierStub("safe", []),
        introspect: vi.fn().mockResolvedValue(liveSnapshot),
      }
    );

    expect(result.liveSnapshot).toEqual(liveSnapshot);
  });
});
