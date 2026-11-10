// Unit tests for RealPreCleanupExecutor.

import { afterEach, describe, it, expect, vi } from "vitest";

import type { NextlySchemaSnapshot, Operation } from "../../diff/types";
import { PromptCancelledError } from "../../prompt-dispatcher/errors";
import type {
  AddNotNullWithNullsEvent,
  ClassifierEvent,
  Resolution,
} from "../../resolution/types";
import {
  assertLiveCounts,
  assertPreCleanupAccepted,
  RealPreCleanupExecutor,
  withAddedColumnsLeftToTighten,
} from "../executor";

// The rows a change would break as the database holds them now, keyed `table.column` (`table.null`
// for every row): 0 for anything a case does not set, so only the cases about a changed count see
// one.
const liveCounts = vi.hoisted(() => new Map<string, number>());
vi.mock("../../classifier/count-helpers", async importOriginal => ({
  ...(await importOriginal<object>()),
  countRowsBreakingNotNull: (
    _db: unknown,
    _dialect: unknown,
    target: { table: string; column: string | null }
  ) =>
    Promise.resolve({
      total: liveCounts.get(`${target.table}.${String(target.column)}`) ?? 0,
      byParentTable: new Map(),
    }),
}));
afterEach(() => {
  liveCounts.clear();
  vi.unstubAllEnvs();
});

const baseSnapshot: NextlySchemaSnapshot = {
  tables: [
    {
      name: "dc_users",
      columns: [
        { name: "id", type: "text", nullable: false },
        { name: "email", type: "text", nullable: false },
      ],
    },
  ],
};

// Typed as its own kind, so a test spreading it may set that kind's fields.
const notNullEvent: AddNotNullWithNullsEvent = {
  id: "add_not_null_with_nulls:dc_users.email",
  kind: "add_not_null_with_nulls",
  tableName: "dc_users",
  columnName: "email",
  nullCount: 3,
  tableRowCount: 47,
  applicableResolutions: [
    "provide_default",
    "make_optional",
    "delete_nonconforming",
    "abort",
  ],
};

describe("RealPreCleanupExecutor", () => {
  it("provide_default: runs UPDATE with bound value", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 3 });
    const exec = new RealPreCleanupExecutor();
    await exec.execute({
      tx: { execute },
      desiredSnapshot: baseSnapshot,
      resolutions: [
        {
          kind: "provide_default",
          eventId: notNullEvent.id,
          value: "guest@example.com",
        },
      ],
      events: [notNullEvent],
      operations: [],
      fields: [{ tableName: "dc_users", name: "email", type: "text" }],
      dialect: "postgresql",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("provide_default: rejects invalid value with INVALID_DEFAULT_FOR_TYPE", async () => {
    const exec = new RealPreCleanupExecutor();
    await expect(
      exec.execute({
        tx: { execute: vi.fn() },
        desiredSnapshot: baseSnapshot,
        resolutions: [
          {
            kind: "provide_default",
            eventId: notNullEvent.id,
            value: 42, // invalid for text field
          },
        ],
        events: [notNullEvent],
        operations: [],
        fields: [{ tableName: "dc_users", name: "email", type: "text" }],
        dialect: "postgresql",
      })
    ).rejects.toThrow(/INVALID_DEFAULT_FOR_TYPE/);
  });

  /** A Required column added over rows that have none, named as the table names it. */
  const addedOver = (columnName: string): AddNotNullWithNullsEvent => ({
    ...notNullEvent,
    id: `add_not_null_with_nulls:dc_users.${columnName}`,
    columnName,
  });

  /** Run one provide_default for `columnName` against these fields on this dialect. */
  const provide = (
    columnName: string,
    field: { name: string; type: string; unique?: boolean },
    value: unknown,
    dialect: "postgresql" | "mysql" | "sqlite"
  ) =>
    new RealPreCleanupExecutor().execute({
      // `execute` where the dialect's driver runs statements so, `run` on SQLite.
      tx: {
        execute: vi.fn().mockResolvedValue({ rowCount: 3 }),
        run: vi.fn().mockResolvedValue({ changes: 3 }),
      },
      desiredSnapshot: baseSnapshot,
      resolutions: [
        {
          kind: "provide_default",
          eventId: addedOver(columnName).id,
          value,
        },
      ],
      events: [addedOver(columnName)],
      operations: [],
      fields: [{ tableName: "dc_users", ...field }],
      dialect,
    });

  it("provide_default: judges a camelCase field's value by its type, found by its column", async () => {
    const itemCount = { name: "itemCount", type: "number" };
    await expect(
      provide("item_count", itemCount, 0, "postgresql")
    ).resolves.toBeDefined();
    // Found as a number, not passed as text: a string is refused.
    await expect(
      provide("item_count", itemCount, "abc", "postgresql")
    ).rejects.toThrow(/INVALID_DEFAULT_FOR_TYPE: item_count \(number\)/);
  });

  it("provide_default: takes on SQLite the 0/1 and epoch seconds its boolean and date columns store", async () => {
    const featured = { name: "isFeatured", type: "checkbox" };
    const published = { name: "publishedOn", type: "date" };
    await expect(
      provide("is_featured", featured, 0, "sqlite")
    ).resolves.toBeDefined();
    await expect(
      provide("published_on", published, 1_700_000_000, "sqlite")
    ).resolves.toBeDefined();
    // Elsewhere a boolean column takes a boolean, as a value typed in the schema dialog is.
    await expect(
      provide("is_featured", featured, 0, "postgresql")
    ).rejects.toThrow(/INVALID_DEFAULT_FOR_TYPE/);
    await expect(provide("is_featured", featured, 2, "sqlite")).rejects.toThrow(
      /INVALID_DEFAULT_FOR_TYPE/
    );
  });

  // The fill's field is the one on the event's table: a same-named field elsewhere has its own type.
  it("provide_default: judges the value by the field on the event's own table", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 3 });
    await expect(
      new RealPreCleanupExecutor().execute({
        tx: { execute },
        desiredSnapshot: baseSnapshot,
        resolutions: [
          {
            kind: "provide_default",
            eventId: addedOver("tally").id,
            value: "plenty",
          },
        ],
        events: [addedOver("tally")],
        operations: [],
        fields: [
          { tableName: "dc_posts", name: "tally", type: "number" },
          { tableName: "dc_users", name: "tally", type: "text" },
        ],
        dialect: "postgresql",
      })
    ).resolves.toBeDefined();
  });

  // Rows can change while the prompt is open: the classifier's counts are from before it, so the
  // threshold and the unique fill are judged again on the rows as they stand, before any statement.
  it("delete_nonconforming: refuses past the threshold on the rows as they stand now", async () => {
    vi.stubEnv("NEXTLY_DELETE_THRESHOLD", "5");
    liveCounts.set("dc_users.email", 7);
    const execute = vi.fn();
    await expect(
      assertLiveCounts({
        tx: { execute },
        resolutions: [
          { kind: "delete_nonconforming", eventId: notNullEvent.id },
        ],
        events: [notNullEvent],
        operations: [],
        dialect: "postgresql",
      })
    ).rejects.toThrow(/DELETE_THRESHOLD_EXCEEDED: 7 rows >= 5/);
    expect(execute).not.toHaveBeenCalled();
  });

  // What a fill must be, read from the desired schema: a table with no declared field (an
  // extension's) has its column's type, and a unique index declared on the collection rather than
  // the field is as unique as the field's own flag.
  describe("a fill's column, as the desired schema declares it", () => {
    const withExtension: NextlySchemaSnapshot = {
      tables: [
        ...baseSnapshot.tables,
        {
          name: "ext_items",
          columns: [
            { name: "id", type: "text", nullable: false },
            { name: "qty", type: "integer", nullable: false },
          ],
        },
      ],
    };
    const qtyEvent: ClassifierEvent = {
      ...notNullEvent,
      id: "add_not_null_with_nulls:ext_items.qty",
      tableName: "ext_items",
      columnName: "qty",
    };

    it("judges an extension column's fill by the column's type", () => {
      expect(() =>
        assertPreCleanupAccepted({
          resolutions: [
            { kind: "provide_default", eventId: qtyEvent.id, value: "many" },
          ],
          events: [qtyEvent],
          fields: [],
          desiredSnapshot: withExtension,
          dialect: "postgresql",
        })
      ).toThrow(/INVALID_DEFAULT_FOR_TYPE: qty \(number\)/);
    });
  });

  // A unique column is never offered "fill with one value" (the classifier leaves it out), so a
  // request sending one anyway is refused before any statement, as any answer not offered is.
  it("refuses a fill value for a unique column, which its event does not offer", async () => {
    const execute = vi.fn();
    const uniqueEvent: ClassifierEvent = {
      ...addedOver("handle"),
      applicableResolutions: ["make_optional", "delete_nonconforming", "abort"],
    };
    await expect(
      new RealPreCleanupExecutor().execute({
        tx: { execute },
        desiredSnapshot: baseSnapshot,
        resolutions: [
          { kind: "provide_default", eventId: uniqueEvent.id, value: "same" },
        ],
        events: [uniqueEvent],
        operations: [],
        fields: [{ tableName: "dc_users", name: "handle", type: "text" }],
        dialect: "postgresql",
      })
    ).rejects.toMatchObject({
      publicData: {
        errors: [expect.objectContaining({ code: "RESOLUTION_NOT_OFFERED" })],
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("delete_nonconforming: runs DELETE", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 3 });
    const exec = new RealPreCleanupExecutor();
    await exec.execute({
      tx: { execute },
      desiredSnapshot: baseSnapshot,
      resolutions: [{ kind: "delete_nonconforming", eventId: notNullEvent.id }],
      events: [notNullEvent],
      operations: [],
      fields: [{ tableName: "dc_users", name: "email", type: "text" }],
      dialect: "postgresql",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("delete_nonconforming: throws DELETE_THRESHOLD_EXCEEDED above default 10000", async () => {
    const execute = vi.fn();
    const exec = new RealPreCleanupExecutor();
    const bigEvent: ClassifierEvent = {
      ...notNullEvent,
      nullCount: 10000,
    };
    await expect(
      exec.execute({
        tx: { execute },
        desiredSnapshot: baseSnapshot,
        resolutions: [{ kind: "delete_nonconforming", eventId: bigEvent.id }],
        events: [bigEvent],
        operations: [],
        fields: [{ tableName: "dc_users", name: "email", type: "text" }],
        dialect: "postgresql",
      })
    ).rejects.toThrow(/DELETE_THRESHOLD_EXCEEDED/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("make_optional: runs no SQL, patches snapshot to nullable=true", async () => {
    const execute = vi.fn();
    const exec = new RealPreCleanupExecutor();
    const out = await exec.execute({
      tx: { execute },
      desiredSnapshot: baseSnapshot,
      resolutions: [{ kind: "make_optional", eventId: notNullEvent.id }],
      events: [notNullEvent],
      operations: [],
      fields: [{ tableName: "dc_users", name: "email", type: "text" }],
      dialect: "postgresql",
    });
    expect(execute).not.toHaveBeenCalled();
    expect(out.tables[0].columns[1].nullable).toBe(true);
  });

  it("abort: throws PromptCancelledError, runs no SQL", async () => {
    const execute = vi.fn();
    const exec = new RealPreCleanupExecutor();
    await expect(
      exec.execute({
        tx: { execute },
        desiredSnapshot: baseSnapshot,
        resolutions: [{ kind: "abort", eventId: notNullEvent.id }],
        events: [notNullEvent],
        operations: [],
        fields: [{ tableName: "dc_users", name: "email", type: "text" }],
        dialect: "postgresql",
      })
    ).rejects.toThrow(PromptCancelledError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns input snapshot unchanged when no resolutions", async () => {
    const exec = new RealPreCleanupExecutor();
    const out = await exec.execute({
      tx: { execute: vi.fn() },
      desiredSnapshot: baseSnapshot,
      resolutions: [],
      events: [],
      operations: [],
      fields: [],
      dialect: "postgresql",
    });
    expect(out).toBe(baseSnapshot);
  });

  it("throws DUPLICATE_RESOLUTION_FOR_EVENT when same eventId has multiple resolutions", async () => {
    // Defense in depth: dispatcher contract is one resolution per event;
    // multiples mean ambiguous intent (e.g. UPDATE then DELETE on same col).
    const exec = new RealPreCleanupExecutor();
    await expect(
      exec.execute({
        tx: { execute: vi.fn() },
        desiredSnapshot: baseSnapshot,
        resolutions: [
          {
            kind: "provide_default",
            eventId: notNullEvent.id,
            value: "x@y.com",
          },
          { kind: "delete_nonconforming", eventId: notNullEvent.id },
        ],
        events: [notNullEvent],
        operations: [],
        fields: [{ tableName: "dc_users", name: "email", type: "text" }],
        dialect: "postgresql",
      })
    ).rejects.toThrow(/DUPLICATE_RESOLUTION_FOR_EVENT/);
  });

  it("ignores resolutions that don't match any known event id", async () => {
    const execute = vi.fn();
    const exec = new RealPreCleanupExecutor();
    await exec.execute({
      tx: { execute },
      desiredSnapshot: baseSnapshot,
      resolutions: [
        {
          kind: "provide_default",
          eventId: "add_not_null_with_nulls:no.such",
          value: "x",
        },
      ],
      events: [],
      operations: [],
      fields: [],
      dialect: "postgresql",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  // A NEW required column (add_required_field_no_default) does not exist when pre-cleanup runs:
  // the fill can only work once the column has been added, nullable, ahead of it.
  describe("a required column this apply adds", () => {
    const addedSnapshot: NextlySchemaSnapshot = {
      tables: [
        {
          name: "dc_users",
          columns: [
            { name: "id", type: "text", nullable: false },
            { name: "nickname", type: "text", nullable: false },
          ],
        },
      ],
    };
    const addedEvent: ClassifierEvent = {
      id: "add_required_field_no_default:dc_users.nickname",
      kind: "add_required_field_no_default",
      tableName: "dc_users",
      columnName: "nickname",
      tableRowCount: 3,
      applicableResolutions: ["provide_default", "make_optional", "abort"],
    };

    /** Every statement `execute` received, rendered as PostgreSQL. */
    async function rendered(execute: ReturnType<typeof vi.fn>) {
      const { PgDialect } = await import("drizzle-orm/pg-core");
      const pg = new PgDialect();
      return execute.mock.calls.map(call => pg.sqlToQuery(call[0]).sql);
    }

    it.each([
      [
        "provide_default",
        { kind: "provide_default", eventId: addedEvent.id, value: "anon" },
        `UPDATE "dc_users" SET "nickname" = $1 WHERE "nickname" IS NULL`,
      ],
    ] as const)(
      "%s: adds the column nullable before the statement that needs it",
      async (_kind, resolution, fill) => {
        const execute = vi.fn().mockResolvedValue({ rowCount: 3 });
        await new RealPreCleanupExecutor().execute({
          tx: { execute },
          desiredSnapshot: addedSnapshot,
          resolutions: [resolution as Resolution],
          events: [addedEvent],
          operations: [],
          fields: [{ tableName: "dc_users", name: "nickname", type: "text" }],
          dialect: "postgresql",
        });
        expect(await rendered(execute)).toEqual([
          `ALTER TABLE "dc_users" ADD COLUMN "nickname" text`,
          fill,
        ]);
      }
    );

    // A field renamed and made required in one apply: the drop and add pair is a confirmed rename,
    // so the column is there, renamed, when pre-cleanup runs, and only its fill is left to do.
    it("leaves a column a confirmed rename brings to only its fill", async () => {
      const execute = vi.fn().mockResolvedValue({ rowCount: 3 });
      const renamed: Operation = {
        type: "rename_column",
        tableName: "dc_users",
        fromColumn: "nick",
        toColumn: "nickname",
        fromType: "text",
        toType: "text",
      };
      const resolutions: Resolution[] = [
        { kind: "provide_default", eventId: addedEvent.id, value: "anon" },
      ];
      await new RealPreCleanupExecutor().execute({
        tx: { execute },
        desiredSnapshot: addedSnapshot,
        resolutions,
        events: [addedEvent],
        operations: [renamed],
        fields: [{ tableName: "dc_users", name: "nickname", type: "text" }],
        dialect: "postgresql",
      });
      expect(await rendered(execute)).toEqual([
        `UPDATE "dc_users" SET "nickname" = $1 WHERE "nickname" IS NULL`,
      ]);
      // The rest of the apply keeps the rename and makes the renamed column NOT NULL once it is
      // filled: the rename alone carries no nullability, and SQLite's rebuild needs this to run.
      expect(
        withAddedColumnsLeftToTighten([renamed], resolutions, [addedEvent])
      ).toEqual([
        renamed,
        {
          type: "change_column_nullable",
          tableName: "dc_users",
          columnName: "nickname",
          fromNullable: true,
          toNullable: false,
        },
      ]);
      // A rename the apply leaves optional raises no such event, and is left as it is.
      expect(withAddedColumnsLeftToTighten([renamed], [], [])).toEqual([
        renamed,
      ]);
    });

    it("leaves a column already in the table alone: only the fill runs", async () => {
      const execute = vi.fn().mockResolvedValue({ rowCount: 3 });
      await new RealPreCleanupExecutor().execute({
        tx: { execute },
        desiredSnapshot: baseSnapshot,
        resolutions: [
          { kind: "provide_default", eventId: notNullEvent.id, value: "a@b.c" },
        ],
        events: [notNullEvent],
        operations: [],
        fields: [{ tableName: "dc_users", name: "email", type: "text" }],
        dialect: "postgresql",
      });
      expect(await rendered(execute)).toEqual([
        `UPDATE "dc_users" SET "email" = $1 WHERE "email" IS NULL`,
      ]);
    });

    const addNickname: Operation = {
      type: "add_column",
      tableName: "dc_users",
      column: { name: "nickname", type: "text", nullable: false },
    };
    const addBio: Operation = {
      type: "add_column",
      tableName: "dc_users",
      column: { name: "bio", type: "text", nullable: true },
    };

    it("leaves the rest of the apply only the NOT NULL to add, for a column pre-cleanup adds", () => {
      expect(
        withAddedColumnsLeftToTighten(
          [addNickname, addBio],
          [{ kind: "provide_default", eventId: addedEvent.id, value: "anon" }],
          [addedEvent]
        )
      ).toEqual([
        {
          type: "change_column_nullable",
          tableName: "dc_users",
          columnName: "nickname",
          fromNullable: true,
          toNullable: false,
        },
        addBio,
      ]);
    });

    it("keeps the ADD COLUMN for a column pre-cleanup does not add", () => {
      for (const resolution of [
        { kind: "make_optional", eventId: addedEvent.id },
        {
          kind: "provide_default",
          eventId: "add_required_field_no_default:dc_users.other",
          value: "anon",
        },
      ] as Resolution[]) {
        expect(
          withAddedColumnsLeftToTighten(
            [addNickname, addBio],
            [resolution],
            [addedEvent]
          )
        ).toEqual([addNickname, addBio]);
      }
    });

    // Every row of a column this apply adds is null, so deleting the nonconforming rows would
    // delete the table's every row: the event does not offer it, and a request carrying it
    // (a stale or hand-made browser payload) is refused before any statement.
    it("refuses an answer its event does not offer, before any statement", async () => {
      const execute = vi.fn();
      const resolutions: Resolution[] = [
        { kind: "delete_nonconforming", eventId: addedEvent.id },
      ];
      await expect(
        new RealPreCleanupExecutor().execute({
          tx: { execute },
          desiredSnapshot: addedSnapshot,
          resolutions,
          events: [addedEvent],
          operations: [],
          fields: [{ tableName: "dc_users", name: "nickname", type: "text" }],
          dialect: "postgresql",
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            {
              path: "fields.nickname",
              code: "RESOLUTION_NOT_OFFERED",
              message:
                "Table 'dc_users': column 'nickname' cannot be answered with delete_nonconforming, which this change does not offer (it offers provide_default, make_optional, abort). Nothing was changed.",
            },
          ],
        },
      });
      expect(execute).not.toHaveBeenCalled();
      // The same precondition the pipeline runs before anything else.
      expect(() =>
        assertPreCleanupAccepted({
          resolutions,
          events: [addedEvent],
          fields: [{ tableName: "dc_users", name: "nickname", type: "text" }],
          desiredSnapshot: addedSnapshot,
          dialect: "postgresql",
        })
      ).toThrow();
    });

    it("refuses a column the desired schema does not describe, before any statement", async () => {
      const execute = vi.fn();
      await expect(
        new RealPreCleanupExecutor().execute({
          tx: { execute },
          desiredSnapshot: baseSnapshot,
          resolutions: [
            { kind: "provide_default", eventId: addedEvent.id, value: "anon" },
          ],
          events: [addedEvent],
          operations: [],
          fields: [{ tableName: "dc_users", name: "nickname", type: "text" }],
          dialect: "postgresql",
        })
      ).rejects.toThrow();
      expect(execute).not.toHaveBeenCalled();
    });
  });
});
